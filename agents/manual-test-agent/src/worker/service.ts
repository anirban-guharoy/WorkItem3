import { Command } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { ProjectAuthorizer } from '../auth/authorizer.js';
import type { AppConfig } from '../config/index.js';
import type { Db } from '../database/db.js';
import { buildGraph, type CompiledWorkflow } from '../graph/index.js';
import type { GraphDeps } from '../graph/deps.js';
import type { McpReadGateway, McpWriteGateway } from '../mcp/types.js';
import type { DeadLetterHandler, MessageHandler, QueueConsumer, QueuePublisher } from '../messaging/types.js';
import type { TestGenerationModel } from '../models/types.js';
import { extractTraceContext, injectTraceContext, m, withSpan } from '../observability/telemetry.js';
import { repositoriesFor } from '../repositories/index.js';
import type { QueueMessage } from '../schemas/domain.js';
import { RetryLaterError, safeMessage } from '../shared/errors.js';
import type { BaseCheckpointSaver } from '@langchain/langgraph';

export interface WorkerDeps {
  db: Db;
  publisher: QueuePublisher;
  consumer: QueueConsumer;
  read: McpReadGateway;
  write: McpWriteGateway | undefined;
  model: TestGenerationModel;
  authorizer: ProjectAuthorizer;
  config: AppConfig;
  log: Logger;
  checkpointer: BaseCheckpointSaver;
}

const BUSY_RETRY_MS = 15_000;

export class WorkerService {
  readonly workerId = `worker-${randomUUID()}`;
  private readonly graph: CompiledWorkflow;
  private sweeper: NodeJS.Timeout | undefined;
  private sweeping = false;

  constructor(private readonly d: WorkerDeps) {
    const deps: GraphDeps = { ...d, workerId: this.workerId };
    this.graph = buildGraph(deps, d.checkpointer);
  }

  private get jobs() {
    return repositoriesFor(this.d.db).jobs;
  }

  readonly handle: MessageHandler = async (message, meta) => {
    await withSpan(
      'worker.handle_message',
      {
        'job.id': message.jobId,
        'message.type': message.type,
        'correlation.id': message.correlationId,
        'message.delivery_count': meta.deliveryCount,
      },
      async () => {
        if (message.type === 'generate') await this.runGenerate(message);
        else await this.runPublish(message);
      },
      extractTraceContext(meta.traceCarrier),
    );
  };

  readonly handleDeadLetter: DeadLetterHandler = async (message, reason) => {
    m.messagesDeadLettered.add(1);
    this.d.log.error({ jobId: message?.jobId, type: message?.type, reason }, 'message dead-lettered');
    if (!message) return;
    const repos = repositoriesFor(this.d.db);
    const job = await repos.jobs.get(message.jobId);
    if (!job) return;
    try {
      if (job.status === 'publishing' && message.publicationId) {
        await repos.publications.markFailed(message.publicationId, 'internal', `dead-lettered: ${reason}`);
      }
      if (job.status === 'queued' || job.status === 'running' || job.status === 'publishing') {
        await repos.jobs.transition(job.id, {
          to: 'failed',
          set: {
            failureCategory: 'internal',
            failureMessage: `Processing failed after retries (${reason})`.slice(0, 500),
          },
        });
      }
    } finally {
      await repos.audit.append({
        jobId: job.id,
        eventType: 'message_dead_lettered',
        actor: this.workerId,
        correlationId: message.correlationId,
        details: { reason, type: message.type },
      });
    }
  };

  private async withLease<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
    const leaseSeconds = this.d.config.WORKER_LEASE_SECONDS;
    const timer = setInterval(
      () => {
        this.jobs
          .heartbeat(jobId, this.workerId, leaseSeconds)
          .catch((err: unknown) => this.d.log.warn({ jobId, err: safeMessage(err) }, 'heartbeat failed'));
      },
      Math.max(1000, (leaseSeconds * 1000) / 3),
    );
    timer.unref();
    try {
      return await fn();
    } catch (err) {
      await this.jobs.releaseLease(jobId, this.workerId).catch(() => undefined);
      throw err;
    } finally {
      clearInterval(timer);
    }
  }

  private async runGenerate(msg: QueueMessage): Promise<void> {
    const claim = await this.jobs.claim(
      msg.jobId,
      this.workerId,
      'generate',
      msg.attempt,
      this.d.config.WORKER_LEASE_SECONDS,
    );
    if (!claim.claimed) return this.skip(msg, claim.reason);
    await this.withLease(msg.jobId, async () => {
      const cfg = { configurable: { thread_id: `${msg.jobId}:${msg.attempt}` }, recursionLimit: 60 };
      const snap = await this.graph.getState(cfg);
      if (snap.next.length > 0) await this.graph.invoke(null, cfg);
      else if (!snap.values?.jobId)
        await this.graph.invoke({ jobId: msg.jobId, attempt: msg.attempt, phase: 'generate' }, cfg);
    });
  }

  private async runPublish(msg: QueueMessage): Promise<void> {
    if (!msg.publicationId) throw new Error('publish message without publicationId');
    const repos = repositoriesFor(this.d.db);
    const publication = await repos.publications.get(msg.publicationId);
    if (!publication) return this.skip(msg, 'missing');
    const claim = await this.jobs.claim(
      msg.jobId,
      this.workerId,
      'publish',
      msg.attempt,
      this.d.config.WORKER_LEASE_SECONDS,
    );
    if (!claim.claimed) return this.skip(msg, claim.reason);
    await this.withLease(msg.jobId, async () => {
      const main = { configurable: { thread_id: `${msg.jobId}:${msg.attempt}` }, recursionLimit: 60 };
      const snap = await this.graph.getState(main);
      if (snap.next.includes('awaitHumanReview')) {
        await this.graph.invoke(
          new Command({ resume: { action: 'publish', publicationId: publication.id } }),
          main,
        );
        return;
      }
      if (snap.next.length > 0) {
        await this.graph.invoke(null, main);
        return;
      }
      // The review checkpoint is gone (already consumed by a failed publish, or a non-durable checkpointer was
      // reset): run the publish phase on its own thread. publishApprovedCases re-verifies everything.
      const alt = {
        configurable: {
          thread_id: `${msg.jobId}:${msg.attempt}:publish:${publication.id}:${msg.publicationVersion ?? publication.version}`,
        },
        recursionLimit: 60,
      };
      const altSnap = await this.graph.getState(alt);
      if (altSnap.next.length > 0) await this.graph.invoke(null, alt);
      else if (!altSnap.values?.jobId)
        await this.graph.invoke(
          { jobId: msg.jobId, attempt: msg.attempt, phase: 'publish', publicationId: publication.id },
          alt,
        );
    });
  }

  private skip(msg: QueueMessage, reason: string): void {
    if (reason === 'busy')
      throw new RetryLaterError(`job ${msg.jobId} is being processed by another worker`, BUSY_RETRY_MS);
    this.d.log.info({ jobId: msg.jobId, type: msg.type, reason }, 'message not applicable; acknowledging');
  }

  /** Re-enqueues work whose lease expired (pod crash) or that never reached the queue. Handlers are idempotent. */
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const repos = repositoriesFor(this.d.db);
      const stale = await repos.jobs.findRecoverable(Math.max(60, this.d.config.RECOVERY_SWEEP_SECONDS * 2));
      let count = 0;
      for (const job of stale) {
        let message: QueueMessage | undefined;
        if (job.status === 'queued' || job.status === 'running') {
          message = {
            schemaVersion: 1,
            type: 'generate',
            jobId: job.id,
            attempt: job.attempt,
            correlationId: job.correlationId,
            enqueuedAt: new Date().toISOString(),
          };
        } else if (job.status === 'publishing') {
          const pub = await repos.publications.latestForJob(job.id);
          if (pub) {
            message = {
              schemaVersion: 1,
              type: 'publish',
              jobId: job.id,
              attempt: job.attempt,
              correlationId: job.correlationId,
              publicationId: pub.id,
              publicationVersion: pub.version,
              enqueuedAt: new Date().toISOString(),
            };
          }
        }
        if (!message) continue;
        await this.d.publisher.send(message, { delayMs: 1, traceCarrier: injectTraceContext() });
        await repos.audit.append({
          jobId: job.id,
          eventType: 'job_recovery_enqueued',
          actor: this.workerId,
          correlationId: job.correlationId,
          details: { status: job.status },
        });
        count += 1;
      }
      if (count) this.d.log.warn({ count }, 'recovery sweep re-enqueued jobs');
      return count;
    } finally {
      this.sweeping = false;
    }
  }

  async start(): Promise<void> {
    await this.d.consumer.start(this.handle, this.handleDeadLetter);
    this.sweeper = setInterval(() => {
      this.sweep().catch((err: unknown) =>
        this.d.log.error({ err: safeMessage(err) }, 'recovery sweep failed'),
      );
    }, this.d.config.RECOVERY_SWEEP_SECONDS * 1000);
    this.sweeper.unref();
    this.d.log.info({ workerId: this.workerId }, 'worker started');
  }

  /** Graceful shutdown: stop taking messages, let in-flight handlers finish. */
  async stop(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    await this.d.consumer.stop();
  }
}

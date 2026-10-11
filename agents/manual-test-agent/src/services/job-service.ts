import type { Logger } from 'pino';
import type { ProjectAuthorizer, Action } from '../auth/authorizer.js';
import { snapshotOf, type Principal } from '../auth/principal.js';
import type { AppConfig } from '../config/index.js';
import type { Db, Queryable } from '../database/db.js';
import type { QueuePublisher } from '../messaging/types.js';
import { injectTraceContext } from '../observability/telemetry.js';
import type { JobRecord } from '../repositories/jobs.js';
import { repositoriesFor } from '../repositories/index.js';
import { projectKeyOf } from '../schemas/common.js';
import type { CreateGenerationRequest, QueueMessage } from '../schemas/domain.js';
import { forbidden, notFound } from '../shared/errors.js';
import { newId } from '../shared/util.js';

export interface ServiceDeps {
  db: Db;
  queue: QueuePublisher;
  authorizer: ProjectAuthorizer;
  config: AppConfig;
  log: Logger;
}

export const generateMessage = (job: Pick<JobRecord, 'id' | 'attempt' | 'correlationId'>): QueueMessage => ({
  schemaVersion: 1,
  type: 'generate',
  jobId: job.id,
  attempt: job.attempt,
  correlationId: job.correlationId,
  enqueuedAt: new Date().toISOString(),
});

export async function enqueue(
  deps: Pick<ServiceDeps, 'queue' | 'log'>,
  message: QueueMessage,
): Promise<boolean> {
  try {
    await deps.queue.send(message, { traceCarrier: injectTraceContext() });
    return true;
  } catch (err) {
    // The job row is already durable; the recovery sweeper re-enqueues stale queued jobs.
    deps.log.error(
      { jobId: message.jobId, err: err instanceof Error ? err.message : 'unknown' },
      'enqueue failed; relying on recovery sweeper',
    );
    return false;
  }
}

/**
 * Loads a job for a principal. Principals outside the project get 404 (not 403) so that job ids and
 * issue keys of other projects cannot be probed; members lacking the role for the action get 403.
 */
export async function loadJobFor(
  deps: ServiceDeps,
  principal: Principal,
  jobId: string,
  action: Action,
  lock = false,
  q: Queryable = deps.db,
): Promise<JobRecord> {
  const job = await repositoriesFor(q).jobs.get(jobId, lock);
  if (!job || !deps.authorizer.isMember(principal, job.projectKey)) throw notFound('Job');
  if (!deps.authorizer.hasRole(principal, action)) throw forbidden(`Missing role for ${action}`);
  return job;
}

export class JobService {
  constructor(private readonly deps: ServiceDeps) {}

  async submit(
    principal: Principal,
    req: CreateGenerationRequest,
    idempotencyKey: string | undefined,
    correlationId: string,
  ): Promise<{ job: JobRecord; created: boolean }> {
    const projectKey = projectKeyOf(req.issueKey);
    if (!this.deps.authorizer.can(principal, projectKey, 'generate'))
      throw forbidden('Not authorized to generate test cases for this project');
    if (!this.deps.authorizer.projectConfig(projectKey)) throw forbidden('Project is not configured');

    const result = await this.deps.db.transaction(async (tx) => {
      const repos = repositoriesFor(tx);
      const r = await repos.jobs.create({
        id: newId(),
        issueKey: req.issueKey,
        projectKey,
        requestedBy: principal.id,
        requesterEntitlements: snapshotOf(principal),
        idempotencyKey,
        correlationId,
        notes: req.notes,
      });
      if (r.created) {
        await repos.audit.append({
          jobId: r.job.id,
          eventType: 'job_submitted',
          actor: principal.id,
          correlationId,
          details: { issueKey: req.issueKey, idempotent: Boolean(idempotencyKey) },
        });
      }
      return r;
    });
    if (result.created) await enqueue(this.deps, generateMessage(result.job));
    return result;
  }

  async get(principal: Principal, jobId: string): Promise<JobRecord> {
    return loadJobFor(this.deps, principal, jobId, 'view');
  }

  async cancel(principal: Principal, jobId: string, correlationId: string): Promise<JobRecord> {
    return this.deps.db.transaction(async (tx) => {
      const job = await loadJobFor(this.deps, principal, jobId, 'cancel', true, tx);
      const repos = repositoriesFor(tx);
      const cancelled = await repos.jobs.transition(jobId, { to: 'cancelled', expectedVersion: job.version });
      const revoked = await repos.reviews.revokeApprovals(jobId, 'job cancelled');
      await repos.audit.append({
        jobId,
        eventType: 'job_cancelled',
        actor: principal.id,
        correlationId,
        details: { from: job.status, revokedApprovals: revoked },
      });
      return cancelled;
    });
  }

  /** Starts a new attempt (new graph thread) for a failed or clarification-blocked job. A failed publish is retried via the publish endpoint. */
  async retry(principal: Principal, jobId: string, correlationId: string): Promise<JobRecord> {
    const queued = await this.deps.db.transaction(async (tx) => {
      const job = await loadJobFor(this.deps, principal, jobId, 'generate', true, tx);
      const repos = repositoriesFor(tx);
      const next = await repos.jobs.transition(jobId, {
        to: 'queued',
        from: ['failed', 'needs_clarification'],
        expectedVersion: job.version,
        set: { attempt: job.attempt + 1, failureCategory: null, failureMessage: null },
      });
      await repos.audit.append({
        jobId,
        eventType: 'job_retried',
        actor: principal.id,
        correlationId,
        details: { attempt: next.attempt },
      });
      return next;
    });
    await enqueue(this.deps, generateMessage(queued));
    return queued;
  }
}

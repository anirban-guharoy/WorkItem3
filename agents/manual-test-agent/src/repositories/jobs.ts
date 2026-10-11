import type { Queryable } from '../database/db.js';
import { iso } from '../database/db.js';
import type { GenerationJobView } from '../schemas/domain.js';
import type { JobStatus } from '../schemas/common.js';
import { conflict, InvalidTransitionError, notFound } from '../shared/errors.js';
import { canTransition, sourcesOf } from '../services/state-machine.js';

export interface JobRecord extends GenerationJobView {
  requesterEntitlements: string[];
  idempotencyKey: string | null;
  notes: string | null;
  storyHash: string | null;
  lockedBy: string | null;
  leaseExpiresAt: string | null;
}

interface JobRow {
  id: string;
  issue_key: string;
  project_key: string;
  status: JobStatus;
  attempt: number;
  version: number;
  draft_version: number;
  requested_by: string;
  requester_entitlements: string[];
  idempotency_key: string | null;
  correlation_id: string;
  notes: string | null;
  story_hash: string | null;
  failure_category: string | null;
  failure_message: string | null;
  clarification_questions: string[];
  locked_by: string | null;
  lease_expires_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export const toJobRecord = (r: JobRow): JobRecord => ({
  id: r.id,
  issueKey: r.issue_key,
  projectKey: r.project_key,
  status: r.status,
  attempt: r.attempt,
  version: r.version,
  draftVersion: r.draft_version,
  requestedBy: r.requested_by,
  requesterEntitlements: r.requester_entitlements,
  idempotencyKey: r.idempotency_key,
  correlationId: r.correlation_id,
  notes: r.notes,
  storyHash: r.story_hash,
  failureCategory: r.failure_category,
  failureMessage: r.failure_message,
  clarificationQuestions: r.clarification_questions,
  lockedBy: r.locked_by,
  leaseExpiresAt: r.lease_expires_at ? iso(r.lease_expires_at) : null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export interface NewJob {
  id: string;
  issueKey: string;
  projectKey: string;
  requestedBy: string;
  requesterEntitlements: string[];
  idempotencyKey?: string | undefined;
  correlationId: string;
  notes?: string | undefined;
}

export interface TransitionOptions {
  to: JobStatus;
  /** Optimistic-concurrency token; when given, the update fails with 409 if the job changed meanwhile. */
  expectedVersion?: number;
  /** Restrict the source states (intersected with the legal sources of `to`). */
  from?: readonly JobStatus[];
  /** Only the worker that holds the lease may move a running/publishing job. */
  workerId?: string;
  set?: {
    attempt?: number;
    draftVersion?: number;
    storyHash?: string | null;
    notes?: string | null;
    failureCategory?: string | null;
    failureMessage?: string | null;
    clarificationQuestions?: string[];
  };
}

export type ClaimResult =
  | { claimed: true; job: JobRecord }
  | { claimed: false; reason: 'busy' | 'not_applicable' | 'missing'; job?: JobRecord };

export class JobRepository {
  constructor(private readonly q: Queryable) {}

  async create(job: NewJob): Promise<{ job: JobRecord; created: boolean }> {
    const inserted = await this.q.query<JobRow>(
      `INSERT INTO generation_jobs
         (id, issue_key, project_key, status, requested_by, requester_entitlements, idempotency_key, correlation_id, notes)
       VALUES ($1,$2,$3,'queued',$4,$5::jsonb,$6,$7,$8)
       ON CONFLICT (requested_by, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        job.id,
        job.issueKey,
        job.projectKey,
        job.requestedBy,
        JSON.stringify(job.requesterEntitlements),
        job.idempotencyKey ?? null,
        job.correlationId,
        job.notes ?? null,
      ],
    );
    const row = inserted.rows[0];
    if (row) return { job: toJobRecord(row), created: true };
    const existing = await this.q.query<JobRow>(
      'SELECT * FROM generation_jobs WHERE requested_by = $1 AND idempotency_key = $2',
      [job.requestedBy, job.idempotencyKey],
    );
    const found = existing.rows[0];
    if (!found) throw conflict('Idempotent job creation raced; retry');
    return { job: toJobRecord(found), created: false };
  }

  async get(id: string, lock = false): Promise<JobRecord | undefined> {
    const r = await this.q.query<JobRow>(
      `SELECT * FROM generation_jobs WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return r.rows[0] ? toJobRecord(r.rows[0]) : undefined;
  }

  async require(id: string, lock = false): Promise<JobRecord> {
    const job = await this.get(id, lock);
    if (!job) throw notFound('Job');
    return job;
  }

  /** Guarded state change: legal-transition check, optional version check and lease ownership in one UPDATE. */
  async transition(id: string, opts: TransitionOptions): Promise<JobRecord> {
    const legalSources = sourcesOf(opts.to);
    const sources = (opts.from ? legalSources.filter((s) => opts.from?.includes(s)) : legalSources).concat(
      opts.from?.includes(opts.to) || !opts.from ? [opts.to] : [],
    );
    const s = opts.set ?? {};
    const sets: string[] = [];
    const params: unknown[] = [id, opts.to, sources];
    const push = (column: string, value: unknown, cast = '') => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };
    if (s.attempt !== undefined) push('attempt', s.attempt);
    if (s.draftVersion !== undefined) push('draft_version', s.draftVersion);
    if (s.storyHash !== undefined) push('story_hash', s.storyHash);
    if (s.notes !== undefined) push('notes', s.notes);
    if (s.failureCategory !== undefined) push('failure_category', s.failureCategory);
    if (s.failureMessage !== undefined) push('failure_message', s.failureMessage);
    if (s.clarificationQuestions !== undefined)
      push('clarification_questions', JSON.stringify(s.clarificationQuestions), '::jsonb');
    let where = 'id = $1 AND status = ANY($3::text[])';
    if (opts.expectedVersion !== undefined) {
      params.push(opts.expectedVersion);
      where += ` AND version = $${params.length}`;
    }
    if (opts.workerId !== undefined) {
      params.push(opts.workerId);
      where += ` AND (locked_by = $${params.length})`;
    }
    const r = await this.q.query<JobRow>(
      `UPDATE generation_jobs SET status = $2, version = version + 1, updated_at = now(),
         locked_by = CASE WHEN $2 IN ('running','publishing') THEN locked_by ELSE NULL END,
         lease_expires_at = CASE WHEN $2 IN ('running','publishing') THEN lease_expires_at ELSE NULL END
         ${sets.length ? `, ${sets.join(', ')}` : ''}
       WHERE ${where} RETURNING *`,
      params,
    );
    const row = r.rows[0];
    if (row) return toJobRecord(row);

    const current = await this.require(id);
    if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) {
      throw conflict('Job was modified concurrently', { currentVersion: current.version });
    }
    if (!canTransition(current.status, opts.to) || (opts.from && !opts.from.includes(current.status))) {
      throw new InvalidTransitionError(current.status, opts.to);
    }
    throw conflict('Job is leased by another worker');
  }

  async claim(
    id: string,
    workerId: string,
    kind: 'generate' | 'publish',
    attempt: number | undefined,
    leaseSeconds: number,
  ): Promise<ClaimResult> {
    const status = kind === 'generate' ? 'running' : 'publishing';
    const claimableFrom =
      kind === 'generate'
        ? `(status = 'queued' OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < now() OR locked_by = $2)))`
        : `(status = 'publishing' AND (locked_by IS NULL OR lease_expires_at < now() OR locked_by = $2))`;
    const r = await this.q.query<JobRow>(
      `UPDATE generation_jobs SET status = $5, locked_by = $2, version = version + 1, updated_at = now(),
         lease_expires_at = now() + ($3::int * interval '1 second')
       WHERE id = $1 AND ${claimableFrom} AND ($4::int IS NULL OR attempt = $4::int) RETURNING *`,
      [id, workerId, leaseSeconds, attempt ?? null, status],
    );
    const row = r.rows[0];
    if (row) return { claimed: true, job: toJobRecord(row) };
    const job = await this.get(id);
    if (!job) return { claimed: false, reason: 'missing' };
    const leaseLive = job.leaseExpiresAt !== null && new Date(job.leaseExpiresAt) > new Date();
    return {
      claimed: false,
      reason:
        leaseLive && (job.status === 'running' || job.status === 'publishing') ? 'busy' : 'not_applicable',
      job,
    };
  }

  async heartbeat(id: string, workerId: string, leaseSeconds: number): Promise<boolean> {
    const r = await this.q.query(
      `UPDATE generation_jobs SET lease_expires_at = now() + ($3::int * interval '1 second')
       WHERE id = $1 AND locked_by = $2 AND status IN ('running','publishing')`,
      [id, workerId, leaseSeconds],
    );
    return r.rowCount > 0;
  }

  /** Gives up the lease early (after a failed attempt) so a redelivered message can be claimed immediately. */
  async releaseLease(id: string, workerId: string): Promise<void> {
    await this.q.query(
      `UPDATE generation_jobs SET lease_expires_at = now() - interval '1 second'
       WHERE id = $1 AND locked_by = $2 AND status IN ('running','publishing')`,
      [id, workerId],
    );
  }

  /** Jobs that are queued/running/publishing with no live lease (for crash recovery). */
  async findRecoverable(olderThanSeconds: number, limit = 50): Promise<JobRecord[]> {
    const r = await this.q.query<JobRow>(
      `SELECT * FROM generation_jobs
       WHERE ((status IN ('running','publishing') AND lease_expires_at < now())
          OR (status IN ('queued','publishing') AND lease_expires_at IS NULL
              AND updated_at < now() - ($1::int * interval '1 second')))
       ORDER BY updated_at LIMIT $2`,
      [olderThanSeconds, limit],
    );
    return r.rows.map(toJobRecord);
  }

  async list(projectKeys: string[], limit = 50): Promise<JobRecord[]> {
    const r = await this.q.query<JobRow>(
      'SELECT * FROM generation_jobs WHERE project_key = ANY($1::text[]) ORDER BY created_at DESC LIMIT $2',
      [projectKeys, limit],
    );
    return r.rows.map(toJobRecord);
  }
}

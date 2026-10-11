import type { Queryable } from '../database/db.js';
import { iso } from '../database/db.js';

export type PublicationStatus = 'pending' | 'in_progress' | 'published' | 'failed';

export interface PublicationItemResult {
  testCaseId: string;
  externalId: string;
  idempotencyKey: string;
}

export interface PublicationRecord {
  id: string;
  jobId: string;
  issueKey: string;
  draftVersion: number;
  approvalDecisionId: string;
  destination: string;
  contentHash: string;
  status: PublicationStatus;
  requestedBy: string;
  results: PublicationItemResult[];
  errorCategory: string | null;
  errorMessage: string | null;
  version: number;
  createdAt: string;
  completedAt: string | null;
}

interface Row {
  id: string;
  job_id: string;
  issue_key: string;
  draft_version: number;
  approval_decision_id: string;
  destination: string;
  content_hash: string;
  status: PublicationStatus;
  requested_by: string;
  results: PublicationItemResult[];
  error_category: string | null;
  error_message: string | null;
  version: number;
  created_at: unknown;
  completed_at: unknown;
}

const toRecord = (r: Row): PublicationRecord => ({
  id: r.id,
  jobId: r.job_id,
  issueKey: r.issue_key,
  draftVersion: r.draft_version,
  approvalDecisionId: r.approval_decision_id,
  destination: r.destination,
  contentHash: r.content_hash,
  status: r.status,
  requestedBy: r.requested_by,
  results: r.results,
  errorCategory: r.error_category,
  errorMessage: r.error_message,
  version: r.version,
  createdAt: iso(r.created_at),
  completedAt: r.completed_at ? iso(r.completed_at) : null,
});

export class PublicationRepository {
  constructor(private readonly q: Queryable) {}

  async get(id: string): Promise<PublicationRecord | undefined> {
    const r = await this.q.query<Row>('SELECT * FROM publication_records WHERE id = $1', [id]);
    return r.rows[0] ? toRecord(r.rows[0]) : undefined;
  }

  async getForJob(jobId: string, draftVersion: number): Promise<PublicationRecord | undefined> {
    const r = await this.q.query<Row>(
      'SELECT * FROM publication_records WHERE job_id = $1 AND draft_version = $2',
      [jobId, draftVersion],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : undefined;
  }

  async latestForJob(jobId: string): Promise<PublicationRecord | undefined> {
    const r = await this.q.query<Row>(
      'SELECT * FROM publication_records WHERE job_id = $1 ORDER BY draft_version DESC LIMIT 1',
      [jobId],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : undefined;
  }

  /** Equivalent publication = same story, destination and exact content already published. */
  async findPublishedEquivalent(
    issueKey: string,
    destination: string,
    contentHash: string,
  ): Promise<PublicationRecord | undefined> {
    const r = await this.q.query<Row>(
      `SELECT * FROM publication_records WHERE issue_key = $1 AND destination = $2 AND content_hash = $3 AND status = 'published'`,
      [issueKey, destination, contentHash],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : undefined;
  }

  async createOrReset(
    p: Omit<
      PublicationRecord,
      'status' | 'results' | 'errorCategory' | 'errorMessage' | 'version' | 'createdAt' | 'completedAt'
    >,
  ): Promise<PublicationRecord> {
    const r = await this.q.query<Row>(
      `INSERT INTO publication_records (id, job_id, issue_key, draft_version, approval_decision_id, destination, content_hash, status, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)
       ON CONFLICT (job_id, draft_version) DO UPDATE SET
         status = 'pending', error_category = NULL, error_message = NULL, requested_by = EXCLUDED.requested_by,
         approval_decision_id = EXCLUDED.approval_decision_id, version = publication_records.version + 1, updated_at = now()
         WHERE publication_records.status = 'failed' AND publication_records.content_hash = EXCLUDED.content_hash
       RETURNING *`,
      [
        p.id,
        p.jobId,
        p.issueKey,
        p.draftVersion,
        p.approvalDecisionId,
        p.destination,
        p.contentHash,
        p.requestedBy,
      ],
    );
    if (r.rows[0]) return toRecord(r.rows[0]);
    const existing = await this.getForJob(p.jobId, p.draftVersion);
    if (!existing) throw new Error('publication upsert failed');
    return existing;
  }

  async recordItem(id: string, item: PublicationItemResult): Promise<void> {
    await this.q.query(
      `UPDATE publication_records SET status = 'in_progress', updated_at = now(), version = version + 1,
         results = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM (
            SELECT e FROM jsonb_array_elements(results) e WHERE e->>'testCaseId' <> $2
            UNION ALL SELECT $3::jsonb) s)
       WHERE id = $1`,
      [id, item.testCaseId, JSON.stringify(item)],
    );
  }

  async markPublished(id: string): Promise<void> {
    await this.q.query(
      `UPDATE publication_records SET status = 'published', completed_at = now(), updated_at = now(), version = version + 1 WHERE id = $1`,
      [id],
    );
  }

  async markFailed(id: string, category: string, message: string): Promise<void> {
    await this.q.query(
      `UPDATE publication_records SET status = 'failed', error_category = $2, error_message = $3, updated_at = now(), version = version + 1 WHERE id = $1`,
      [id, category, message.slice(0, 500)],
    );
  }
}

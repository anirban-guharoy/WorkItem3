import type { Queryable } from '../database/db.js';
import { iso } from '../database/db.js';

export interface ReviewDecisionRecord {
  id: string;
  jobId: string;
  draftVersion: number;
  action: 'approve' | 'reject' | 'edit' | 'request_regeneration';
  reviewer: string;
  comment: string | null;
  contentHash: string;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  job_id: string;
  draft_version: number;
  action: ReviewDecisionRecord['action'];
  reviewer: string;
  comment: string | null;
  content_hash: string;
  revoked_at: unknown;
  revoked_reason: string | null;
  created_at: unknown;
}

const toRecord = (r: Row): ReviewDecisionRecord => ({
  id: r.id,
  jobId: r.job_id,
  draftVersion: r.draft_version,
  action: r.action,
  reviewer: r.reviewer,
  comment: r.comment,
  contentHash: r.content_hash,
  revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
  revokedReason: r.revoked_reason,
  createdAt: iso(r.created_at),
});

export class ReviewRepository {
  constructor(private readonly q: Queryable) {}

  async get(id: string): Promise<ReviewDecisionRecord | undefined> {
    const r = await this.q.query<Row>('SELECT * FROM review_decisions WHERE id = $1', [id]);
    return r.rows[0] ? toRecord(r.rows[0]) : undefined;
  }

  async insert(
    d: Omit<ReviewDecisionRecord, 'createdAt' | 'revokedAt' | 'revokedReason'>,
  ): Promise<ReviewDecisionRecord> {
    const r = await this.q.query<Row>(
      `INSERT INTO review_decisions (id, job_id, draft_version, action, reviewer, comment, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [d.id, d.jobId, d.draftVersion, d.action, d.reviewer, d.comment, d.contentHash],
    );
    return toRecord(r.rows[0] as Row);
  }

  async activeApproval(jobId: string, draftVersion: number): Promise<ReviewDecisionRecord | undefined> {
    const r = await this.q.query<Row>(
      `SELECT * FROM review_decisions WHERE job_id = $1 AND draft_version = $2 AND action = 'approve' AND revoked_at IS NULL`,
      [jobId, draftVersion],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : undefined;
  }

  async revokeApprovals(jobId: string, reason: string): Promise<number> {
    const r = await this.q.query(
      `UPDATE review_decisions SET revoked_at = now(), revoked_reason = $2
       WHERE job_id = $1 AND action = 'approve' AND revoked_at IS NULL`,
      [jobId, reason],
    );
    return r.rowCount;
  }

  async list(jobId: string): Promise<ReviewDecisionRecord[]> {
    const r = await this.q.query<Row>(
      'SELECT * FROM review_decisions WHERE job_id = $1 ORDER BY created_at, id',
      [jobId],
    );
    return r.rows.map(toRecord);
  }
}

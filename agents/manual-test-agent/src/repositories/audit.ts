import type { Queryable } from '../database/db.js';
import { iso } from '../database/db.js';
import type { AuditEventInput } from '../schemas/domain.js';
import { redact } from '../security/redaction.js';

export interface AuditRecord extends AuditEventInput {
  id: number;
  createdAt: string;
}

export class AuditRepository {
  constructor(private readonly q: Queryable) {}

  async append(event: AuditEventInput): Promise<void> {
    await this.q.query(
      'INSERT INTO audit_events (job_id, event_type, actor, correlation_id, details) VALUES ($1,$2,$3,$4,$5::jsonb)',
      [event.jobId, event.eventType, event.actor, event.correlationId, JSON.stringify(redact(event.details))],
    );
  }

  async listForJob(jobId: string): Promise<AuditRecord[]> {
    const r = await this.q.query<{
      id: string | number;
      job_id: string | null;
      event_type: string;
      actor: string;
      correlation_id: string | null;
      details: Record<string, unknown>;
      created_at: unknown;
    }>('SELECT * FROM audit_events WHERE job_id = $1 ORDER BY id', [jobId]);
    return r.rows.map((x) => ({
      id: Number(x.id),
      jobId: x.job_id,
      eventType: x.event_type,
      actor: x.actor,
      correlationId: x.correlation_id,
      details: x.details,
      createdAt: iso(x.created_at),
    }));
  }
}

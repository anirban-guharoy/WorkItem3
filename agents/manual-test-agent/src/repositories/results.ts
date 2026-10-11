import type { Queryable } from '../database/db.js';
import { iso } from '../database/db.js';
import type {
  CoverageRecord,
  DuplicateCandidate,
  Ambiguity,
  NormalizedCriterion,
  RequirementsAnalysis,
  ValidationReport,
} from '../schemas/domain.js';
import type { TestCase } from '../schemas/testcase.js';
import { newId } from '../shared/util.js';

export interface GenerationResultInput {
  jobId: string;
  attempt: number;
  storyHash: string;
  storySummary: string;
  criteria: NormalizedCriterion[];
  contextRefs: Array<{
    id: string;
    type: string;
    title: string;
    url?: string | undefined;
    suspectedInjection: boolean;
  }>;
  analysis: RequirementsAnalysis | null;
  ambiguities: Ambiguity[];
  validation: ValidationReport;
  duplicates: DuplicateCandidate[];
  modelInfo: Record<string, unknown>;
  qualityMetrics: Record<string, unknown>;
}

export interface DraftRecord {
  id: string;
  jobId: string;
  draftVersion: number;
  testCases: TestCase[];
  contentHash: string;
  origin: 'model' | 'reviewer_edit';
  createdBy: string;
  createdAt: string;
}

export interface CoverageSummary {
  total: number;
  covered: number;
  partiallyCovered: number;
  uncovered: number;
  requiresClarification: number;
  coveragePercent: number;
}

export interface CoverageResultRecord {
  jobId: string;
  draftVersion: number;
  records: CoverageRecord[];
  summary: CoverageSummary;
}

interface DraftRow {
  id: string;
  job_id: string;
  draft_version: number;
  test_cases: TestCase[];
  content_hash: string;
  origin: 'model' | 'reviewer_edit';
  created_by: string;
  created_at: unknown;
}

const toDraft = (r: DraftRow): DraftRecord => ({
  id: r.id,
  jobId: r.job_id,
  draftVersion: r.draft_version,
  testCases: r.test_cases,
  contentHash: r.content_hash,
  origin: r.origin,
  createdBy: r.created_by,
  createdAt: iso(r.created_at),
});

export class ResultRepository {
  constructor(private readonly q: Queryable) {}

  async saveGenerationResult(r: GenerationResultInput): Promise<void> {
    await this.q.query(
      `INSERT INTO generation_results
         (id, job_id, attempt, story_hash, story_summary, criteria, context_refs, analysis, ambiguities, validation, duplicates, model_info, quality_metrics)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb)
       ON CONFLICT (job_id, attempt) DO UPDATE SET
         story_hash = EXCLUDED.story_hash, story_summary = EXCLUDED.story_summary, criteria = EXCLUDED.criteria,
         context_refs = EXCLUDED.context_refs, analysis = EXCLUDED.analysis, ambiguities = EXCLUDED.ambiguities,
         validation = EXCLUDED.validation, duplicates = EXCLUDED.duplicates, model_info = EXCLUDED.model_info,
         quality_metrics = EXCLUDED.quality_metrics`,
      [
        newId(),
        r.jobId,
        r.attempt,
        r.storyHash,
        r.storySummary,
        JSON.stringify(r.criteria),
        JSON.stringify(r.contextRefs),
        JSON.stringify(r.analysis),
        JSON.stringify(r.ambiguities),
        JSON.stringify(r.validation),
        JSON.stringify(r.duplicates),
        JSON.stringify(r.modelInfo),
        JSON.stringify(r.qualityMetrics),
      ],
    );
  }

  async getGenerationResult(jobId: string): Promise<Record<string, unknown> | undefined> {
    const r = await this.q.query<Record<string, unknown>>(
      'SELECT * FROM generation_results WHERE job_id = $1 ORDER BY attempt DESC LIMIT 1',
      [jobId],
    );
    return r.rows[0];
  }

  /** Idempotent per (job, version): re-running persistence for the same draft is a no-op. */
  async insertDraft(
    d: Omit<DraftRecord, 'id' | 'createdAt'>,
  ): Promise<{ draft: DraftRecord; created: boolean }> {
    const ins = await this.q.query<DraftRow>(
      `INSERT INTO test_case_drafts (id, job_id, draft_version, test_cases, content_hash, origin, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT (job_id, draft_version) DO NOTHING RETURNING *`,
      [newId(), d.jobId, d.draftVersion, JSON.stringify(d.testCases), d.contentHash, d.origin, d.createdBy],
    );
    if (ins.rows[0]) return { draft: toDraft(ins.rows[0]), created: true };
    const existing = await this.getDraft(d.jobId, d.draftVersion);
    if (!existing) throw new Error('Draft insert raced and row is missing');
    return { draft: existing, created: false };
  }

  async getDraft(jobId: string, draftVersion: number): Promise<DraftRecord | undefined> {
    const r = await this.q.query<DraftRow>(
      'SELECT * FROM test_case_drafts WHERE job_id = $1 AND draft_version = $2',
      [jobId, draftVersion],
    );
    return r.rows[0] ? toDraft(r.rows[0]) : undefined;
  }

  async listDrafts(jobId: string): Promise<DraftRecord[]> {
    const r = await this.q.query<DraftRow>(
      'SELECT * FROM test_case_drafts WHERE job_id = $1 ORDER BY draft_version',
      [jobId],
    );
    return r.rows.map(toDraft);
  }

  async saveCoverage(c: CoverageResultRecord): Promise<void> {
    await this.q.query(
      `INSERT INTO coverage_results (id, job_id, draft_version, records, summary) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
       ON CONFLICT (job_id, draft_version) DO UPDATE SET records = EXCLUDED.records, summary = EXCLUDED.summary`,
      [newId(), c.jobId, c.draftVersion, JSON.stringify(c.records), JSON.stringify(c.summary)],
    );
  }

  async getCoverage(jobId: string, draftVersion: number): Promise<CoverageResultRecord | undefined> {
    const r = await this.q.query<{ records: CoverageRecord[]; summary: CoverageSummary }>(
      'SELECT records, summary FROM coverage_results WHERE job_id = $1 AND draft_version = $2',
      [jobId, draftVersion],
    );
    const row = r.rows[0];
    return row ? { jobId, draftVersion, records: row.records, summary: row.summary } : undefined;
  }
}

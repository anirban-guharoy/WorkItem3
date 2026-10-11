import type { Principal } from '../auth/principal.js';
import { repositoriesFor } from '../repositories/index.js';
import type { CoverageResultRecord, DraftRecord } from '../repositories/results.js';
import type { Ambiguity, DuplicateCandidate, ValidationReport } from '../schemas/domain.js';
import { conflict, notFound } from '../shared/errors.js';
import { loadJobFor, type ServiceDeps } from './job-service.js';

export interface DraftView {
  jobId: string;
  status: string;
  draftVersion: number;
  draft: DraftRecord;
  availableVersions: number[];
  validation: ValidationReport | null;
  duplicates: DuplicateCandidate[];
  ambiguities: Ambiguity[];
  clarificationQuestions: string[];
}

export class QueryService {
  constructor(private readonly deps: ServiceDeps) {}

  async drafts(principal: Principal, jobId: string, version?: number): Promise<DraftView> {
    const job = await loadJobFor(this.deps, principal, jobId, 'view');
    const repos = repositoriesFor(this.deps.db);
    if (job.draftVersion === 0)
      throw conflict(`No draft available while job is ${job.status}`, { status: job.status });
    const wanted = version ?? job.draftVersion;
    const draft = await repos.results.getDraft(jobId, wanted);
    if (!draft) throw notFound('Draft version');
    const all = await repos.results.listDrafts(jobId);
    const generation = await repos.results.getGenerationResult(jobId);
    return {
      jobId,
      status: job.status,
      draftVersion: job.draftVersion,
      draft,
      availableVersions: all.map((d) => d.draftVersion),
      validation: (generation?.['validation'] as ValidationReport | undefined) ?? null,
      duplicates: (generation?.['duplicates'] as DuplicateCandidate[] | undefined) ?? [],
      ambiguities: (generation?.['ambiguities'] as Ambiguity[] | undefined) ?? [],
      clarificationQuestions: job.clarificationQuestions,
    };
  }

  async coverage(principal: Principal, jobId: string, version?: number): Promise<CoverageResultRecord> {
    const job = await loadJobFor(this.deps, principal, jobId, 'view');
    if (job.draftVersion === 0)
      throw conflict(`No coverage available while job is ${job.status}`, { status: job.status });
    const result = await repositoriesFor(this.deps.db).results.getCoverage(
      jobId,
      version ?? job.draftVersion,
    );
    if (!result) throw notFound('Coverage result');
    return result;
  }
}

import { hashOf } from '../../shared/util.js';
import { repositoriesFor } from '../../repositories/index.js';
import { requireField, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

/**
 * Persists result, draft, coverage and the running -> draft_ready -> awaiting_review transitions in one
 * transaction, so a crash can never leave a draft without a reviewable job (or the reverse). Safe to re-run.
 */
export const persistDraft =
  (deps: GraphDeps): NodeFn =>
  async (state) => {
    const testCases = requireField(state.testCases, 'testCases');
    const coverage = requireField(state.coverage, 'coverage');
    const validation = requireField(state.validation, 'validation');
    const story = requireField(state.story, 'story');
    const contentHash = hashOf(testCases);
    const usage = state.usage;
    const draftVersion = await deps.db.transaction(async (tx) => {
      const { jobs, results, audit: auditRepo } = repositoriesFor(tx);
      const job = await jobs.require(state.jobId, true);
      if (job.status === 'cancelled') return undefined;
      const next = job.draftVersion + 1;
      await results.saveGenerationResult({
        jobId: state.jobId,
        attempt: state.attempt,
        storyHash: requireField(state.storyHash, 'storyHash'),
        storySummary: story.summary,
        criteria: requireField(state.criteria, 'criteria'),
        contextRefs: (state.context?.items ?? []).map((i) => ({
          id: i.id,
          type: i.type,
          title: i.title,
          url: i.url,
          suspectedInjection: i.suspectedInjection,
        })),
        analysis: state.analysis ?? null,
        ambiguities: state.ambiguities ?? [],
        validation,
        duplicates: state.duplicates ?? [],
        modelInfo: { ...state.modelInfo },
        qualityMetrics: {
          coverage: coverage.summary,
          duplicateCandidates: (state.duplicates ?? []).length,
          validationWarnings: validation.issues.filter((i) => i.severity === 'warning').length,
          repairs: state.repairs,
          degradedSources: state.context?.degraded ?? [],
          quarantinedContextItems: (state.context?.items ?? []).filter((i) => i.suspectedInjection).length,
          modelCalls: usage.length,
          inputTokens: usage.reduce((s, u) => s + u.inputTokens, 0),
          outputTokens: usage.reduce((s, u) => s + u.outputTokens, 0),
          estimatedCostUsd: usage.reduce((s, u) => s + (u.estimatedCostUsd ?? 0), 0),
          modelLatencyMs: usage.reduce((s, u) => s + u.latencyMs, 0),
        },
      });
      await results.insertDraft({
        jobId: state.jobId,
        draftVersion: next,
        testCases,
        contentHash,
        origin: 'model',
        createdBy: `model:${state.modelInfo?.modelId ?? 'unknown'}`,
      });
      await results.saveCoverage({
        jobId: state.jobId,
        draftVersion: next,
        records: coverage.records,
        summary: coverage.summary,
      });
      await jobs.transition(state.jobId, {
        to: 'draft_ready',
        workerId: deps.workerId,
        set: {
          draftVersion: next,
          storyHash: state.storyHash ?? null,
          clarificationQuestions: state.clarificationQuestions,
        },
      });
      await jobs.transition(state.jobId, { to: 'awaiting_review' });
      await auditRepo.append({
        jobId: state.jobId,
        eventType: 'draft_persisted',
        actor: 'worker',
        correlationId: state.correlationId ?? null,
        details: { draftVersion: next, contentHash, testCases: testCases.length, coverage: coverage.summary },
      });
      return next;
    });
    if (draftVersion === undefined) return { outcome: 'cancelled' };
    return { draftVersion };
  };

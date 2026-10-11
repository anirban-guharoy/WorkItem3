import { m } from '../../observability/telemetry.js';
import { InvalidTransitionError } from '../../shared/errors.js';
import { reposOf, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

/** Final node for every path that ends without a pending review: applies the job outcome and audits it. */
export const recordAuditOutcome =
  (deps: GraphDeps): NodeFn =>
  async (state) => {
    const repos = reposOf(deps);
    const job = await repos.jobs.require(state.jobId);
    const outcome = state.outcome ?? 'failed';
    const details: Record<string, unknown> = { outcome, phase: state.phase };
    const actor = 'worker';

    try {
      if (outcome === 'needs_clarification') {
        await repos.jobs.transition(job.id, {
          to: 'needs_clarification',
          workerId: deps.workerId,
          set: { clarificationQuestions: state.clarificationQuestions },
        });
        details.questions = state.clarificationQuestions.length;
      } else if (outcome === 'published') {
        await repos.jobs.transition(job.id, { to: 'published', workerId: deps.workerId });
      } else if (outcome === 'failed' && job.status !== 'cancelled') {
        const failure = state.failure ?? {
          node: 'unknown',
          category: 'internal' as const,
          message: 'Unknown failure',
        };
        if (state.publicationId && job.status === 'publishing') {
          await repos.publications.markFailed(state.publicationId, failure.category, failure.message);
          m.publicationFailures.add(1, { category: failure.category });
        }
        await repos.jobs.transition(job.id, {
          to: 'failed',
          workerId: deps.workerId,
          set: { failureCategory: failure.category, failureMessage: failure.message.slice(0, 500) },
        });
        Object.assign(details, { failedNode: failure.node, category: failure.category });
      }
    } catch (err) {
      // A concurrent cancel (or other legal change) wins; record that instead of failing the run.
      if (!(err instanceof InvalidTransitionError)) throw err;
      details.skipped = err.message;
    }
    m.jobsCompleted.add(1, { outcome });
    await repos.audit.append({
      jobId: job.id,
      eventType: `job_${outcome}`,
      actor,
      correlationId: job.correlationId,
      details,
    });
    return {};
  };

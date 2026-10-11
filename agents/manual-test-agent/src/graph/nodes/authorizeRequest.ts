import { principalFromSnapshot } from '../../auth/principal.js';
import { notFound } from '../../shared/errors.js';
import { audit, reposOf, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

/** Loads the job and re-checks, inside the worker, that the requester may generate for this project. */
export const authorizeRequest =
  (deps: GraphDeps): NodeFn =>
  async (state) => {
    const repos = reposOf(deps);
    const job = await repos.jobs.get(state.jobId);
    if (!job) throw notFound('Job');
    const base = {
      issueKey: job.issueKey,
      projectKey: job.projectKey,
      requestedBy: job.requestedBy,
      correlationId: job.correlationId,
      guidance: job.notes ?? undefined,
    };
    const scoped = { ...state, ...base };
    if (job.status === 'cancelled') return { ...base, outcome: 'cancelled' };

    if (state.phase === 'generate') {
      const principal = principalFromSnapshot(job.requestedBy, job.requesterEntitlements);
      if (
        !deps.authorizer.can(principal, job.projectKey, 'generate') ||
        !deps.authorizer.projectConfig(job.projectKey)
      ) {
        await audit(deps, scoped, 'authorization_denied', { projectKey: job.projectKey });
        return {
          ...base,
          outcome: 'failed',
          failure: {
            node: 'authorizeRequest',
            category: 'forbidden',
            message: 'Requester is no longer authorized for this project',
          },
        };
      }
    }
    await audit(deps, scoped, 'authorization_checked', { phase: state.phase });
    return base;
  };

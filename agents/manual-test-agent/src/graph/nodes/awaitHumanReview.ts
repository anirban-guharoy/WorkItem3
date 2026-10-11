import { interrupt } from '@langchain/langgraph';
import type { GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

export interface ReviewResume {
  action: 'publish';
  publicationId: string;
}

/**
 * Durable human-in-the-loop pause. The graph checkpoint is the wait state; nothing proceeds until the
 * API (after verifying an authorized, valid approval) enqueues a publish message that resumes it.
 * The resume value only identifies the publication; publishApprovedCases re-verifies everything from the database.
 */
export const awaitHumanReview =
  (_deps: GraphDeps): NodeFn =>
  async (state) => {
    const resume = interrupt<{ jobId: string; draftVersion: number | undefined }, ReviewResume>({
      jobId: state.jobId,
      draftVersion: state.draftVersion,
    });
    if (resume.action !== 'publish' || !resume.publicationId) {
      return {
        outcome: 'failed',
        failure: { node: 'awaitHumanReview', category: 'validation', message: 'Unsupported resume value' },
      };
    }
    return { phase: 'publish', publicationId: resume.publicationId };
  };

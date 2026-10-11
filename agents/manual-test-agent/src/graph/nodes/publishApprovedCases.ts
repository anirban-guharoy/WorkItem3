import { m } from '../../observability/telemetry.js';
import { UpstreamError } from '../../shared/errors.js';
import { audit, mcpContext, reposOf, type GraphDeps } from '../deps.js';
import type { GraphUpdate, NodeFn } from '../state.js';
import { storyHashOf } from './fetchJiraStory.js';

const blocked = (
  category: 'forbidden' | 'conflict' | 'not_found' | 'validation',
  message: string,
): GraphUpdate => ({
  outcome: 'failed',
  failure: { node: 'publishApprovedCases', category, message },
});

/**
 * The only component that performs a privileged write. It trusts nothing from the resume payload and
 * re-verifies from authoritative state: approval validity, draft version/hash, unchanged source story,
 * no equivalent publication, and an authorized destination. Writes are idempotent per test case.
 */
export const publishApprovedCases =
  (deps: GraphDeps): NodeFn =>
  async (state) => {
    const repos = reposOf(deps);
    const job = await repos.jobs.require(state.jobId);
    const pub = state.publicationId ? await repos.publications.get(state.publicationId) : undefined;
    if (!pub || pub.jobId !== job.id) return blocked('not_found', 'Publication record not found');
    const ctx = mcpContext({ ...state, projectKey: job.projectKey, correlationId: job.correlationId });

    if (job.status !== 'publishing') return blocked('conflict', `Job is ${job.status}, not publishing`);

    const approval = await repos.reviews.activeApproval(job.id, pub.draftVersion);
    if (!approval || approval.id !== pub.approvalDecisionId)
      return blocked('forbidden', 'Approval is missing or has been revoked');

    const draft = await repos.results.getDraft(job.id, pub.draftVersion);
    if (
      !draft ||
      pub.draftVersion !== job.draftVersion ||
      draft.contentHash !== approval.contentHash ||
      draft.contentHash !== pub.contentHash
    ) {
      return blocked('conflict', 'Draft version or content does not match the approved version');
    }

    const destination = deps.authorizer.projectConfig(job.projectKey)?.publishDestination;
    if (!destination || destination !== pub.destination)
      return blocked('forbidden', 'Publish destination is not authorized for this project');
    if (!deps.config.MCP_ALLOW_WRITES || !deps.write)
      return blocked('forbidden', 'Write operations are disabled in this deployment');

    const story = await deps.read.getJiraIssue(job.issueKey, ctx);
    if (!job.storyHash || storyHashOf(story) !== job.storyHash) {
      return blocked(
        'conflict',
        'The source story changed after the draft was generated; regenerate before publishing',
      );
    }

    const equivalent = await repos.publications.findPublishedEquivalent(
      job.issueKey,
      destination,
      draft.contentHash,
    );
    if (equivalent && equivalent.id !== pub.id)
      return blocked('conflict', 'An equivalent publication already exists');

    await audit(
      deps,
      state,
      'publish_started',
      { publicationId: pub.id, destination, draftVersion: pub.draftVersion },
      pub.requestedBy,
    );
    const done = new Map(pub.results.map((r) => [r.testCaseId, r]));
    for (const testCase of draft.testCases) {
      if (done.has(testCase.id)) continue;
      const idempotencyKey = `${pub.id}:${testCase.id}`;
      // A previous attempt may have written without recording the result (crash/timeout): look before writing.
      const found = await deps.read.searchExistingTestCases({ marker: idempotencyKey }, ctx);
      let externalId = found[0]?.id;
      if (!externalId) {
        const res = await deps.write.createTestCases(
          { destination, issueKey: job.issueKey, idempotencyKey, testCases: [testCase] },
          ctx,
        );
        externalId = res.created.find((c) => c.testCaseId === testCase.id)?.externalId;
        if (!externalId)
          throw new UpstreamError(
            'MCP did not return an identifier for the created test case',
            'upstream_mcp',
            false,
          );
      }
      await repos.publications.recordItem(pub.id, { testCaseId: testCase.id, externalId, idempotencyKey });
    }
    await repos.publications.markPublished(pub.id);
    m.publicationSuccesses.add(1);
    return { outcome: 'published' };
  };

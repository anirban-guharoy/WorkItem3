import { END, START, StateGraph, isGraphBubbleUp, type BaseCheckpointSaver } from '@langchain/langgraph';
import { m, withSpan } from '../observability/telemetry.js';
import { AppError, RetryLaterError, categoryOf, isRetryable, safeMessage } from '../shared/errors.js';
import type { GraphDeps } from './deps.js';
import { reposOf } from './deps.js';
import { analyzeRequirements } from './nodes/analyzeRequirements.js';
import { authorizeRequest } from './nodes/authorizeRequest.js';
import { awaitHumanReview } from './nodes/awaitHumanReview.js';
import { detectAmbiguities } from './nodes/detectAmbiguities.js';
import { detectDuplicates } from './nodes/detectDuplicates.js';
import { evaluateCoverage } from './nodes/evaluateCoverage.js';
import { fetchJiraStory } from './nodes/fetchJiraStory.js';
import { generateTestCases } from './nodes/generateTestCases.js';
import { normalizeAcceptanceCriteria } from './nodes/normalizeAcceptanceCriteria.js';
import { persistDraft } from './nodes/persistDraft.js';
import { publishApprovedCases } from './nodes/publishApprovedCases.js';
import { recordAuditOutcome } from './nodes/recordAuditOutcome.js';
import { retrieveEnterpriseContext } from './nodes/retrieveEnterpriseContext.js';
import { validateTestCases } from './nodes/validateTestCases.js';
import { GraphStateAnnotation, type GraphState, type GraphUpdate, type NodeFn } from './state.js';

/**
 * Wraps a node with tracing, metrics and the error policy:
 *  - transient (retryable) failures are rethrown so the checkpoint stays before the node and the
 *    message is redelivered (bounded by the queue's max delivery count);
 *  - everything else becomes a recorded `failed` outcome routed to recordAuditOutcome;
 *  - a cancelled job stops the run before the next node does any work.
 */
export const guard =
  (name: string, deps: GraphDeps, fn: NodeFn, opts: { checkCancelled?: boolean } = {}): NodeFn =>
  async (state: GraphState): Promise<GraphUpdate> => {
    const started = Date.now();
    return withSpan(
      `workflow.${name}`,
      { 'job.id': state.jobId, 'workflow.node': name, 'correlation.id': state.correlationId ?? '' },
      async () => {
        try {
          if (opts.checkCancelled !== false && name !== 'authorizeRequest') {
            const job = await reposOf(deps).jobs.get(state.jobId);
            if (job?.status === 'cancelled') return { outcome: 'cancelled' };
          }
          return await fn(state);
        } catch (err) {
          if (isGraphBubbleUp(err) || err instanceof RetryLaterError || isRetryable(err)) throw err;
          m.workflowNodeErrors.add(1, { node: name, category: categoryOf(err) });
          deps.log.warn(
            { jobId: state.jobId, node: name, category: categoryOf(err), err: safeMessage(err) },
            'workflow node failed',
          );
          if (name === 'recordAuditOutcome') throw err;
          const category = err instanceof AppError ? err.category : 'internal';
          return { outcome: 'failed', failure: { node: name, category, message: safeMessage(err) } };
        } finally {
          m.workflowNodeDuration.record(Date.now() - started, { node: name });
        }
      },
    );
  };

/** Next node, or the audit/outcome node when a previous step set a terminal outcome. */
const orOutcome = (next: string) => (state: GraphState) => (state.outcome ? 'recordAuditOutcome' : next);

export function buildGraph(deps: GraphDeps, checkpointer: BaseCheckpointSaver) {
  const g = new StateGraph(GraphStateAnnotation)
    .addNode('authorizeRequest', guard('authorizeRequest', deps, authorizeRequest(deps)))
    .addNode('fetchJiraStory', guard('fetchJiraStory', deps, fetchJiraStory(deps)))
    .addNode(
      'retrieveEnterpriseContext',
      guard('retrieveEnterpriseContext', deps, retrieveEnterpriseContext(deps)),
    )
    .addNode(
      'normalizeAcceptanceCriteria',
      guard('normalizeAcceptanceCriteria', deps, normalizeAcceptanceCriteria(deps)),
    )
    .addNode('analyzeRequirements', guard('analyzeRequirements', deps, analyzeRequirements(deps)))
    .addNode('detectAmbiguities', guard('detectAmbiguities', deps, detectAmbiguities(deps)))
    .addNode('generateTestCases', guard('generateTestCases', deps, generateTestCases(deps)))
    .addNode('validateTestCases', guard('validateTestCases', deps, validateTestCases(deps)))
    .addNode('evaluateCoverage', guard('evaluateCoverage', deps, evaluateCoverage(deps)))
    .addNode('detectDuplicates', guard('detectDuplicates', deps, detectDuplicates(deps)))
    .addNode('persistDraft', guard('persistDraft', deps, persistDraft(deps)))
    .addNode('awaitHumanReview', awaitHumanReview(deps))
    .addNode('publishApprovedCases', guard('publishApprovedCases', deps, publishApprovedCases(deps)))
    .addNode(
      'recordAuditOutcome',
      guard('recordAuditOutcome', deps, recordAuditOutcome(deps), { checkCancelled: false }),
    )

    .addNode('markInvalid', async (s: GraphState): Promise<GraphUpdate> => ({
      outcome: 'failed',
      failure: {
        node: 'validateTestCases',
        category: 'model_output_invalid',
        message: `Generated test cases failed validation: ${(s.validation?.issues ?? [])
          .filter((i) => i.severity === 'error')
          .slice(0, 5)
          .map((i) => i.code)
          .join(', ')}`,
      },
    }))

    .addEdge(START, 'authorizeRequest')
    .addConditionalEdges(
      'authorizeRequest',
      (s) =>
        s.outcome ? 'recordAuditOutcome' : s.phase === 'publish' ? 'publishApprovedCases' : 'fetchJiraStory',
      ['recordAuditOutcome', 'publishApprovedCases', 'fetchJiraStory'],
    )
    .addConditionalEdges('fetchJiraStory', orOutcome('retrieveEnterpriseContext'), [
      'recordAuditOutcome',
      'retrieveEnterpriseContext',
    ])
    .addConditionalEdges('retrieveEnterpriseContext', orOutcome('normalizeAcceptanceCriteria'), [
      'recordAuditOutcome',
      'normalizeAcceptanceCriteria',
    ])
    .addConditionalEdges('normalizeAcceptanceCriteria', orOutcome('analyzeRequirements'), [
      'recordAuditOutcome',
      'analyzeRequirements',
    ])
    .addConditionalEdges('analyzeRequirements', orOutcome('detectAmbiguities'), [
      'recordAuditOutcome',
      'detectAmbiguities',
    ])
    .addConditionalEdges('detectAmbiguities', orOutcome('generateTestCases'), [
      'recordAuditOutcome',
      'generateTestCases',
    ])
    .addConditionalEdges('generateTestCases', orOutcome('validateTestCases'), [
      'recordAuditOutcome',
      'validateTestCases',
    ])
    .addConditionalEdges(
      'validateTestCases',
      (s) => {
        if (s.outcome) return 'recordAuditOutcome';
        if (s.validation?.valid) return 'evaluateCoverage';
        // Bounded repair loop: one more generation with the validator's feedback, then give up.
        return s.repairs < deps.config.MAX_VALIDATION_REPAIRS ? 'generateTestCases' : 'giveUp';
      },
      {
        recordAuditOutcome: 'recordAuditOutcome',
        evaluateCoverage: 'evaluateCoverage',
        generateTestCases: 'generateTestCases',
        giveUp: 'markInvalid',
      },
    )
    .addEdge('markInvalid', 'recordAuditOutcome')
    .addConditionalEdges('evaluateCoverage', orOutcome('detectDuplicates'), [
      'recordAuditOutcome',
      'detectDuplicates',
    ])
    .addConditionalEdges('detectDuplicates', orOutcome('persistDraft'), [
      'recordAuditOutcome',
      'persistDraft',
    ])
    .addConditionalEdges('persistDraft', orOutcome('awaitHumanReview'), [
      'recordAuditOutcome',
      'awaitHumanReview',
    ])
    .addConditionalEdges('awaitHumanReview', orOutcome('publishApprovedCases'), [
      'recordAuditOutcome',
      'publishApprovedCases',
    ])
    .addEdge('publishApprovedCases', 'recordAuditOutcome')
    .addEdge('recordAuditOutcome', END);

  return g.compile({ checkpointer });
}

export type CompiledWorkflow = ReturnType<typeof buildGraph>;
export { NODE_NAMES } from './state.js';

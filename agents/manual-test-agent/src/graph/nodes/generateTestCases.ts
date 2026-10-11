import { m } from '../../observability/telemetry.js';
import { requireField, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

/** The only references a model may cite: the story itself, linked issues and non-quarantined retrieved items. */
export function allowedReferencesOf(state: {
  story?: { key: string; linkedIssueKeys: string[] } | undefined;
  context?: { items: Array<{ type: string; id: string; suspectedInjection: boolean }> } | undefined;
}) {
  const refs: Array<{ type: string; ref: string }> = [];
  if (state.story) {
    refs.push({ type: 'jira', ref: state.story.key });
    for (const k of state.story.linkedIssueKeys) refs.push({ type: 'jira', ref: k });
  }
  for (const i of state.context?.items ?? [])
    if (!i.suspectedInjection) refs.push({ type: i.type, ref: i.id });
  return refs;
}

export const generateTestCases =
  (deps: GraphDeps): NodeFn =>
  async (state) => {
    const story = requireField(state.story, 'story');
    const allowedReferences = allowedReferencesOf(state);
    const repairing = state.validation && !state.validation.valid;
    const result = await deps.model.generateTestCases({
      issueKey: story.key,
      summary: story.summary,
      criteria: requireField(state.criteria, 'criteria'),
      context: (state.context?.items ?? []).filter((i) => !i.suspectedInjection),
      guidance: state.guidance,
      analysis: requireField(state.analysis, 'analysis'),
      ambiguities: state.ambiguities ?? [],
      allowedReferences,
      repairFeedback: repairing ? state.validation?.issues.filter((i) => i.severity === 'error') : undefined,
    });
    m.modelLatency.record(result.usage.latencyMs, { operation: 'generate' });
    m.modelTokens.add(result.usage.inputTokens + result.usage.outputTokens);
    if (result.usage.estimatedCostUsd) m.modelCostUsd.add(result.usage.estimatedCostUsd);
    return {
      testCases: result.value.testCases,
      allowedReferences,
      modelInfo: result.model,
      repairs: repairing ? state.repairs + 1 : state.repairs,
      usage: [{ ...result.usage, operation: 'generate' }],
    };
  };

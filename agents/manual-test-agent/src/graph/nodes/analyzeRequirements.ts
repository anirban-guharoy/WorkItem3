import { m } from '../../observability/telemetry.js';
import { requireField, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

export const analyzeRequirements =
  (deps: GraphDeps): NodeFn =>
  async (state) => {
    const story = requireField(state.story, 'story');
    const result = await deps.model.analyzeRequirements({
      issueKey: story.key,
      summary: story.summary,
      criteria: requireField(state.criteria, 'criteria'),
      // Quarantined (suspected injection) items never reach the model.
      context: (state.context?.items ?? []).filter((i) => !i.suspectedInjection),
      guidance: state.guidance,
    });
    m.modelLatency.record(result.usage.latencyMs, { operation: 'analyze' });
    return {
      analysis: result.value,
      modelInfo: result.model,
      usage: [{ ...result.usage, operation: 'analyze' }],
    };
  };

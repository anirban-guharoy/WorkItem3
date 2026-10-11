import { retrieveContext } from '../../services/context.js';
import { m } from '../../observability/telemetry.js';
import { audit, mcpContext, requireField, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

export const retrieveEnterpriseContext =
  (deps: GraphDeps): NodeFn =>
  async (state) => {
    const story = requireField(state.story, 'story');
    const context = await retrieveContext({
      gateway: deps.read,
      story,
      scope: deps.authorizer.projectConfig(requireField(state.projectKey, 'projectKey')),
      limits: {
        maxItems: deps.config.MAX_CONTEXT_ITEMS,
        maxSnippetChars: deps.config.MAX_CONTEXT_SNIPPET_CHARS,
      },
      ctx: mcpContext(state),
    });
    const quarantined = context.items.filter((i) => i.suspectedInjection);
    if (quarantined.length > 0) {
      m.injectionSuspected.add(quarantined.length);
      await audit(deps, state, 'context_quarantined', {
        items: quarantined.map((i) => ({ id: i.id, type: i.type })),
      });
    }
    return { context };
  };

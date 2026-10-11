import type { ProjectConfig } from '../config/index.js';
import type { McpCallContext, McpReadGateway } from '../mcp/types.js';
import { m } from '../observability/telemetry.js';
import type { ContextItem, JiraStory, RetrievedContext } from '../schemas/domain.js';
import { detectPromptInjection, sanitizeUntrusted } from '../security/sanitize.js';
import { jaccard, tokens } from '../shared/text.js';

export interface ContextLimits {
  maxItems: number;
  maxSnippetChars: number;
}

type ProjectScope = ProjectConfig[string];

const FIGMA_URL = /figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]{10,40}|[A-Za-z0-9]{5,40})/g;

const keywordsOf = (story: JiraStory): string =>
  [...new Set(tokens(`${story.summary} ${story.description}`))].slice(0, 12).join(' ');

/** Picks the paragraphs of a document most relevant to the story rather than sending whole pages. */
function relevantExcerpt(body: string, story: JiraStory, maxChars: number): string {
  const storyTokens = tokens(`${story.summary} ${story.acceptanceCriteriaField ?? ''} ${story.description}`);
  const paragraphs = body
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const scored = paragraphs
    .map((p, i) => ({ p, i, s: jaccard(tokens(p), storyTokens) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const picked: typeof scored = [];
  let size = 0;
  for (const item of scored) {
    if (size + item.p.length > maxChars && picked.length) break;
    picked.push(item);
    size += item.p.length;
  }
  return picked
    .sort((a, b) => a.i - b.i)
    .map((x) => x.p)
    .join('\n\n');
}

function toItem(
  partial: Omit<ContextItem, 'trust' | 'suspectedInjection' | 'snippet' | 'title'> & {
    title: string;
    snippet: string;
  },
  maxSnippet: number,
): ContextItem {
  const title = sanitizeUntrusted(partial.title, 300);
  const snippet = sanitizeUntrusted(partial.snippet, maxSnippet);
  return {
    ...partial,
    title,
    snippet,
    trust: 'untrusted',
    suspectedInjection: detectPromptInjection(`${title}\n${snippet}`),
  };
}

export interface RetrieveArgs {
  gateway: McpReadGateway;
  story: JiraStory;
  scope: ProjectScope | undefined;
  limits: ContextLimits;
  ctx: McpCallContext;
}

/**
 * Retrieves only relevant, project-scoped context. Failures of optional sources degrade the result
 * instead of failing the job. Items that look like prompt injection are quarantined (not sent to the model).
 */
export async function retrieveContext({
  gateway,
  story,
  scope,
  limits,
  ctx,
}: RetrieveArgs): Promise<RetrievedContext> {
  const items: ContextItem[] = [];
  const degraded: string[] = [];
  let droppedOutOfScope = 0;

  const attempt = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      degraded.push(`${label}: source unavailable`);
    }
  };

  await attempt('linked issues', async () => {
    for (const l of (await gateway.getLinkedIssues(story.key, ctx)).slice(0, 5)) {
      items.push(
        toItem(
          { id: l.key, type: 'jira', title: `${l.key} (${l.linkType})`, snippet: l.summary },
          limits.maxSnippetChars,
        ),
      );
    }
  });

  const allowedSpaces = scope?.confluenceSpaces ?? [];
  await attempt('confluence', async () => {
    if (allowedSpaces.length === 0) return;
    const hits = await gateway.searchConfluence(
      keywordsOf(story),
      { spaces: allowedSpaces, limit: limits.maxItems },
      ctx,
    );
    const inScope = hits.filter((h) => {
      const ok = allowedSpaces.includes(h.space);
      if (!ok) droppedOutOfScope += 1;
      return ok;
    });
    for (const hit of inScope.slice(0, 3)) {
      const page = await gateway.getConfluencePage(hit.id, ctx);
      if (!allowedSpaces.includes(page.space)) {
        droppedOutOfScope += 1;
        continue;
      }
      items.push(
        toItem(
          {
            id: page.id,
            type: 'confluence',
            title: page.title,
            snippet: relevantExcerpt(page.body, story, limits.maxSnippetChars),
            url: page.url,
            scope: page.space,
          },
          limits.maxSnippetChars,
        ),
      );
    }
  });

  const figmaKeys = new Set<string>();
  for (const match of `${story.description}\n${story.acceptanceCriteriaField ?? ''}`.matchAll(FIGMA_URL))
    if (match[1]) figmaKeys.add(match[1]);
  await attempt('figma', async () => {
    for (const key of [...figmaKeys].slice(0, 2)) {
      if (!(scope?.figmaFileKeys ?? []).includes(key)) {
        droppedOutOfScope += 1;
        continue;
      }
      const d = await gateway.getFigmaDesign(key, ctx);
      items.push(
        toItem(
          { id: d.id || key, type: 'figma', title: d.name, snippet: d.annotations.join('\n'), url: d.url },
          limits.maxSnippetChars,
        ),
      );
    }
  });

  await attempt('existing test cases', async () => {
    for (const t of (await gateway.searchExistingTestCases({ issueKey: story.key }, ctx)).slice(0, 10)) {
      items.push(
        toItem(
          { id: t.id, type: 'test_case', title: t.title, snippet: t.summary, url: t.url },
          limits.maxSnippetChars,
        ),
      );
    }
  });

  const flagged = items.filter((i) => i.suspectedInjection).length;
  if (flagged) m.injectionSuspected.add(flagged, { source: 'context' });
  return { items: items.slice(0, 40), degraded, droppedOutOfScope };
}

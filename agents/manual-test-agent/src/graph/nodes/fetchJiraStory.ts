import { AppError } from '../../shared/errors.js';
import { hashOf } from '../../shared/util.js';
import { projectKeyOf } from '../../schemas/common.js';
import { mcpContext, requireField, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

/** Hash of the requirement-bearing fields; used to detect a material change before publishing. */
export const storyHashOf = (story: {
  summary: string;
  description: string;
  acceptanceCriteriaField?: string | undefined;
}): string => hashOf({ s: story.summary, d: story.description, ac: story.acceptanceCriteriaField ?? '' });

export const fetchJiraStory =
  (deps: GraphDeps): NodeFn =>
  async (state) => {
    const issueKey = requireField(state.issueKey, 'issueKey');
    const story = await deps.read.getJiraIssue(issueKey, mcpContext(state));
    // Defence against a mis-mapped tool or cross-project data: the returned issue must be the one requested.
    if (story.key !== issueKey || projectKeyOf(story.key) !== state.projectKey) {
      throw new AppError('MCP returned an issue that does not match the request', 'upstream_mcp', 502, false);
    }
    return { story, storyHash: storyHashOf(story) };
  };

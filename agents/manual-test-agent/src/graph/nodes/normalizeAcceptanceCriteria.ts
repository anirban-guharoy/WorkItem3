import { normalizeAcceptanceCriteria as normalize } from '../../services/criteria.js';
import { requireField, audit, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

/** Missing acceptance criteria produce a clarification request; requirements are never invented. */
export const normalizeAcceptanceCriteria =
  (deps: GraphDeps): NodeFn =>
  async (state) => {
    const story = requireField(state.story, 'story');
    const criteria = normalize(story);
    if (criteria.length === 0) {
      const questions = [
        `${story.key} has no identifiable acceptance criteria. Please add testable acceptance criteria to the story (acceptance criteria field or an "Acceptance Criteria" section) and request generation again.`,
        'What observable behaviour defines "done" for this story, including error and boundary conditions?',
      ];
      await audit(deps, state, 'clarification_requested', { reason: 'no_acceptance_criteria' });
      return { criteria, clarificationQuestions: questions, outcome: 'needs_clarification' };
    }
    return { criteria };
  };

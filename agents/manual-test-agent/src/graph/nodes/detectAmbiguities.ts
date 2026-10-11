import { detectRuleAmbiguities, mergeAmbiguities } from '../../services/ambiguity.js';
import { requireField, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

export const detectAmbiguities =
  (_deps: GraphDeps): NodeFn =>
  async (state) => {
    const criteria = requireField(state.criteria, 'criteria');
    const ambiguities = mergeAmbiguities(detectRuleAmbiguities(criteria), state.analysis ?? null, criteria);
    const questions = [...new Set(ambiguities.map((a) => a.question))];
    return { ambiguities, clarificationQuestions: questions };
  };

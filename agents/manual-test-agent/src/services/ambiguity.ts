import type { Ambiguity, NormalizedCriterion, RequirementsAnalysis } from '../schemas/domain.js';
import { tokens } from '../shared/text.js';

const VAGUE_TERMS = [
  'quickly',
  'fast',
  'slow',
  'appropriate',
  'appropriately',
  'user-friendly',
  'user friendly',
  'easy',
  'intuitive',
  'as needed',
  'etc',
  'and so on',
  'reasonable',
  'properly',
  'efficient',
  'efficiently',
  'adequate',
  'minimal',
  'several',
  'various',
  'some',
  'many',
  'few',
  'if possible',
  'as soon as possible',
  'asap',
  'tbd',
  'tbc',
  'to be determined',
  'and/or',
  'similar',
  'good',
  'better',
  'nice',
  'robust',
  'seamless',
  'simple',
];
const VAGUE = new RegExp(
  `(?<![\\w-])(${VAGUE_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})(?![\\w-])`,
  'i',
);
const LIMIT_WITHOUT_VALUE = /\b(limit|threshold|maximum|minimum|timeout|within|at most|at least)\b/i;

export function detectRuleAmbiguities(criteria: NormalizedCriterion[]): Ambiguity[] {
  const out: Ambiguity[] = [];
  for (const c of criteria) {
    const vague = VAGUE.exec(c.text);
    if (vague?.[1]) {
      out.push({
        criterionId: c.id,
        kind: 'vague_term',
        description: `${c.id} uses the non-measurable term "${vague[1]}".`,
        question: `What exact, measurable behaviour is expected for "${vague[1]}" in ${c.id}?`,
        detectedBy: 'rules',
      });
    }
    if (LIMIT_WITHOUT_VALUE.test(c.text) && !/\d/.test(c.text) && !vague) {
      out.push({
        criterionId: c.id,
        kind: 'missing_value',
        description: `${c.id} refers to a limit or time bound without a concrete value.`,
        question: `What is the concrete value of the limit or time bound in ${c.id}?`,
        detectedBy: 'rules',
      });
    }
    if (tokens(c.text).length < 3) {
      out.push({
        criterionId: c.id,
        kind: 'untestable',
        description: `${c.id} is too short to derive observable expected results.`,
        question: `Please describe the observable behaviour that proves ${c.id} is satisfied.`,
        detectedBy: 'rules',
      });
    }
  }
  return out;
}

export function mergeAmbiguities(
  ruleBased: Ambiguity[],
  analysis: RequirementsAnalysis | null,
  criteria: NormalizedCriterion[],
): Ambiguity[] {
  const known = new Set(criteria.map((c) => c.id));
  const modelBased: Ambiguity[] = (analysis?.ambiguities ?? [])
    .filter((a) => known.has(a.criterionId))
    .map((a) => ({
      criterionId: a.criterionId,
      kind: 'model_reported' as const,
      description: a.description,
      question: a.question,
      detectedBy: 'model' as const,
    }));
  const seen = new Set<string>();
  return [...ruleBased, ...modelBased].filter((a) => {
    const key = `${a.criterionId}|${a.kind}|${a.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

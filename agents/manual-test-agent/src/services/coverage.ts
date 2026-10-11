import type { Ambiguity, CoverageRecord, NormalizedCriterion } from '../schemas/domain.js';
import type { TestCase } from '../schemas/testcase.js';
import type { CoverageSummary } from '../repositories/results.js';
import { normalizeText, tokens } from '../shared/text.js';

export interface CoverageThresholds {
  covered: number;
  partial: number;
}

const literalsOf = (text: string): string[] => {
  const quoted = [...text.matchAll(/["“']([^"”']{3,120})["”']/g)].map((m) => normalizeText(m[1] ?? ''));
  const numbers = [...text.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((m) => m[0]);
  return [...new Set([...quoted, ...numbers])].filter(Boolean);
};

const evidenceText = (tc: TestCase): string =>
  [
    tc.title,
    tc.objective,
    ...tc.steps.flatMap((s) => [s.action, s.expectedResult]),
    tc.expectedOutcome,
    ...tc.testData.map((d) => `${d.name} ${d.value}`),
  ].join(' ');

/**
 * Deterministic coverage assessment. A linked test case only counts if its actions and expected
 * results actually exercise the criterion's significant terms and literals (numbers, quoted messages).
 * This is a lexical heuristic; it is conservative and is meant to prompt human review, not replace it.
 */
export function evaluateCoverage(
  criteria: NormalizedCriterion[],
  testCases: TestCase[],
  ambiguities: Ambiguity[],
  thresholds: CoverageThresholds,
): { records: CoverageRecord[]; summary: CoverageSummary } {
  const records = criteria.map((c): CoverageRecord => {
    const linked = testCases.filter((tc) => tc.acceptanceCriteriaIds.includes(c.id));
    const ambiguous = ambiguities.filter((a) => a.criterionId === c.id);
    const needed = new Set(tokens(c.text));
    const literals = literalsOf(c.text);
    const base = { criterionId: c.id, criterionText: c.text, testCaseIds: linked.map((t) => t.id) };

    if (linked.length === 0) {
      return {
        ...base,
        status: ambiguous.length ? 'requires_clarification' : 'uncovered',
        evidence: [],
        gaps: [
          ambiguous.length
            ? 'Criterion is ambiguous and no test case is linked'
            : 'No test case is linked to this criterion',
        ],
      };
    }

    const covered = new Set<string>();
    const normalizedEvidence: string[] = [];
    const evidence: string[] = [];
    let bestScore = 0;
    for (const tc of linked) {
      const text = evidenceText(tc);
      normalizedEvidence.push(normalizeText(text));
      const evTokens = new Set(tokens(text));
      const matched = [...needed].filter((t) => evTokens.has(t));
      matched.forEach((t) => covered.add(t));
      const hasExpected = tc.steps.some((s) => s.expectedResult.trim().length > 0);
      const score = needed.size ? matched.length / needed.size : 0;
      if (hasExpected) bestScore = Math.max(bestScore, score);
      evidence.push(
        `${tc.id}: ${matched.length}/${needed.size} criterion terms exercised${hasExpected ? '' : ' (no expected result)'}`,
      );
    }
    const unionScore = needed.size ? covered.size / needed.size : 0;
    const score = Math.max(bestScore, unionScore * 0.9);
    const joined = normalizedEvidence.join(' ');
    const missingLiterals = literals.filter((l) => !joined.includes(l));
    const gaps: string[] = [];
    if (missingLiterals.length)
      gaps.push(
        `Specific values not verified by any linked test: ${missingLiterals.map((l) => `"${l}"`).join(', ')}`,
      );
    const missingTerms = [...needed].filter((t) => !covered.has(t)).slice(0, 8);
    if (score < thresholds.covered && missingTerms.length)
      gaps.push(`Terms not exercised: ${missingTerms.join(', ')}`);

    let status: CoverageRecord['status'];
    if (ambiguous.length) {
      status = 'requires_clarification';
      gaps.push(...ambiguous.map((a) => `Ambiguity: ${a.description}`));
    } else if (score >= thresholds.covered && missingLiterals.length === 0) status = 'covered';
    else if (score >= thresholds.partial) status = 'partially_covered';
    else status = 'uncovered';
    return { ...base, status, evidence: evidence.slice(0, 10), gaps: gaps.slice(0, 10) };
  });

  const count = (s: CoverageRecord['status']) => records.filter((r) => r.status === s).length;
  const total = records.length;
  return {
    records,
    summary: {
      total,
      covered: count('covered'),
      partiallyCovered: count('partially_covered'),
      uncovered: count('uncovered'),
      requiresClarification: count('requires_clarification'),
      coveragePercent: total ? Math.round((count('covered') / total) * 100) : 0,
    },
  };
}

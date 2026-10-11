import type { ContextItem, DuplicateCandidate } from '../schemas/domain.js';
import type { TestCase } from '../schemas/testcase.js';
import { jaccard, normalizeText, shingles, tokens } from '../shared/text.js';

const signature = (tc: TestCase): string[] => {
  const t = tokens([tc.title, ...tc.steps.flatMap((s) => [s.action, s.expectedResult])].join(' '));
  return [...t, ...shingles(t, 2)];
};

/** Flags (never removes) likely duplicates among the drafts and against existing test cases in context. */
export function detectDuplicates(
  testCases: TestCase[],
  existing: ContextItem[],
  threshold: number,
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  const sigs = testCases.map(signature);
  for (let i = 0; i < testCases.length; i += 1) {
    for (let j = i + 1; j < testCases.length; j += 1) {
      const a = testCases[i] as TestCase;
      const b = testCases[j] as TestCase;
      const sameTitle = normalizeText(a.title) === normalizeText(b.title);
      const sim = sameTitle ? 1 : jaccard(sigs[i] as string[], sigs[j] as string[]);
      if (sim >= threshold) {
        out.push({
          testCaseIds: [a.id, b.id],
          similarity: Math.round(sim * 100) / 100,
          reason: sameTitle ? 'Identical normalized title' : 'High textual similarity of steps and results',
        });
      }
    }
  }
  for (const tc of testCases) {
    const sig = signature(tc);
    for (const e of existing.filter((x) => x.type === 'test_case')) {
      const t = tokens(`${e.title} ${e.snippet}`);
      const sim =
        normalizeText(e.title) === normalizeText(tc.title) ? 1 : jaccard(sig, [...t, ...shingles(t, 2)]);
      if (sim >= threshold) {
        out.push({
          testCaseIds: [tc.id, `existing:${e.id}`],
          similarity: Math.round(sim * 100) / 100,
          reason: 'Similar to an existing test case',
        });
      }
    }
  }
  return out;
}

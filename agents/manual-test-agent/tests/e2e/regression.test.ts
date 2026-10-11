import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { principal, startStack } from './helpers.js';

interface Expectation {
  finalStatus: string;
  minTestCases: number;
  allCriteriaCovered: boolean;
  mustIncludeTestTypes: string[];
  everyCaseHasTraceability: boolean;
  everyStepHasExpectedResult: boolean;
}
interface Tc {
  testType: string;
  acceptanceCriteriaIds: string[];
  steps: { expectedResult: string }[];
}

const expectations = JSON.parse(
  readFileSync(new URL('../fixtures/quality-expectations.json', import.meta.url), 'utf8'),
) as Record<string, Expectation>;

const gen = principal('alice');
let s: Awaited<ReturnType<typeof startStack>>;
beforeAll(async () => {
  s = await startStack();
});
afterAll(async () => {
  await s.stop();
});

describe('regression fixtures: expected quality properties', () => {
  for (const [key, exp] of Object.entries(expectations)) {
    it(`${key} satisfies its quality expectations`, async () => {
      const created = await s.call('POST', '/api/v1/generations', gen, { issueKey: key });
      const jobId = created.body['jobId'] as string;
      const job = await s.waitFor(jobId, gen, [exp.finalStatus]);
      expect(job['status']).toBe(exp.finalStatus);
      if (exp.finalStatus !== 'awaiting_review') return;

      const tcs = (await s.call('GET', `/api/v1/generations/${jobId}/test-cases`, gen)).body['draft']
        .testCases as Tc[];
      expect(tcs.length).toBeGreaterThanOrEqual(exp.minTestCases);
      for (const t of exp.mustIncludeTestTypes) expect(tcs.some((c) => c.testType === t)).toBe(true);
      if (exp.everyCaseHasTraceability)
        expect(tcs.every((c) => c.acceptanceCriteriaIds.length > 0)).toBe(true);
      if (exp.everyStepHasExpectedResult)
        expect(tcs.every((c) => c.steps.every((st) => st.expectedResult.trim().length > 0))).toBe(true);
      const cov = (await s.call('GET', `/api/v1/generations/${jobId}/coverage`, gen)).body['records'] as {
        status: string;
      }[];
      expect(cov.every((r) => r.status === 'covered')).toBe(exp.allCriteriaCovered);
    });
  }
});

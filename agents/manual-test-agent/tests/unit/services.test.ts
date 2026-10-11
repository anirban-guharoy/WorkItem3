import { describe, expect, it } from 'vitest';
import { detectRuleAmbiguities } from '../../src/services/ambiguity.js';
import { evaluateCoverage } from '../../src/services/coverage.js';
import { normalizeAcceptanceCriteria } from '../../src/services/criteria.js';
import { detectDuplicates } from '../../src/services/duplicates.js';
import { validateTestCases } from '../../src/services/validation.js';
import { TestCaseSchema, type TestCase } from '../../src/schemas/testcase.js';
import { MOCK_STORIES } from '../../src/mcp/mock-data.js';

const tc = (over: Partial<TestCase> = {}): TestCase => ({
  id: 'TC-001',
  title: 'Account locks after 5 failed sign-in attempts',
  objective: 'Verify lockout after five consecutive failures',
  testType: 'negative',
  priority: 'high',
  preconditions: ['Active user account'],
  testData: [{ name: 'attempts', value: '5' }],
  steps: [
    {
      stepNumber: 1,
      action: 'Enter a wrong password 5 times within 15 minutes',
      expectedResult: 'Each attempt is rejected',
    },
    {
      stepNumber: 2,
      action: 'Attempt a sixth sign-in',
      expectedResult: 'The account is locked and sign-in is refused',
    },
  ],
  acceptanceCriteriaIds: ['AC-1'],
  sourceReferences: [{ type: 'jira', ref: 'PROJ-101' }],
  assumptions: [],
  expectedOutcome: 'The account is locked after 5 failed attempts',
  requiresClarification: false,
  clarificationQuestions: [],
  ...over,
});

const story = MOCK_STORIES.find((s) => s.key === 'PROJ-101') as (typeof MOCK_STORIES)[number];
const criteria = [
  {
    id: 'AC-1',
    text: 'The account is locked after 5 consecutive failed sign-in attempts within 15 minutes.',
    idOrigin: 'application_generated' as const,
    source: { type: 'jira' as const, ref: 'PROJ-101', field: 'acceptanceCriteria' as const },
  },
];

describe('criteria normalization', () => {
  it('marks identifiers as application generated and returns [] when criteria are missing', () => {
    const list = normalizeAcceptanceCriteria(story);
    expect(list.length).toBeGreaterThan(1);
    expect(list.every((c) => c.idOrigin === 'application_generated')).toBe(true);
    const none = MOCK_STORIES.find((s) => s.key === 'PROJ-102') as typeof story;
    expect(normalizeAcceptanceCriteria(none)).toEqual([]);
  });
});

describe('ambiguity detection', () => {
  it('flags vague terms', () => {
    const out = detectRuleAmbiguities([
      { ...criteria[0]!, id: 'AC-1', text: 'The page should load quickly and be user friendly' },
    ]);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.detectedBy).toBe('rules');
  });
});

describe('test case validation', () => {
  const allowed = [{ type: 'jira', ref: 'PROJ-101' }];
  it('accepts a good case', () => {
    expect(validateTestCases({ testCases: [tc()], criteria, allowedReferences: allowed }).valid).toBe(true);
  });
  it('rejects duplicate ids, fabricated references, unknown criteria and placeholder results', () => {
    const report = validateTestCases({
      testCases: [
        tc(),
        tc({
          sourceReferences: [{ type: 'confluence', ref: 'FAKE-1' }],
          acceptanceCriteriaIds: ['AC-9'],
          steps: [{ stepNumber: 1, action: 'Do it', expectedResult: 'TBD' }],
        }),
      ],
      criteria,
      allowedReferences: allowed,
    });
    expect(report.valid).toBe(false);
    const codes = report.issues.map((i) => i.code);
    expect(codes.length).toBeGreaterThanOrEqual(3);
  });
  it('rejects schema violations', () => {
    expect(validateTestCases({ testCases: [{ id: 'x' }], criteria, allowedReferences: allowed }).valid).toBe(
      false,
    );
    expect(validateTestCases({ testCases: [], criteria, allowedReferences: allowed }).valid).toBe(false);
  });
  it('schema enforces sequential step numbers', () => {
    expect(
      TestCaseSchema.safeParse(tc({ steps: [{ stepNumber: 2, action: 'a b c', expectedResult: 'x y z' }] }))
        .success,
    ).toBe(false);
  });
});

describe('coverage evaluation', () => {
  it('does not count a linked but unrelated case as coverage', () => {
    const unrelated = tc({
      title: 'Display help banner on dashboard',
      objective: 'Check banner rendering',
      steps: [{ stepNumber: 1, action: 'Open the dashboard page', expectedResult: 'Help banner is visible' }],
      expectedOutcome: 'Banner visible on dashboard',
      testData: [],
    });
    const { records } = evaluateCoverage(criteria, [unrelated], [], { covered: 0.6, partial: 0.3 });
    expect(records[0]?.status).not.toBe('covered');
  });
  it('marks relevant cases covered and unlinked criteria uncovered', () => {
    const ok = evaluateCoverage(criteria, [tc()], [], { covered: 0.6, partial: 0.3 });
    expect(ok.records[0]?.status).toBe('covered');
    const none = evaluateCoverage(criteria, [], [], { covered: 0.6, partial: 0.3 });
    expect(none.records[0]?.status).toBe('uncovered');
  });
});

describe('duplicate detection', () => {
  it('flags but does not remove near-identical cases', () => {
    const cases = [tc(), tc({ id: 'TC-002', title: 'Account locks after five failed sign-in attempts' })];
    const dups = detectDuplicates(cases, [], 0.6);
    expect(dups.length).toBe(1);
    expect(cases).toHaveLength(2);
  });
  it('does not flag distinct cases', () => {
    const other = tc({
      id: 'TC-002',
      title: 'Password reset email is sent',
      steps: [
        { stepNumber: 1, action: 'Request a reset link', expectedResult: 'An email arrives within a minute' },
      ],
    });
    expect(detectDuplicates([tc(), other], [], 0.8)).toHaveLength(0);
  });
});

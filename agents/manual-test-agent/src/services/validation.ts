import type { NormalizedCriterion, ValidationIssue, ValidationReport } from '../schemas/domain.js';
import { LIMITS } from '../schemas/common.js';
import { TestCaseSchema, type TestCase } from '../schemas/testcase.js';
import { tokens } from '../shared/text.js';

const PLACEHOLDER =
  /^\s*(tbd|tba|n\/a|na|todo|none|as expected|works|ok|success|same as above|\.\.\.)\s*\.?\s*$/i;
export const MAX_DRAFT_BYTES = 400_000;

export interface ValidationInput {
  testCases: unknown[];
  criteria: NormalizedCriterion[];
  allowedReferences: Array<{ type: string; ref: string }>;
}

export function validateTestCases(input: ValidationInput): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (severity: 'error' | 'warning', code: string, message: string, testCaseId?: string) =>
    issues.push({ severity, code, message: message.slice(0, 500), ...(testCaseId ? { testCaseId } : {}) });

  if (input.testCases.length === 0) add('error', 'empty_set', 'No test cases were produced');
  if (input.testCases.length > LIMITS.maxTestCases)
    add('error', 'too_many_cases', `More than ${LIMITS.maxTestCases} test cases`);
  if (Buffer.byteLength(JSON.stringify(input.testCases)) > MAX_DRAFT_BYTES)
    add('error', 'output_too_large', 'Draft exceeds the maximum size');

  const criterionIds = new Set(input.criteria.map((c) => c.id));
  const allowed = new Set(input.allowedReferences.map((r) => `${r.type}:${r.ref}`));
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  for (const raw of input.testCases) {
    const parsed = TestCaseSchema.safeParse(raw);
    const rawId = (raw as { id?: unknown })?.id;
    const label = typeof rawId === 'string' ? rawId : undefined;
    if (!parsed.success) {
      for (const i of parsed.error.issues.slice(0, 5))
        add('error', 'schema', `${i.path.join('.') || '(root)'}: ${i.message}`, label);
      continue;
    }
    const tc: TestCase = parsed.data;
    if (seenIds.has(tc.id)) add('error', 'duplicate_id', `Duplicate test case id ${tc.id}`, tc.id);
    seenIds.add(tc.id);
    const titleKey = tc.title.toLowerCase().trim();
    if (seenTitles.has(titleKey))
      add('warning', 'duplicate_title', 'Another test case has an identical title', tc.id);
    seenTitles.add(titleKey);

    for (const step of tc.steps) {
      if (tokens(step.action).length < 2 || PLACEHOLDER.test(step.action)) {
        add(
          'error',
          'non_actionable_step',
          `Step ${step.stepNumber} is not an actionable instruction`,
          tc.id,
        );
      }
      if (tokens(step.expectedResult).length < 2 || PLACEHOLDER.test(step.expectedResult)) {
        add(
          'error',
          'incomplete_expected_result',
          `Step ${step.stepNumber} has no observable expected result`,
          tc.id,
        );
      }
    }
    if (PLACEHOLDER.test(tc.expectedOutcome))
      add('error', 'incomplete_expected_result', 'expectedOutcome is a placeholder', tc.id);

    for (const acId of tc.acceptanceCriteriaIds) {
      if (!criterionIds.has(acId))
        add('error', 'unknown_criterion', `References unknown criterion ${acId}`, tc.id);
    }
    for (const ref of tc.sourceReferences) {
      if (!allowed.has(`${ref.type}:${ref.ref}`))
        add(
          'error',
          'invalid_source_reference',
          `Source reference ${ref.type}:${ref.ref} was not retrieved`,
          tc.id,
        );
    }
  }
  return { valid: !issues.some((i) => i.severity === 'error'), issues };
}

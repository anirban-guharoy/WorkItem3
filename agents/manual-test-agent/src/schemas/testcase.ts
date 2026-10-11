import { z } from 'zod';
import { LIMITS } from './common.js';

export const TEST_TYPES = [
  'positive',
  'negative',
  'boundary',
  'validation',
  'authorization',
  'integration',
  'usability',
  'regression',
] as const;
export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export const SOURCE_REFERENCE_TYPES = ['jira', 'confluence', 'figma', 'test_case', 'knowledge'] as const;

export const TestTypeSchema = z.enum(TEST_TYPES);
export const PrioritySchema = z.enum(PRIORITIES);

export const TestStepSchema = z.strictObject({
  stepNumber: z.number().int().min(1).max(LIMITS.maxSteps),
  action: z.string().trim().min(1).max(LIMITS.step),
  expectedResult: z.string().trim().min(1).max(LIMITS.step),
});

export const SourceReferenceSchema = z.strictObject({
  type: z.enum(SOURCE_REFERENCE_TYPES),
  ref: z.string().trim().min(1).max(200),
  excerpt: z.string().max(LIMITS.shortText).optional(),
});

export const TestDataEntrySchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  value: z.string().max(LIMITS.shortText),
});

export const TestCaseSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/),
    title: z.string().trim().min(5).max(LIMITS.title),
    objective: z.string().trim().min(5).max(LIMITS.objective),
    testType: TestTypeSchema,
    priority: PrioritySchema,
    preconditions: z.array(z.string().trim().min(1).max(LIMITS.shortText)).max(15),
    testData: z.array(TestDataEntrySchema).max(20),
    steps: z.array(TestStepSchema).min(1).max(LIMITS.maxSteps),
    acceptanceCriteriaIds: z
      .array(z.string().regex(/^AC-\d{1,3}$/))
      .min(1)
      .max(10),
    sourceReferences: z.array(SourceReferenceSchema).max(10),
    assumptions: z.array(z.string().trim().min(1).max(LIMITS.shortText)).max(10),
    expectedOutcome: z.string().trim().min(5).max(LIMITS.step),
    requiresClarification: z.boolean(),
    clarificationQuestions: z.array(z.string().trim().min(1).max(LIMITS.shortText)).max(10),
  })
  .superRefine((tc, ctx) => {
    tc.steps.forEach((step, i) => {
      if (step.stepNumber !== i + 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'stepNumber'],
          message: 'stepNumber must be sequential from 1',
        });
      }
    });
    if (tc.requiresClarification && tc.clarificationQuestions.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['clarificationQuestions'],
        message: 'questions required when requiresClarification',
      });
    }
  });
export type TestCase = z.infer<typeof TestCaseSchema>;

export const GeneratedTestCasesSchema = z.strictObject({
  testCases: z.array(TestCaseSchema).min(1).max(LIMITS.maxTestCases),
});
export type GeneratedTestCases = z.infer<typeof GeneratedTestCasesSchema>;

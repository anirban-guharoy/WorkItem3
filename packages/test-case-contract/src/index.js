import { z } from "zod";

export const StorySchema = z.object({
  key: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
});

export const TestCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.enum(["functional", "negative", "boundary", "security", "usability", "regression"]),
  priority: z.enum(["High", "Medium", "Low"]),
  acceptanceCriterion: z.string(),
  preconditions: z.array(z.string()),
  steps: z.array(z.string()).min(1),
  expectedResult: z.string(),
});

export const TestCaseSet = z.object({
  summary: z.string().describe("One-paragraph summary of what is being tested"),
  assumptions: z.array(z.string()).describe("Assumptions or open questions found while reviewing the story"),
  contextSources: z.array(z.string()).describe("Titles/URLs of documents actually used"),
  testCases: z.array(TestCaseSchema).min(1),
});

export const TestCaseReview = z.object({
  reviewStatus: z.enum(["approved", "changes_requested"]),
  summary: z.string(),
  contextSources: z.array(z.string()).describe("Titles/URLs of external documents actually used during the review"),
  coverage: z.array(
    z.object({
      criterion: z.string(),
      status: z.enum(["covered", "partial", "missing", "not_assessable"]),
      testCaseIds: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
  findings: z.array(
    z.object({
      severity: z.enum(["critical", "major", "minor", "suggestion"]),
      testCaseIds: z.array(z.string()).describe("Affected case IDs, or an empty list for a set-level finding"),
      title: z.string(),
      rationale: z.string(),
      recommendation: z.string(),
    }),
  ),
});

export const ReviewRequest = z.object({
  story: StorySchema,
  testCaseSet: TestCaseSet,
});

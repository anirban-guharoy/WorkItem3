import { z } from 'zod';
import {
  IssueKeySchema,
  JobStatusSchema,
  LIMITS,
  ProjectKeySchema,
  Sha256Schema,
  UuidSchema,
} from './common.js';
import { SOURCE_REFERENCE_TYPES, TestCaseSchema } from './testcase.js';

export const JiraStorySchema = z.strictObject({
  key: IssueKeySchema,
  summary: z.string().max(LIMITS.title * 2),
  description: z.string().max(20_000),
  acceptanceCriteriaField: z.string().max(20_000).optional(),
  issueType: z.string().max(50).optional(),
  status: z.string().max(100).optional(),
  labels: z.array(z.string().max(100)).max(50).default([]),
  updatedAt: z.string().max(40).optional(),
  linkedIssueKeys: z.array(IssueKeySchema).max(50).default([]),
});
export type JiraStory = z.infer<typeof JiraStorySchema>;

export const NormalizedCriterionSchema = z.strictObject({
  id: z.string().regex(/^AC-\d{1,3}$/),
  text: z.string().trim().min(3).max(LIMITS.longText),
  idOrigin: z.literal('application_generated'),
  source: z.strictObject({
    type: z.literal('jira'),
    ref: IssueKeySchema,
    field: z.enum(['acceptanceCriteria', 'description']),
  }),
});
export type NormalizedCriterion = z.infer<typeof NormalizedCriterionSchema>;

export const ContextItemSchema = z.strictObject({
  id: z.string().max(200),
  type: z.enum(SOURCE_REFERENCE_TYPES),
  title: z.string().max(300),
  snippet: z.string().max(3000),
  url: z.string().max(500).optional(),
  scope: z.string().max(100).optional(),
  trust: z.literal('untrusted'),
  suspectedInjection: z.boolean(),
});
export type ContextItem = z.infer<typeof ContextItemSchema>;

export const RetrievedContextSchema = z.strictObject({
  items: z.array(ContextItemSchema).max(40),
  degraded: z.array(z.string().max(200)).max(20),
  droppedOutOfScope: z.number().int().min(0),
});
export type RetrievedContext = z.infer<typeof RetrievedContextSchema>;

export const AmbiguitySchema = z.strictObject({
  criterionId: z.string().regex(/^AC-\d{1,3}$/),
  kind: z.enum(['vague_term', 'missing_value', 'conflict', 'untestable', 'model_reported']),
  description: z.string().max(LIMITS.shortText),
  question: z.string().max(LIMITS.shortText),
  detectedBy: z.enum(['rules', 'model']),
});
export type Ambiguity = z.infer<typeof AmbiguitySchema>;

export const RequirementsAnalysisSchema = z.strictObject({
  summary: z.string().max(LIMITS.longText),
  testableBehaviours: z
    .array(
      z.strictObject({
        criterionId: z.string().regex(/^AC-\d{1,3}$/),
        behaviour: z.string().max(LIMITS.shortText),
      }),
    )
    .max(100),
  missingRequirements: z.array(z.string().max(LIMITS.shortText)).max(20),
  ambiguities: z
    .array(
      z.strictObject({
        criterionId: z.string().regex(/^AC-\d{1,3}$/),
        description: z.string().max(LIMITS.shortText),
        question: z.string().max(LIMITS.shortText),
      }),
    )
    .max(50),
});
export type RequirementsAnalysis = z.infer<typeof RequirementsAnalysisSchema>;

export const COVERAGE_STATUSES = [
  'covered',
  'partially_covered',
  'uncovered',
  'requires_clarification',
] as const;
export const CoverageRecordSchema = z.strictObject({
  criterionId: z.string(),
  criterionText: z.string(),
  testCaseIds: z.array(z.string()),
  status: z.enum(COVERAGE_STATUSES),
  evidence: z.array(z.string().max(LIMITS.shortText)),
  gaps: z.array(z.string().max(LIMITS.shortText)),
});
export type CoverageRecord = z.infer<typeof CoverageRecordSchema>;

export const DuplicateCandidateSchema = z.strictObject({
  testCaseIds: z.tuple([z.string(), z.string()]),
  similarity: z.number().min(0).max(1),
  reason: z.string().max(LIMITS.shortText),
});
export type DuplicateCandidate = z.infer<typeof DuplicateCandidateSchema>;

export const ValidationIssueSchema = z.strictObject({
  testCaseId: z.string().optional(),
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string().max(LIMITS.shortText),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationReportSchema = z.strictObject({
  valid: z.boolean(),
  issues: z.array(ValidationIssueSchema),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

export const CreateGenerationRequestSchema = z.strictObject({
  issueKey: IssueKeySchema,
  notes: z.string().max(LIMITS.shortText).optional(),
});
export type CreateGenerationRequest = z.infer<typeof CreateGenerationRequestSchema>;

export const REVIEW_ACTIONS = ['approve', 'reject', 'edit', 'request_regeneration'] as const;
export const ReviewRequestSchema = z
  .strictObject({
    decisionId: UuidSchema,
    action: z.enum(REVIEW_ACTIONS),
    draftVersion: z.number().int().min(1),
    comment: z.string().max(2000).optional(),
    editedTestCases: z.array(TestCaseSchema).min(1).max(LIMITS.maxTestCases).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.action === 'edit' && !r.editedTestCases) {
      ctx.addIssue({ code: 'custom', path: ['editedTestCases'], message: 'required for edit' });
    }
    if (r.action !== 'edit' && r.editedTestCases) {
      ctx.addIssue({ code: 'custom', path: ['editedTestCases'], message: 'only allowed for edit' });
    }
    if ((r.action === 'reject' || r.action === 'request_regeneration') && !r.comment) {
      ctx.addIssue({ code: 'custom', path: ['comment'], message: 'comment required' });
    }
  });
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export const PublicationRequestSchema = z.strictObject({
  draftVersion: z.number().int().min(1),
});
export type PublicationRequest = z.infer<typeof PublicationRequestSchema>;

export const AuditEventSchema = z.strictObject({
  jobId: UuidSchema.nullable(),
  eventType: z.string().max(100),
  actor: z.string().max(200),
  correlationId: z.string().max(100).nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type AuditEventInput = z.infer<typeof AuditEventSchema>;

export const GenerationJobSchema = z.strictObject({
  id: UuidSchema,
  issueKey: IssueKeySchema,
  projectKey: ProjectKeySchema,
  status: JobStatusSchema,
  attempt: z.number().int(),
  version: z.number().int(),
  draftVersion: z.number().int(),
  requestedBy: z.string(),
  correlationId: z.string(),
  failureCategory: z.string().nullable(),
  failureMessage: z.string().nullable(),
  clarificationQuestions: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GenerationJobView = z.infer<typeof GenerationJobSchema>;

export const QueueMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.enum(['generate', 'publish']),
  jobId: UuidSchema,
  attempt: z.number().int().min(1),
  correlationId: z.string().max(100),
  publicationId: UuidSchema.optional(),
  publicationVersion: z.number().int().min(1).optional(),
  enqueuedAt: z.string(),
});
export type QueueMessage = z.infer<typeof QueueMessageSchema>;

export const StoryHashSchema = Sha256Schema;

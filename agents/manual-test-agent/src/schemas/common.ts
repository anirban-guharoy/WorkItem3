import { z } from 'zod';

export const IssueKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{1,19}-[1-9]\d{0,8}$/, 'Expected a JIRA issue key such as PROJ-123');

export const ProjectKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/);

export const JOB_STATUSES = [
  'queued',
  'running',
  'draft_ready',
  'awaiting_review',
  'needs_clarification',
  'approved',
  'rejected',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const UuidSchema = z.uuid();
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const projectKeyOf = (issueKey: string): string => issueKey.slice(0, issueKey.lastIndexOf('-'));

export const LIMITS = {
  title: 200,
  objective: 1000,
  step: 1000,
  shortText: 500,
  longText: 4000,
  maxSteps: 30,
  maxTestCases: 60,
  maxCriteria: 50,
} as const;

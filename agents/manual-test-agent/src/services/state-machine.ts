import type { JobStatus } from '../schemas/common.js';
import { InvalidTransitionError } from '../shared/errors.js';

/** Must stay identical to enforce_job_transition() in migrations/001_initial_schema.sql (verified by a test). */
export const TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ['running', 'cancelled', 'failed'],
  running: ['queued', 'draft_ready', 'awaiting_review', 'needs_clarification', 'failed', 'cancelled'],
  draft_ready: ['awaiting_review', 'failed', 'cancelled'],
  awaiting_review: ['approved', 'rejected', 'queued', 'cancelled', 'failed'],
  needs_clarification: ['queued', 'cancelled'],
  approved: ['publishing', 'awaiting_review', 'cancelled'],
  publishing: ['published', 'failed', 'approved'],
  failed: ['queued', 'publishing'],
  rejected: [],
  published: [],
  cancelled: [],
};

export const TERMINAL_STATUSES: readonly JobStatus[] = ['rejected', 'published', 'cancelled'];

export const canTransition = (from: JobStatus, to: JobStatus): boolean =>
  from === to || TRANSITIONS[from].includes(to);

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** States from which `to` may legally be entered (used to build guarded UPDATE statements). */
export const sourcesOf = (to: JobStatus): JobStatus[] =>
  (Object.keys(TRANSITIONS) as JobStatus[]).filter((from) => TRANSITIONS[from].includes(to));

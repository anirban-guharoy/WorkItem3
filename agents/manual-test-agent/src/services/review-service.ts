import type { Principal } from '../auth/principal.js';
import { m } from '../observability/telemetry.js';
import type { JobRecord } from '../repositories/jobs.js';
import { repositoriesFor } from '../repositories/index.js';
import type { ReviewDecisionRecord } from '../repositories/reviews.js';
import type { NormalizedCriterion, Ambiguity, ReviewRequest } from '../schemas/domain.js';
import { AppError, conflict, forbidden } from '../shared/errors.js';
import { hashOf } from '../shared/util.js';
import { evaluateCoverage } from './coverage.js';
import { enqueue, generateMessage, loadJobFor, type ServiceDeps } from './job-service.js';
import { validateTestCases } from './validation.js';

export interface ReviewOutcome {
  job: JobRecord;
  decision: ReviewDecisionRecord;
  replay: boolean;
}

export class ReviewService {
  constructor(private readonly deps: ServiceDeps) {}

  async review(
    principal: Principal,
    jobId: string,
    req: ReviewRequest,
    correlationId: string,
  ): Promise<ReviewOutcome> {
    const outcome = await this.deps.db.transaction(async (tx) => {
      const repos = repositoriesFor(tx);
      const job = await loadJobFor(this.deps, principal, jobId, 'review', true, tx);

      // decisionId is the replay key: an identical retry is a no-op, any other reuse is rejected.
      const prior = await repos.reviews.get(req.decisionId);
      if (prior) {
        if (
          prior.jobId === jobId &&
          prior.reviewer === principal.id &&
          prior.action === req.action &&
          prior.draftVersion === req.draftVersion
        ) {
          return { job, decision: prior, replay: true };
        }
        throw conflict('decisionId has already been used');
      }
      if (req.draftVersion !== job.draftVersion) {
        throw conflict('The draft changed since you loaded it', { currentDraftVersion: job.draftVersion });
      }
      if (req.action === 'approve' && job.status !== 'awaiting_review')
        throw conflict(`Job is ${job.status}; only awaiting_review drafts can be approved`);
      if (
        req.action === 'approve' &&
        this.deps.config.REQUIRE_DISTINCT_REVIEWER &&
        job.requestedBy === principal.id
      ) {
        throw forbidden('The reviewer must differ from the requester');
      }

      let version = job.version;
      if (job.status === 'approved' && req.action !== 'approve') {
        // Withdrawing an approval before it is published: revoke it and reopen the draft.
        await repos.reviews.revokeApprovals(jobId, `superseded by ${req.action}`);
        version = (await repos.jobs.transition(jobId, { to: 'awaiting_review', expectedVersion: version }))
          .version;
      } else if (job.status !== 'awaiting_review') {
        throw conflict(`Job is ${job.status}; it is not awaiting review`);
      }

      const draft = await repos.results.getDraft(jobId, job.draftVersion);
      if (!draft) throw conflict('No draft exists for this job');
      const insert = (hash: string) =>
        repos.reviews.insert({
          id: req.decisionId,
          jobId,
          draftVersion: req.draftVersion,
          action: req.action,
          reviewer: principal.id,
          comment: req.comment ?? null,
          contentHash: hash,
        });

      let decision: ReviewDecisionRecord;
      let updated: JobRecord;
      switch (req.action) {
        case 'approve': {
          decision = await insert(draft.contentHash);
          updated = await repos.jobs.transition(jobId, { to: 'approved', expectedVersion: version });
          break;
        }
        case 'reject': {
          decision = await insert(draft.contentHash);
          updated = await repos.jobs.transition(jobId, { to: 'rejected', expectedVersion: version });
          break;
        }
        case 'request_regeneration': {
          decision = await insert(draft.contentHash);
          updated = await repos.jobs.transition(jobId, {
            to: 'queued',
            expectedVersion: version,
            set: { attempt: job.attempt + 1, notes: req.comment ?? null },
          });
          break;
        }
        case 'edit': {
          const generation = await repos.results.getGenerationResult(jobId);
          const criteria = (generation?.['criteria'] ?? []) as NormalizedCriterion[];
          const ambiguities = (generation?.['ambiguities'] ?? []) as Ambiguity[];
          const contextRefs = (generation?.['context_refs'] ?? []) as Array<{
            id: string;
            type: string;
            suspectedInjection: boolean;
          }>;
          const edited = req.editedTestCases ?? [];
          const allowedReferences = [
            { type: 'jira', ref: job.issueKey },
            ...contextRefs.filter((c) => !c.suspectedInjection).map((c) => ({ type: c.type, ref: c.id })),
            ...draft.testCases.flatMap((t) => t.sourceReferences.map((r) => ({ type: r.type, ref: r.ref }))),
          ];
          const report = validateTestCases({ testCases: edited, criteria, allowedReferences });
          if (!report.valid)
            throw new AppError(
              'Edited test cases failed validation',
              'validation',
              422,
              false,
              report.issues,
            );
          const next = draft.draftVersion + 1;
          const contentHash = hashOf(edited);
          await repos.reviews.revokeApprovals(jobId, 'draft edited');
          await repos.results.insertDraft({
            jobId,
            draftVersion: next,
            testCases: edited,
            contentHash,
            origin: 'reviewer_edit',
            createdBy: principal.id,
          });
          const coverage = evaluateCoverage(criteria, edited, ambiguities, {
            covered: this.deps.config.COVERAGE_COVERED_THRESHOLD,
            partial: this.deps.config.COVERAGE_PARTIAL_THRESHOLD,
          });
          await repos.results.saveCoverage({ jobId, draftVersion: next, ...coverage });
          decision = await insert(contentHash);
          updated = await repos.jobs.transition(jobId, {
            to: 'awaiting_review',
            expectedVersion: version,
            set: { draftVersion: next },
          });
          break;
        }
      }

      await repos.audit.append({
        jobId,
        eventType: `review_${req.action}`,
        actor: principal.id,
        correlationId,
        details: {
          decisionId: req.decisionId,
          draftVersion: req.draftVersion,
          contentHash: decision.contentHash,
          comment: req.comment,
        },
      });
      m.reviewDecisions.add(1, { action: req.action });
      return { job: updated, decision, replay: false };
    });

    if (!outcome.replay && req.action === 'request_regeneration')
      await enqueue(this.deps, generateMessage(outcome.job));
    return outcome;
  }
}

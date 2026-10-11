import type { Principal } from '../auth/principal.js';
import type { JobRecord } from '../repositories/jobs.js';
import type { PublicationRecord } from '../repositories/publications.js';
import { repositoriesFor } from '../repositories/index.js';
import type { PublicationRequest } from '../schemas/domain.js';
import { conflict, forbidden } from '../shared/errors.js';
import { newId } from '../shared/util.js';
import { enqueue, loadJobFor, type ServiceDeps } from './job-service.js';

export interface PublishOutcome {
  job: JobRecord;
  publication: PublicationRecord;
  /** True when an identical request had already been accepted; nothing new was queued. */
  replay: boolean;
}

/**
 * Synchronous gate in front of the privileged write. It never writes to JIRA itself: it validates the
 * approval and moves the job to `publishing`; the worker then re-verifies and performs the write.
 */
export class PublishService {
  constructor(private readonly deps: ServiceDeps) {}

  async publish(
    principal: Principal,
    jobId: string,
    req: PublicationRequest,
    correlationId: string,
  ): Promise<PublishOutcome> {
    const outcome = await this.deps.db.transaction(async (tx) => {
      const repos = repositoriesFor(tx);
      const job = await loadJobFor(this.deps, principal, jobId, 'publish', true, tx);

      if (job.status === 'publishing' || job.status === 'published') {
        const existing = await repos.publications.getForJob(jobId, req.draftVersion);
        if (existing) return { job, publication: existing, replay: true };
      }
      if (job.status !== 'approved' && job.status !== 'failed')
        throw conflict(`Job is ${job.status}; only approved drafts can be published`);
      if (req.draftVersion !== job.draftVersion)
        throw conflict('Draft version does not match the current draft', {
          currentDraftVersion: job.draftVersion,
        });

      const approval = await repos.reviews.activeApproval(jobId, req.draftVersion);
      if (!approval) throw forbidden('No valid approval exists for this draft version');
      const draft = await repos.results.getDraft(jobId, req.draftVersion);
      if (!draft || draft.contentHash !== approval.contentHash)
        throw conflict('Approved content does not match the current draft');

      const destination = this.deps.authorizer.projectConfig(job.projectKey)?.publishDestination;
      if (!destination) throw forbidden('No publish destination is configured for this project');
      if (!this.deps.config.MCP_ALLOW_WRITES)
        throw forbidden('Write operations are disabled in this deployment');

      if (job.status === 'failed') {
        const last = await repos.publications.getForJob(jobId, req.draftVersion);
        if (!last || last.status !== 'failed') throw conflict('Only a failed publication can be retried');
      }
      const equivalent = await repos.publications.findPublishedEquivalent(
        job.issueKey,
        destination,
        draft.contentHash,
      );
      if (equivalent)
        throw conflict('An equivalent publication already exists', {
          externalIds: equivalent.results.map((r) => r.externalId),
        });

      const publication = await repos.publications.createOrReset({
        id: newId(),
        jobId,
        issueKey: job.issueKey,
        draftVersion: req.draftVersion,
        approvalDecisionId: approval.id,
        destination,
        contentHash: draft.contentHash,
        requestedBy: principal.id,
      });
      const updated = await repos.jobs.transition(jobId, {
        to: 'publishing',
        from: ['approved', 'failed'],
        expectedVersion: job.version,
      });
      await repos.audit.append({
        jobId,
        eventType: 'publish_requested',
        actor: principal.id,
        correlationId,
        details: {
          publicationId: publication.id,
          destination,
          draftVersion: req.draftVersion,
          approvalDecisionId: approval.id,
        },
      });
      return { job: updated, publication, replay: false };
    });

    if (!outcome.replay) {
      await enqueue(this.deps, {
        schemaVersion: 1,
        type: 'publish',
        jobId,
        attempt: outcome.job.attempt,
        correlationId,
        publicationId: outcome.publication.id,
        publicationVersion: outcome.publication.version,
        enqueuedAt: new Date().toISOString(),
      });
    }
    return outcome;
  }
}

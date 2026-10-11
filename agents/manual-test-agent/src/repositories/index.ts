import type { Queryable } from '../database/db.js';
import { AuditRepository } from './audit.js';
import { JobRepository } from './jobs.js';
import { PublicationRepository } from './publications.js';
import { ResultRepository } from './results.js';
import { ReviewRepository } from './reviews.js';

export interface Repositories {
  jobs: JobRepository;
  results: ResultRepository;
  reviews: ReviewRepository;
  publications: PublicationRepository;
  audit: AuditRepository;
}

export const repositoriesFor = (q: Queryable): Repositories => ({
  jobs: new JobRepository(q),
  results: new ResultRepository(q),
  reviews: new ReviewRepository(q),
  publications: new PublicationRepository(q),
  audit: new AuditRepository(q),
});

export { AuditRepository, JobRepository, PublicationRepository, ResultRepository, ReviewRepository };

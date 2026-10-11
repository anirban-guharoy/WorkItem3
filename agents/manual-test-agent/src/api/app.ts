import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z, ZodError, type ZodType } from 'zod';
import type { Authenticator } from '../auth/entra.js';
import type { Principal } from '../auth/principal.js';
import type { AppConfig } from '../config/index.js';
import type { Db } from '../database/db.js';
import { createLogger } from '../observability/telemetry.js';
import type { JobRecord } from '../repositories/jobs.js';
import {
  CreateGenerationRequestSchema,
  PublicationRequestSchema,
  ReviewRequestSchema,
} from '../schemas/domain.js';
import { UuidSchema } from '../schemas/common.js';
import { AppError, invalidInput, unauthenticated } from '../shared/errors.js';
import type { JobService } from '../services/job-service.js';
import type { PublishService } from '../services/publish-service.js';
import type { QueryService } from '../services/query-service.js';
import type { ReviewService } from '../services/review-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export interface ApiDeps {
  config: AppConfig;
  db: Db;
  authenticator: Authenticator;
  jobs: JobService;
  reviews: ReviewService;
  publishing: PublishService;
  queries: QueryService;
}

const JobParams = z.strictObject({ jobId: UuidSchema });
const VersionQuery = z.object({ version: z.coerce.number().int().min(1).optional() });

const parse = <T>(schema: ZodType<T>, value: unknown, what: string): T => {
  const r = schema.safeParse(value);
  if (!r.success)
    throw invalidInput(
      `Invalid ${what}`,
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  return r.data;
};

/** Public projection of a job: never exposes entitlements, lease or idempotency internals. */
export const jobView = (j: JobRecord, base: string) => ({
  jobId: j.id,
  issueKey: j.issueKey,
  projectKey: j.projectKey,
  status: j.status,
  attempt: j.attempt,
  version: j.version,
  draftVersion: j.draftVersion,
  requestedBy: j.requestedBy,
  correlationId: j.correlationId,
  failureCategory: j.failureCategory,
  failureMessage: j.failureMessage,
  clarificationQuestions: j.clarificationQuestions,
  createdAt: j.createdAt,
  updatedAt: j.updatedAt,
  statusUrl: `${base}/api/v1/generations/${j.id}`,
});

export function errorBody(err: unknown, correlationId: string): { status: number; body: unknown } {
  if (err instanceof AppError) {
    return {
      status: err.statusCode,
      body: { error: { code: err.category, message: err.message, details: err.details, correlationId } },
    };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'validation',
          message: 'Invalid request',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          correlationId,
        },
      },
    };
  }
  const e = err as { code?: string; statusCode?: number; message?: string };
  if (e.code === '23505')
    return {
      status: 409,
      body: { error: { code: 'conflict', message: 'Conflicting request', correlationId } },
    };
  if (e.code === '23514')
    return {
      status: 409,
      body: {
        error: {
          code: 'invalid_transition',
          message: 'Operation not permitted in the current state',
          correlationId,
        },
      },
    };
  if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE')
    return {
      status: 413,
      body: { error: { code: 'validation', message: 'Request body too large', correlationId } },
    };
  if (e.code?.startsWith('FST_ERR_CTP') || e.code === 'FST_ERR_VALIDATION')
    return {
      status: 400,
      body: { error: { code: 'validation', message: 'Malformed request', correlationId } },
    };
  if (e.statusCode === 429)
    return {
      status: 429,
      body: { error: { code: 'rate_limited', message: 'Too many requests', correlationId } },
    };
  return {
    status: 500,
    body: { error: { code: 'internal', message: 'Internal server error', correlationId } },
  };
}

export async function buildApi(deps: ApiDeps) {
  const { config } = deps;
  const log = createLogger(config.LOG_LEVEL, { service: 'agent-api' });
  const app = Fastify({
    loggerInstance: log,
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: true,
    genReqId: (req) => {
      const supplied = req.headers['x-correlation-id'];
      const v = Array.isArray(supplied) ? supplied[0] : supplied;
      return v && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : randomUUID();
    },
    requestIdHeader: false,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
    reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    const { status, body } = errorBody(err, req.id);
    if (status >= 500)
      req.log.error({ err: err instanceof Error ? err.message : 'unknown' }, 'request failed');
    else req.log.info({ status, code: (body as { error: { code: string } }).error.code }, 'request rejected');
    return reply.status(status).send(body);
  });
  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'not_found', message: 'Route not found', correlationId: req.id } }),
  );

  const base = config.PUBLIC_BASE_URL.replace(/\/$/, '');

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await deps.db.ping();
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  await app.register(
    async (api) => {
      api.addHook('preHandler', async (req: FastifyRequest) => {
        try {
          req.principal = await deps.authenticator(req.headers);
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw unauthenticated();
        }
      });
      const who = (req: FastifyRequest): Principal => {
        if (!req.principal) throw unauthenticated();
        return req.principal;
      };

      api.post('/generations', async (req, reply: FastifyReply) => {
        const body = parse(CreateGenerationRequestSchema, req.body, 'request body');
        const key = req.headers['idempotency-key'];
        const idempotencyKey = Array.isArray(key) ? key[0] : key;
        if (idempotencyKey !== undefined && !/^[\x21-\x7e]{1,128}$/.test(idempotencyKey))
          throw invalidInput('Invalid Idempotency-Key header');
        const { job, created } = await deps.jobs.submit(who(req), body, idempotencyKey, req.id);
        return reply
          .status(created ? 202 : 200)
          .header('location', `${base}/api/v1/generations/${job.id}`)
          .send(jobView(job, base));
      });

      api.get('/generations/:jobId', async (req) => {
        const { jobId } = parse(JobParams, req.params, 'path');
        return jobView(await deps.jobs.get(who(req), jobId), base);
      });

      api.get('/generations/:jobId/test-cases', async (req) => {
        const { jobId } = parse(JobParams, req.params, 'path');
        const { version } = parse(VersionQuery, req.query, 'query');
        return deps.queries.drafts(who(req), jobId, version);
      });

      api.get('/generations/:jobId/coverage', async (req) => {
        const { jobId } = parse(JobParams, req.params, 'path');
        const { version } = parse(VersionQuery, req.query, 'query');
        return deps.queries.coverage(who(req), jobId, version);
      });

      api.post('/generations/:jobId/review', async (req, reply) => {
        const { jobId } = parse(JobParams, req.params, 'path');
        const body = parse(ReviewRequestSchema, req.body, 'request body');
        const out = await deps.reviews.review(who(req), jobId, body, req.id);
        return reply.status(out.replay ? 200 : 201).send({
          job: jobView(out.job, base),
          decision: {
            decisionId: out.decision.id,
            action: out.decision.action,
            draftVersion: out.decision.draftVersion,
            reviewer: out.decision.reviewer,
            contentHash: out.decision.contentHash,
          },
          replay: out.replay,
        });
      });

      api.post('/generations/:jobId/publish', async (req, reply) => {
        const { jobId } = parse(JobParams, req.params, 'path');
        const body = parse(PublicationRequestSchema, req.body, 'request body');
        const out = await deps.publishing.publish(who(req), jobId, body, req.id);
        return reply.status(202).send({
          job: jobView(out.job, base),
          publication: {
            publicationId: out.publication.id,
            status: out.publication.status,
            destination: out.publication.destination,
            draftVersion: out.publication.draftVersion,
            results: out.publication.results.map((r) => ({
              testCaseId: r.testCaseId,
              externalId: r.externalId,
            })),
          },
          replay: out.replay,
        });
      });

      api.post('/generations/:jobId/cancel', async (req) => {
        const { jobId } = parse(JobParams, req.params, 'path');
        return jobView(await deps.jobs.cancel(who(req), jobId, req.id), base);
      });

      api.post('/generations/:jobId/retry', async (req, reply) => {
        const { jobId } = parse(JobParams, req.params, 'path');
        return reply.status(202).send(jobView(await deps.jobs.retry(who(req), jobId, req.id), base));
      });
    },
    { prefix: '/api/v1' },
  );

  return app;
}

export type ApiApp = Awaited<ReturnType<typeof buildApi>>;

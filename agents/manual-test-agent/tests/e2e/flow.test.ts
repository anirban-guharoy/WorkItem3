import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { principal, startStack } from './helpers.js';

const gen = principal('alice');
const reviewer = principal('bob');
let s: Awaited<ReturnType<typeof startStack>>;

beforeAll(async () => {
  s = await startStack();
});
afterAll(async () => {
  await s.stop();
});

const submit = async (issueKey: string, who = gen) => {
  const r = await s.call('POST', '/api/v1/generations', who, { issueKey });
  return r;
};

describe('end-to-end generation, review and publication (mock MCP + fake model)', () => {
  it('generates drafts with coverage, requires approval, then publishes once', async () => {
    const created = await submit('PROJ-101');
    expect(created.status).toBe(202);
    const jobId = created.body['jobId'] as string;
    expect(created.body['statusUrl']).toContain(jobId);

    const job = await s.waitFor(jobId, gen, ['awaiting_review']);
    expect(job['draftVersion']).toBe(1);

    const tcs = await s.call('GET', `/api/v1/generations/${jobId}/test-cases`, gen);
    expect(tcs.body['draft'].testCases.length).toBeGreaterThan(2);
    const cov = await s.call('GET', `/api/v1/generations/${jobId}/coverage`, gen);
    expect(cov.body['records'].every((r: { status: string }) => r.status === 'covered')).toBe(true);

    // Publishing without approval is impossible.
    const early = await s.call('POST', `/api/v1/generations/${jobId}/publish`, reviewer, { draftVersion: 1 });
    expect(early.status).toBe(409);

    // Stale draft version on review is rejected.
    const stale = await s.call('POST', `/api/v1/generations/${jobId}/review`, reviewer, {
      decisionId: randomUUID(),
      action: 'approve',
      draftVersion: 7,
    });
    expect(stale.status).toBe(409);

    // A user without the reviewer role cannot approve.
    const denied = await s.call(
      'POST',
      `/api/v1/generations/${jobId}/review`,
      principal('eve', ['QA.Reader']),
      { decisionId: randomUUID(), action: 'approve', draftVersion: 1 },
    );
    expect(denied.status).toBe(403);

    const decisionId = randomUUID();
    const approve = await s.call('POST', `/api/v1/generations/${jobId}/review`, reviewer, {
      decisionId,
      action: 'approve',
      draftVersion: 1,
    });
    expect(approve.status).toBe(201);
    expect(approve.body['job'].status).toBe('approved');

    const replay = await s.call('POST', `/api/v1/generations/${jobId}/review`, reviewer, {
      decisionId,
      action: 'approve',
      draftVersion: 1,
    });
    expect(replay.status).toBe(200);
    expect(replay.body['replay']).toBe(true);

    const pub = await s.call('POST', `/api/v1/generations/${jobId}/publish`, reviewer, { draftVersion: 1 });
    expect(pub.status).toBe(202);
    const done = await s.waitFor(jobId, gen, ['published', 'failed']);
    expect(done['status']).toBe('published');

    const again = await s.call('POST', `/api/v1/generations/${jobId}/publish`, reviewer, { draftVersion: 1 });
    expect([200, 202, 409]).toContain(again.status);
    const rows = await s.rt.db.query<{ n: string }>(
      'SELECT count(*) AS n FROM publication_records WHERE job_id = $1',
      [jobId],
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });

  it('returns a clarification request instead of inventing criteria', async () => {
    const r = await submit('PROJ-102');
    const job = await s.waitFor(r.body['jobId'], gen, ['needs_clarification']);
    expect(job['clarificationQuestions'].length).toBeGreaterThan(0);
    const tcs = await s.call('GET', `/api/v1/generations/${r.body['jobId']}/test-cases`, gen);
    expect(tcs.body['draft'] ?? null).toBeNull();
  });

  it('treats injected instructions as data and still ends in review', async () => {
    const r = await submit('PROJ-103');
    const job = await s.waitFor(r.body['jobId'], gen, ['awaiting_review', 'needs_clarification', 'failed']);
    expect(job['status']).not.toBe('published');
    const audit = await s.rt.db.query<{ n: string }>(
      'SELECT count(*) AS n FROM audit_events WHERE job_id = $1',
      [r.body['jobId']],
    );
    expect(Number(audit.rows[0]?.n)).toBeGreaterThan(0);
  });

  it('denies cross-project access and hides foreign jobs', async () => {
    const projects = JSON.stringify({
      PROJ: {
        members: ['alice'],
        confluenceSpaces: ['PROJ'],
        figmaFileKeys: [],
        publishDestination: 'LOCAL',
      },
    });
    const iso = await startStack({ PROJECTS_JSON: projects, REQUIRE_DISTINCT_REVIEWER: 'true' });
    try {
      const own = await iso.call('POST', '/api/v1/generations', gen, { issueKey: 'PROJ-101' });
      expect(own.status).toBe(202);
      const outsider = principal('mallory');
      expect((await iso.call('GET', `/api/v1/generations/${own.body['jobId']}`, outsider)).status).toBe(404);
      expect((await iso.call('POST', '/api/v1/generations', outsider, { issueKey: 'PROJ-101' })).status).toBe(
        403,
      );
      expect((await iso.call('POST', '/api/v1/generations', gen, { issueKey: 'OTHER-5' })).status).toBe(403);
      await iso.waitFor(own.body['jobId'], gen, ['awaiting_review']);
      const self = await iso.call('POST', `/api/v1/generations/${own.body['jobId']}/review`, gen, {
        decisionId: randomUUID(),
        action: 'approve',
        draftVersion: 1,
      });
      expect(self.status).toBe(403);
    } finally {
      await iso.stop();
    }
  });

  it('rejects malformed input and unauthenticated calls with consistent errors', async () => {
    const bad = await s.call('POST', '/api/v1/generations', gen, { issueKey: 'not a key' });
    expect(bad.status).toBe(400);
    expect(bad.body['error'].correlationId).toBeTruthy();
    const anon = await s.app.inject({ method: 'GET', url: `/api/v1/generations/${randomUUID()}` });
    expect(anon.statusCode).toBe(401);
  });

  it('is idempotent for repeated submissions with the same key', async () => {
    const h = { 'idempotency-key': 'abc-123' };
    const a = await s.call('POST', '/api/v1/generations', gen, { issueKey: 'PROJ-101' }, h);
    const b = await s.call('POST', '/api/v1/generations', gen, { issueKey: 'PROJ-101' }, h);
    expect(b.body['jobId']).toBe(a.body['jobId']);
    expect(b.status).toBe(200);
  });

  it('exposes health endpoints', async () => {
    expect((await s.app.inject({ url: '/health/live' })).statusCode).toBe(200);
    expect((await s.app.inject({ url: '/health/ready' })).statusCode).toBe(200);
  });
});

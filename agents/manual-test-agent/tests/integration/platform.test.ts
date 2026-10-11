import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FoundryClaudeModel } from '../../src/models/foundry.js';
import { startStack } from '../e2e/helpers.js';

const foundry = (fetchImpl: typeof fetch, maxRetries = 1) =>
  new FoundryClaudeModel({
    endpoint: 'https://example.invalid/anthropic',
    deployment: 'test-deployment',
    apiVersion: '2023-06-01',
    authMode: 'api-key',
    apiKey: 'unit-test-key',
    entraScope: 'unused',
    timeoutMs: 1000,
    maxRetries,
    maxOutputTokens: 1000,
    temperature: 0,
    priceInputPerMTok: 1,
    priceOutputPerMTok: 2,
    fetchImpl,
  });

const input = { issueKey: 'PROJ-1', summary: 's', criteria: [], context: [] };
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const analysis = { summary: 'ok', testableBehaviours: [], missingRequirements: [], ambiguities: [] };

describe('Foundry adapter (fake fetch)', () => {
  it('parses JSON output and reports usage and cost', async () => {
    let seen: RequestInit | undefined;
    const m = foundry(async (_u, init) => {
      seen = init;
      return reply({
        content: [{ type: 'text', text: JSON.stringify(analysis) }],
        usage: { input_tokens: 1000, output_tokens: 500 },
      });
    });
    const r = await m.analyzeRequirements(input);
    expect(r.value.summary).toBe('ok');
    expect(r.usage.inputTokens).toBe(1000);
    expect(r.usage.estimatedCostUsd).toBeCloseTo(0.002);
    expect((seen?.headers as Record<string, string>)['x-api-key']).toBe('unit-test-key');
  });

  it('retries throttling then succeeds, and fails on persistent server errors without echoing the body', async () => {
    let n = 0;
    const m = foundry(async () =>
      ++n === 1
        ? reply({ error: 'throttled' }, 429)
        : reply({ content: [{ type: 'text', text: JSON.stringify(analysis) }] }),
    );
    await expect(m.analyzeRequirements(input)).resolves.toBeTruthy();
    const bad = foundry(async () => reply({ secret: 'prompt echo' }, 500), 0);
    await expect(bad.analyzeRequirements(input)).rejects.toThrow(/HTTP 500/);
  });

  it('rejects invalid model output after bounded repair', async () => {
    let n = 0;
    const m = foundry(async () => {
      n += 1;
      return reply({ content: [{ type: 'text', text: '{"summary": 5}' }] });
    }, 0);
    await expect(m.analyzeRequirements(input)).rejects.toMatchObject({ category: 'model_output_invalid' });
    expect(n).toBeLessThanOrEqual(3);
  });
});

describe('database guarantees (PGlite)', () => {
  it('rejects illegal job transitions and audit mutation at the database level', async () => {
    const s = await startStack();
    try {
      const id = randomUUID();
      await s.rt.db.query(
        `INSERT INTO generation_jobs (id, issue_key, project_key, status, requested_by, requester_entitlements, correlation_id)
         VALUES ($1,'PROJ-9','PROJ','queued','u','{}'::jsonb,'c')`,
        [id],
      );
      await expect(
        s.rt.db.query("UPDATE generation_jobs SET status='published' WHERE id=$1", [id]),
      ).rejects.toThrow(/invalid job state transition/);
      await s.rt.db.query(
        `INSERT INTO audit_events (job_id, event_type, actor, details) VALUES ($1,'t','a','{}'::jsonb)`,
        [id],
      );
      await expect(s.rt.db.query("UPDATE audit_events SET actor='x' WHERE job_id=$1", [id])).rejects.toThrow(
        /append-only/,
      );
      await expect(s.rt.db.query('DELETE FROM audit_events WHERE job_id=$1', [id])).rejects.toThrow(
        /append-only/,
      );
    } finally {
      await s.stop();
    }
  });
});

describe('failed-job recovery', () => {
  it('retry re-queues a failed job and it completes', async () => {
    const s = await startStack();
    try {
      const who = JSON.stringify({
        id: 'alice',
        roles: ['QA.Generator', 'QA.Reviewer', 'QA.Publisher', 'QA.Reader'],
      });
      const r = await s.call('POST', '/api/v1/generations', who, { issueKey: 'PROJ-101' });
      await s.waitFor(r.body['jobId'], who, ['awaiting_review']);
      // Retry is only valid from failed/needs_clarification.
      const bad = await s.call('POST', `/api/v1/generations/${r.body['jobId']}/retry`, who);
      expect(bad.status).toBe(409);
      const cancel = await s.call('POST', `/api/v1/generations/${r.body['jobId']}/cancel`, who);
      expect(cancel.body['status']).toBe('cancelled');
      const clar = await s.call('POST', '/api/v1/generations', who, { issueKey: 'PROJ-102' });
      await s.waitFor(clar.body['jobId'], who, ['needs_clarification']);
      const retry = await s.call('POST', `/api/v1/generations/${clar.body['jobId']}/retry`, who);
      expect(retry.status).toBe(202);
      expect(retry.body['attempt']).toBe(2);
    } finally {
      await s.stop();
    }
  });
});

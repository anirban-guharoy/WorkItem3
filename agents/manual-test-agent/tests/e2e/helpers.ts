/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Runtime } from '../../src/bootstrap.js';
import { createRuntime, createServices } from '../../src/bootstrap.js';
import { buildApi } from '../../src/api/app.js';
import { loadConfig } from '../../src/config/index.js';
import { WorkerService } from '../../src/worker/service.js';

export const principal = (
  id: string,
  roles: string[] = ['QA.Generator', 'QA.Reviewer', 'QA.Publisher', 'QA.Reader'],
  groups: string[] = [],
) => JSON.stringify({ id, roles, groups });

export async function startStack(env: Record<string, string> = {}) {
  const config = loadConfig({
    AUTH_MODE: 'dev',
    MCP_ALLOW_WRITES: 'true',
    AUTO_MIGRATE: 'true',
    LOG_LEVEL: 'silent',
    ...env,
  } as NodeJS.ProcessEnv);
  const rt: Runtime = await createRuntime(config);
  const worker = new WorkerService(rt);
  await worker.start();
  const app = await buildApi({ config, db: rt.db, authenticator: rt.authenticator, ...createServices(rt) });
  await app.ready();

  const call = async (
    method: 'GET' | 'POST',
    url: string,
    who: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.inject({
      method,
      url,
      headers: { 'x-dev-principal': who, ...headers },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    return { status: res.statusCode, body: res.json() as Record<string, any> };
  };

  const waitFor = async (jobId: string, who: string, statuses: string[], timeoutMs = 15_000) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const r = await call('GET', `/api/v1/generations/${jobId}`, who);
      if (statuses.includes(r.body['status'])) return r.body;
      if (Date.now() > end)
        throw new Error(`Timeout waiting for ${statuses.join('|')}; got ${r.body['status']}`);
      await new Promise((r2) => setTimeout(r2, 50));
    }
  };

  const stop = async () => {
    await app.close();
    await worker.stop();
    await rt.close();
  };
  return { app, rt, worker, call, waitFor, stop };
}

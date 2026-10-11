import 'dotenv/config';
import { buildApi } from '../api/app.js';
import { createRuntime, createServices } from '../bootstrap.js';
import { loadConfig } from '../config/index.js';
import { WorkerService } from '../worker/service.js';

/**
 * Single-process local mode: API + worker share an in-memory queue, PGlite and the mock MCP/fake model
 * (unless overridden by environment variables). Never valid in staging/production (see config assertions).
 */
const config = loadConfig({
  AUTH_MODE: 'dev',
  MCP_ALLOW_WRITES: 'true',
  AUTO_MIGRATE: 'true',
  ...process.env,
});
const rt = await createRuntime(config);
const worker = new WorkerService(rt);
await worker.start();
const app = await buildApi({ config, db: rt.db, authenticator: rt.authenticator, ...createServices(rt) });

const shutdown = async () => {
  await app.close();
  await worker.stop();
  await rt.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ port: config.PORT, host: '127.0.0.1' });
rt.log.info(
  {
    url: `http://127.0.0.1:${config.PORT}`,
    hint: 'send header x-dev-principal: {"id":"u1","roles":["QA.Generator","QA.Reviewer","QA.Publisher","QA.Reader"]}',
  },
  'local mode ready',
);

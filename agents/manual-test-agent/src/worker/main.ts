import 'dotenv/config';
import { createServer } from 'node:http';
import { createRuntime } from '../bootstrap.js';
import { loadConfig } from '../config/index.js';
import { initTelemetry } from '../observability/telemetry.js';
import { WorkerService } from './service.js';

const config = loadConfig();
await initTelemetry(
  config.OTEL_SERVICE_NAME ?? 'manual-test-agent-worker',
  config.APPLICATIONINSIGHTS_CONNECTION_STRING,
);
const rt = await createRuntime(config);
const worker = new WorkerService(rt);

let ready = false;
let stopping = false;
const probes = createServer((req, res) => {
  const ok = req.url === '/health/live' ? true : req.url === '/health/ready' ? ready && !stopping : undefined;
  res.statusCode = ok === undefined ? 404 : ok ? 200 : 503;
  res.end(ok ? 'ok' : 'unavailable');
});
probes.listen(Number(process.env['WORKER_HEALTH_PORT'] ?? 8080), '0.0.0.0');

const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  rt.log.info({ signal }, 'worker draining');
  await worker.stop();
  probes.close();
  await rt.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await worker.start();
ready = true;

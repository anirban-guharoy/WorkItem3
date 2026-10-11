import 'dotenv/config';
import { buildApi } from './app.js';
import { createRuntime, createServices } from '../bootstrap.js';
import { loadConfig } from '../config/index.js';
import { initTelemetry } from '../observability/telemetry.js';

const config = loadConfig();
await initTelemetry(
  config.OTEL_SERVICE_NAME ?? 'manual-test-agent-api',
  config.APPLICATIONINSIGHTS_CONNECTION_STRING,
);
const rt = await createRuntime(config);
const app = await buildApi({ config, db: rt.db, authenticator: rt.authenticator, ...createServices(rt) });

const shutdown = async (signal: string) => {
  rt.log.info({ signal }, 'api shutting down');
  await app.close();
  await rt.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });

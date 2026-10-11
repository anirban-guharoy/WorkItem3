import { MemorySaver, type BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { Logger } from 'pino';
import { ProjectAuthorizer } from './auth/authorizer.js';
import { createDevAuthenticator, createEntraAuthenticator, type Authenticator } from './auth/entra.js';
import type { AppConfig } from './config/index.js';
import { createDb, type Db } from './database/db.js';
import { migrate } from './database/migrator.js';
import { MockMcpGateway } from './mcp/mock.js';
import { createMcpTokenProvider, RemoteMcpClient } from './mcp/remote.js';
import type { McpHealth, McpReadGateway, McpWriteGateway } from './mcp/types.js';
import { InMemoryQueue } from './messaging/memory.js';
import { ServiceBusConsumer, ServiceBusPublisher } from './messaging/servicebus.js';
import type { QueueConsumer, QueuePublisher } from './messaging/types.js';
import { FakeTestGenerationModel } from './models/fake.js';
import { FoundryClaudeModel } from './models/foundry.js';
import type { TestGenerationModel } from './models/types.js';
import { createLogger } from './observability/telemetry.js';
import { JobService } from './services/job-service.js';
import { PublishService } from './services/publish-service.js';
import { QueryService } from './services/query-service.js';
import { ReviewService } from './services/review-service.js';

export interface Runtime {
  config: AppConfig;
  log: Logger;
  db: Db;
  publisher: QueuePublisher;
  consumer: QueueConsumer;
  read: McpReadGateway;
  write: McpWriteGateway | undefined;
  mcpHealth: McpHealth;
  model: TestGenerationModel;
  authorizer: ProjectAuthorizer;
  authenticator: Authenticator;
  checkpointer: BaseCheckpointSaver;
  close(): Promise<void>;
}

export const roleNamesOf = (c: AppConfig) => ({
  generator: c.ENTRA_ROLE_GENERATOR,
  reviewer: c.ENTRA_ROLE_REVIEWER,
  publisher: c.ENTRA_ROLE_PUBLISHER,
  reader: c.ENTRA_ROLE_READER,
});

/** Composition root shared by the API, the worker and the single-process local mode. */
export async function createRuntime(
  config: AppConfig,
  overrides: Partial<Pick<Runtime, 'read' | 'write' | 'model' | 'mcpHealth' | 'db'>> = {},
): Promise<Runtime> {
  const log = createLogger(config.LOG_LEVEL, { env: config.APP_ENV });
  const db = overrides.db ?? (await createDb(config));
  if (config.AUTO_MIGRATE || db.kind === 'pglite') {
    const applied = await migrate(db);
    if (applied.length) log.info({ applied }, 'database migrations applied');
  }

  let publisher: QueuePublisher;
  let consumer: QueueConsumer;
  if (config.QUEUE_TRANSPORT === 'servicebus') {
    const sb = {
      queue: config.SERVICEBUS_QUEUE,
      namespace: config.SERVICEBUS_NAMESPACE,
      connectionString: config.SERVICEBUS_CONNECTION_STRING,
      concurrency: config.WORKER_CONCURRENCY,
      maxDeliveryAttempts: config.WORKER_MAX_DELIVERY_ATTEMPTS,
      logger: log,
    };
    const pub = new ServiceBusPublisher(sb);
    publisher = pub;
    consumer = new ServiceBusConsumer(sb, pub);
  } else {
    const queue = new InMemoryQueue({
      maxDeliveryAttempts: config.WORKER_MAX_DELIVERY_ATTEMPTS,
      concurrency: config.WORKER_CONCURRENCY,
    });
    publisher = queue;
    consumer = queue;
  }

  let read: McpReadGateway;
  let write: McpWriteGateway | undefined;
  let mcpHealth: McpHealth;
  if (config.MCP_ADAPTER === 'remote') {
    const client = new RemoteMcpClient({
      url: config.MCP_SERVER_URL as string,
      toolMap: config.MCP_TOOL_MAP_JSON as NonNullable<typeof config.MCP_TOOL_MAP_JSON>,
      tokenProvider: createMcpTokenProvider({
        mode: config.MCP_AUTH_MODE,
        bearerToken: config.MCP_BEARER_TOKEN,
        entraScope: config.MCP_ENTRA_SCOPE,
      }),
      timeoutMs: config.MCP_TIMEOUT_MS,
      maxRetries: config.MCP_MAX_RETRIES,
      allowWrites: config.MCP_ALLOW_WRITES,
      acceptanceCriteriaField: config.JIRA_ACCEPTANCE_CRITERIA_FIELD,
      logger: log,
    });
    read = client;
    write = config.MCP_ALLOW_WRITES ? client.createWriteGateway() : undefined;
    mcpHealth = client;
  } else {
    const mock = new MockMcpGateway();
    read = mock;
    write = config.MCP_ALLOW_WRITES ? mock : undefined;
    mcpHealth = mock;
  }

  const model: TestGenerationModel =
    config.MODEL_PROVIDER === 'foundry'
      ? new FoundryClaudeModel({
          endpoint: config.FOUNDRY_ENDPOINT as string,
          deployment: config.FOUNDRY_DEPLOYMENT as string,
          apiVersion: config.FOUNDRY_API_VERSION,
          authMode: config.FOUNDRY_AUTH_MODE,
          apiKey: config.FOUNDRY_API_KEY,
          entraScope: config.FOUNDRY_ENTRA_SCOPE,
          timeoutMs: config.MODEL_TIMEOUT_MS,
          maxRetries: config.MODEL_MAX_RETRIES,
          maxOutputTokens: config.MODEL_MAX_OUTPUT_TOKENS,
          temperature: config.MODEL_TEMPERATURE,
          priceInputPerMTok: config.MODEL_PRICE_INPUT_PER_MTOK,
          priceOutputPerMTok: config.MODEL_PRICE_OUTPUT_PER_MTOK,
        })
      : new FakeTestGenerationModel();

  let checkpointer: BaseCheckpointSaver;
  if (config.CHECKPOINTER === 'postgres') {
    if (!db.pool) throw new Error('CHECKPOINTER=postgres requires a PostgreSQL DATABASE_URL');
    const saver = new PostgresSaver(db.pool);
    await saver.setup();
    checkpointer = saver;
  } else {
    checkpointer = new MemorySaver();
  }

  const authorizer = new ProjectAuthorizer(config.PROJECTS_JSON, roleNamesOf(config));
  const authenticator =
    config.AUTH_MODE === 'entra'
      ? createEntraAuthenticator({
          tenantId: config.ENTRA_TENANT_ID as string,
          audience: config.ENTRA_AUDIENCE as string,
          requiredScope: config.ENTRA_REQUIRED_SCOPE,
        })
      : createDevAuthenticator();

  const merged = { read, write, mcpHealth, model, ...overrides };
  return {
    config,
    log,
    db,
    publisher,
    consumer,
    read: merged.read,
    write: merged.write,
    mcpHealth: merged.mcpHealth,
    model: merged.model,
    authorizer,
    authenticator,
    checkpointer,
    close: async () => {
      await consumer.stop().catch(() => undefined);
      await publisher.close().catch(() => undefined);
      await db.close().catch(() => undefined);
    },
  };
}

export function createServices(rt: Pick<Runtime, 'db' | 'publisher' | 'authorizer' | 'config' | 'log'>) {
  const deps = { db: rt.db, queue: rt.publisher, authorizer: rt.authorizer, config: rt.config, log: rt.log };
  return {
    jobs: new JobService(deps),
    reviews: new ReviewService(deps),
    publishing: new PublishService(deps),
    queries: new QueryService(deps),
  };
}

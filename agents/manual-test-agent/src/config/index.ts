import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const int = (def: number) => z.coerce.number().int().default(def);
const jsonObject = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'must be valid JSON' });
        return z.NEVER;
      }
    })
    .pipe(schema);

export const McpToolMappingSchema = z.record(
  z.enum([
    'getJiraIssue',
    'getLinkedIssues',
    'searchConfluence',
    'getConfluencePage',
    'getFigmaDesign',
    'searchExistingTestCases',
    'createTestCases',
  ]),
  z.strictObject({
    tool: z.string().min(1),
    /** Argument template; string values may use {{placeholders}} documented in docs/model-configuration.md */
    args: z.record(z.string(), z.unknown()).default({}),
  }),
);
export type McpToolMapping = z.infer<typeof McpToolMappingSchema>;

export const ProjectConfigSchema = z.record(
  z.string(),
  z.strictObject({
    /** Entra object ids (users or groups) that are members of the project. "*" = any authenticated principal (dev only). */
    members: z.array(z.string()).default([]),
    confluenceSpaces: z.array(z.string()).default([]),
    figmaFileKeys: z.array(z.string()).default([]),
    /** Destination (test-management project / folder) used for publishing; opaque to the application. */
    publishDestination: z.string().optional(),
  }),
);
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

const EnvSchema = z.object({
  APP_ENV: z.enum(['local', 'development', 'staging', 'production']).default('local'),
  NODE_ENV: z.string().default('development'),
  PORT: int(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  BODY_LIMIT_BYTES: int(262_144),
  RATE_LIMIT_MAX: int(60),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  AUTH_MODE: z.enum(['entra', 'dev']).default('entra'),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_AUDIENCE: z.string().optional(),
  ENTRA_REQUIRED_SCOPE: z.string().default('Agent.Access'),
  ENTRA_ROLE_GENERATOR: z.string().default('QA.Generator'),
  ENTRA_ROLE_REVIEWER: z.string().default('QA.Reviewer'),
  ENTRA_ROLE_PUBLISHER: z.string().default('QA.Publisher'),
  ENTRA_ROLE_READER: z.string().default('QA.Reader'),
  REQUIRE_DISTINCT_REVIEWER: bool.default(false),
  PROJECTS_JSON: jsonObject(ProjectConfigSchema).default({
    '*': {
      members: ['*'],
      confluenceSpaces: ['PROJ'],
      figmaFileKeys: ['AbC123xyz'],
      publishDestination: 'LOCAL',
    },
  } as never),

  DATABASE_URL: z.string().default('pglite://memory'),
  DATABASE_SSL: bool.default(false),
  DATABASE_POOL_MAX: int(10),
  AUTO_MIGRATE: bool.default(false),
  CHECKPOINTER: z.enum(['postgres', 'memory']).default('memory'),

  QUEUE_TRANSPORT: z.enum(['servicebus', 'memory']).default('memory'),
  SERVICEBUS_NAMESPACE: z.string().optional(),
  SERVICEBUS_CONNECTION_STRING: z.string().optional(),
  SERVICEBUS_QUEUE: z.string().default('generation-jobs'),
  WORKER_CONCURRENCY: int(2),
  WORKER_LEASE_SECONDS: int(300),
  WORKER_MAX_DELIVERY_ATTEMPTS: int(5),
  RECOVERY_SWEEP_SECONDS: int(60),

  MCP_ADAPTER: z.enum(['remote', 'mock']).default('mock'),
  MCP_SERVER_URL: z.string().optional(),
  MCP_AUTH_MODE: z.enum(['none', 'bearer', 'entra']).default('none'),
  MCP_BEARER_TOKEN: z.string().optional(),
  MCP_ENTRA_SCOPE: z.string().optional(),
  MCP_TIMEOUT_MS: int(20_000),
  MCP_MAX_RETRIES: int(2),
  MCP_TOOL_MAP_JSON: jsonObject(McpToolMappingSchema).optional(),
  MCP_ALLOW_WRITES: bool.default(false),
  JIRA_ACCEPTANCE_CRITERIA_FIELD: z.string().optional(),

  MODEL_PROVIDER: z.enum(['foundry', 'fake']).default('fake'),
  FOUNDRY_ENDPOINT: z.string().optional(),
  FOUNDRY_DEPLOYMENT: z.string().optional(),
  FOUNDRY_API_VERSION: z.string().default('2023-06-01'),
  FOUNDRY_AUTH_MODE: z.enum(['api-key', 'entra']).default('entra'),
  FOUNDRY_API_KEY: z.string().optional(),
  FOUNDRY_ENTRA_SCOPE: z.string().default('https://cognitiveservices.azure.com/.default'),
  MODEL_TIMEOUT_MS: int(120_000),
  MODEL_MAX_RETRIES: int(2),
  MODEL_MAX_OUTPUT_TOKENS: int(16_000),
  MODEL_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.2),
  MODEL_PRICE_INPUT_PER_MTOK: z.coerce.number().optional(),
  MODEL_PRICE_OUTPUT_PER_MTOK: z.coerce.number().optional(),

  MAX_CONTEXT_ITEMS: int(8),
  MAX_CONTEXT_SNIPPET_CHARS: int(1500),
  MAX_VALIDATION_REPAIRS: int(1),
  DUPLICATE_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  COVERAGE_COVERED_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  COVERAGE_PARTIAL_THRESHOLD: z.coerce.number().min(0).max(1).default(0.25),
  STORE_CONTEXT_SNIPPETS: bool.default(false),

  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
});

export type AppConfig = Omit<z.infer<typeof EnvSchema>, 'PROJECTS_JSON'> & {
  PROJECTS_JSON: ProjectConfig;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const config = parsed.data as unknown as AppConfig;
  assertConfigConsistency(config);
  return config;
}

const isDeployed = (c: Pick<AppConfig, 'APP_ENV' | 'NODE_ENV'>) =>
  c.APP_ENV === 'staging' || c.APP_ENV === 'production' || c.NODE_ENV === 'production';

/** Fails fast on dev-only modes in deployed environments and on missing required settings. */
export function assertConfigConsistency(c: AppConfig): void {
  const errors: string[] = [];
  if (isDeployed(c)) {
    if (c.AUTH_MODE !== 'entra') errors.push('AUTH_MODE=dev is not permitted in staging/production');
    if (c.MCP_ADAPTER === 'mock') errors.push('MCP_ADAPTER=mock is not permitted in staging/production');
    if (c.MODEL_PROVIDER === 'fake')
      errors.push('MODEL_PROVIDER=fake is not permitted in staging/production');
    if (c.QUEUE_TRANSPORT === 'memory')
      errors.push('QUEUE_TRANSPORT=memory is not permitted in staging/production');
    if (c.DATABASE_URL.startsWith('pglite:'))
      errors.push('DATABASE_URL must be PostgreSQL in staging/production');
    if (c.CHECKPOINTER === 'memory') errors.push('CHECKPOINTER=postgres is required in staging/production');
    if (c.SERVICEBUS_CONNECTION_STRING)
      errors.push('Use SERVICEBUS_NAMESPACE with Workload Identity, not a connection string');
    if (
      c.PROJECTS_JSON['*']?.members.includes('*') ||
      Object.values(c.PROJECTS_JSON).some((p) => p.members.includes('*'))
    ) {
      errors.push('PROJECTS_JSON must not use the "*" wildcard member in staging/production');
    }
    if (c.MCP_ADAPTER === 'remote' && c.MCP_SERVER_URL && !c.MCP_SERVER_URL.startsWith('https://')) {
      errors.push('MCP_SERVER_URL must use https in staging/production');
    }
  }
  if (c.AUTH_MODE === 'entra' && (!c.ENTRA_TENANT_ID || !c.ENTRA_AUDIENCE)) {
    errors.push('ENTRA_TENANT_ID and ENTRA_AUDIENCE are required when AUTH_MODE=entra');
  }
  if (c.QUEUE_TRANSPORT === 'servicebus' && !c.SERVICEBUS_NAMESPACE && !c.SERVICEBUS_CONNECTION_STRING) {
    errors.push('SERVICEBUS_NAMESPACE is required when QUEUE_TRANSPORT=servicebus');
  }
  if (c.MCP_ADAPTER === 'remote') {
    if (!c.MCP_SERVER_URL) errors.push('MCP_SERVER_URL is required when MCP_ADAPTER=remote');
    if (!c.MCP_TOOL_MAP_JSON) errors.push('MCP_TOOL_MAP_JSON is required when MCP_ADAPTER=remote');
    if (c.MCP_AUTH_MODE === 'bearer' && !c.MCP_BEARER_TOKEN)
      errors.push('MCP_BEARER_TOKEN is required for MCP_AUTH_MODE=bearer');
    if (c.MCP_AUTH_MODE === 'entra' && !c.MCP_ENTRA_SCOPE)
      errors.push('MCP_ENTRA_SCOPE is required for MCP_AUTH_MODE=entra');
  }
  if (c.MODEL_PROVIDER === 'foundry') {
    if (!c.FOUNDRY_ENDPOINT) errors.push('FOUNDRY_ENDPOINT is required when MODEL_PROVIDER=foundry');
    if (!c.FOUNDRY_DEPLOYMENT) errors.push('FOUNDRY_DEPLOYMENT is required when MODEL_PROVIDER=foundry');
    if (c.FOUNDRY_AUTH_MODE === 'api-key' && !c.FOUNDRY_API_KEY)
      errors.push('FOUNDRY_API_KEY is required for FOUNDRY_AUTH_MODE=api-key');
  }
  if (c.CHECKPOINTER === 'postgres' && c.DATABASE_URL.startsWith('pglite:')) {
    errors.push('CHECKPOINTER=postgres requires a PostgreSQL DATABASE_URL');
  }
  if (errors.length) throw new Error(`Invalid configuration: ${errors.join('; ')}`);
}

export const isProductionLike = isDeployed;

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Logger } from 'pino';
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import type { McpToolMapping } from '../config/index.js';
import { m, withSpan } from '../observability/telemetry.js';
import { UpstreamError } from '../shared/errors.js';
import { withRetry } from '../shared/util.js';
import {
  normalizeConfluenceHits,
  normalizeConfluencePage,
  normalizeCreated,
  normalizeExistingTestCases,
  normalizeFigma,
  normalizeIssue,
  normalizeLinkedIssues,
} from './normalize.js';
import {
  WRITE_OPERATIONS,
  type ConfluenceHit,
  type ConfluencePage,
  type CreateTestCasesRequest,
  type CreateTestCasesResult,
  type ExistingTestCase,
  type FigmaDesign,
  type LinkedIssue,
  type LogicalOperation,
  type McpCallContext,
  type McpHealth,
  type McpReadGateway,
  type McpWriteGateway,
} from './types.js';
import type { JiraStory } from '../schemas/domain.js';

export type TokenProvider = () => Promise<string | undefined>;

export function createMcpTokenProvider(opts: {
  mode: 'none' | 'bearer' | 'entra';
  bearerToken?: string | undefined;
  entraScope?: string | undefined;
  credential?: TokenCredential;
}): TokenProvider {
  if (opts.mode === 'none') return async () => undefined;
  if (opts.mode === 'bearer') return async () => opts.bearerToken;
  const credential = opts.credential ?? new DefaultAzureCredential();
  return async () => (await credential.getToken(opts.entraScope as string))?.token;
}

/** Minimal surface of the SDK client that we depend on (also lets tests inject a fake). */
export interface McpClientLike {
  listTools(): Promise<{ tools: Array<{ name: string }> }>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    schema?: undefined,
    options?: { timeout?: number },
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface RemoteMcpOptions {
  url: string;
  toolMap: McpToolMapping;
  tokenProvider: TokenProvider;
  timeoutMs: number;
  maxRetries: number;
  allowWrites: boolean;
  acceptanceCriteriaField?: string | undefined;
  logger: Logger;
  clientFactory?: () => Promise<McpClientLike>;
}

function substitute(template: unknown, vars: Record<string, unknown>): unknown {
  if (typeof template === 'string') {
    const whole = /^\{\{(\w+)\}\}$/.exec(template);
    if (whole?.[1]) return vars[whole[1]] ?? '';
    return template.replace(/\{\{(\w+)\}\}/g, (_x, k: string) => String(vars[k] ?? ''));
  }
  if (Array.isArray(template)) return template.map((t) => substitute(t, vars));
  if (template && typeof template === 'object') {
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, substitute(v, vars)]));
  }
  return template;
}

function extractPayload(result: unknown): unknown {
  const r = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type: string; text?: string }>;
  };
  if (r.isError) throw new UpstreamError('MCP tool reported an error', 'upstream_mcp', false);
  if (r.structuredContent !== undefined) return r.structuredContent;
  const text = (r.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError('MCP tool returned non-JSON content', 'upstream_mcp', false);
  }
}

const isTransient = (err: unknown): boolean => (err instanceof UpstreamError ? err.retryable : true);

/**
 * Remote MCP adapter over Streamable HTTP. Only tools named in the configured mapping can be called
 * (allow-list); the model never sees or selects tools. Write tools additionally require allowWrites
 * and are only reachable through createWriteGateway().
 */
export class RemoteMcpClient implements McpReadGateway, McpHealth {
  private client: McpClientLike | undefined;
  private connecting: Promise<McpClientLike> | undefined;

  constructor(private readonly o: RemoteMcpOptions) {}

  private async connect(): Promise<McpClientLike> {
    if (this.client) return this.client;
    this.connecting ??= (async () => {
      if (this.o.clientFactory) return this.o.clientFactory();
      const transport = new StreamableHTTPClientTransport(new URL(this.o.url), {
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          const token = await this.o.tokenProvider();
          if (token) headers.set('Authorization', `Bearer ${token}`);
          return fetch(input, {
            ...init,
            headers,
            signal: init?.signal ?? AbortSignal.timeout(this.o.timeoutMs),
          });
        },
      });
      const client = new Client({ name: 'manual-test-agent', version: '2.0.0' });
      await client.connect(transport);
      return client as unknown as McpClientLike;
    })();
    try {
      this.client = await this.connecting;
      return this.client;
    } finally {
      this.connecting = undefined;
    }
  }

  private async reset(): Promise<void> {
    const c = this.client;
    this.client = undefined;
    await c?.close().catch(() => undefined);
  }

  /** Verifies that every mapped (allow-listed) tool exists on the server. */
  async check(): Promise<void> {
    const client = await this.connect();
    const available = new Set((await client.listTools()).tools.map((t) => t.name));
    const missing = Object.values(this.o.toolMap)
      .map((t) => t.tool)
      .filter((t) => !available.has(t));
    if (missing.length)
      throw new UpstreamError(
        `Mapped MCP tools not found on server: ${missing.join(', ')}`,
        'upstream_mcp',
        false,
      );
  }

  async discoverToolNames(): Promise<string[]> {
    return (await (await this.connect()).listTools()).tools.map((t) => t.name);
  }

  private async call(
    op: LogicalOperation,
    vars: Record<string, unknown>,
    ctx: McpCallContext,
  ): Promise<unknown> {
    const mapping = this.o.toolMap[op];
    if (!mapping) throw new UpstreamError(`No MCP tool is mapped for ${op}`, 'upstream_mcp', false);
    const isWrite = WRITE_OPERATIONS.has(op);
    if (isWrite && !this.o.allowWrites)
      throw new UpstreamError('MCP write operations are disabled', 'upstream_mcp', false);
    const args = substitute(mapping.args, { ...vars, correlationId: ctx.correlationId }) as Record<
      string,
      unknown
    >;
    const started = Date.now();
    try {
      return await withSpan(
        'mcp.call',
        { 'mcp.operation': op, 'mcp.tool': mapping.tool, 'job.id': ctx.jobId ?? '' },
        async () => {
          const attempt = async () => {
            const client = await this.connect();
            try {
              return extractPayload(
                await client.callTool({ name: mapping.tool, arguments: args }, undefined, {
                  timeout: this.o.timeoutMs,
                }),
              );
            } catch (err) {
              if (!(err instanceof UpstreamError)) await this.reset();
              throw err instanceof UpstreamError
                ? err
                : new UpstreamError(`MCP ${op} failed`, 'upstream_mcp', true, err);
            }
          };
          // Writes are never auto-retried here: the caller resumes idempotently using the idempotency key.
          return isWrite
            ? attempt()
            : withRetry(attempt, { retries: this.o.maxRetries, baseDelayMs: 300, shouldRetry: isTransient });
        },
      );
    } catch (err) {
      m.mcpFailures.add(1, { operation: op });
      this.o.logger.warn(
        {
          op,
          correlationId: ctx.correlationId,
          jobId: ctx.jobId,
          error: err instanceof Error ? err.name : 'error',
        },
        'mcp call failed',
      );
      throw err;
    } finally {
      m.mcpLatency.record(Date.now() - started, { operation: op });
    }
  }

  async getJiraIssue(issueKey: string, ctx: McpCallContext): Promise<JiraStory> {
    return normalizeIssue(await this.call('getJiraIssue', { issueKey }, ctx), this.o.acceptanceCriteriaField);
  }
  async getLinkedIssues(issueKey: string, ctx: McpCallContext): Promise<LinkedIssue[]> {
    return normalizeLinkedIssues(await this.call('getLinkedIssues', { issueKey }, ctx));
  }
  async searchConfluence(
    query: string,
    opts: { spaces: string[]; limit: number },
    ctx: McpCallContext,
  ): Promise<ConfluenceHit[]> {
    return normalizeConfluenceHits(
      await this.call(
        'searchConfluence',
        { query, spaces: opts.spaces, limit: opts.limit, spaceList: opts.spaces.join(',') },
        ctx,
      ),
    );
  }
  async getConfluencePage(pageId: string, ctx: McpCallContext): Promise<ConfluencePage> {
    return normalizeConfluencePage(await this.call('getConfluencePage', { pageId }, ctx));
  }
  async getFigmaDesign(fileKeyOrUrl: string, ctx: McpCallContext): Promise<FigmaDesign> {
    return normalizeFigma(await this.call('getFigmaDesign', { fileKey: fileKeyOrUrl }, ctx));
  }
  async searchExistingTestCases(
    query: { issueKey?: string; text?: string; marker?: string },
    ctx: McpCallContext,
  ): Promise<ExistingTestCase[]> {
    return normalizeExistingTestCases(
      await this.call(
        'searchExistingTestCases',
        { issueKey: query.issueKey ?? '', text: query.text ?? '', marker: query.marker ?? '' },
        ctx,
      ),
    );
  }

  /** Only the publishing component receives this; it is not part of the read gateway. */
  createWriteGateway(): McpWriteGateway {
    return {
      createTestCases: async (
        req: CreateTestCasesRequest,
        ctx: McpCallContext,
      ): Promise<CreateTestCasesResult> => {
        const payload = await this.call(
          'createTestCases',
          {
            destination: req.destination,
            issueKey: req.issueKey,
            idempotencyKey: req.idempotencyKey,
            testCases: req.testCases,
          },
          ctx,
        );
        return { created: normalizeCreated(payload) };
      },
    };
  }

  async close(): Promise<void> {
    await this.reset();
  }
}

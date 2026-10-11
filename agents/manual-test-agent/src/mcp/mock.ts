import type { JiraStory } from '../schemas/domain.js';
import { AppError, notFound, UpstreamError } from '../shared/errors.js';
import { MOCK_EXISTING_TESTS, MOCK_FIGMA, MOCK_PAGES, MOCK_STORIES } from './mock-data.js';
import type {
  ConfluenceHit,
  ConfluencePage,
  CreateTestCasesRequest,
  CreateTestCasesResult,
  ExistingTestCase,
  FigmaDesign,
  LinkedIssue,
  McpCallContext,
  McpHealth,
  McpReadGateway,
  McpWriteGateway,
} from './types.js';

/** In-memory MCP adapter for local development and automated tests. Mutable for scenario setup. */
export class MockMcpGateway implements McpReadGateway, McpWriteGateway, McpHealth {
  stories = new Map<string, JiraStory>(MOCK_STORIES.map((s) => [s.key, structuredClone(s)]));
  pages = new Map<string, ConfluencePage>(MOCK_PAGES.map((p) => [p.id, { ...p }]));
  designs = new Map<string, FigmaDesign>(MOCK_FIGMA.map((d) => [d.id, { ...d }]));
  existingTests: ExistingTestCase[] = [...MOCK_EXISTING_TESTS];
  /** idempotencyKey -> result, mirrors a well-behaved server. */
  readonly created = new Map<string, CreateTestCasesResult>();
  readonly calls: Array<{ op: string; args: unknown }> = [];
  failures: Partial<Record<string, number>> = {};
  private counter = 0;

  private record(op: string, args: unknown): void {
    this.calls.push({ op, args });
    const remaining = this.failures[op];
    if (remaining && remaining > 0) {
      this.failures[op] = remaining - 1;
      throw new UpstreamError(`mock ${op} failure`, 'upstream_mcp', true);
    }
  }

  async check(): Promise<void> {}

  async getJiraIssue(issueKey: string, _ctx: McpCallContext): Promise<JiraStory> {
    this.record('getJiraIssue', issueKey);
    const s = this.stories.get(issueKey);
    if (!s) throw notFound('JIRA issue');
    return structuredClone(s);
  }
  async getLinkedIssues(issueKey: string, _ctx: McpCallContext): Promise<LinkedIssue[]> {
    this.record('getLinkedIssues', issueKey);
    return (this.stories.get(issueKey)?.linkedIssueKeys ?? []).map((key) => ({
      key,
      summary: `Linked ${key}`,
      linkType: 'relates to',
    }));
  }
  async searchConfluence(
    query: string,
    opts: { spaces: string[]; limit: number },
    _ctx: McpCallContext,
  ): Promise<ConfluenceHit[]> {
    this.record('searchConfluence', { query, ...opts });
    const words = query
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    // Deliberately ignores the spaces filter for out-of-scope hits so the app-side scoping can be tested.
    return [...this.pages.values()]
      .filter((p) => words.some((w) => `${p.title} ${p.excerpt} ${p.body}`.toLowerCase().includes(w)))
      .slice(0, opts.limit)
      .map(({ body: _b, ...hit }) => hit);
  }
  async getConfluencePage(pageId: string, _ctx: McpCallContext): Promise<ConfluencePage> {
    this.record('getConfluencePage', pageId);
    const p = this.pages.get(pageId);
    if (!p) throw notFound('Confluence page');
    return { ...p };
  }
  async getFigmaDesign(fileKeyOrUrl: string, _ctx: McpCallContext): Promise<FigmaDesign> {
    this.record('getFigmaDesign', fileKeyOrUrl);
    const d = this.designs.get(fileKeyOrUrl);
    if (!d) throw notFound('Figma design');
    return { ...d };
  }
  async searchExistingTestCases(
    query: { issueKey?: string; text?: string; marker?: string },
    _ctx: McpCallContext,
  ): Promise<ExistingTestCase[]> {
    this.record('searchExistingTestCases', query);
    if (query.marker) {
      return [...this.created.entries()]
        .filter(([key]) => key === query.marker)
        .flatMap(([, r]) =>
          r.created.map((c) => ({
            id: c.externalId,
            title: c.testCaseId,
            summary: `marker:${query.marker}`,
          })),
        );
    }
    return this.existingTests.slice();
  }
  async createTestCases(req: CreateTestCasesRequest, _ctx: McpCallContext): Promise<CreateTestCasesResult> {
    this.record('createTestCases', {
      destination: req.destination,
      issueKey: req.issueKey,
      idempotencyKey: req.idempotencyKey,
      ids: req.testCases.map((t) => t.id),
    });
    const existing = this.created.get(req.idempotencyKey);
    if (existing) return existing;
    const result: CreateTestCasesResult = {
      created: req.testCases.map((t) => ({
        testCaseId: t.id,
        externalId: `${req.destination}-T${++this.counter}`,
      })),
    };
    this.created.set(req.idempotencyKey, result);
    return result;
  }
}

export const isMockNotFound = (e: unknown): boolean => e instanceof AppError && e.category === 'not_found';

import type { JiraStory } from '../schemas/domain.js';
import type { TestCase } from '../schemas/testcase.js';

export interface McpCallContext {
  correlationId: string;
  jobId?: string;
  projectKey: string;
}

export interface LinkedIssue {
  key: string;
  summary: string;
  linkType: string;
}
export interface ConfluenceHit {
  id: string;
  title: string;
  excerpt: string;
  space: string;
  url?: string | undefined;
}
export interface ConfluencePage extends ConfluenceHit {
  body: string;
}
export interface FigmaDesign {
  id: string;
  name: string;
  annotations: string[];
  url?: string | undefined;
}
export interface ExistingTestCase {
  id: string;
  title: string;
  summary: string;
  url?: string | undefined;
}

export interface CreateTestCasesRequest {
  destination: string;
  issueKey: string;
  /** Stable key so that a retried call can never create the same test twice. */
  idempotencyKey: string;
  testCases: TestCase[];
}
export interface CreateTestCasesResult {
  created: Array<{ testCaseId: string; externalId: string }>;
}

/** Read-only operations. Nothing reachable through this interface can modify JIRA or any other system. */
export interface McpReadGateway {
  getJiraIssue(issueKey: string, ctx: McpCallContext): Promise<JiraStory>;
  getLinkedIssues(issueKey: string, ctx: McpCallContext): Promise<LinkedIssue[]>;
  searchConfluence(
    query: string,
    opts: { spaces: string[]; limit: number },
    ctx: McpCallContext,
  ): Promise<ConfluenceHit[]>;
  getConfluencePage(pageId: string, ctx: McpCallContext): Promise<ConfluencePage>;
  getFigmaDesign(fileKeyOrUrl: string, ctx: McpCallContext): Promise<FigmaDesign>;
  searchExistingTestCases(
    query: { issueKey?: string; text?: string; marker?: string },
    ctx: McpCallContext,
  ): Promise<ExistingTestCase[]>;
}

/** Write operations, only handed to the publishing component after approval checks have passed. */
export interface McpWriteGateway {
  createTestCases(req: CreateTestCasesRequest, ctx: McpCallContext): Promise<CreateTestCasesResult>;
}

export interface McpHealth {
  check(): Promise<void>;
}

export type LogicalOperation =
  | 'getJiraIssue'
  | 'getLinkedIssues'
  | 'searchConfluence'
  | 'getConfluencePage'
  | 'getFigmaDesign'
  | 'searchExistingTestCases'
  | 'createTestCases';

export const WRITE_OPERATIONS: ReadonlySet<LogicalOperation> = new Set(['createTestCases']);

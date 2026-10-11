import { JiraStorySchema, type JiraStory } from '../schemas/domain.js';
import { IssueKeySchema } from '../schemas/common.js';
import { UpstreamError } from '../shared/errors.js';
import type { ConfluenceHit, ConfluencePage, ExistingTestCase, FigmaDesign, LinkedIssue } from './types.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Flattens Atlassian Document Format (or plain strings) to text. */
export function adfToText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!isObj(node)) return '';
  const parts: string[] = [];
  const walk = (n: unknown, bullet = false): void => {
    if (!isObj(n)) return;
    if (n['type'] === 'text') parts.push(str(n['text']));
    const children = Array.isArray(n['content']) ? n['content'] : [];
    const isBlock = ['paragraph', 'heading', 'listItem', 'codeBlock'].includes(str(n['type']));
    if (n['type'] === 'listItem') parts.push('- ');
    children.forEach((c) => walk(c, bullet));
    if (isBlock || n['type'] === 'hardBreak') parts.push('\n');
  };
  walk(node);
  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const unwrap = (payload: unknown): unknown =>
  isObj(payload) && payload['result'] !== undefined ? payload['result'] : payload;

export function normalizeIssue(payload: unknown, acField?: string): JiraStory {
  const root = unwrap(payload);
  if (!isObj(root)) throw new UpstreamError('MCP issue payload is not an object', 'upstream_mcp', false);
  const fields = isObj(root['fields']) ? root['fields'] : root;
  const links = Array.isArray(fields['issuelinks']) ? fields['issuelinks'] : [];
  const linkedIssueKeys = links
    .flatMap((l) => (isObj(l) ? [l['inwardIssue'], l['outwardIssue']] : []))
    .map((i) => (isObj(i) ? str(i['key']) : ''))
    .filter((k) => IssueKeySchema.safeParse(k).success);
  const acRaw = acField ? fields[acField] : (fields['acceptanceCriteria'] ?? root['acceptanceCriteria']);
  const candidate = {
    key: str(root['key']),
    summary: str(fields['summary']).slice(0, 400),
    description: adfToText(fields['description']).slice(0, 20_000),
    acceptanceCriteriaField: acRaw ? adfToText(acRaw).slice(0, 20_000) : undefined,
    issueType: isObj(fields['issuetype']) ? str(fields['issuetype']['name']) : str(fields['issueType']),
    status: isObj(fields['status']) ? str(fields['status']['name']) : str(fields['status']),
    labels: Array.isArray(fields['labels']) ? fields['labels'].map(str).filter(Boolean).slice(0, 50) : [],
    updatedAt: str(fields['updated'] ?? fields['updatedAt']) || undefined,
    linkedIssueKeys,
  };
  const parsed = JiraStorySchema.safeParse(candidate);
  if (!parsed.success) throw new UpstreamError('MCP issue payload failed validation', 'upstream_mcp', false);
  return parsed.data;
}

const list = (payload: unknown, ...keys: string[]): unknown[] => {
  const root = unwrap(payload);
  if (Array.isArray(root)) return root;
  if (isObj(root)) for (const k of keys) if (Array.isArray(root[k])) return root[k] as unknown[];
  return [];
};

export const normalizeLinkedIssues = (payload: unknown): LinkedIssue[] =>
  list(payload, 'issues', 'links', 'results')
    .filter(isObj)
    .map((i) => ({
      key: str(i['key']),
      summary: str(i['summary']).slice(0, 300),
      linkType: str(i['linkType'] ?? i['type']),
    }))
    .filter((i) => IssueKeySchema.safeParse(i.key).success);

export const normalizeConfluenceHits = (payload: unknown): ConfluenceHit[] =>
  list(payload, 'results', 'pages')
    .filter(isObj)
    .map((p) => ({
      id: str(p['id']),
      title: str(p['title']).slice(0, 300),
      excerpt: str(p['excerpt'] ?? p['snippet']).slice(0, 3000),
      space: str(isObj(p['space']) ? p['space']['key'] : (p['space'] ?? p['spaceKey'])),
      url: str(p['url']) || undefined,
    }))
    .filter((p) => p.id);

export function normalizeConfluencePage(payload: unknown): ConfluencePage {
  const p = unwrap(payload);
  if (!isObj(p) || !str(p['id'])) throw new UpstreamError('MCP page payload invalid', 'upstream_mcp', false);
  const body = isObj(p['body']) ? adfToText(p['body']) || str(p['body']) : str(p['body'] ?? p['content']);
  return {
    id: str(p['id']),
    title: str(p['title']).slice(0, 300),
    excerpt: '',
    body,
    space: str(isObj(p['space']) ? p['space']['key'] : (p['space'] ?? p['spaceKey'])),
    url: str(p['url']) || undefined,
  };
}

export function normalizeFigma(payload: unknown): FigmaDesign {
  const p = unwrap(payload);
  if (!isObj(p)) throw new UpstreamError('MCP design payload invalid', 'upstream_mcp', false);
  const annotations = [
    ...(Array.isArray(p['annotations']) ? p['annotations'] : []),
    ...(Array.isArray(p['comments']) ? p['comments'] : []),
  ]
    .map((a) => (isObj(a) ? str(a['text'] ?? a['message']) : str(a)))
    .filter(Boolean)
    .slice(0, 50);
  return {
    id: str(p['key'] ?? p['id'] ?? p['fileKey']),
    name: str(p['name']).slice(0, 300),
    annotations,
    url: str(p['url']) || undefined,
  };
}

export const normalizeExistingTestCases = (payload: unknown): ExistingTestCase[] =>
  list(payload, 'tests', 'testCases', 'results')
    .filter(isObj)
    .map((t) => ({
      id: str(t['key'] ?? t['id']),
      title: str(t['title'] ?? t['summary']).slice(0, 300),
      summary: str(t['description'] ?? t['summary'] ?? '').slice(0, 1500),
      url: str(t['url']) || undefined,
    }))
    .filter((t) => t.id);

export function normalizeCreated(payload: unknown): Array<{ testCaseId: string; externalId: string }> {
  return list(payload, 'created', 'tests', 'results')
    .filter(isObj)
    .map((t) => ({
      testCaseId: str(t['testCaseId'] ?? t['localId'] ?? t['id']),
      externalId: str(t['externalId'] ?? t['key']),
    }))
    .filter((t) => t.testCaseId && t.externalId);
}

import { config } from "./config.js";

const { jira } = config;
export const jiraEnabled = () => Boolean(jira.baseUrl && jira.email && jira.token);

const authHeader = () =>
  "Basic " + Buffer.from(`${jira.email}:${jira.token}`).toString("base64");

// Flatten Atlassian Document Format (JIRA Cloud) into plain text.
export function adfToText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  const kids = (node.content || []).map(adfToText);
  switch (node.type) {
    case "text":
      return node.text || "";
    case "hardBreak":
      return "\n";
    case "listItem":
      return "- " + kids.join("").trim() + "\n";
    case "paragraph":
    case "heading":
      return kids.join("") + "\n";
    case "codeBlock":
      return "```\n" + kids.join("") + "\n```\n";
    default:
      return kids.join("");
  }
}

// Split "Acceptance Criteria" section out of a description when no dedicated field exists.
function splitAcceptanceCriteria(description) {
  const m = description.match(/^\s*(?:#+\s*|\*\*)?\s*acceptance criteria\s*(?:\*\*)?\s*:?\s*$/im);
  if (!m) return { description, acceptanceCriteria: "" };
  return {
    description: description.slice(0, m.index).trim(),
    acceptanceCriteria: description.slice(m.index + m[0].length).trim(),
  };
}

export function normalizeIssue(issue) {
  const f = issue.fields || {};
  let description = adfToText(f.description).trim();
  let acceptanceCriteria = config.jira.acField ? adfToText(f[config.jira.acField]).trim() : "";
  if (!acceptanceCriteria) ({ description, acceptanceCriteria } = splitAcceptanceCriteria(description));
  return {
    key: issue.key,
    summary: f.summary || "",
    description,
    acceptanceCriteria,
    labels: f.labels || [],
    url: jira.baseUrl ? `${jira.baseUrl}/browse/${issue.key}` : "",
  };
}

export async function fetchIssue(key) {
  const res = await fetch(`${jira.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}`, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`JIRA fetch ${key} failed: ${res.status} ${await res.text()}`);
  return normalizeIssue(await res.json());
}

export async function addComment(key, text) {
  const body = {
    body: {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  };
  const res = await fetch(`${jira.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`JIRA comment on ${key} failed: ${res.status}`);
}

// Best-effort traceability: story "is tested by" test (requires JIRA creds and the "Test" link type from Xray).
export async function linkTestToStory(storyKey, testKey) {
  const res = await fetch(`${jira.baseUrl}/rest/api/3/issueLink`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      type: { name: "Test" },
      inwardIssue: { key: storyKey },
      outwardIssue: { key: testKey },
    }),
  });
  if (!res.ok) throw new Error(`JIRA link ${storyKey}->${testKey} failed: ${res.status}`);
}

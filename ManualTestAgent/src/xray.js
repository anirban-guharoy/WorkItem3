import { config } from "./config.js";

const { xray } = config;
export const xrayEnabled = () => Boolean(xray.clientId && xray.clientSecret);

let token;
let tokenAt = 0;

async function authenticate() {
  if (token && Date.now() - tokenAt < 20 * 60 * 60 * 1000) return token; // tokens last 24h
  const res = await fetch(`${xray.baseUrl}/api/v2/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: xray.clientId, client_secret: xray.clientSecret }),
  });
  if (!res.ok) throw new Error(`Xray authentication failed: ${res.status}`);
  token = await res.json();
  tokenAt = Date.now();
  return token;
}

async function gql(query, variables) {
  const res = await fetch(`${xray.baseUrl}/api/v2/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await authenticate()}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors?.length) {
    if (res.status === 401) token = undefined;
    throw new Error(`Xray GraphQL error: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data;
}

const projectOf = (storyKey) => storyKey.split("-")[0];

export function testDescription(tc, storyKey) {
  const pre = tc.preconditions.length ? `Preconditions:\n${tc.preconditions.map((p) => `- ${p}`).join("\n")}\n\n` : "";
  return `${pre}Covers: ${tc.acceptanceCriterion}\nStory: ${storyKey}\nType: ${tc.type}`;
}

async function createManualTest(tc, storyKey) {
  const data = await gql(
    `mutation($steps:[CreateStepInput!], $jira: JSON!) {
       createTest(testType:{name:"Manual"}, steps:$steps, jira:$jira) {
         test { issueId jira(fields:["key"]) }
       }
     }`,
    {
      steps: tc.steps.map((action, i) => ({
        action,
        result: i === tc.steps.length - 1 ? tc.expectedResult : "",
      })),
      jira: {
        fields: {
          summary: `[${storyKey}] ${tc.title}`,
          description: testDescription(tc, storyKey),
          project: { key: projectOf(storyKey) },
          labels: ["manual-tester", storyKey, tc.type],
          priority: { name: tc.priority },
        },
      },
    },
  );
  const t = data.createTest.test;
  return { issueId: t.issueId, key: t.jira.key };
}

async function findOrCreateCycle(name, storyKey, testIssueIds) {
  const project = projectOf(storyKey);
  const jql = `project = "${project}" AND issuetype = "Test Execution" AND summary ~ "\\"${name.replace(/["\\]/g, "")}\\""`;
  const found = await gql(
    `query($jql:String!){ getTestExecutions(jql:$jql, limit:20){ results { issueId jira(fields:["key","summary"]) } } }`,
    { jql },
  );
  const existing = found.getTestExecutions.results.find((r) => r.jira.summary === name);
  if (existing) {
    await gql(
      `mutation($id:String!, $ids:[String]!){ addTestsToTestExecution(issueId:$id, testIssueIds:$ids){ addedTests warning } }`,
      { id: existing.issueId, ids: testIssueIds },
    );
    return { issueId: existing.issueId, key: existing.jira.key, created: false };
  }
  const data = await gql(
    `mutation($ids:[String], $jira: JSON!){ createTestExecution(testIssueIds:$ids, jira:$jira){ testExecution { issueId jira(fields:["key"]) } } }`,
    { ids: testIssueIds, jira: { fields: { summary: name, project: { key: project } } } },
  );
  const e = data.createTestExecution.testExecution;
  return { issueId: e.issueId, key: e.jira.key, created: true };
}

// Creates Xray manual tests (resumable via `progress`) and tags them into the named test cycle.
export async function publishTestCases({ storyKey, testCases, cycleName, progress = {}, onProgress }) {
  const tests = { ...(progress.tests || {}) };
  for (const tc of testCases) {
    if (tests[tc.id]) continue;
    tests[tc.id] = await createManualTest(tc, storyKey);
    onProgress?.({ tests });
  }
  const cycle = await findOrCreateCycle(cycleName, storyKey, Object.values(tests).map((t) => t.issueId));
  return { tests, cycle: { name: cycleName, ...cycle } };
}

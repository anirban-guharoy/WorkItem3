export function createXrayClient({ baseUrl, clientId, clientSecret }) {
  let token;
  let tokenAt = 0;

  const enabled = () => Boolean(clientId && clientSecret);

  async function authenticate() {
    if (!enabled()) throw new Error("XRAY_CLIENT_ID and XRAY_CLIENT_SECRET are required");
    if (token && Date.now() - tokenAt < 20 * 60 * 60 * 1000) return token;
    const res = await fetch(`${baseUrl}/api/v2/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    });
    if (!res.ok) throw new Error(`Xray authentication failed: ${res.status}`);
    token = await res.json();
    tokenAt = Date.now();
    return token;
  }

  async function gql(query, variables) {
    const res = await fetch(`${baseUrl}/api/v2/graphql`, {
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

  function testDescription(testCase, storyKey) {
    const preconditions = testCase.preconditions.length
      ? `Preconditions:\n${testCase.preconditions.map((item) => `- ${item}`).join("\n")}\n\n`
      : "";
    return `${preconditions}Covers: ${testCase.acceptanceCriterion}\nStory: ${storyKey}\nType: ${testCase.type}`;
  }

  async function createManualTest(testCase, storyKey) {
    const data = await gql(
      `mutation($steps:[CreateStepInput!], $jira: JSON!) {
         createTest(testType:{name:"Manual"}, steps:$steps, jira:$jira) {
           test { issueId jira(fields:["key"]) }
         }
       }`,
      {
        steps: testCase.steps.map((action, index) => ({
          action,
          result: index === testCase.steps.length - 1 ? testCase.expectedResult : "",
        })),
        jira: {
          fields: {
            summary: `[${storyKey}] ${testCase.title}`,
            description: testDescription(testCase, storyKey),
            project: { key: projectOf(storyKey) },
            labels: ["manual-tester", storyKey, testCase.type],
            priority: { name: testCase.priority },
          },
        },
      },
    );
    const created = data.createTest.test;
    return { issueId: created.issueId, key: created.jira.key };
  }

  async function findOrCreateCycle(name, storyKey, testIssueIds) {
    const project = projectOf(storyKey);
    const jql = `project = "${project}" AND issuetype = "Test Execution" AND summary ~ "\\"${name.replace(/["\\]/g, "")}\\""`;
    const found = await gql(
      `query($jql:String!){ getTestExecutions(jql:$jql, limit:20){ results { issueId jira(fields:["key","summary"]) } } }`,
      { jql },
    );
    const existing = found.getTestExecutions.results.find((result) => result.jira.summary === name);
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
    const execution = data.createTestExecution.testExecution;
    return { issueId: execution.issueId, key: execution.jira.key, created: true };
  }

  async function publishTestCases({ storyKey, testCases, cycleName, progress = {}, onProgress }) {
    const tests = { ...(progress.tests || {}) };
    for (const testCase of testCases) {
      if (tests[testCase.id]) continue;
      tests[testCase.id] = await createManualTest(testCase, storyKey);
      onProgress?.({ tests });
    }
    const cycle = progress.cycle || (await findOrCreateCycle(
      cycleName,
      storyKey,
      Object.values(tests).map((createdTest) => createdTest.issueId),
    ));
    onProgress?.({ tests, cycle });
    return { tests, cycle: { name: cycleName, ...cycle } };
  }

  return { enabled, publishTestCases };
}

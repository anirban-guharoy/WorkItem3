import assert from "node:assert/strict";
import test from "node:test";
import { createXrayClient } from "../src/index.js";

const testCase = {
  id: "TC-001",
  title: "Sign in with valid credentials",
  type: "functional",
  priority: "High",
  acceptanceCriterion: "Valid credentials sign in",
  preconditions: ["An active account exists"],
  steps: ["Open login", "Enter valid credentials", "Submit"],
  expectedResult: "The authenticated page is displayed",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("creates an Xray manual test and test execution in the cloud project", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const request = { url: String(url), ...options, body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(request);
    if (request.url.endsWith("/api/v2/authenticate")) return jsonResponse("cloud-token");
    if (request.body.query.includes("createTest(")) {
      return jsonResponse({ data: { createTest: { test: { issueId: "test-id", jira: { key: "DEMO-101" } } } } });
    }
    if (request.body.query.includes("getTestExecutions")) {
      return jsonResponse({ data: { getTestExecutions: { results: [] } } });
    }
    if (request.body.query.includes("createTestExecution")) {
      return jsonResponse({
        data: {
          createTestExecution: {
            testExecution: { issueId: "execution-id", jira: { key: "DEMO-201" } },
          },
        },
      });
    }
    throw new Error(`Unexpected Xray request: ${request.body.query}`);
  };

  try {
    const client = createXrayClient({
      baseUrl: "https://xray.cloud.getxray.app",
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    const progressUpdates = [];
    const result = await client.publishTestCases({
      storyKey: "DEMO-1",
      testCases: [testCase],
      cycleName: "Sprint regression",
      onProgress: (progress) => progressUpdates.push(progress),
    });

    assert.deepEqual(result.tests["TC-001"], { issueId: "test-id", key: "DEMO-101" });
    assert.deepEqual(result.cycle, {
      name: "Sprint regression",
      issueId: "execution-id",
      key: "DEMO-201",
      created: true,
    });
    const createTest = requests.find((request) => request.body?.query?.includes("createTest("));
    assert.equal(createTest.body.variables.jira.fields.project.key, "DEMO");
    assert.equal(createTest.body.variables.steps.at(-1).result, testCase.expectedResult);
    assert.equal(createTest.headers.Authorization, "Bearer cloud-token");
    assert.equal(progressUpdates.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resumes from saved test and execution progress without creating duplicates", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const request = { url: String(url), ...options, body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(request);
    if (request.url.endsWith("/api/v2/authenticate")) return jsonResponse("cloud-token");
    if (request.body.query.includes("getTestExecutions")) {
      return jsonResponse({ data: { getTestExecutions: { results: [] } } });
    }
    assert.match(request.body.query, /createTestExecution/);
    return jsonResponse({
      data: {
        createTestExecution: {
          testExecution: { issueId: "execution-id", jira: { key: "DEMO-201" } },
        },
      },
    });
  };

  try {
    const client = createXrayClient({
      baseUrl: "https://xray.cloud.getxray.app",
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    const result = await client.publishTestCases({
      storyKey: "DEMO-1",
      testCases: [testCase],
      cycleName: "Sprint regression",
      progress: {
        tests: { "TC-001": { issueId: "test-id", key: "DEMO-101" } },
      },
    });

    assert.equal(requests.length, 3);
    assert.match(requests[1].body.query, /getTestExecutions/);
    assert.match(requests[2].body.query, /createTestExecution/);
    assert.deepEqual(result.tests["TC-001"], { issueId: "test-id", key: "DEMO-101" });
    assert.equal(result.cycle.key, "DEMO-201");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adds cases to an existing named cloud test execution", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const request = { url: String(url), ...options, body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(request);
    if (request.url.endsWith("/api/v2/authenticate")) return jsonResponse("cloud-token");
    if (request.body.query.includes("getTestExecutions")) {
      return jsonResponse({
        data: {
          getTestExecutions: {
            results: [{ issueId: "existing-execution", jira: { key: "DEMO-201", summary: "Sprint regression" } }],
          },
        },
      });
    }
    assert.match(request.body.query, /addTestsToTestExecution/);
    return jsonResponse({ data: { addTestsToTestExecution: { addedTests: ["test-id"], warning: null } } });
  };

  try {
    const client = createXrayClient({
      baseUrl: "https://xray.cloud.getxray.app",
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    const result = await client.publishTestCases({
      storyKey: "DEMO-1",
      testCases: [testCase],
      cycleName: "Sprint regression",
      progress: { tests: { "TC-001": { issueId: "test-id", key: "DEMO-101" } } },
    });

    assert.equal(requests.length, 3);
    assert.equal(requests[2].body.variables.id, "existing-execution");
    assert.deepEqual(requests[2].body.variables.ids, ["test-id"]);
    assert.deepEqual(result.cycle, {
      name: "Sprint regression",
      issueId: "existing-execution",
      key: "DEMO-201",
      created: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

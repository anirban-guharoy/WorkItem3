import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ReviewRequest, TestCaseReview } from "@workitem3/test-case-contract";
import { loadMcpTools } from "@workitem3/langchain-runtime/mcp";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const reviewerModel = JSON.parse(
  fs.readFileSync(path.join(testDir, "../../config/models.json"), "utf8"),
).model;
const generatorModel = JSON.parse(
  fs.readFileSync(
    path.join(testDir, "../../../manual-test-agent/config/models.json"),
    "utf8",
  ),
).model;

const request = {
  story: {
    key: "DEMO-1",
    summary: "User login",
    description: "Users can sign in with their account.",
    acceptanceCriteria: "- Valid credentials sign in",
  },
  testCaseSet: {
    summary: "Login behavior",
    assumptions: [],
    contextSources: [],
    testCases: [
      {
        id: "TC-001",
        title: "Sign in with valid credentials",
        type: "functional",
        priority: "High",
        acceptanceCriterion: "Valid credentials sign in",
        preconditions: ["An active account exists"],
        steps: ["Open login", "Enter valid credentials", "Submit"],
        expectedResult: "The authenticated page is displayed",
      },
    ],
  },
};

test("accepts the checked-in representative regression fixture", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(testDir, "../fixtures/representative-review.json"),
      "utf8",
    ),
  );
  assert.equal(ReviewRequest.safeParse(fixture).success, true);
});

test("accepts the test case set generated for a story", () => {
  assert.equal(ReviewRequest.safeParse(request).success, true);
});

test("rejects test cases with invalid priority or missing verification fields", () => {
  const invalid = structuredClone(request);
  invalid.testCaseSet.testCases[0].priority = "Urgent";
  invalid.testCaseSet.testCases[0].expectedResult = undefined;
  assert.equal(ReviewRequest.safeParse(invalid).success, false);
});

test("rejects empty test sets and cases without executable steps", () => {
  const emptySet = structuredClone(request);
  emptySet.testCaseSet.testCases = [];
  assert.equal(ReviewRequest.safeParse(emptySet).success, false);

  const noSteps = structuredClone(request);
  noSteps.testCaseSet.testCases[0].steps = [];
  assert.equal(ReviewRequest.safeParse(noSteps).success, false);
});

test("validates the structured review result", () => {
  assert.equal(
    TestCaseReview.safeParse({
      reviewStatus: "approved",
      summary: "All acceptance criteria are covered.",
      contextSources: [],
      coverage: [
        {
          criterion: "Valid credentials sign in",
          status: "covered",
          testCaseIds: ["TC-001"],
          rationale: "The expected result verifies a successful sign-in.",
        },
      ],
      findings: [],
    }).success,
    true,
  );
});

test("requires common-mcp-server configuration before researching context", async () => {
  await assert.rejects(
    () => loadMcpTools({ name: "common-mcp-server" }, "test"),
    {
      message: "MCP_SERVER_URL is required for context research",
    },
  );
});

test("keeps the reviewer on a separate model from the generator", () => {
  assert.notEqual(reviewerModel, generatorModel);
});

import assert from "node:assert/strict";
import test from "node:test";
import { applyReviewGate } from "../src/quality-gate.js";

const approvedReview = {
  reviewStatus: "approved",
  summary: "Cases cover the acceptance criteria.",
  contextSources: [],
  coverage: [{ criterion: "Users can log in", status: "covered", testCaseIds: ["TC-001"], rationale: "Covered." }],
  findings: [],
};

test("passes a complete review with covered criteria and no major findings", () => {
  assert.equal(applyReviewGate(approvedReview, { acceptanceCriteria: "Users can log in" }), approvedReview);
});

test("blocks Xray publishing when any criterion is not covered", () => {
  const review = {
    ...approvedReview,
    coverage: [{ ...approvedReview.coverage[0], status: "partial" }],
  };
  const result = applyReviewGate(review, { acceptanceCriteria: "Users can log in" });
  assert.equal(result.reviewStatus, "changes_requested");
  assert.equal(result.findings.at(-1).title, "Acceptance-criterion coverage gate failed");
});

test("blocks approval when criteria exist but the model omitted coverage", () => {
  const result = applyReviewGate({ ...approvedReview, coverage: [] }, { acceptanceCriteria: "Users can log in" });
  assert.equal(result.reviewStatus, "changes_requested");
  assert.match(result.findings.at(-1).rationale, /did not provide criterion-level coverage/);
});

test("blocks approval when coverage repeats the same criterion", () => {
  const review = {
    ...approvedReview,
    coverage: [approvedReview.coverage[0], { ...approvedReview.coverage[0], testCaseIds: ["TC-002"] }],
  };
  const result = applyReviewGate(review, { acceptanceCriteria: "Users can log in" });
  assert.equal(result.reviewStatus, "changes_requested");
});

test("blocks approval if a critical or major finding remains", () => {
  const review = {
    ...approvedReview,
    findings: [{
      severity: "major",
      testCaseIds: ["TC-001"],
      title: "Expected result is untestable",
      rationale: "It is vague.",
      recommendation: "Make it measurable.",
    }],
  };
  assert.equal(applyReviewGate(review, { acceptanceCriteria: "Users can log in" }).reviewStatus, "changes_requested");
});

test("allows stories without acceptance criteria when there are no serious findings", () => {
  const review = { ...approvedReview, coverage: [] };
  assert.equal(applyReviewGate(review, {}), review);
});

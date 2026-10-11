import assert from "node:assert/strict";
import test from "node:test";
import { applyHumanDecision } from "../src/human-review.js";

const review = {
  key: "DEMO-1",
  status: "pending_review",
  output: { testCases: [{ id: "TC-001" }] },
};

test("records an attributed human decision and retains the case output", () => {
  const updated = applyHumanDecision(review, {
    decision: "approved",
    comment: "Looks good",
    reviewer: { userId: "user-123", name: "Reviewer", username: "reviewer@example.com" },
    decidedAt: "2026-10-11T07:00:00.000Z",
    cycleName: "Sprint regression",
  });

  assert.equal(updated.status, "approved");
  assert.equal(updated.output, review.output);
  assert.deepEqual(updated.humanReview, {
    decision: "approved",
    comment: "Looks good",
    reviewer: { id: "user-123", name: "Reviewer", username: "reviewer@example.com" },
    decidedAt: "2026-10-11T07:00:00.000Z",
  });
  assert.equal(updated.humanReviewHistory.length, 1);
  assert.equal(updated.cycleName, "Sprint regression");
  assert.equal(review.humanReviewHistory, undefined);
});

test("preserves prior outcomes when a case set is reviewed again", () => {
  const first = applyHumanDecision(review, {
    decision: "rejected",
    comment: "Clarify edge coverage",
    reviewer: { userId: "user-123", name: "", username: "" },
    decidedAt: "2026-10-11T07:00:00.000Z",
    cycleName: "Sprint regression",
  });
  const second = applyHumanDecision(first, {
    decision: "approved",
    comment: "Updated cases are ready",
    reviewer: { userId: "user-456", name: "Reviewer 2", username: "reviewer2@example.com" },
    decidedAt: "2026-10-11T07:05:00.000Z",
    cycleName: "Sprint regression",
  });

  assert.deepEqual(second.humanReviewHistory.map(({ decision }) => decision), ["rejected", "approved"]);
  assert.equal(second.humanReview.reviewer.id, "user-456");
});

test("rejects unsupported human decisions", () => {
  assert.throws(() => applyHumanDecision(review, {
    decision: "changes_requested",
    comment: "",
    reviewer: { userId: "user-123", name: "", username: "" },
    decidedAt: "2026-10-11T07:00:00.000Z",
    cycleName: "Sprint regression",
  }), /must be approved or rejected/);
});

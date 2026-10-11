import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLearningStore } from "../../src/repositories/learning-store.js";

test("persists operator-confirmed feedback and ranks matching evidence", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wpf-learning-"));
  const filePath = path.join(dir, "learning.json");
  try {
    const store = createLearningStore(filePath);
    await store.recordFeedback({
      namespace: "production",
      pod: "api-0",
      issueReference: "INC-4",
      issue: "Memory limit exceeded after cache growth",
      diagnosis: "The response cache leaked memory",
      resolution: "Bound the cache",
      userId: "operator-1",
    });
    const records = await store.listFeedback();
    const matches = await store.getRelevantFeedback({
      namespace: "production",
      pod: "api-0",
      activity: { status: "OOMKilled", message: "memory usage grew" },
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].verified, true);
    assert.equal(matches[0].issueReference, "INC-4");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("persists reviewer state and uses stable request fingerprints", async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "manual-review-store-"),
  );
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  try {
    const moduleUrl = new URL(
      "../../src/repositories/review-store.js",
      import.meta.url,
    );
    moduleUrl.searchParams.set("test", crypto.randomUUID());
    const { getReviewRecord, reviewId, saveReviewRecord } = await import(
      moduleUrl.href
    );
    const first = {
      story: { key: "DEMO-1", summary: "Login" },
      testCases: [1, 2],
    };
    const reordered = {
      testCases: [1, 2],
      story: { summary: "Login", key: "DEMO-1" },
    };
    const id = reviewId(first);

    assert.equal(reviewId(reordered), id);
    saveReviewRecord(id, {
      status: "published",
      response: { status: "published" },
    });
    assert.deepEqual(getReviewRecord(id), {
      status: "published",
      response: { status: "published" },
    });
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  hashOf,
  isKubernetesResourceName,
  redact,
  safeErrorMessage,
  stableStringify,
  writeJsonFileAtomically,
} from "../src/index.js";

test("stable hashes ignore object insertion order", () => {
  assert.equal(hashOf({ b: 2, a: 1 }), hashOf({ a: 1, b: 2 }));
  assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test("redacts sensitive keys and credential-shaped strings", () => {
  assert.deepEqual(redact({ token: "value", message: "Bearer abcdefghijk" }), {
    token: "[REDACTED]",
    message: "Bearer [REDACTED]",
  });

  test("sanitizes and bounds error messages before logging", () => {
    assert.equal(
      safeErrorMessage(new Error("request failed Bearer abcdefghijk")),
      "request failed Bearer [REDACTED]",
    );
    assert.equal(safeErrorMessage("x".repeat(2000)).length, 1000);
  });
});

test("validates Kubernetes DNS-label/resource names", () => {
  assert.equal(isKubernetesResourceName("prod.api-0"), true);
  assert.equal(isKubernetesResourceName("-invalid"), false);
  assert.equal(isKubernetesResourceName("x".repeat(64), 63), false);
});

test("atomically writes JSON and creates a private parent directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-common-"));
  try {
    const file = path.join(dir, "nested", "state.json");
    await writeJsonFileAtomically(file, { status: "ready" });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      status: "ready",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

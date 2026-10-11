import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-test-agent-review-"));
process.env.NODE_ENV = "test";
process.env.DATA_DIR = dataDir;
process.env.ENTRA_TENANT_ID = "00000000-0000-0000-0000-000000000000";
process.env.ENTRA_API_AUDIENCE = "manual-test-agent-test";

const { app } = await import("../src/server.js");
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("requires Entra bearer tokens to read the review queue or submit a decision", async () => {
  const queue = await fetch(`${baseUrl}/api/reviews`);
  assert.equal(queue.status, 401);

  const decision = await fetch(`${baseUrl}/api/reviews/DEMO-1/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approved", comment: "Looks good" }),
  });
  assert.equal(decision.status, 401);
});

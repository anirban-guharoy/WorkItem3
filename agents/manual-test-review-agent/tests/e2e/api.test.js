import assert from "node:assert/strict";
import test, { after, before } from "node:test";

process.env.ENTRA_TENANT_ID = "00000000-0000-0000-0000-000000000000";
process.env.ENTRA_API_AUDIENCE = "manual-test-review-agent-test";

const { app } = await import("../../src/api/app.js");
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("keeps health public and requires Entra authentication for review/status", async () => {
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);

  for (const [route, method] of [
    ["/api/status", "GET"],
    ["/review", "POST"],
  ]) {
    const response = await fetch(`${baseUrl}${route}`, { method });
    assert.equal(
      response.status,
      401,
      `${method} ${route} must require a bearer token`,
    );
  }
});

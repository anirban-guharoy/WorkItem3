import assert from "node:assert/strict";
import test, { after, before } from "node:test";

process.env.NODE_ENV = "test";
process.env.ENTRA_TENANT_ID = "00000000-0000-0000-0000-000000000000";
process.env.ENTRA_API_AUDIENCE = "wpf-sre-agent-test";

const { app } = await import("../../src/api/app.js");
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

test("keeps Kubernetes health probe open but protects SRE APIs", async () => {
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).agent, "wpf-sre-agent");

  for (const [path, method] of [
    ["/api/status", "GET"],
    ["/api/azure/health", "GET"],
    ["/api/pods", "GET"],
    ["/api/pods/production/api-0/summary", "POST"],
    ["/api/pods/production/api-0/restart", "POST"],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, { method });
    assert.equal(
      response.status,
      401,
      `${method} ${path} must require a bearer token`,
    );
  }
});

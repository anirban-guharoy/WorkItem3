import assert from "node:assert/strict";
import test from "node:test";
import {
  createBackstageClient,
  isKubernetesResourceName,
  redactSensitiveData,
} from "../../src/services/backstage.js";

function response({ status = 200, body = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

const configuration = {
  baseUrl: "https://backstage.example.com",
  token: "test-token",
  healthPath: "/api/azure/health",
  podsPath: "/api/kubernetes/pods",
  activityPath: "/api/kubernetes/namespaces/{namespace}/pods/{pod}/activities",
  restartPath: "/api/ops/restart",
  restartMethod: "POST",
  restartBodyTemplate: '{"namespace":"{namespace}","pod":"{pod}"}',
  requestTimeoutMs: 1000,
};

test("calls configurable Backstage health, pod, and activity routes with bearer auth", async () => {
  const calls = [];
  const client = createBackstageClient(configuration, async (url, options) => {
    calls.push({ url: String(url), options });
    return response({ body: { ok: true } });
  });

  assert.deepEqual(await client.getAzureHealth(), { ok: true });
  assert.deepEqual(await client.getPods(), { ok: true });
  assert.deepEqual(await client.getPodActivity("team-a", "api-0"), {
    ok: true,
  });
  assert.deepEqual(
    calls.map(({ url }) => new URL(url).pathname),
    [
      "/api/azure/health",
      "/api/kubernetes/pods",
      "/api/kubernetes/namespaces/team-a/pods/api-0/activities",
    ],
  );
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
});

test("substitutes pod values in the configured restart endpoint and request body", async () => {
  let call;
  const client = createBackstageClient(configuration, async (url, options) => {
    call = { url: String(url), options };
    return response({ status: 202, body: { accepted: true } });
  });

  assert.deepEqual(await client.restartPod("team-a", "api-0"), {
    accepted: true,
  });
  assert.equal(new URL(call.url).pathname, "/api/ops/restart");
  assert.equal(call.options.method, "POST");
  assert.deepEqual(JSON.parse(call.options.body), {
    namespace: "team-a",
    pod: "api-0",
  });
  assert.equal(call.options.redirect, "manual");
});

test("rejects cross-origin Backstage paths, failed responses, and non-JSON responses", async () => {
  const client = createBackstageClient({
    ...configuration,
    healthPath: "https://attacker.example/api/data",
  });
  await assert.rejects(
    client.getAzureHealth(),
    /must remain on the configured server origin/,
  );

  await assert.rejects(
    createBackstageClient(configuration, async () =>
      response({ status: 503 }),
    ).getAzureHealth(),
    /HTTP 503/,
  );
  await assert.rejects(
    createBackstageClient(configuration, async () => ({
      ok: true,
      status: 200,
      text: async () => "<html>not JSON</html>",
    })).getAzureHealth(),
    /non-JSON/,
  );
});

test("redacts credential-shaped fields before returning Backstage data", () => {
  assert.deepEqual(
    redactSensitiveData({
      status: "healthy",
      nested: { apiKey: "secret-value", password: "also-secret" },
      items: [{ token: "hidden" }],
    }),
    {
      status: "healthy",
      nested: { apiKey: "[redacted]", password: "[redacted]" },
      items: [{ token: "[redacted]" }],
    },
  );
});

test("validates Kubernetes names before using them in Backstage routes", () => {
  assert.equal(isKubernetesResourceName("production", 63), true);
  assert.equal(isKubernetesResourceName("api-7f9c", 253), true);
  assert.equal(isKubernetesResourceName("../secrets", 63), false);
  assert.equal(isKubernetesResourceName("Uppercase", 63), false);
  assert.equal(isKubernetesResourceName("a".repeat(64), 63), false);
});

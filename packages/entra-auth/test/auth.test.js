import assert from "node:assert/strict";
import test from "node:test";
import { createEntraBearerAuth, hasAppRole } from "../src/index.js";

function responseMock() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test("rejects requests without bearer tokens", async () => {
  const middleware = createEntraBearerAuth({
    tenantId: "tenant-id",
    audience: "api-client-id",
    requiredScope: "Agent.Read",
  });
  const res = responseMock();
  let nextCalled = false;
  await middleware({ get: () => undefined }, res, () => (nextCalled = true));
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("reports missing API registration configuration explicitly", async () => {
  const middleware = createEntraBearerAuth({ tenantId: "", audience: "", requiredScope: "Agent.Read" });
  const res = responseMock();
  await middleware({ get: () => "Bearer token" }, res, () => {});
  assert.equal(res.statusCode, 503);
});

test("matches required Entra app roles exactly", () => {
  assert.equal(hasAppRole(["Tester", "DevOps"], "Tester"), true);
  assert.equal(hasAppRole(["tester"], "Tester"), false);
  assert.equal(hasAppRole([], "DevOps"), false);
  assert.equal(hasAppRole(undefined, "DevOps"), false);
  assert.equal(hasAppRole(undefined, undefined), true);
});

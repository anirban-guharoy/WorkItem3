import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AIMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { createSummaryChain } from "../../src/graph/summary.js";

test("uses common-mcp-server context alongside Backstage insight-log data", async () => {
  const activity = JSON.parse(
    readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../fixtures/crashloop-activity.json",
      ),
      "utf8",
    ),
  );
  let researchRequest;
  let summaryMessages;
  const model = RunnableLambda.from(async (messages) => {
    summaryMessages = messages.toChatMessages();
    return new AIMessage("The pod is restarting; investigate memory pressure.");
  });
  const chain = createSummaryChain({
    model,
    tools: [{ name: "search_runbooks" }],
    researchContext: async (request) => {
      researchRequest = request;
      return "AKS runbook: exit code 137 can indicate memory pressure. https://docs.example/runbook";
    },
  });

  const result = await chain.invoke({
    namespace: "production",
    pod: "api-0",
    activity,
  });

  assert.equal(
    result.content,
    "The pod is restarting; investigate memory pressure.",
  );
  assert.equal(researchRequest.tools[0].name, "search_runbooks");
  assert.match(researchRequest.input, /CrashLoopBackOff/);
  assert.match(researchRequest.input, /Readiness probe failed/);
  assert.match(researchRequest.systemPrompt, /common-mcp-server/);
  assert.match(summaryMessages[1].content, /AKS runbook: exit code 137/);
  assert.match(summaryMessages[1].content, /CrashLoopBackOff/);
});

test("does not produce a summary when common-mcp-server context research fails", async () => {
  const chain = createSummaryChain({
    model: RunnableLambda.from(async () => {
      throw new Error("Summary model should not run without MCP context");
    }),
    tools: [],
    researchContext: async () => {
      throw new Error("common-mcp-server unavailable");
    },
  });

  await assert.rejects(
    chain.invoke({
      namespace: "production",
      pod: "api-0",
      activity: { status: "Unknown" },
    }),
    /common-mcp-server unavailable/,
  );
});

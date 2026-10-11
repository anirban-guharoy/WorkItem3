import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadModelConfig } from "@workitem3/langchain-runtime";
import { stripTrailingSlashes } from "@workitem3/agent-common";

const agentDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
dotenv.config({ path: path.join(agentDir, ".env") });
const defaultModelConfig = path.join(agentDir, "config/models.json");

export const config = {
  port: Number(process.env.PORT || 3001),
  model: loadModelConfig(defaultModelConfig),
  foundry: {
    endpoint: stripTrailingSlashes(process.env.AZURE_FOUNDRY_ENDPOINT || ""),
    apiKey: process.env.AZURE_FOUNDRY_API_KEY || "",
  },
  mcpServer: {
    name: "common-mcp-server",
    url: process.env.MCP_SERVER_URL || "",
    token: process.env.MCP_SERVER_TOKEN || "",
  },
  xray: {
    baseUrl: stripTrailingSlashes(
      process.env.XRAY_BASE_URL || "https://xray.cloud.getxray.app",
    ),
    clientId: process.env.XRAY_CLIENT_ID || "",
    clientSecret: process.env.XRAY_CLIENT_SECRET || "",
    cycleName:
      process.env.XRAY_TEST_CYCLE_NAME || "Manual Test Review - Regression",
  },
  auth: {
    tenantId: process.env.ENTRA_TENANT_ID || "",
    audience: process.env.ENTRA_API_AUDIENCE || "",
    readScope: process.env.ENTRA_READ_SCOPE || "Agent.Read",
    invokeScope: process.env.ENTRA_INVOKE_SCOPE || "Agent.Invoke",
    devOpsRole: process.env.ENTRA_DEVOPS_ROLE || "DevOps",
    dashboardOrigin: process.env.DASHBOARD_ORIGIN || "",
  },
  langsmith: {
    project: process.env.LANGSMITH_PROJECT || "manual-test-review-agent",
    tracing:
      process.env.LANGSMITH_TRACING === "true" &&
      Boolean(process.env.LANGSMITH_API_KEY),
  },
};

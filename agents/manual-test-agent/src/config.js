import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadModelConfig } from "@workitem3/langchain-runtime";

const agentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(agentDir, "../.env") });
const defaultModelConfig = path.join(agentDir, "../config/models.json");

export const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ""),
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  model: loadModelConfig(defaultModelConfig),
  foundry: {
    // e.g. https://<resource>.services.ai.azure.com/anthropic
    endpoint: (process.env.AZURE_FOUNDRY_ENDPOINT || "").replace(/\/$/, ""),
    apiKey: process.env.AZURE_FOUNDRY_API_KEY || "",
  },
  jira: {
    baseUrl: (process.env.JIRA_BASE_URL || "").replace(/\/$/, ""),
    email: process.env.JIRA_EMAIL || "",
    token: process.env.JIRA_API_TOKEN || "",
    acField: process.env.JIRA_AC_FIELD || "",
  },
  xray: {
    // Xray Cloud; region hosts: xray.cloud.getxray.app, eu.xray.cloud.getxray.app, au.xray.cloud.getxray.app
    baseUrl: (process.env.XRAY_BASE_URL || "https://xray.cloud.getxray.app").replace(/\/$/, ""),
    clientId: process.env.XRAY_CLIENT_ID || "",
    clientSecret: process.env.XRAY_CLIENT_SECRET || "",
    defaultCycleName: process.env.XRAY_TEST_CYCLE_NAME || "Manual Tester - Sprint Regression",
  },
  mcpServer: {
    name: "common-mcp-server",
    url: process.env.MCP_SERVER_URL || "",
    token: process.env.MCP_SERVER_TOKEN || "",
  },
  auth: {
    tenantId: process.env.ENTRA_TENANT_ID || "",
    audience: process.env.ENTRA_API_AUDIENCE || "",
    readScope: process.env.ENTRA_READ_SCOPE || "Agent.Read",
    reviewScope: process.env.ENTRA_REVIEW_SCOPE || "Agent.Review",
    devOpsRole: process.env.ENTRA_DEVOPS_ROLE || "DevOps",
    testerRole: process.env.ENTRA_TESTER_ROLE || "Tester",
    dashboardOrigin: process.env.DASHBOARD_ORIGIN || "",
  },
  langsmith: {
    project: process.env.LANGSMITH_PROJECT || "manual-test-agent",
    tracing: process.env.LANGSMITH_TRACING === "true" && Boolean(process.env.LANGSMITH_API_KEY),
  },
};

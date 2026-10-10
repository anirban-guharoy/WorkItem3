import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

// Model settings live in a config file (override path with MODEL_CONFIG_FILE, e.g. a mounted ConfigMap).
// "model" is the Azure AI Foundry deployment name of the Claude model.
function loadModelConfig() {
  const file = path.resolve(process.env.MODEL_CONFIG_FILE || "config/models.json");
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!cfg.model) throw new Error(`${file}: "model" is required`);
  return { temperature: 0.2, maxTokens: 8192, ...cfg };
}

export const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ""),
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  model: loadModelConfig(),
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
};

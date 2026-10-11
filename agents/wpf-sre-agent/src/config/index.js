import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadModelConfig } from "@workitem3/langchain-runtime";
import {
  parseCommaSeparatedList,
  stripTrailingSlashes,
} from "@workitem3/agent-common";

const agentDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
dotenv.config({ path: path.join(agentDir, ".env") });

const required = (name, value) => {
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const config = {
  port: Number(process.env.PORT || 3002),
  model: loadModelConfig(path.join(agentDir, "config/models.json")),
  foundry: {
    endpoint: stripTrailingSlashes(process.env.AZURE_FOUNDRY_ENDPOINT || ""),
    apiKey: process.env.AZURE_FOUNDRY_API_KEY || "",
  },
  backstage: {
    baseUrl: stripTrailingSlashes(process.env.BACKSTAGE_BASE_URL || ""),
    token: process.env.BACKSTAGE_API_TOKEN || "",
    healthPath: process.env.BACKSTAGE_AZURE_HEALTH_PATH || "",
    podsPath: process.env.BACKSTAGE_PODS_PATH || "",
    activityPath: process.env.BACKSTAGE_POD_ACTIVITY_PATH || "",
    restartPath: process.env.BACKSTAGE_RESTART_ACTION_PATH || "",
    restartMethod: (
      process.env.BACKSTAGE_RESTART_ACTION_METHOD || "POST"
    ).toUpperCase(),
    restartBodyTemplate: process.env.BACKSTAGE_RESTART_ACTION_BODY || "",
    requestTimeoutMs: Number(process.env.BACKSTAGE_REQUEST_TIMEOUT_MS || 15000),
  },
  mcpServer: {
    name: "common-mcp-server",
    url: process.env.MCP_SERVER_URL || "",
    token: process.env.MCP_SERVER_TOKEN || "",
  },
  learning: {
    storePath:
      process.env.WPF_SRE_LEARNING_STORE_PATH ||
      path.join(agentDir, "../data/learning.json"),
  },
  auth: {
    tenantId: process.env.ENTRA_TENANT_ID || "",
    audience: process.env.ENTRA_API_AUDIENCE || "",
    readScope: process.env.ENTRA_READ_SCOPE || "Agent.Read",
    restartScope: process.env.ENTRA_RESTART_SCOPE || "Agent.Restart",
    devOpsRole: process.env.ENTRA_DEVOPS_ROLE || "DevOps",
    dashboardOrigin: process.env.DASHBOARD_ORIGIN || "",
  },
  teams: {
    appId: process.env.MICROSOFT_APP_ID || "",
    appPassword: process.env.MICROSOFT_APP_PASSWORD || "",
    allowedTeamIds: parseCommaSeparatedList(process.env.WPF_DEVOPS_TEAM_IDS),
    allowedChannelIds: parseCommaSeparatedList(
      process.env.WPF_DEVOPS_CHANNEL_IDS,
    ),
  },
  langsmith: {
    project: process.env.LANGSMITH_PROJECT || "wpf-sre-agent",
    tracing:
      process.env.LANGSMITH_TRACING === "true" &&
      Boolean(process.env.LANGSMITH_API_KEY),
  },
};

export function validateConfig() {
  required("AZURE_FOUNDRY_ENDPOINT", config.foundry.endpoint);
  required("AZURE_FOUNDRY_API_KEY", config.foundry.apiKey);
  required("BACKSTAGE_BASE_URL", config.backstage.baseUrl);
  let backstageUrl;
  try {
    backstageUrl = new URL(config.backstage.baseUrl);
  } catch {
    throw new Error("BACKSTAGE_BASE_URL must be a valid URL");
  }
  if (
    backstageUrl.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(backstageUrl.hostname)
  ) {
    throw new Error("BACKSTAGE_BASE_URL must use HTTPS outside localhost");
  }
  required("BACKSTAGE_API_TOKEN", config.backstage.token);
  required("BACKSTAGE_AZURE_HEALTH_PATH", config.backstage.healthPath);
  required("BACKSTAGE_PODS_PATH", config.backstage.podsPath);
  required("BACKSTAGE_POD_ACTIVITY_PATH", config.backstage.activityPath);
  required("BACKSTAGE_RESTART_ACTION_PATH", config.backstage.restartPath);
  if (!["POST", "PUT"].includes(config.backstage.restartMethod)) {
    throw new Error("BACKSTAGE_RESTART_ACTION_METHOD must be POST or PUT");
  }
  if (!config.backstage.restartBodyTemplate) {
    throw new Error("BACKSTAGE_RESTART_ACTION_BODY is required");
  }
  required("MCP_SERVER_URL", config.mcpServer.url);
  required("ENTRA_TENANT_ID", config.auth.tenantId);
  required("ENTRA_API_AUDIENCE", config.auth.audience);
  required("MICROSOFT_APP_ID", config.teams.appId);
  required("MICROSOFT_APP_PASSWORD", config.teams.appPassword);
  if (
    !config.teams.allowedTeamIds.length ||
    !config.teams.allowedChannelIds.length
  ) {
    throw new Error(
      "WPF_DEVOPS_TEAM_IDS and WPF_DEVOPS_CHANNEL_IDS must restrict the Teams bot",
    );
  }
}

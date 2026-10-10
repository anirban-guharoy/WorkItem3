import "dotenv/config";

function parseJson(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${name} is not valid JSON: ${e.message}`);
  }
}

export const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ""),
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  model: process.env.OPENAI_MODEL || "gpt-4o",
  jira: {
    baseUrl: (process.env.JIRA_BASE_URL || "").replace(/\/$/, ""),
    email: process.env.JIRA_EMAIL || "",
    token: process.env.JIRA_API_TOKEN || "",
    acField: process.env.JIRA_AC_FIELD || "",
  },
  mcpServers: parseJson("MCP_SERVERS", {}),
};

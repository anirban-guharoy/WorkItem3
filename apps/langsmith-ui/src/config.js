import "dotenv/config";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const config = {
  port: Number(process.env.PORT || 8080),
  tenantId: process.env.ENTRA_TENANT_ID || "",
  clientId: process.env.ENTRA_UI_CLIENT_ID || "",
  uiAudience: process.env.ENTRA_UI_API_AUDIENCE || process.env.ENTRA_UI_CLIENT_ID || "",
  dashboardScope: process.env.ENTRA_DASHBOARD_SCOPE || "Dashboard.Read",
  roles: {
    devOps: process.env.ENTRA_DEVOPS_ROLE || "DevOps",
    tester: process.env.ENTRA_TESTER_ROLE || "Tester",
  },
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
  langsmithApiUrl: (process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com").replace(/\/$/, ""),
  langsmithProjects: {
    manualTester: process.env.LANGSMITH_MANUAL_TEST_PROJECT || "manual-test-agent",
    reviewAgent: process.env.LANGSMITH_REVIEW_AGENT_PROJECT || "manual-test-review-agent",
    wpfSreAgent: process.env.LANGSMITH_WPF_SRE_PROJECT || "wpf-sre-agent",
  },
  agents: {
    manualTester: {
      name: "Manual Test Agent",
      baseUrl: (process.env.MANUAL_TEST_AGENT_URL || "").replace(/\/$/, ""),
      clientId: process.env.MANUAL_TEST_AGENT_CLIENT_ID || "",
      scope: process.env.MANUAL_TEST_AGENT_SCOPE || "",
      reviewScope: process.env.MANUAL_TEST_AGENT_REVIEW_SCOPE || "Agent.Review",
    },
    reviewAgent: {
      name: "Manual Test Review Agent",
      baseUrl: (process.env.MANUAL_TEST_REVIEW_AGENT_URL || "").replace(/\/$/, ""),
      clientId: process.env.MANUAL_TEST_REVIEW_AGENT_CLIENT_ID || "",
      scope: process.env.MANUAL_TEST_REVIEW_AGENT_SCOPE || "",
    },
    wpfSreAgent: {
      name: "WPF SRE Agent",
      baseUrl: (process.env.WPF_SRE_AGENT_URL || "").replace(/\/$/, ""),
      clientId: process.env.WPF_SRE_AGENT_CLIENT_ID || "",
      scope: process.env.WPF_SRE_AGENT_SCOPE || "",
    },
  },
};

export function publicConfig() {
  return {
    tenantId: config.tenantId,
    clientId: config.clientId,
    dashboardScope: config.clientId ? `api://${config.uiAudience}/${config.dashboardScope}` : "",
    agents: Object.fromEntries(
      Object.entries(config.agents).map(([key, agent]) => [
        key,
        {
          name: agent.name,
          baseUrl: agent.baseUrl,
          scope: agent.clientId && agent.scope ? `api://${agent.clientId}/${agent.scope}` : "",
          reviewScope:
            key === "manualTester" && agent.clientId && agent.reviewScope
              ? `api://${agent.clientId}/${agent.reviewScope}`
              : "",
        },
      ]),
    ),
  };
}

export function validateServerConfig() {
  required("LANGSMITH_API_KEY");
  required("ENTRA_TENANT_ID");
  required("ENTRA_UI_CLIENT_ID");
  required("ENTRA_DEVOPS_ROLE");
  required("ENTRA_TESTER_ROLE");
  validateAgentUrl("MANUAL_TEST_AGENT_URL");
  required("MANUAL_TEST_AGENT_CLIENT_ID");
  required("MANUAL_TEST_AGENT_SCOPE");
  required("MANUAL_TEST_AGENT_REVIEW_SCOPE");
  validateAgentUrl("MANUAL_TEST_REVIEW_AGENT_URL");
  required("MANUAL_TEST_REVIEW_AGENT_CLIENT_ID");
  required("MANUAL_TEST_REVIEW_AGENT_SCOPE");
  validateAgentUrl("WPF_SRE_AGENT_URL");
  required("WPF_SRE_AGENT_CLIENT_ID");
  required("WPF_SRE_AGENT_SCOPE");
}

function validateAgentUrl(name) {
  const value = required(name);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(`${name} must use HTTPS outside localhost`);
  }
}

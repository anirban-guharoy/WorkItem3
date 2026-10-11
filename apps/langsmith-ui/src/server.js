import express from "express";
import { fileURLToPath } from "node:url";
import { Client } from "langsmith";
import { createEntraBearerAuth } from "@workitem3/entra-auth";
import { config, publicConfig, validateServerConfig } from "./config.js";

const app = express();
const authenticateDashboard = createEntraBearerAuth({
  tenantId: config.tenantId,
  audience: config.uiAudience,
  requiredScope: config.dashboardScope,
});
const authenticateDevOps = createEntraBearerAuth({
  tenantId: config.tenantId,
  audience: config.uiAudience,
  requiredScope: config.dashboardScope,
  requiredRole: config.roles.devOps,
});
let langsmith;

app.use((_req, res, next) => {
  const agentOrigins = Object.values(config.agents).map((agent) => {
    try {
      return new URL(agent.baseUrl).origin;
    } catch {
      return "";
    }
  }).filter(Boolean).join(" ");
  res.set({
    "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://login.microsoftonline.com ${agentOrigins}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  next();
});

app.get("/healthz", (_req, res) => res.json({ ok: true, app: "LangSmith UI" }));
app.get("/config.json", (_req, res) => res.json(publicConfig()));

app.get("/api/access", authenticateDashboard, (req, res) => {
  const hasDevOpsRole = req.auth.roles.includes(config.roles.devOps);
  const hasTesterRole = req.auth.roles.includes(config.roles.tester);
  if (!hasDevOpsRole && !hasTesterRole) {
    return res.status(403).json({ error: "Assigned DevOps or Tester app role required" });
  }
  return res.json({
    roles: req.auth.roles,
    capabilities: {
      viewAgentStatus: hasDevOpsRole,
      viewGeneratedCases: hasTesterRole,
      reviewGeneratedCases: hasTesterRole,
    },
  });
});

app.get("/api/runs/:agent", authenticateDevOps, async (req, res) => {
  if (!Object.hasOwn(config.langsmithProjects, req.params.agent)) {
    return res.status(404).json({ error: "Unknown agent" });
  }
  const projectName = config.langsmithProjects[req.params.agent];
  if (!config.langsmithApiKey) return res.status(503).json({ error: "LangSmith is not configured" });

  try {
    langsmith ??= new Client({ apiKey: config.langsmithApiKey, apiUrl: config.langsmithApiUrl });
    const runIterator = langsmith.listRuns({
      projectName,
      limit: 1,
      isRoot: true,
      order: "desc",
    });
    for await (const run of runIterator) {
      return res.json({
        configured: true,
        project: projectName,
        run: {
          id: run.id,
          name: run.name,
          status: run.error ? "failed" : run.end_time ? "succeeded" : "running",
          startedAt: run.start_time ? new Date(run.start_time).toISOString() : null,
          endedAt: run.end_time ? new Date(run.end_time).toISOString() : null,
          hasError: Boolean(run.error),
        },
      });
    }
    return res.json({ configured: true, project: projectName, run: null });
  } catch (error) {
    console.error("[langsmith] failed to retrieve latest run");
    return res.status(502).json({ error: "Unable to retrieve LangSmith runs" });
  }
});

app.use(express.static(fileURLToPath(new URL("../public", import.meta.url)), { index: "index.html" }));

if (process.env.NODE_ENV !== "test") {
  validateServerConfig();
  app.listen(config.port, () => console.log(`LangSmith UI listening on port ${config.port}`));
}

export { app };

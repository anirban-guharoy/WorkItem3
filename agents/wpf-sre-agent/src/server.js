import cors from "cors";
import express from "express";
import { createEntraBearerAuth } from "@workitem3/entra-auth";
import { createBackstageClient, isKubernetesResourceName } from "./backstage.js";
import { AGENT_NAME, summarizePodActivity } from "./agent.js";
import { config, validateConfig } from "./config.js";
import { createLearningStore } from "./learning.js";
import { createTeamsAgent } from "./teams.js";
import { startServer } from "@microsoft/agents-hosting-express";

const app = express();
const backstage = createBackstageClient(config.backstage);
const learningStore = createLearningStore(config.learning.storePath);
const readAuth = createEntraBearerAuth({
  tenantId: config.auth.tenantId,
  audience: config.auth.audience,
  requiredScope: config.auth.readScope,
  requiredRole: config.auth.devOpsRole,
});
const restartAuth = createEntraBearerAuth({
  tenantId: config.auth.tenantId,
  audience: config.auth.audience,
  requiredScope: config.auth.restartScope,
  requiredRole: config.auth.devOpsRole,
});

app.use(cors({
  origin: config.auth.dashboardOrigin || false,
  allowedHeaders: ["Authorization", "Content-Type"],
  methods: ["GET", "POST", "OPTIONS"],
}));
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, agent: AGENT_NAME }));
app.get("/api/status", readAuth, (_req, res) => res.json({
  name: AGENT_NAME,
  status: "healthy",
  checkedAt: new Date().toISOString(),
  backstage: { configured: Boolean(config.backstage.baseUrl) },
  langsmith: { tracing: config.langsmith.tracing, project: config.langsmith.project },
}));

app.get("/api/azure/health", readAuth, async (_req, res) => {
  try {
    return res.json({ checkedAt: new Date().toISOString(), health: await backstage.getAzureHealth() });
  } catch (error) {
    console.error("[backstage] Azure health query failed:", error.message);
    return res.status(502).json({ error: "Unable to retrieve Azure health from Backstage" });
  }
});

app.get("/api/pods", readAuth, async (_req, res) => {
  try {
    return res.json({ checkedAt: new Date().toISOString(), pods: await backstage.getPods() });
  } catch (error) {
    console.error("[backstage] pod query failed:", error.message);
    return res.status(502).json({ error: "Unable to retrieve AKS pods from Backstage" });
  }
});

app.get("/api/learning/feedback", readAuth, async (_req, res) => {
  try {
    return res.json({ feedback: await learningStore.listFeedback() });
  } catch (error) {
    console.error("[learning] feedback history read failed:", error.message);
    return res.status(500).json({ error: "Unable to retrieve operator learning records" });
  }
});

app.post("/api/learning/feedback", readAuth, async (req, res) => {
  const { namespace, pod } = req.body || {};
  if (!isKubernetesResourceName(namespace, 63) || !isKubernetesResourceName(pod)) {
    return res.status(400).json({ error: "namespace and pod must be valid Kubernetes resource names" });
  }
  try {
    const feedback = await learningStore.recordFeedback({
      namespace,
      pod,
      issueReference: req.body.issueReference,
      issue: req.body.issue,
      diagnosis: req.body.diagnosis,
      resolution: req.body.resolution,
      userId: req.auth.userId,
    });
    console.info(`[learning] recorded verified operator feedback ${feedback.id} for ${namespace}/${pod}`);
    return res.status(201).json({ feedback });
  } catch (error) {
    if (/must be a non-empty string/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    console.error("[learning] feedback persistence failed:", error.message);
    return res.status(500).json({ error: "Unable to persist operator learning record" });
  }
});

app.post("/api/pods/:namespace/:pod/summary", readAuth, async (req, res) => {
  const { namespace, pod } = req.params;
  if (!isKubernetesResourceName(namespace, 63) || !isKubernetesResourceName(pod)) {
    return res.status(400).json({ error: "namespace and pod must be valid Kubernetes resource names" });
  }
  try {
    const activity = await backstage.getPodActivity(namespace, pod);
    const summary = await summarizePodActivity({ namespace, pod, activity });
    return res.json({ namespace, pod, summary, summarizedAt: new Date().toISOString() });
  } catch (error) {
    console.error(`[sre] activity summary failed for ${namespace}/${pod}:`, error.message);
    return res.status(502).json({ error: "Unable to summarize pod activity" });
  }
});

app.post("/api/pods/:namespace/:pod/restart", restartAuth, async (req, res) => {
  const { namespace, pod } = req.params;
  if (!isKubernetesResourceName(namespace, 63) || !isKubernetesResourceName(pod)) {
    return res.status(400).json({ error: "namespace and pod must be valid Kubernetes resource names" });
  }
  try {
    console.info(`[audit] Entra user ${req.auth.userId} requested Backstage restart for ${namespace}/${pod}`);
    const result = await backstage.restartPod(namespace, pod);
    return res.status(202).json({ accepted: true, namespace, pod, result });
  } catch (error) {
    console.error(`[backstage] restart action failed for ${namespace}/${pod}:`, error.message);
    return res.status(502).json({ error: "Backstage did not accept the pod restart action" });
  }
});

async function handleTeamsCommand(text, actor = {}) {
  const command = text.toLowerCase();
  if (command === "help") {
    return "Commands: `health`, `pods`, `summary <namespace>/<pod>`, `restart <namespace>/<pod> confirm`.";
  }
  if (command === "health") {
    const health = await backstage.getAzureHealth();
    return `Azure health from Backstage:\n\`\`\`json\n${JSON.stringify(health, null, 2).slice(0, 6000)}\n\`\`\``;
  }
  if (command === "pods") {
    const pods = await backstage.getPods();
    return `AKS pod status from Backstage:\n\`\`\`json\n${JSON.stringify(pods, null, 2).slice(0, 6000)}\n\`\`\``;
  }
  const summaryMatch = /^summary\s+([a-z0-9.-]+)\/([a-z0-9.-]+)$/i.exec(text);
  if (summaryMatch) {
    const [, namespace, pod] = summaryMatch;
    if (!isKubernetesResourceName(namespace, 63) || !isKubernetesResourceName(pod)) {
      return "Use valid Kubernetes namespace and pod names. Send `help` for command syntax.";
    }
    const activity = await backstage.getPodActivity(namespace, pod);
    const summary = await summarizePodActivity({ namespace, pod, activity });
    return `**${namespace}/${pod} activity summary**\n${summary}`;
  }
  const restartMatch = /^restart\s+([a-z0-9.-]+)\/([a-z0-9.-]+)\s+confirm$/i.exec(text);
  if (restartMatch) {
    const [, namespace, pod] = restartMatch;
    if (!isKubernetesResourceName(namespace, 63) || !isKubernetesResourceName(pod)) {
      return "Use valid Kubernetes namespace and pod names. Send `help` for command syntax.";
    }
    console.info(`[audit] Teams user ${actor.userId || "unknown"} requested Backstage restart for ${namespace}/${pod} in ${actor.conversationId || "unknown"}`);
    const result = await backstage.restartPod(namespace, pod);
    return `Backstage accepted the restart request for ${namespace}/${pod}.\n\`\`\`json\n${JSON.stringify(result, null, 2).slice(0, 3000)}\n\`\`\``;
  }
  return "Unknown command. Send `help` for the available commands.";
}

if (process.env.NODE_ENV !== "test") {
  validateConfig();
  const agent = createTeamsAgent(handleTeamsCommand, {
    teams: config.teams,
    onError: (error) => console.error("[teams] command failed:", error.message),
  });
  startServer(agent, {
    port: config.port,
    routePath: "/api/teams/messages",
    authConfig: {
      clientId: config.teams.appId,
      clientSecret: config.teams.appPassword,
      tenantId: config.auth.tenantId,
    },
    beforeListen: (server) => {
      server.use(app);
    },
  });
  console.log(`${AGENT_NAME} listening on port ${config.port}`);
}

export { app, handleTeamsCommand };

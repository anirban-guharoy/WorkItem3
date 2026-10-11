import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import { createEntraBearerAuth } from "@workitem3/entra-auth";
import { config } from "./config.js";
import { runManualTester, AGENT_NAME } from "./agent.js";
import { applyHumanDecision } from "./human-review.js";
import { formatReviewLessons, selectRelevantReviewLessons } from "./learning.js";
import { fetchIssue, normalizeIssue, jiraEnabled, addComment, linkTestToStory } from "./jira.js";
import { publishTestCases, xrayEnabled } from "./xray.js";
import { saveReview, getReview, listReviews } from "./store.js";

const app = express();
app.use(cors({
  origin: config.auth.dashboardOrigin || false,
  allowedHeaders: ["Authorization", "Content-Type"],
  methods: ["GET", "POST", "OPTIONS"],
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function redirectToDashboard(res, suffix = "") {
  if (!config.auth.dashboardOrigin) {
    return res.status(503).send("DASHBOARD_ORIGIN is required for the human review UI");
  }
  return res.redirect(`${config.auth.dashboardOrigin}${suffix}`);
}

async function generate(key, fallbackStory) {
  const now = () => new Date().toISOString();
  const prev = getReview(key);
  let rec = { ...prev, key, status: "processing", story: fallbackStory ?? prev?.story, updatedAt: now() };
  saveReview(rec);
  try {
    const story = jiraEnabled() ? await fetchIssue(key).catch(() => fallbackStory) : fallbackStory;
    rec = { ...rec, story: story ?? rec.story };
    if (!rec.story) throw new Error("No story data available");
    const reviewLearning = formatReviewLessons(selectRelevantReviewLessons(rec.story, listReviews()));
    const output = await runManualTester(rec.story, reviewLearning);
    rec = { ...rec, status: "pending_review", output, error: undefined, updatedAt: now() };
    saveReview(rec);
    if (jiraEnabled()) {
      const reviewUrl = config.auth.dashboardOrigin
        ? `${config.auth.dashboardOrigin}/?story=${encodeURIComponent(key)}`
        : `${config.publicBaseUrl}/reviews/${encodeURIComponent(key)}`;
      await addComment(key, `${AGENT_NAME}: ${output.testCases.length} test cases are ready for review: ${reviewUrl}`).catch((e) =>
        console.error("[jira] comment failed:", e.message),
      );
    }
  } catch (e) {
    console.error(`[agent] ${key} failed:`, e);
    saveReview({ ...rec, status: "failed", error: e.message, updatedAt: now() });
  }
}

app.post("/webhook/jira", (req, res) => {
  const supplied = req.query.secret ?? req.get("x-webhook-secret") ?? "";
  if (!config.webhookSecret || !safeEqual(supplied, config.webhookSecret)) return res.sendStatus(401);
  const issue = req.body?.issue;
  if (!issue?.key) return res.status(400).json({ error: "payload has no issue" });
  const type = issue.fields?.issuetype?.name;
  if (type && type !== "Story") return res.status(200).json({ ignored: `issue type ${type}` });

  res.status(202).json({ accepted: issue.key, review: `${config.publicBaseUrl}/reviews/${issue.key}` });
  generate(issue.key, normalizeIssue(issue));
});

app.get("/", (_req, res) => redirectToDashboard(res));
app.get("/healthz", (_req, res) => res.json({ ok: true, agent: AGENT_NAME }));
app.get("/api/status", createEntraBearerAuth({
  tenantId: config.auth.tenantId,
  audience: config.auth.audience,
  requiredScope: config.auth.readScope,
  requiredRole: config.auth.devOpsRole,
}), (_req, res) => res.json({
  name: AGENT_NAME,
  status: "healthy",
  checkedAt: new Date().toISOString(),
  langsmith: { tracing: config.langsmith.tracing, project: config.langsmith.project },
}));
app.get("/api/reviews", createEntraBearerAuth({
  tenantId: config.auth.tenantId,
  audience: config.auth.audience,
  requiredScope: config.auth.readScope,
  requiredRole: config.auth.testerRole,
}), (req, res) => {
  const requestedStory = typeof req.query.story === "string" ? req.query.story : "";
  let reviews = listReviews()
    .filter((review) => review.story && review.output)
    .filter((review) => !requestedStory || review.key === requestedStory)
    .slice(0, requestedStory ? 1 : 50)
    .map((review) => ({
      key: review.key,
      story: review.story,
      status: review.status,
      output: review.output,
      updatedAt: review.updatedAt,
      humanReview: review.humanReview || null,
      humanReviewHistory: review.humanReviewHistory || [],
      xray: review.xray || null,
      error: ["failed", "publish_failed", "awaiting_xray_configuration"].includes(review.status)
        ? review.error
        : undefined,
    }));
  return res.json({ reviews });
});
app.post("/api/reviews/:key/decision", createEntraBearerAuth({
  tenantId: config.auth.tenantId,
  audience: config.auth.audience,
  requiredScope: config.auth.reviewScope,
  requiredRole: config.auth.testerRole,
}), (req, res) => {
  const { decision, comment = "" } = req.body || {};
  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ error: "decision must be approved or rejected" });
  }
  if (typeof comment !== "string" || comment.length > 5000) {
    return res.status(400).json({ error: "comment must be a string of at most 5000 characters" });
  }
  const review = getReview(req.params.key);
  if (!review || !review.output) return res.sendStatus(404);
  if (!["pending_review", "rejected", "approved", "publish_failed", "awaiting_xray_configuration"].includes(review.status)) {
    return res.status(409).json({ error: `Cannot review a test case set with status ${review.status}` });
  }

  const decidedAt = new Date().toISOString();
  const updated = applyHumanDecision(review, {
    decision,
    comment: comment.trim(),
    reviewer: req.auth,
    decidedAt,
    cycleName: review.cycleName || config.xray.defaultCycleName,
  });
  const canPublish = decision === "approved" && xrayEnabled();
  if (decision === "approved" && !canPublish) {
    updated.status = "awaiting_xray_configuration";
    updated.error = "Human approval recorded; configure Xray Cloud credentials to publish the test cases.";
  } else {
    updated.error = undefined;
  }
  saveReview(updated);
  if (canPublish) publish(review.key, updated.cycleName);
  return res.status(202).json({
    key: updated.key,
    status: canPublish ? "publishing" : updated.status,
    humanReview: updated.humanReview,
  });
});
app.get("/reviews", (_req, res) => redirectToDashboard(res));
app.get("/reviews/:key", (req, res) => {
  return redirectToDashboard(res, `/?story=${encodeURIComponent(req.params.key)}`);
});
async function publish(key, cycleName) {
  const now = () => new Date().toISOString();
  let rec = getReview(key);
  rec = { ...rec, status: "publishing", cycleName, error: undefined, updatedAt: now() };
  saveReview(rec);
  try {
    const result = await publishTestCases({
      storyKey: key,
      testCases: rec.output.testCases,
      cycleName,
      progress: rec.xray,
      onProgress: (xray) => saveReview({ ...rec, xray, updatedAt: now() }),
    });
    if (jiraEnabled()) {
      for (const t of Object.values(result.tests)) {
        await linkTestToStory(key, t.key).catch((e) => console.error("[jira] link failed:", e.message));
      }
      await addComment(key, `${AGENT_NAME}: ${Object.keys(result.tests).length} approved tests created in Xray and added to test cycle "${cycleName}" (${result.cycle.key}).`).catch(() => {});
    }
    saveReview({ ...getReview(key), status: "published", xray: result, error: undefined, updatedAt: now() });
  } catch (e) {
    console.error(`[xray] ${key} publish failed:`, e);
    saveReview({ ...getReview(key), status: "publish_failed", error: e.message, updatedAt: now() });
  }
}

app.post("/reviews/:key/decision", createEntraBearerAuth({
  tenantId: config.auth.tenantId,
  audience: config.auth.audience,
  requiredScope: config.auth.reviewScope,
  requiredRole: config.auth.testerRole,
}), (req, res) => {
  const r = getReview(req.params.key);
  if (!r || !["pending_review", "rejected", "approved", "publish_failed"].includes(r.status)) return res.sendStatus(409);
  const { decision } = req.body;
  if (!["approved", "rejected"].includes(decision)) return res.sendStatus(400);
  if (decision === "approved" && !xrayEnabled()) return res.status(503).send("Xray is not configured (XRAY_CLIENT_ID / XRAY_CLIENT_SECRET)");
  const cycleName = (req.body.cycleName || "").trim() || config.xray.defaultCycleName;
  saveReview({ ...r, status: decision, reviewerComment: req.body.comment || "", cycleName, updatedAt: new Date().toISOString() });
  if (decision === "approved") publish(r.key, cycleName);
  res.redirect(`/reviews/${r.key}`);
});
app.post("/reviews/:key/retry-publish", createEntraBearerAuth({
  tenantId: config.auth.tenantId,
  audience: config.auth.audience,
  requiredScope: config.auth.reviewScope,
  requiredRole: config.auth.testerRole,
}), (req, res) => {
  const r = getReview(req.params.key);
  if (!r || r.status !== "publish_failed") return res.sendStatus(409);
  publish(r.key, r.cycleName || config.xray.defaultCycleName);
  res.redirect(`/reviews/${r.key}`);
});
app.post("/reviews/:key/regenerate", createEntraBearerAuth({
  tenantId: config.auth.tenantId,
  audience: config.auth.audience,
  requiredScope: config.auth.reviewScope,
  requiredRole: config.auth.testerRole,
}), (req, res) => {
  const r = getReview(req.params.key);
  if (!r || ["processing", "publishing", "published"].includes(r.status)) return res.sendStatus(409);
  generate(r.key, r.story);
  res.redirect(`/reviews/${r.key}`);
});

if (process.env.NODE_ENV !== "test") {
  const server = app.listen(config.port, () => console.log(`${AGENT_NAME} listening on ${config.publicBaseUrl} (port ${config.port})`));
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
}

export { app };

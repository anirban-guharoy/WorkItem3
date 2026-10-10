import crypto from "node:crypto";
import express from "express";
import { config } from "./config.js";
import { runManualTester, AGENT_NAME } from "./agent.js";
import { fetchIssue, normalizeIssue, jiraEnabled, addComment, linkTestToStory } from "./jira.js";
import { publishTestCases, xrayEnabled } from "./xray.js";
import { saveReview, getReview, listReviews } from "./store.js";
import { listView, reviewView } from "./views.js";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function generate(key, fallbackStory) {
  const now = () => new Date().toISOString();
  const prev = getReview(key);
  let rec = { ...prev, key, status: "processing", story: fallbackStory ?? prev?.story, updatedAt: now() };
  saveReview(rec);
  try {
    const story = jiraEnabled() ? await fetchIssue(key).catch(() => fallbackStory) : fallbackStory;
    rec = { ...rec, story: story ?? rec.story };
    if (!rec.story) throw new Error("No story data available");
    const output = await runManualTester(rec.story);
    rec = { ...rec, status: "pending_review", output, error: undefined, updatedAt: now() };
    saveReview(rec);
    if (jiraEnabled()) {
      await addComment(key, `${AGENT_NAME}: ${output.testCases.length} test cases are ready for review: ${config.publicBaseUrl}/reviews/${key}`).catch((e) =>
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

app.get("/", (_req, res) => res.redirect("/reviews"));
app.get("/healthz", (_req, res) => res.json({ ok: true, agent: AGENT_NAME }));
app.get("/reviews", (_req, res) => res.send(listView(listReviews())));
app.get("/reviews/:key", (req, res) => {
  const r = getReview(req.params.key);
  return r ? res.send(reviewView(r, config.xray.defaultCycleName)) : res.sendStatus(404);
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

app.post("/reviews/:key/decision", (req, res) => {
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
app.post("/reviews/:key/retry-publish", (req, res) => {
  const r = getReview(req.params.key);
  if (!r || r.status !== "publish_failed") return res.sendStatus(409);
  publish(r.key, r.cycleName || config.xray.defaultCycleName);
  res.redirect(`/reviews/${r.key}`);
});
app.post("/reviews/:key/regenerate", (req, res) => {
  const r = getReview(req.params.key);
  if (!r || ["processing", "publishing", "published"].includes(r.status)) return res.sendStatus(409);
  generate(r.key, r.story);
  res.redirect(`/reviews/${r.key}`);
});

const server = app.listen(config.port, () => console.log(`${AGENT_NAME} listening on ${config.publicBaseUrl} (port ${config.port})`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));

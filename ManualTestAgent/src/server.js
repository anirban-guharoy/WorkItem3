import crypto from "node:crypto";
import express from "express";
import { config } from "./config.js";
import { runManualTester, AGENT_NAME } from "./agent.js";
import { fetchIssue, normalizeIssue, jiraEnabled, addComment } from "./jira.js";
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
  return r ? res.send(reviewView(r)) : res.sendStatus(404);
});
app.post("/reviews/:key/decision", (req, res) => {
  const r = getReview(req.params.key);
  if (!r || r.status === "processing") return res.sendStatus(404);
  if (!["approved", "rejected"].includes(req.body.decision)) return res.sendStatus(400);
  saveReview({ ...r, status: req.body.decision, reviewerComment: req.body.comment || "", updatedAt: new Date().toISOString() });
  res.redirect(`/reviews/${r.key}`);
});
app.post("/reviews/:key/regenerate", (req, res) => {
  const r = getReview(req.params.key);
  if (!r || r.status === "processing") return res.sendStatus(404);
  generate(r.key, r.story);
  res.redirect(`/reviews/${r.key}`);
});

app.listen(config.port, () => console.log(`${AGENT_NAME} listening on ${config.publicBaseUrl} (port ${config.port})`));

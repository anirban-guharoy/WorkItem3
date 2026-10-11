import cors from "cors";
import express from "express";
import { createEntraBearerAuth } from "../auth/entra.js";
import { ReviewRequest } from "../shared/contracts.js";
import { createXrayClient } from "@workitem3/xray-cloud";
import { config } from "../config/index.js";
import { AGENT_NAME, reviewTestCases } from "../graph/review.js";
import { applyReviewGate } from "../services/review-gate.js";
import {
  getReviewRecord,
  reviewId,
  saveReviewRecord,
} from "../repositories/review-store.js";
import { logError } from "../observability/logger.js";

const app = express();
app.use(
  cors({
    origin: config.auth.dashboardOrigin || false,
    allowedHeaders: ["Authorization", "Content-Type"],
    methods: ["GET", "POST", "OPTIONS"],
  }),
);
app.use(express.json({ limit: "2mb" }));
const xray = createXrayClient(config.xray);
const BUSY_TIMEOUT_MS = 60 * 60 * 1000;

app.get("/healthz", (_req, res) => res.json({ ok: true, agent: AGENT_NAME }));
app.get(
  "/api/status",
  createEntraBearerAuth({
    tenantId: config.auth.tenantId,
    audience: config.auth.audience,
    requiredScope: config.auth.readScope,
    requiredRole: config.auth.devOpsRole,
  }),
  (_req, res) =>
    res.json({
      name: AGENT_NAME,
      status: "healthy",
      checkedAt: new Date().toISOString(),
      langsmith: {
        tracing: config.langsmith.tracing,
        project: config.langsmith.project,
      },
    }),
);

app.post(
  "/review",
  createEntraBearerAuth({
    tenantId: config.auth.tenantId,
    audience: config.auth.audience,
    requiredScope: config.auth.invokeScope,
  }),
  async (req, res) => {
    const parsed = ReviewRequest.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({
          error: "Invalid review request",
          details: parsed.error.issues,
        });
    }

    const input = parsed.data;
    const id = reviewId(input);
    let record = getReviewRecord(id);
    if (record?.status === "published") return res.json(record.response);
    if (record?.status === "changes_requested")
      return res.json(record.response);
    if (
      ["reviewing", "publishing"].includes(record?.status) &&
      Date.now() - Date.parse(record.updatedAt) < BUSY_TIMEOUT_MS
    ) {
      return res
        .status(409)
        .json({
          error: "This test-case set is already being processed",
          status: record.status,
        });
    }

    try {
      let review = record?.review;
      if (review?.reviewStatus !== "approved") {
        record = {
          id,
          status: "reviewing",
          updatedAt: new Date().toISOString(),
        };
        saveReviewRecord(id, record);
        try {
          review = applyReviewGate(await reviewTestCases(input), input.story);
        } catch (error) {
          saveReviewRecord(id, {
            ...record,
            status: "review_failed",
            error: error.message,
            updatedAt: new Date().toISOString(),
          });
          throw error;
        }
      }

      const reviewedAt = record?.reviewedAt || new Date().toISOString();
      if (review.reviewStatus !== "approved") {
        const response = {
          agent: AGENT_NAME,
          storyKey: input.story.key,
          reviewedAt,
          status: "changes_requested",
          review,
          xray: null,
        };
        saveReviewRecord(id, {
          id,
          status: "changes_requested",
          review,
          reviewedAt,
          response,
          updatedAt: new Date().toISOString(),
        });
        return res.json(response);
      }
      if (!xray.enabled()) {
        saveReviewRecord(id, {
          id,
          status: "awaiting_xray_configuration",
          review,
          reviewedAt,
          updatedAt: new Date().toISOString(),
        });
        return res.status(503).json({
          error: "Review passed, but Xray Cloud is not configured",
          required: ["XRAY_CLIENT_ID", "XRAY_CLIENT_SECRET"],
          review,
        });
      }

      record = {
        ...record,
        id,
        status: "publishing",
        review,
        reviewedAt,
        updatedAt: new Date().toISOString(),
      };
      saveReviewRecord(id, record);

      let xrayResult;
      try {
        xrayResult = await xray.publishTestCases({
          storyKey: input.story.key,
          testCases: input.testCaseSet.testCases,
          cycleName: config.xray.cycleName,
          progress: record.xrayProgress,
          onProgress: (xrayProgress) => {
            record = {
              ...record,
              xrayProgress,
              updatedAt: new Date().toISOString(),
            };
            saveReviewRecord(id, record);
          },
        });
      } catch (error) {
        record = {
          ...record,
          status: "publish_failed",
          xrayError: error.message,
          updatedAt: new Date().toISOString(),
        };
        saveReviewRecord(id, record);
        logError("xray.publish", error, { storyKey: input.story.key });
        return res.status(502).json({
          error: "Review passed, but publishing to Xray Cloud failed",
          review,
          xrayProgress: record.xrayProgress,
        });
      }

      const response = {
        agent: AGENT_NAME,
        storyKey: input.story.key,
        reviewedAt,
        status: "published",
        review,
        xray: xrayResult,
      };
      saveReviewRecord(id, {
        ...record,
        status: "published",
        response,
        xrayResult,
        updatedAt: new Date().toISOString(),
      });
      return res.json(response);
    } catch (error) {
      logError("review.generate", error, { storyKey: input.story.key });
      return res.status(502).json({ error: "Review generation failed" });
    }
  },
);

export { app };

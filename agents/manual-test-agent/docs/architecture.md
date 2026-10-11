# Architecture

```
User ──Entra JWT──▶ Agent API (Fastify) ──tx──▶ PostgreSQL (jobs, drafts, coverage, reviews, publications, audit)
                        │ versioned message (Service Bus, correlation id)
                        ▼
                  Agent worker ── LangGraph (14 nodes, PostgreSQL checkpointer) ──▶ remote MCP (separate AKS cluster)
                        │                                                       └─▶ Claude Opus (Azure AI Foundry)
                        └── publish message ──▶ MCP write gateway (only after verified human approval)
```

## Components

- **API** (`src/api/app.ts`): auth, project authorization, size limit, rate limit, idempotent submission (`Idempotency-Key`), status/drafts/coverage/review/publish/cancel/retry, `/health/live|ready`.
- **Worker** (`src/worker`): Service Bus consumer, bounded retries (queue max delivery 5), dead-letter, graceful shutdown (stop receiving, finish in-flight, close), health server on `WORKER_HEALTH_PORT`.
- **Workflow** (`src/graph`): `authorizeRequest → fetchJiraStory → retrieveEnterpriseContext → normalizeAcceptanceCriteria → analyzeRequirements → detectAmbiguities → generateTestCases → validateTestCases → evaluateCoverage → detectDuplicates → persistDraft → awaitHumanReview → publishApprovedCases → recordAuditOutcome`. Edges are explicit and conditional: missing acceptance criteria routes to a clarification outcome; failures route to an error path; model regeneration after validation failure is capped. There is no free-form agent loop and the model has no tool access.
- **MCP** (`src/mcp`): `McpGateway` exposes the 7 logical operations. Read and write paths are separated; writes require `MCP_ALLOW_WRITES` and are only reachable from the publish service. Tool names come from `MCP_TOOL_MAP_JSON` and an allowlist; discovered tools are checked against it. A mock adapter backs local dev and tests.
- **Model** (`src/models`): `TestGenerationModel` interface; `FoundryModel` and deterministic `FakeModel`. Output is parsed from JSON and validated with Zod; model and prompt versions are recorded.
- **Services**: deterministic criteria normalization (ids are marked application-generated), ambiguity detection, validation, coverage evaluation (checks actions/expected results against the criterion, not only links), duplicate flagging (similarity, never auto-discard).

## State machine

`queued, running, draft_ready, awaiting_review, needs_clarification, approved, rejected, publishing, published, failed, cancelled`. The transition table exists in `services/state-machine.ts` and in the SQL trigger `enforce_job_transition`; a test asserts they are identical. Rows carry a `version` for optimistic concurrency.

## Publication safety

The API records a publication request (unique per job + approval + draft hash) and enqueues a publish message. The worker re-verifies: approval exists and is not revoked, approved draft version/hash equals current, the source story hash is unchanged, no published equivalent exists, destination is configured and writes are enabled. Each external write uses idempotency key `<publicationId>:<testCaseId>`, and external ids are persisted. Delivery is at-least-once; effects are idempotent. We do not claim exactly-once across JIRA/MCP: if the MCP write succeeds but the process dies before persisting, retry relies on the idempotency key being honoured by the MCP tool (to be verified, see [model-configuration](model-configuration.md)).

## Recovery

Jobs are durable in PostgreSQL. LangGraph checkpoints use the PostgreSQL checkpointer (`CHECKPOINTER=postgres`). A restarted pod receives the redelivered message and resumes from the checkpoint; failed jobs can be retried via `POST /generations/:id/retry`. Cancelled jobs are never resumed.

## Data minimization

Only the story, selected criteria and short relevance-ranked context excerpts are sent to the model. Full retrieved documents are not stored; context references and hashes are.

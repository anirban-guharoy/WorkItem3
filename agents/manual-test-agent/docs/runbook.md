# Runbook

| Symptom                       | Check                                                                           | Action                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job stuck in `running`        | Worker logs by `jobId`; Service Bus active/locked messages                      | Pod restart redelivers the message and resumes from the checkpoint. If dead-lettered, fix the cause and `POST /api/v1/generations/:id/retry`.                               |
| Job `failed`                  | `GET /generations/:id` shows sanitized error category; audit events             | Retry (`/retry`) after fixing. Categories are defined in `src/shared/errors.ts` (e.g. `validation`, `forbidden`, `internal`).                                               |
| Messages in dead-letter queue | Service Bus Explorer / `az servicebus queue show`                               | Identify reason; retry the job through the API (preferred, keeps state machine consistent) rather than re-queuing raw messages.                                             |
| Model 429/5xx                 | `agent.model.throttled` metric and worker warnings                              | Retries are bounded. Reduce worker replicas/concurrency or raise Foundry quota.                                                                                             |
| MCP errors                    | `agent.mcp.failures` metric and MCP warnings, network path to the other cluster | Verify private DNS, firewall, TLS and credentials; confirm tool map matches the server's tools (see model-configuration).                                                   |
| Publish blocked               | Response message and audit event                                                | Typical causes: draft version changed, story changed since approval (re-review required), approval revoked, destination not configured, writes disabled.                    |
| Publication partially done    | `publication_records` for the job                                               | Retry the publish; per-case idempotency keys prevent duplicate creation. Verify in the test tool that no duplicates exist if the MCP tool does not honour idempotency keys. |
| Migration job failed          | `kubectl logs job/<release>-mta-migrate`                                        | Fix and `helm upgrade` again; migrations are transactional and recorded.                                                                                                    |
| Readiness failing             | `/health/ready`                                                                 | API checks the database; check PostgreSQL connectivity and network policy.                                                                                                  |

Cancel: `POST /generations/:id/cancel`. Cancelled jobs are not processed even if a message is redelivered.

Rollback: `helm rollback <release> <revision>`. Migrations are forward-only; keep schema changes backward compatible across one release.

Secret rotation: update the Key Vault secret; restart pods (Key Vault CSI syncs on mount) with `kubectl rollout restart`.

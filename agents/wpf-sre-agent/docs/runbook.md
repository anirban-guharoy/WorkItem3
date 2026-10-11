# Runbook

| Symptom                   | Check                                                                   | Action                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| API pod not ready         | `/healthz`, pod events, logs                                            | Fix startup config and restart; health checks are process-only.                                                                 |
| 401/403 from API          | Entra issuer/audience/tenant, delegated scope and app role              | Correct app registration and assigned roles; restart endpoints require `Agent.Restart`.                                         |
| Backstage 502             | Sanitized logs; private DNS, TLS, firewall, token permissions           | Verify configured same-origin path and Backstage API health. Response bodies are not returned.                                  |
| Summary fails             | MCP reachability/tool availability and Foundry endpoint                 | Restore read-only MCP research and Foundry access; the graph intentionally fails rather than producing context-free summaries.  |
| Restart not accepted      | Entra/Teams identity, resource-name validation, Backstage action result | Verify user authorization and Backstage action configuration. Do not retry blindly if the first request may have been accepted. |
| Learning feedback missing | `WPF_SRE_LEARNING_STORE_PATH`, mount and file permissions               | Mount durable `/data`, set the configured path to `/data/learning.json`, and restore from backup if required.                   |
| Feedback file corrupt     | JSON parse error in logs                                                | Restore a known-good backup; do not silently reset verified operational history.                                                |

Rollback using `helm rollback`. Preserve the feedback volume across image rollbacks.

# Operations

## Health and telemetry

- `/healthz` is liveness/readiness and intentionally does not require Entra.
- `/api/status` is authenticated and reports configuration/tracing state.
- Container stdout/stderr is the current logging sink. The service does not yet emit OpenTelemetry
  metrics; collect AKS/container, ingress, restart count and HTTP metrics with Azure Monitor.
- Do not log bearer tokens, full Backstage payloads, full MCP documents or model reasoning.

Recommended alerts: pod restart count, memory/CPU pressure, readiness failures, HTTP 5xx rate,
Backstage 429/5xx errors, MCP/model failures, feedback volume/volume capacity, and denied restart
requests. Dashboard panels: API request latency/error rate, pod summaries by status, upstream
Backstage/MCP/model availability, and restart requests/accepted actions.

## Scaling

Set one replica while `WPF_SRE_LEARNING_STORE_PATH` uses the local JSON file. Teams and API calls
can be served concurrently within the process. For multiple replicas, move feedback to a durable
transactional database and add distributed idempotency for restart actions first.

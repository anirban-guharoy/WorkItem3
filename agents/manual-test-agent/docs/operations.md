# Operations

## Telemetry

OpenTelemetry traces cross API → Service Bus (trace context in message properties) → worker → MCP/model → database. `APPLICATIONINSIGHTS_CONNECTION_STRING` enables the Azure Monitor exporter. Logs are structured JSON (pino) with `correlationId`, `jobId`, `node`, `durationMs`; secrets/authorization headers are redacted and chain-of-thought is never logged.

Metrics (OpenTelemetry meter): node duration, MCP latency/failures, model latency/throttling/tokens/cost estimate, validation failures, coverage ratio, duplicate flags, review approvals/rejections, publication failures.

## Example alerts (Log Analytics KQL)

Custom metrics are exported under the names below (Application Insights `customMetrics`; names may be normalized by the exporter, so check in Metrics Explorer first): `agent.workflow.node.duration`, `agent.workflow.node.errors`, `agent.mcp.latency`, `agent.mcp.failures`, `agent.model.latency`, `agent.model.throttled`, `agent.model.tokens`, `agent.model.cost_usd`, `agent.validation.failures`, `agent.coverage.percent`, `agent.duplicates.flagged`, `agent.review.decisions`, `agent.publication.failures`, `agent.publication.successes`, `agent.jobs.completed`, `agent.messages.dead_lettered`, `agent.context.injection_suspected`.

```kusto
// Dead-lettered messages
customMetrics | where timestamp > ago(15m) and name == "agent.messages.dead_lettered" | summarize n=sum(value) | where n > 0
```

```kusto
// Model throttling
customMetrics | where timestamp > ago(10m) and name == "agent.model.throttled" | summarize n=sum(value) | where n > 20
```

```kusto
// Publication failures
customMetrics | where timestamp > ago(30m) and name == "agent.publication.failures" | summarize n=sum(value) | where n > 0
```

```kusto
// Error log lines from the worker
traces | where timestamp > ago(15m) and severityLevel >= 3 and message has "dead-lettered" | summarize count()
```

Azure Monitor metric alerts: Service Bus `DeadletteredMessages > 0`, `ActiveMessages` age > 15 min, PostgreSQL CPU/storage, AKS pod restarts, API 5xx rate > 2%, p95 latency of `/api/v1/generations` > 1 s.

## Dashboard guidance

Panels: queue depth and oldest message age; jobs by state; time per workflow node (p50/p95); model latency, tokens and cost per day; MCP error rate by operation; coverage distribution (% covered); review approval/rejection ratio; publication success rate.

## Scaling

API: HPA on CPU. Worker: KEDA `azure-servicebus` scaler on queue length (workload identity). Worker concurrency is bounded per pod by `WORKER_CONCURRENCY`; the model's quota is the practical ceiling.

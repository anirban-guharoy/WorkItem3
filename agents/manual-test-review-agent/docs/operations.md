# Operations

## Health and metrics

- `GET /healthz` is the Kubernetes liveness/readiness endpoint.
- `GET /api/status` is Entra-protected and reports service/configured LangSmith state.
- Logs are structured only at the platform boundary and include request error categories; do not
  enable prompt or credential logging.
- Track HTTP 5xx/latency, `review_failed`, `publish_failed`, Xray retry counts, and the age/size of
  files in `DATA_DIR`. Alert if the persistent volume is nearing capacity or the pod restarts.

The service does not currently emit OpenTelemetry metrics. Azure Monitor can collect container
stdout and Kubernetes/ingress metrics; model and publish counters should be added before requiring
SLO-based autoscaling.

## Scaling

Do not scale this deployment above one replica while using the local JSON repository. Requests are
synchronous and can take as long as the model/MCP/Xray calls. Size CPU/memory for the configured
model response and request limit. If request timeouts become operationally unacceptable, migrate the
store and introduce a durable queue/worker before horizontal scaling.

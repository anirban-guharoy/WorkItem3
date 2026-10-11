# wpf-sre-agent

An independently deployable LangChain Node.js SRE agent for WPF Azure operations. It reads Azure
service health, AKS pod state, and pod activity from a remote Backstage server already integrated
with Azure Insights. It summarizes pod activity using Azure AI Foundry and can submit a pod-restart
action to Backstage. The agent does not connect directly to the Kubernetes API.

## Backstage integration

Backstage plugin APIs vary by installation, so configure every route to match your deployment.
The agent sends JSON requests with a bearer `Authorization` header and expects JSON responses.
Configure the token with the least-privilege permissions needed for health, pod/activity
reads, and the restart action.

| Setting                           | Purpose                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `BACKSTAGE_BASE_URL`              | HTTPS origin of the remote Backstage server                       |
| `BACKSTAGE_AZURE_HEALTH_PATH`     | GET path for Azure Insights health                                |
| `BACKSTAGE_PODS_PATH`             | GET path returning AKS pods                                       |
| `BACKSTAGE_POD_ACTIVITY_PATH`     | GET path for activity; supports `{namespace}` and `{pod}`         |
| `BACKSTAGE_RESTART_ACTION_PATH`   | Backstage restart action path; supports `{namespace}` and `{pod}` |
| `BACKSTAGE_RESTART_ACTION_METHOD` | `POST` or `PUT`                                                   |
| `BACKSTAGE_RESTART_ACTION_BODY`   | JSON body template; supports `{namespace}` and `{pod}`            |
| `BACKSTAGE_REQUEST_TIMEOUT_MS`    | Backstage HTTP timeout (default 15 seconds)                       |

The agent returns explicit upstream errors rather than substituting empty health data. Backstage
responses are limited to 1 MB and credential-shaped fields are redacted before returning data to
callers or summarizing activity. Backstage endpoint paths must stay on the configured origin.

## Operational context with common-mcp-server

Pod activity summaries first use `common-mcp-server` to search relevant prior issues, incidents,
verified resolutions, runbooks, service documentation, and Azure Insights guidance using the
namespace, pod, and Backstage insight-log details. The retrieved context and relevant operator
feedback are passed alongside the original activity to the summarizer; Backstage log data remains
the primary evidence, and the model separates observed facts, documented context, and hypotheses.
Configure `MCP_SERVER_URL` and optional `MCP_SERVER_TOKEN`. The endpoint must expose at least one
tool; missing configuration or MCP failures are reported instead of silently producing a
context-free summary.

DevOps operators can teach the agent verified diagnoses and resolutions using
`POST /api/learning/feedback` (protected by the `Agent.Read` scope and `DevOps` role):

```json
{
  "namespace": "production",
  "pod": "api-7f9c",
  "issueReference": "INC-1234",
  "issue": "The pod repeatedly restarted after memory usage exceeded its limit.",
  "diagnosis": "A memory leak in the response cache exhausted the container limit.",
  "resolution": "The cache was bounded and the deployment was rolled out."
}
```

Submitting this endpoint records operator-confirmed feedback. `GET /api/learning/feedback` lists
the records for authorized DevOps users. Up to 500 records are retained in the persistent learning
store, and up to 8 relevant matches are included in each summary research request. The feedback is
treated as prior evidence, not as proof that a new incident has the same cause.

## API and Entra ID

Register an Entra API application for the agent. Expose delegated scopes `Agent.Read` and
`Agent.Restart`, define a `DevOps` app role, and assign only authorized operators. Configure:

- `ENTRA_TENANT_ID` and `ENTRA_API_AUDIENCE` for this API registration.
- `ENTRA_READ_SCOPE`, `ENTRA_RESTART_SCOPE`, and `ENTRA_DEVOPS_ROLE`.
- `DASHBOARD_ORIGIN` to the exact HTTPS dashboard origin for browser CORS.

`GET /api/status`, `GET /api/azure/health`, `GET /api/pods`, and `POST /api/pods/:namespace/:pod/summary`
require `Agent.Read` and the `DevOps` role. `POST /api/pods/:namespace/:pod/restart` requires
`Agent.Restart` and `DevOps`. Namespace and pod names are validated before interpolating configured
Backstage routes. `/healthz` is unauthenticated for Kubernetes probes.

## Microsoft Teams

Register an Azure Bot with the Microsoft Teams channel enabled. Its messaging endpoint is
`https://<agent-host>/api/teams/messages`. Set `MICROSOFT_APP_ID` and `MICROSOFT_APP_PASSWORD` from
the bot registration. The endpoint uses the Microsoft Agents SDK to authenticate incoming
Bot Framework activities. Install the bot in the `WPF-DevOps-Channel` channel and set
`WPF_DEVOPS_TEAM_IDS` and `WPF_DEVOPS_CHANNEL_IDS` to the exact IDs from the Teams activity payload.
Both allowlists are required; direct chats and other channels/teams are denied. Members of the
configured channel can invoke commands, as requested.

Commands:

```text
help
health
pods
summary <namespace>/<pod>
restart <namespace>/<pod> confirm
```

Restart requires the explicit `confirm` suffix and is submitted to the configured Backstage action.
The agent records an audit log entry for each accepted restart request. The Backstage action should
also apply its own authorization and operational safeguards.

## LangSmith

Set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, and
`LANGSMITH_PROJECT=wpf-sre-agent`. The dashboard shows its authenticated health state and latest
root LangSmith run to DevOps users.

## Local run

From the repository root:

```bash
npm install
cp agents/wpf-sre-agent/.env.example agents/wpf-sre-agent/.env
npm run start --workspace=@workitem3/wpf-sre-agent
```

Fill in all required Backstage routes, MCP endpoint, secrets, Entra registration details, Teams
allowlists, and Foundry credentials first. For local persistence, set
`WPF_SRE_LEARNING_STORE_PATH` to a writable file path. `npm run check` and `npm test` from the root
run checks for this workspace.

## Docker and AKS

Build the image from the repository root:

```bash
docker build -f agents/wpf-sre-agent/Dockerfile \
  -t <ACR_NAME>.azurecr.io/wpf-sre-agent:1.0.0 .
az acr login -n <ACR_NAME>
docker push <ACR_NAME>.azurecr.io/wpf-sre-agent:1.0.0
kubectl apply -f agents/wpf-sre-agent/k8s/deployment.yaml
kubectl -n wpf-sre-agent create secret generic wpf-sre-agent-secrets \
  --from-env-file=agents/wpf-sre-agent/.env
```

Set the Backstage routes, host, image, Entra values, MCP URL, and Teams allowlists in the deployment
ConfigMap/Ingress. Keep Backstage, Foundry, Bot, MCP, and LangSmith credentials in a Kubernetes
Secret. The JSON learning store uses a persistent volume and a single agent replica to avoid
concurrent writes. The Deployment uses no Kubernetes API permissions; pod restarts are delegated to
the configured Backstage action.

The recommended chart is `helm/wpf-sre-agent`. It includes a retained learning-data PVC,
non-root/read-only container, probes, NetworkPolicy, optional TLS ingress, and Workload Identity
annotations. It intentionally rejects more than one replica because the feedback store is
file-backed. See [deployment](docs/deployment.md), [architecture](docs/architecture.md), and
[security](docs/security.md). The legacy `k8s/` YAML is retained for reference; use Helm for new
deployments.

## Source and validation

Implementation modules are organized under `src/api`, `src/auth`, `src/config`, `src/graph`,
`src/mcp`, `src/models`, `src/prompts`, `src/repositories`, `src/services`, `src/observability`,
`src/security`, `src/shared`, and `src/worker`. Unit, integration, HTTP, and fixture files are under
`tests/`.

```bash
npm run check --workspace=@workitem3/wpf-sre-agent
npm test --workspace=@workitem3/wpf-sre-agent
helm lint agents/wpf-sre-agent/helm/wpf-sre-agent \
  --set image.repository=<acr>.azurecr.io/wpf-sre-agent --set image.tag=<tag>
```

# Manual Test Agent

A JIRA webhook triggers the agent, which reads the story's description and acceptance criteria,
gathers context from Confluence and SharePoint via common-mcp-server, and produces structured manual
test cases. Results are shown on a web page for human approval/rejection.
The generator follows the shared `@workitem3/test-case-contract` format and applies relevant
risk-based, equivalence-partitioning, boundary-value, decision-table, state-transition, and negative
test-design techniques.

## Setup

From the repository root:

```bash
npm install
cp agents/manual-test-agent/.env.example agents/manual-test-agent/.env
npm run start --workspace=@workitem3/manual-test-agent
```

## JIRA webhook
JIRA → Settings → System → WebHooks: URL `https://<host>/webhook/jira?secret=<WEBHOOK_SECRET>`,
events: Issue created/updated (optionally JQL `issuetype = Story AND labels = generate-tests`
to control when it fires). Non-Story issues are ignored. For local testing expose the port with a tunnel.

## Review
Open `/reviews` (or the link the agent comments on the JIRA issue). Approve, reject, or regenerate.
Results are stored in `./data`. Protect the review UI behind your SSO/reverse proxy in production.
Review decisions and the reviewed test cases are retained as learning examples. Relevant past
approvals and rejections, including reviewer comments, are provided to later generations for similar
stories. Use the comment field to explain actionable gaps or useful patterns; feedback is treated as
historical guidance and never overrides the current story's acceptance criteria.

## Xray (after approval)
On **Approve**, each test case is created in Xray Cloud as a Manual test (steps, expected result on the last step,
priority, labels `manual-tester`, story key and type) in the story's JIRA project, then the tests are added to the
Test Execution (test cycle) named by `XRAY_TEST_CYCLE_NAME` - the reviewer can override the name on the review page.
An existing execution with that exact summary is reused; otherwise it is created. Needs `XRAY_CLIENT_ID` /
`XRAY_CLIENT_SECRET` (Xray API key) and optionally `XRAY_BASE_URL` for your region. If JIRA credentials are set,
tests are also linked to the story (link type "Test") and a comment is added. Publishing is resumable: on failure use
"Retry publishing" and already-created tests are not duplicated.

## MCP
The agent connects to a single remote MCP server, `common-mcp-server` (streamable HTTP), configured with `MCP_SERVER_URL`
and optional `MCP_SERVER_TOKEN` (sent as a Bearer token).
The MCP URL and at least one available tool are required for test generation. Retrieved context is
used when producing test cases.

## Test without JIRA
```bash
curl -X POST "localhost:3000/webhook/jira?secret=change-me" -H 'content-type: application/json' -d '{"issue":{"key":"DEMO-1","fields":{"summary":"Login","issuetype":{"name":"Story"},"description":"As a user I want to log in.\n\nAcceptance Criteria\n- Valid credentials sign in\n- 5 failed attempts lock the account"}}}'
```

## Model (Claude on Azure AI Foundry)
The agent calls a Claude deployment through Foundry's Anthropic-compatible endpoint
(`AZURE_FOUNDRY_ENDPOINT=https://<resource>.services.ai.azure.com/anthropic`, `AZURE_FOUNDRY_API_KEY`).
The model version is **not in code**: set `model` (your Foundry deployment name) plus `temperature` and
`maxTokens` in `agents/manual-test-agent/config/models.json`. Point `MODEL_CONFIG_FILE` at another file to override; on AKS this is the
`manual-tester-model` ConfigMap, so changing the version needs only a ConfigMap edit and pod restart.

## Entra ID and LangSmith

The authenticated status API is `GET /api/status`, requiring a v2 Entra access token for this API
registration's audience with the delegated `Agent.Read` scope and `DevOps` app role. `GET /api/reviews`
requires `Agent.Read` and the `Tester` app role to list generated cases and persisted review outcomes.
`POST /api/reviews/:key/decision` requires the separate `Agent.Review` scope and `Tester` role; it
stores the decision, comment, Entra user identity, timestamp, and a bounded snapshot of the reviewed
test set for future learning. Approval starts the configured Xray
publication; rejection does not publish.
If Xray is not configured, the approval is still recorded as a human outcome and the case set remains
in `awaiting_xray_configuration`; after configuring Xray, approve again from the dashboard to start
publishing.
Configure `ENTRA_TENANT_ID`, `ENTRA_API_AUDIENCE`, `ENTRA_READ_SCOPE`, `ENTRA_REVIEW_SCOPE`,
`ENTRA_DEVOPS_ROLE`, `ENTRA_TESTER_ROLE`, and the exact LangSmith UI `DASHBOARD_ORIGIN`. `/healthz`
remains available to Kubernetes probes. Configure app-role assignments on this API registration as
described in [LangSmith UI setup](../../apps/langsmith-ui/README.md).

The old `/reviews` pages redirect to `DASHBOARD_ORIGIN`; decision, retry, and regenerate form APIs
also require Entra authentication and the Tester role. Use the dashboard for human review.

Set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, and `LANGSMITH_PROJECT` to
send LangChain traces to the agent's LangSmith project. The LangSmith UI displays only the latest
root-run status, not trace inputs or outputs. See [LangSmith UI setup](../../apps/langsmith-ui/README.md)
for Entra app registration and dashboard configuration.

## Implementation
Built on core LangChain primitives (no prebuilt agent): `ChatPromptTemplate`, `bindTools` with a bounded
tool-calling loop over the MCP tools (research step), then a prompt → `withStructuredOutput(zod)` chain
(writer step), composed with `RunnableLambda.pipe`. See `agents/manual-test-agent/src/agent.js`. The
generator and review agent are independently deployable; generated cases can be submitted separately
to the Manual Test Review Agent's `POST /review` endpoint.

## Docker & Azure AKS

Build and publish from the repository root:

```bash
docker build -f agents/manual-test-agent/Dockerfile -t <ACR_NAME>.azurecr.io/manual-test-agent:1.0.0 .
az acr login -n <ACR_NAME> && docker push <ACR_NAME>.azurecr.io/manual-test-agent:1.0.0
az aks update -g <rg> -n <aks> --attach-acr <ACR_NAME>            # let AKS pull from ACR
az aks approuting enable -g <rg> -n <aks>                          # ingress (app routing add-on)
kubectl apply -f agents/manual-test-agent/k8s/deployment.yaml
kubectl -n manual-tester create secret generic manual-tester-secrets --from-env-file=agents/manual-test-agent/.env
```

Edit the image, host and `PUBLIC_BASE_URL` in `agents/manual-test-agent/k8s/deployment.yaml`, point DNS/TLS at the ingress, and use
`https://<host>/webhook/jira?secret=...` in JIRA. Runs as a single replica with an Azure Disk PVC at `/data`.
Change the Claude version by editing the `manual-tester-model` ConfigMap, then `kubectl -n manual-tester rollout restart deploy/manual-tester`.

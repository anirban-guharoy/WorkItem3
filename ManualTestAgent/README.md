# Manual Tester (LangChain agent, Node.js)

A JIRA webhook triggers the agent, which reads the story's description and acceptance criteria,
gathers context from Confluence and SharePoint via common-mcp-server, and produces structured manual
test cases. Results are shown on a web page for human approval/rejection.

## Setup
```bash
npm install
cp .env.example .env   # fill in values
npm start
```

## JIRA webhook
JIRA → Settings → System → WebHooks: URL `https://<host>/webhook/jira?secret=<WEBHOOK_SECRET>`,
events: Issue created/updated (optionally JQL `issuetype = Story AND labels = generate-tests`
to control when it fires). Non-Story issues are ignored. For local testing expose the port with a tunnel.

## Review
Open `/reviews` (or the link the agent comments on the JIRA issue). Approve, reject, or regenerate.
Results are stored in `./data`. Protect the review UI behind your SSO/reverse proxy in production.

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
All of its tools are given to the agent.

## Test without JIRA
```bash
curl -X POST "localhost:3000/webhook/jira?secret=change-me" -H 'content-type: application/json' -d '{"issue":{"key":"DEMO-1","fields":{"summary":"Login","issuetype":{"name":"Story"},"description":"As a user I want to log in.\n\nAcceptance Criteria\n- Valid credentials sign in\n- 5 failed attempts lock the account"}}}'
```

## Model (Claude on Azure AI Foundry)
The agent calls a Claude deployment through Foundry's Anthropic-compatible endpoint
(`AZURE_FOUNDRY_ENDPOINT=https://<resource>.services.ai.azure.com/anthropic`, `AZURE_FOUNDRY_API_KEY`).
The model version is **not in code**: set `model` (your Foundry deployment name) plus `temperature` and
`maxTokens` in `config/models.json`. Point `MODEL_CONFIG_FILE` at another file to override; on AKS this is the
`manual-tester-model` ConfigMap, so changing the version needs only a ConfigMap edit and pod restart.

## Implementation
Built on core LangChain primitives (no prebuilt agent): `ChatPromptTemplate`, `bindTools` with a bounded
tool-calling loop over the MCP tools (research step), then a prompt → `withStructuredOutput(zod)` chain
(writer step), composed with `RunnableLambda.pipe`. See `src/agent.js`.

## Docker & Azure AKS
```bash
docker build -t <ACR_NAME>.azurecr.io/manual-tester:1.0.0 .
az acr login -n <ACR_NAME> && docker push <ACR_NAME>.azurecr.io/manual-tester:1.0.0
az aks update -g <rg> -n <aks> --attach-acr <ACR_NAME>            # let AKS pull from ACR
az aks approuting enable -g <rg> -n <aks>                          # ingress (app routing add-on)
kubectl apply -f k8s/deployment.yaml                               # creates namespace first
kubectl -n manual-tester create secret generic manual-tester-secrets --from-env-file=.env
```
Edit the image, host and `PUBLIC_BASE_URL` in `k8s/deployment.yaml`, point DNS/TLS at the ingress, and use
`https://<host>/webhook/jira?secret=...` in JIRA. Runs as a single replica with an Azure Disk PVC at `/data`.
Change the Claude version by editing the `manual-tester-model` ConfigMap, then `kubectl -n manual-tester rollout restart deploy/manual-tester`.

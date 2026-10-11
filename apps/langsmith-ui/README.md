# LangSmith Agent Status UI

Standalone dashboard that authenticates users with Microsoft Entra ID and displays live health plus
the latest root LangSmith run for Manual Test Agent and Manual Test Review Agent. The API key used
to query LangSmith stays server-side. The browser gets delegated Entra access tokens for each
independently registered agent API and for the dashboard API. It also displays generated test cases
from Manual Test Agent for human review; decisions and comments are persisted by that agent, and
approval starts its Xray Cloud publishing workflow.

## Run locally

Configure `.env` from `.env.example`, register the redirect URI `http://localhost:8080` as a
Single-page application redirect in Entra ID, then:

```bash
npm install
npm run build --workspace=@workitem3/langsmith-ui
npm run start --workspace=@workitem3/langsmith-ui
```

Use HTTPS for deployed environments. The MSAL browser cache uses `sessionStorage`; access tokens are
not stored in the dashboard server or LangSmith API responses.

## Entra ID app registrations

Create the following **single-tenant** app registrations in the same Entra tenant:

1. **LangSmith UI** — add a SPA redirect URI for the UI origin. Under **Expose an API**, set the
   Application ID URI to `api://<LANGSMITH_UI_APP_CLIENT_ID>` and expose delegated scope
   `Dashboard.Read`. This registration serves as both the public SPA client and the dashboard API
   audience; no client secret is needed.
2. **Manual Test Agent API** — expose delegated scopes `Agent.Read` and `Agent.Review`; use this app's
   client ID as the API audience. `Agent.Review` is required to record a human approve/reject decision.
3. **Manual Test Review Agent API** — expose delegated scopes `Agent.Read` and `Agent.Invoke`; use
   this app's client ID as the API audience. `Agent.Invoke` protects the review-and-publish endpoint.
4. **wpf-sre-agent API** — expose delegated scopes `Agent.Read` and `Agent.Restart`, define the
   `DevOps` app role, and use this app's client ID as the API audience. `Agent.Restart` protects the
   Backstage restart-action endpoint.

In the LangSmith UI registration, add delegated API permissions for `Agent.Read` on each agent
registration, `Agent.Review` on the Manual Test Agent API, and `Agent.Restart` on the wpf-sre-agent
API, then grant tenant admin consent.
Pre-authorize the UI app client ID on the agent APIs for these delegated scopes if the tenant's
consent policy requires it.

### App-role assignments

Define Entra **app roles** with exact values `DevOps` and `Tester` on the LangSmith UI registration
and the Manual Test Agent API registration. Define `DevOps` on the Manual Test Review Agent API
and wpf-sre-agent API registrations. Set the roles' allowed member types to users/groups and assign the appropriate users
or groups to the roles on each API's Enterprise Application. Do not assign both roles to a user if
they must be restricted to just one dashboard area.

The dashboard app role controls dashboard sections: `DevOps` can see agent health/status and latest
LangSmith run state; `Tester` can see generated test cases and human review controls. A user with
both roles can access both sections. Role assignment must be repeated for each resource API because
Entra puts the audience API's assigned app roles in that API's access token. The Manual Test Agent
also requires `DevOps` for `/api/status`, `Tester` for `/api/reviews`, and both the `Tester` role and
`Agent.Review` scope for review decisions. The Review Agent and wpf-sre-agent status endpoints
require `DevOps`; the wpf-sre-agent pod restart API additionally requires `Agent.Restart`.

Every protected API validates the token signature, tenant, v2 issuer, audience, delegated scope,
and (where required) exact app-role claim. Missing roles are denied even if the browser UI is
modified. `/healthz` remains unauthenticated only for Kubernetes probes. The agent's old `/reviews`
URLs now redirect to this dashboard; legacy form POST endpoints are role-protected.

Set `.env` as follows:

- `ENTRA_TENANT_ID`: directory (tenant) ID.
- `ENTRA_UI_CLIENT_ID`: LangSmith UI registration's application (client) ID.
- `ENTRA_UI_API_AUDIENCE`: UI API audience, normally the same client ID.
- `MANUAL_TEST_AGENT_URL` / `MANUAL_TEST_REVIEW_AGENT_URL`: HTTPS origins reachable in the user's
  browser, not AKS-only ClusterIP names.
- `MANUAL_TEST_AGENT_CLIENT_ID` / `MANUAL_TEST_REVIEW_AGENT_CLIENT_ID`: the respective API
  registration client IDs.
- `MANUAL_TEST_AGENT_SCOPE` / `MANUAL_TEST_REVIEW_AGENT_SCOPE`: exposed delegated scope names,
  normally `Agent.Read`.
- `MANUAL_TEST_AGENT_REVIEW_SCOPE`: exposed Manual Test Agent review scope, normally `Agent.Review`.
- `WPF_SRE_AGENT_URL`, `WPF_SRE_AGENT_CLIENT_ID`, `WPF_SRE_AGENT_SCOPE`: public HTTPS URL and API
  registration settings for wpf-sre-agent; the scope is normally `Agent.Read`.
- `ENTRA_DEVOPS_ROLE` / `ENTRA_TESTER_ROLE`: exact app-role values; defaults are `DevOps` and
  `Tester`. Configure the same values in the dashboard and agent deployments.

Configure `DASHBOARD_ORIGIN` in both agent services to the exact dashboard origin so their CORS
policies allow browser calls. Provide `ENTRA_TENANT_ID` and each service's own app ID as
`ENTRA_API_AUDIENCE` in the corresponding agent deployment.

The dashboard reads the generator's `/api/reviews` feed with `Agent.Read` and the `Tester` app role.
Approve/reject actions
request `Agent.Review` interactively and call `/api/reviews/:key/decision`. Each outcome includes the
Entra user ID, display name/username when present, decision, optional comment, and timestamp. Rejected
cases remain available in the queue for a later decision; approval records the outcome and starts
publishing to the configured Xray cycle. If Xray credentials are unavailable, the approval is retained
with `awaiting_xray_configuration`; approve again after configuring Xray to retry publication.

DevOps role users also see the wpf-sre-agent status and Azure health data retrieved through
Backstage. Configure the agent's Entra app role assignment independently on the wpf-sre-agent API
registration. See [wpf-sre-agent setup](../../agents/wpf-sre-agent/README.md) for Backstage and Teams
configuration.

## LangSmith

Set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, and `LANGSMITH_PROJECT` in
each agent so LangChain traces are sent to the corresponding project. Give the dashboard a read-only
LangSmith API key with access to those projects, the same endpoint, and the project names in
`LANGSMITH_MANUAL_TEST_PROJECT` and `LANGSMITH_REVIEW_AGENT_PROJECT`. The UI requests the latest
root run per project through the LangSmith SDK and reports succeeded, failed, or running. The
dashboard API requires the `Dashboard.Read` token; it never returns trace inputs or outputs.

## AKS

Build the dashboard image from the repository root:

```bash
npm install
npm run build --workspace=@workitem3/langsmith-ui
docker build -f apps/langsmith-ui/Dockerfile -t <ACR_NAME>.azurecr.io/langsmith-ui:1.0.0 .
az acr login -n <ACR_NAME>
docker push <ACR_NAME>.azurecr.io/langsmith-ui:1.0.0
kubectl apply -f apps/langsmith-ui/k8s/deployment.yaml
kubectl -n langsmith-ui create secret generic langsmith-ui-secrets \
  --from-literal=LANGSMITH_API_KEY='<read-only-key>'
```

Set the placeholders/hosts in the ConfigMap and Ingress before deploying. Configure DNS/TLS and add
the resulting HTTPS origin as the Entra SPA redirect URI and each agent's `DASHBOARD_ORIGIN`.
Deploy each agent with its own app registration client ID as `ENTRA_API_AUDIENCE` and the shared
tenant ID. The agent Ingress hosts must match the dashboard URL configuration.

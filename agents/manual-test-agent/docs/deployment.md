# Deployment (Azure AKS)

Nothing here has been deployed from this repository; the Bicep compiles and Helm renders, but real subscriptions, DNS and policies are yours to supply. No resource identifiers are committed.

## Prerequisites

1. Azure subscription, resource group, Entra tenant with an **app registration** for the API: expose scope `Agent.Access`, define app roles `QA.Generator`, `QA.Reviewer`, `QA.Publisher`, `QA.Reader`; the audience is `ENTRA_AUDIENCE`.
2. Azure AI Foundry resource with a Claude Opus deployment (see [model-configuration](model-configuration.md)); tenant/region availability must be confirmed.
3. Network path to the MCP cluster (below) and the MCP tool map.
4. GitHub environments `staging` and `production` (production with **required reviewers**) and an Entra app/federated credential for GitHub OIDC (`azure/login`); no client secrets. Per-environment variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `ACR_NAME`, `AKS_RESOURCE_GROUP`, `AKS_NAME`, `KEY_VAULT_NAME`, `API_CLIENT_ID`, `WORKER_CLIENT_ID`, `MIGRATE_CLIENT_ID`, `ENTRA_AUDIENCE`, `SERVICEBUS_NAMESPACE`, `INGRESS_HOST`, `INGRESS_TLS_SECRET`, `HELM_EXTRA_VALUES_YAML` (non-secret Helm values: `config.PROJECTS_JSON`, `config.MCP_TOOL_MAP_JSON`, `config.MCP_SERVER_URL`, `config.FOUNDRY_*`, `networkPolicy.egress` CIDRs).

## 1. Infrastructure

```bash
export POSTGRES_ADMIN_PASSWORD='<generated>'      # consumed by the .bicepparam files
az deployment group create -g <rg> -f infra/main.bicep -p infra/environments/staging.bicepparam
```

Creates Log Analytics, Application Insights, ACR, Key Vault (RBAC, purge protection), Service Bus (local auth disabled; queue `generation-jobs`, duplicate detection, max delivery 5), PostgreSQL Flexible Server, AKS (OIDC issuer, workload identity, KEDA, Key Vault CSI, web app routing, Cilium network policy), three managed identities with federated credentials and least-privilege role assignments. Review SKUs, private networking and `publicNetworkAccess` for your landing zone; production should use private endpoints.

Replace the admin password in the `agent-database-url` Key Vault secret with Entra authentication when practical.

## 2. Image

```bash
az acr login -n <acr>
docker build -f agents/manual-test-agent/Dockerfile -t <acr>.azurecr.io/manual-test-agent:<tag> .
docker push <acr>.azurecr.io/manual-test-agent:<tag>
```

CI does this on `main`, tagging with the first 12 characters of the commit SHA.

## 3. Helm

```bash
helm upgrade --install mta agents/manual-test-agent/helm/manual-test-agent -n manual-test-agent --create-namespace \
  -f agents/manual-test-agent/helm/manual-test-agent/values-staging.yaml -f my-extra-values.yaml \
  --set image.repository=<acr>.azurecr.io/manual-test-agent --set image.tag=<tag> \
  --set keyVault.name=<kv> --set keyVault.tenantId=<tenant> \
  --set workloadIdentity.api.clientId=<id> --set workloadIdentity.worker.clientId=<id> --set workloadIdentity.migrate.clientId=<id>
```

A pre-install/upgrade hook Job runs migrations. The chart creates per-component ServiceAccounts (Workload ID), SecretProviderClasses (Key Vault CSI), ConfigMap, API Deployment/Service/HPA/PDB/Ingress, worker Deployment/PDB and KEDA ScaledObject, and NetworkPolicies. The container image runs with `NODE_ENV=production`, so startup fails fast if `PROJECTS_JSON`, `MCP_TOOL_MAP_JSON`, Entra settings or Service Bus settings are missing or unsafe: this is intentional.

KEDA must be installed (enabled by the Bicep AKS add-on). The KEDA operator federation in Bicep lets it authenticate to Service Bus as the worker identity.

Validate templates locally: `helm lint . -f values-production.yaml -f ci/values-ci.yaml` (`ci/values-ci.yaml` contains dummy values for CI only).

## Cross-cluster connectivity to the MCP server

The agent cluster and the MCP cluster are separate.

- **Path**: VNet peering (or Private Link / an internal load balancer fronted by Private Link service) between the agent AKS VNet and the MCP cluster's VNet. Do not expose the MCP server on the public internet.
- **Private DNS**: a private DNS zone (e.g. `mcp.internal.<corp>`) linked to both VNets, resolving the MCP hostname to the internal load balancer/Private Endpoint IP.
- **TLS**: HTTPS only (the application rejects non-https MCP URLs in staging/production); certificate from your internal CA or a public CA; ensure the CA is trusted in the image (`NODE_EXTRA_CA_CERTS` via a mounted ConfigMap if needed).
- **Service authentication**: `MCP_AUTH_MODE=entra` (token for `MCP_ENTRA_SCOPE` obtained via Workload ID) or `bearer` (token from Key Vault) matching what the MCP server actually accepts. Verify against the real server.
- **Firewall / NSG / Azure Firewall**: allow egress from the agent AKS subnet only to the MCP private IP:443, Service Bus, Foundry, Key Vault, PostgreSQL, Entra (`login.microsoftonline.com`) and Azure Monitor endpoints. Mirror this in the chart's `networkPolicy.egress` CIDRs (default deny) and on the MCP side (allow only the agent subnet).
- **Restricted egress**: use AKS outbound type `userDefinedRouting` with Azure Firewall for production, FQDN rules for required endpoints.

## Production checklist

Entra app registration and roles; `PROJECTS_JSON` with real group object ids and destinations; MCP tool map verified; Foundry deployment verified; private endpoints and DNS; egress CIDRs filled; Defender for Containers; alert rules from [operations](operations.md); backup/PITR settings on PostgreSQL; GitHub environment protection rules.

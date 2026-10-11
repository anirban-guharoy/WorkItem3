# Deployment

The chart targets an existing AKS cluster. It does not provision Teams/Bot registration, Backstage,
MCP, Foundry, Entra, certificates or private networking.

## Build and deploy

```bash
docker build -f agents/wpf-sre-agent/Dockerfile -t wpf-sre-agent:local .
helm lint agents/wpf-sre-agent/helm/wpf-sre-agent \
  --set image.repository=<acr>.azurecr.io/wpf-sre-agent --set image.tag=<immutable-tag>
helm upgrade --install wpf-sre-agent agents/wpf-sre-agent/helm/wpf-sre-agent \
  -n wpf-sre-agent --create-namespace \
  -f agents/wpf-sre-agent/helm/wpf-sre-agent/values.yaml \
  --set image.repository=<acr>.azurecr.io/wpf-sre-agent --set image.tag=<immutable-tag> \
  --set ingress.host=<sre.example.com> --set secret.name=wpf-sre-agent-secrets
```

Supply Foundry, Backstage, MCP, Bot and Entra sensitive values from Key Vault CSI or an externally
managed Kubernetes Secret. Do not pass secret values on the Helm command line. Set
`WPF_SRE_LEARNING_STORE_PATH=/data/learning.json`, mount persistent storage, and keep `replicas: 1`.

## Cross-cluster MCP

The common MCP server is deployed separately. Connect via VNet peering or Private Link, resolve its
private endpoint with a private DNS zone linked to both VNets, require HTTPS with a trusted
certificate, and authenticate with the configured service token. Allow agent subnet egress only to
MCP:443, Backstage, Foundry, Key Vault, Entra/Bot endpoints and Azure Monitor. Apply matching
NetworkPolicy and firewall rules; do not expose MCP publicly.

## Infrastructure

`infra/main.bicep` provisions an ACR and Application Insights/Log Analytics resources only. It
assumes an organization-managed AKS cluster and network. `.bicepparam` files are non-secret
environment examples and contain no production resource identifiers. ACR public access is enabled
by this baseline; production should use a private endpoint/firewall and a private GitHub runner.
GitHub OIDC uses
environment-specific client/tenant/subscription IDs and environment protection; production must
have required reviewers configured in GitHub.

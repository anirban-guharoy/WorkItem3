# Deployment

Build from the repository root (workspace dependencies are required):

```bash
docker build -f agents/manual-test-review-agent/Dockerfile -t manual-test-review-agent:local .
```

The Helm chart targets an existing AKS cluster and ACR. It does not provision the cluster, Xray,
Entra registration, Key Vault, DNS, or certificates. Configure the `production` GitHub environment
with required reviewers if using automated production deployment. The baseline Bicep keeps ACR
public access enabled; for production, restrict it with a private endpoint/firewall and use a
network-connected deployment runner. It does not provision AKS identities or secret-store access.

1. Provision the artifact registry, private network path to MCP/Xray/Foundry, Entra app registration,
   Key Vault and durable storage.
2. Push the image to ACR and grant the cluster identity pull access.
3. Create a CSI-mounted secret set (or a pre-existing Kubernetes Secret) for Foundry, MCP and Xray
   values. The chart values contain only the Secret name and key mappings.
4. Set `DATA_DIR=/data`, mount the chart PVC, and keep replicas at 1.
5. Configure ingress hostname/TLS and restrict egress in the chart.

```bash
helm lint agents/manual-test-review-agent/helm/manual-test-review-agent \
  --set image.repository=<acr>.azurecr.io/manual-test-review-agent --set image.tag=<immutable-tag>
helm upgrade --install manual-test-review-agent \
  agents/manual-test-review-agent/helm/manual-test-review-agent \
  -n manual-test-review-agent --create-namespace \
  -f agents/manual-test-review-agent/helm/manual-test-review-agent/values.yaml \
  --set image.repository=<acr>.azurecr.io/manual-test-review-agent \
  --set image.tag=<immutable-tag> --set ingress.host=<review.example.com> \
  --set secret.name=manual-test-review-agent-secrets
```

For private connectivity, use VNet peering or Private Link, private DNS, TLS, firewall rules scoped
to required upstream IPs/FQDNs and an allow-list NetworkPolicy. The MCP server runs in its existing
cluster; do not redeploy it from this chart.

`infra/main.bicep` provisions only the agent registry and monitoring resources; use your organization
landing zone for AKS, networking and Key Vault. Environment `.bicepparam` files are examples, not
production resource identifiers.

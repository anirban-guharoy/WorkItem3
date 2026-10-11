# Security

- **REST authentication:** Entra JWT validation checks signature, issuer, audience, tenant,
  expiry, delegated scope and `DevOps` app role. Read/summary/feedback routes require `Agent.Read`;
  restart requires `Agent.Restart`. `/healthz` is unauthenticated for probes.
- **Teams access:** Bot Framework authentication is provided by the Microsoft Agents SDK. Commands
  are restricted to configured team and channel IDs. Restart requires the explicit `confirm` suffix.
- **Backstage boundary:** bearer token is attached by the server-side adapter only. Configured
  paths must remain on the configured origin, redirects are not followed, requests have a timeout,
  responses are bounded to 1 MB, and credential-shaped data is redacted before responses or model
  input.
- **Untrusted data:** Backstage logs, operator feedback, MCP documents and Teams text are data, not
  model instructions. Prompts explicitly distinguish evidence and hypotheses. The model has no
  write-capable tools; only the application can invoke the separately authorized restart path.
- **Secrets:** Foundry, Backstage, MCP and Bot credentials must be injected from a secret provider.
  Never commit them to Helm, ConfigMaps, Docker layers or `k8s/secret.example.yaml`.
- **Network:** use TLS, private DNS/Private Link or VNet peering, and default-deny network policy
  with explicit egress to Backstage, MCP, Foundry, Entra, Bot endpoints and telemetry.
- **Persistence:** JSON feedback contains incident details and user identity. Restrict volume
  access and backups. It is serialized only inside one process; replicas are limited to one.

Threats considered: prompt injection/malicious runbook content, cross-origin request/SSRF through
Backstage route configuration, credential leakage, unauthorized restart, replayed Teams commands,
and feedback poisoning. The restart API's Entra check and Backstage's own authorization remain
mandatory even when invoked from Teams.

# Security

- **Authentication:** Entra bearer middleware validates issuer, signature, audience, tenant, scope
  and app role. `/healthz` is unauthenticated; status and review routes are protected.
- **Review/publish separation:** the LLM only returns a structured assessment. The application
  deterministically blocks Xray publication unless review status is approved, coverage is complete,
  criterion entries are unique, and no critical/major findings remain.
- **Input handling:** request payload is validated by the shared Zod contract before the model is
  invoked. Story and test-case text, including MCP results, are treated as untrusted instructions.
  The model has no write-capable tool access.
- **Secrets:** Foundry, MCP, and Xray credentials are supplied from the environment or a secret
  provider; do not place credentials in Helm values, ConfigMaps, images, or checked-in secret
  examples. Error responses avoid returning provider bodies.
- **State:** the JSON repository stores review payload fingerprints, decisions, and publish progress.
  Mount it on durable storage with restrictive permissions. Single replica only; a shared RWX volume
  does not make the file store concurrency-safe.
- **Network:** terminate TLS at the ingress; restrict egress to Entra, Foundry, MCP, Xray, and
  telemetry endpoints required by the deployment. Use a private MCP endpoint where available.

## Threats and mitigations

| Threat                                                    | Mitigation                                                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection in a story, test case, or retrieved page | Explicit untrusted-data system instructions; no model write tools; deterministic quality gate remains authoritative.                               |
| Forged review/publish request                             | Entra scope and app-role authorization at the endpoint.                                                                                            |
| Approval without real criterion coverage                  | Application gate requires criterion-level `covered` status and rejects duplicates, partial/missing coverage, and major/critical findings.          |
| Duplicate Xray cases on retry                             | Stable request fingerprint and persisted Xray progress; external idempotency semantics must still be verified with the configured Xray operations. |
| Cross-tenant or wrong-audience token                      | Entra middleware checks issuer, audience, tenant and signature.                                                                                    |
| Secret exposure through logs                              | Avoid raw upstream response bodies; configure redaction in the deployment logging pipeline.                                                        |

Production prerequisites: configure exact Entra app scopes/roles, a least-privilege Xray account,
MCP access and tool permissions, durable volume, TLS ingress and one-replica scheduling.

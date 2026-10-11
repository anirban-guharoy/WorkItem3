# Security

## Authentication and authorization

- Entra ID JWT validation (`jose`, remote JWKS): signature, issuer, audience, tenant (`tid`), expiry, and required scope `Agent.Access` or app role. Roles: `QA.Generator`, `QA.Reviewer`, `QA.Publisher`, `QA.Reader`.
- Project authorization = role AND project membership from `PROJECTS_JSON` (Entra user or group object ids, plus destination configuration). Non-members get 404 on a job lookup and 403 on submit. Entra group overage (>200 groups) is not resolved via Graph; members should be listed as user ids or the app should use app roles/group claims limited to the application.
- `REQUIRE_DISTINCT_REVIEWER=true` prevents self-approval.
- Dev authentication (`x-dev-principal`), mock MCP, fake model, in-memory queue/checkpointer, PGlite, connection-string Service Bus auth, wildcard project membership and non-HTTPS MCP URLs are **rejected at startup** in staging/production (and whenever `NODE_ENV=production`).

## MCP identity

User tokens are **not** propagated through MCP to JIRA. The agent calls MCP as a backend service identity, so the application itself enforces project authorization before any read and before any write, and records the requesting/approving user in audit events. If the MCP server later supports delegated identity, switch deliberately; this is a documented assumption.

## Separate identities

Three user-assigned managed identities with federated credentials (Workload ID): `api` (Service Bus send), `worker` (send/receive, optional Foundry access), `migrate` (database migration). Key Vault Secrets User and ACR pull per need. See `infra/main.bicep`.

## Threat model

| Threat                                                         | Mitigation                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection via JIRA/Confluence/Figma content             | Retrieved text is wrapped as untrusted data in a delimited block; system prompt forbids following embedded instructions; heuristic injection detection flags content and records an audit event; model has no tools; output must pass strict Zod validation and source-reference checks; the draft cannot self-approve. |
| Malicious retrieved content (oversized, control chars, markup) | Sanitization (control characters, length bounds), excerpt limits, no full-document storage.                                                                                                                                                                                                                             |
| Cross-project data leakage                                     | Authorization before retrieval; context searches are scoped to the story's project; results from other projects are filtered; per-project reads in API are filtered by membership.                                                                                                                                      |
| Unauthorized publishing                                        | Role + membership + approval + destination checks in API **and** worker; writes gated by `MCP_ALLOW_WRITES` and tool allowlist; the model cannot reach write tools.                                                                                                                                                     |
| Forged approval                                                | Approvals are rows created only by the authenticated review endpoint; the approver identity comes from the validated token; publish checks approval id, draft hash and revocation state; audit events are append-only (trigger).                                                                                        |
| Replay                                                         | `decisionId` is unique per review; idempotent submission; publication uniqueness (job, approval, draft hash); external write idempotency keys; stale `draftVersion` yields 409; Entra tokens expire.                                                                                                                    |
| Stale approval after story change                              | Source story hash is checked at publish time.                                                                                                                                                                                                                                                                           |
| Secret leakage                                                 | Redaction of authorization headers/keys in logs, no chain-of-thought stored or logged, secrets only from Key Vault CSI, none in values or images.                                                                                                                                                                       |
| Network exfiltration                                           | NetworkPolicy default-deny with explicit egress CIDRs; private endpoints recommended for PostgreSQL, Key Vault, Service Bus, Foundry.                                                                                                                                                                                   |

## Container and supply chain

Non-root (uid 10001), read-only root filesystem, all capabilities dropped, RuntimeDefault seccomp, no service account token automount where unneeded. CI runs `npm audit` and Trivy on the image; use ACR with Defender for Containers in production.

## Known gaps

Rate limiting is per-process memory (use an ingress/WAF or Redis-backed limiter for strict global limits). PostgreSQL password in the Bicep-generated Key Vault secret should be replaced by Entra authentication. The worker relies on the API for the publisher-role check (persisted in `requested_by`).

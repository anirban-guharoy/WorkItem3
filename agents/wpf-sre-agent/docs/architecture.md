# Architecture

```text
Entra-authenticated operator ── Express API (src/api) ──┬─ Backstage REST API
                                                        ├─ SRE summary graph (src/graph)
                                                        │    ├─ common-mcp-server (read context)
                                                        │    ├─ Azure AI Foundry
                                                        │    └─ operator-confirmed feedback store
                                                        └─ Teams adapter (Microsoft Agents SDK)
```

Backstage is the sole Azure/AKS integration; the agent has no Kubernetes API credentials. Read
routes fetch health, pods and activity. The graph retrieves relevant MCP context and verified
operator feedback, then summarizes the Backstage activity as primary evidence. Restart is a
separate, role/scope-protected operation with explicit `confirm` in Teams commands and delegates
the actual action to a configured Backstage route.

The application remains a synchronous API/Teams service with a local JSON learning repository.
There is no worker, queue or SQL database. The current learning store is single-replica only; use a
database before scaling horizontally.

Source areas: `api` (REST and Teams adapter), `auth` (Entra adapter), `config`, `graph`, `mcp`,
`models`, `prompts`, `repositories` (learning feedback), `services` (Backstage client),
`security`, `observability`, `shared`, and `worker` (documents why no worker exists).

# Architecture

The reviewer is an independently deployable synchronous service:

```text
Entra-authenticated client
  └─ Express API (src/api)
      ├─ Review schema (shared test-case contract)
      ├─ LangChain review workflow (src/graph) ── MCP context research
      ├─ deterministic coverage/quality gate (src/services)
      ├─ JSON idempotency/recovery repository (src/repositories)
      └─ Xray Cloud publish adapter (shared workspace package)
```

`POST /review` validates the story and submitted test cases, fingerprints the request, runs
independent QA review with structured output, then applies the deterministic quality gate. A failed
gate returns `changes_requested` and does not call Xray. An approved review is published only when
Xray credentials are configured. Review and publish progress is saved before/after external effects;
Xray progress is saved as IDs are returned so a retry can resume rather than recreate completed
cases.

There is intentionally no worker, queue, graph checkpoint database, or SQL schema: requests are
synchronous and review state is file-backed. Use one replica with a durable volume. The filesystem
store is not a distributed lock and must not be shared across horizontally scaled writers.

## Source layout

- `api/`: Express app and process entry point.
- `auth/`: shared Entra bearer middleware boundary.
- `config/`: environment and model configuration.
- `graph/`, `prompts/`, `mcp/`, `models/`: model-guided review and evidence retrieval.
- `services/`: deterministic review gate.
- `repositories/`: idempotency and publication progress state.
- `security/`, `observability/`, `shared/`: shared security/error boundaries (observability is
  currently console-based; OpenTelemetry export remains a production enhancement).
- `tests/{unit,integration,e2e,fixtures}/`: contract/gate tests, file-store test, HTTP fixtures.

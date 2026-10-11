# Model and MCP configuration

## Azure AI Foundry (Claude Opus)

Settings: `MODEL_PROVIDER=foundry`, `FOUNDRY_ENDPOINT`, `FOUNDRY_DEPLOYMENT`, `FOUNDRY_API_VERSION` (sent as the `anthropic-version` header, default `2023-06-01`), `FOUNDRY_AUTH_MODE` (`entra` default or `api-key`), `FOUNDRY_ENTRA_SCOPE` (default `https://cognitiveservices.azure.com/.default`), `FOUNDRY_API_KEY` (only for `api-key`; keep in Key Vault), `MODEL_TIMEOUT_MS`, `MODEL_MAX_RETRIES`. No endpoints or deployment names are hardcoded.

The adapter (`src/models/foundry.ts`) assumes the Anthropic Messages API surface `POST {endpoint}/v1/messages` with `model = FOUNDRY_DEPLOYMENT`. It does **not** rely on constrained structured output: the model is asked for JSON, which is parsed and validated with Zod; one repair round is attempted on invalid output, then the job fails with `model_output_invalid`. 429/5xx responses are retried with bounded backoff, and response bodies are never echoed to logs.

**Verification checklist (not verified here; no Azure access was available):**

1. Confirm Claude Opus availability in your region/tenant and the exact deployment name.
2. Confirm the endpoint path (`/v1/messages` vs an `/anthropic/...` base) and set `FOUNDRY_ENDPOINT` accordingly.
3. Confirm Entra token auth (scope and role such as Cognitive Services User) is supported for the deployment; otherwise use `api-key` from Key Vault.
4. Confirm the `anthropic-version` value your deployment accepts.
5. Confirm usage fields (`usage.input_tokens/output_tokens`) in responses; cost estimates use `MODEL_PRICE_INPUT_PER_MTOK` and `MODEL_PRICE_OUTPUT_PER_MTOK` if set, otherwise are omitted.

Model and prompt versions (`src/prompts`) are stored with each result. Use `MODEL_PROVIDER=fake` for local and tests.

## Remote MCP server

Settings: `MCP_ADAPTER=remote`, `MCP_SERVER_URL` (https), `MCP_AUTH_MODE` (`none|bearer|entra`), `MCP_BEARER_TOKEN` or `MCP_ENTRA_SCOPE`, `MCP_TIMEOUT_MS`, `MCP_MAX_RETRIES`, `MCP_ALLOW_WRITES` (default false; needed for publishing), `JIRA_ACCEPTANCE_CRITERIA_FIELD` (custom field id if acceptance criteria live in one).

Transport: MCP Streamable HTTP via `@modelcontextprotocol/sdk`. Confirm the server supports it; SSE-only servers need a transport change.

### Discover the real tools

Call `tools/list` against the server (e.g. with the MCP Inspector) and map the 7 logical operations in `MCP_TOOL_MAP_JSON`. All 7 are required; the worker checks configured tool names exist on the server at connect time. Only mapped tools can be called.

```json
{
  "getJiraIssue": { "tool": "<server tool>", "args": { "issueKey": "{{issueKey}}" } },
  "getLinkedIssues": { "tool": "<server tool>", "args": { "issueKey": "{{issueKey}}" } },
  "searchConfluence": {
    "tool": "<server tool>",
    "args": { "query": "{{query}}", "spaces": "{{spaceList}}", "limit": "{{limit}}" }
  },
  "getConfluencePage": { "tool": "<server tool>", "args": { "pageId": "{{pageId}}" } },
  "getFigmaDesign": { "tool": "<server tool>", "args": { "fileKey": "{{fileKey}}" } },
  "searchExistingTestCases": {
    "tool": "<server tool>",
    "args": { "issueKey": "{{issueKey}}", "text": "{{text}}", "marker": "{{marker}}" }
  },
  "createTestCases": {
    "tool": "<server tool>",
    "args": {
      "destination": "{{destination}}",
      "issueKey": "{{issueKey}}",
      "idempotencyKey": "{{idempotencyKey}}",
      "testCases": "{{testCases}}"
    }
  }
}
```

Placeholders available per operation: `issueKey`, `query`, `spaces`, `spaceList`, `limit`, `pageId`, `fileKey`, `text`, `marker`, `destination`, `idempotencyKey`, `testCases`, plus `correlationId` everywhere. A value that is exactly one placeholder keeps its type.

### Response shapes

The client uses `structuredContent` if present, otherwise JSON from text content. Mapping into the application's types is done in `src/mcp/normalize.ts`, which is tolerant of common field names. **Adjust the normalizers to the real server's payloads** and add a fixture test; they were written without access to the real server.

### Identity and idempotency

MCP calls run as the agent's service identity, not the end user (see [security](security.md)). The write path passes `idempotencyKey` (`<publicationId>:<testCaseId>`); confirm the server's create tool honours it or searches by the marker, otherwise duplicate creation is possible after a crash between the write and the database commit.

## Project configuration

`PROJECTS_JSON` example:

```json
{
  "PROJ": {
    "members": ["<entra-group-object-id>"],
    "confluenceSpaces": ["PROJ"],
    "figmaFileKeys": [],
    "publishDestination": "<test-management-project>"
  }
}
```

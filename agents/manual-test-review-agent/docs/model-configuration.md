# Model and integration configuration

The reviewer loads the model name and sampling limits from `config/models.json` (override with
`MODEL_CONFIG_FILE`). Set `AZURE_FOUNDRY_ENDPOINT` and `AZURE_FOUNDRY_API_KEY` for the Anthropic
Messages-compatible Azure AI Foundry endpoint used by `@workitem3/langchain-runtime`. The review is
requested with LangChain structured output and validated by the shared `TestCaseReview` schema.
Confirm the endpoint path, deployment/model identifier, region availability and key rotation process
against the Azure AI Foundry resource before production use.

`MCP_SERVER_URL` and optional `MCP_SERVER_TOKEN` configure common-mcp-server. The runtime discovers
tools and uses them for read-only evidence gathering. No write tool is supplied to the model.
Confirm actual transport, authentication, tool names and response shapes against the deployed MCP
server.

Xray publication uses the shared `@workitem3/xray-cloud` adapter. Configure
`XRAY_BASE_URL`, `XRAY_CLIENT_ID`, `XRAY_CLIENT_SECRET` and `XRAY_TEST_CYCLE_NAME`. Verify the
configured identity's least-privilege permissions and test idempotent retry behavior in a
non-production Xray project.

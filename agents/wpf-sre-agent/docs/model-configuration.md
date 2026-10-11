# Model and integration configuration

## Azure AI Foundry

`config/models.json` selects the model, temperature and output token limit; `MODEL_CONFIG_FILE` can
override its path. Set `AZURE_FOUNDRY_ENDPOINT` and `AZURE_FOUNDRY_API_KEY`. The shared runtime uses
the Anthropic-compatible LangChain adapter. Confirm that your Foundry resource exposes the required
Anthropic Messages surface, that the deployment identifier is correct, and that region/model
availability and API versions match before enabling production traffic.

## common-mcp-server

Set `MCP_SERVER_URL` (Streamable HTTP) and optional `MCP_SERVER_TOKEN`. The MCP runtime discovers
available tools for read-only research. Confirm server transport, service authentication and actual
tool response schemas. No MCP write tool is used by the SRE graph.

## Backstage

Configure `BACKSTAGE_BASE_URL`, `BACKSTAGE_API_TOKEN`, and the health, pods, activity and restart
paths. Activity/restart paths may use `{namespace}` and `{pod}`; values are URL-encoded and paths
must stay on the configured origin. Configure the restart method (`POST` or `PUT`) and a JSON body
template. Use an API token with read access and only the narrowly scoped restart action permission.

## Microsoft Teams

Set `MICROSOFT_APP_ID`, `MICROSOFT_APP_PASSWORD`, `WPF_DEVOPS_TEAM_IDS` and
`WPF_DEVOPS_CHANNEL_IDS`. Both team and channel allowlists are mandatory. Restrict app credentials
and verify the messaging endpoint with the registered bot.

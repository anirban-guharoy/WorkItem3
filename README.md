# Manual Tester (LangChain agent, Node.js)

A JIRA webhook triggers the agent, which reads the story's description and acceptance criteria,
gathers context from Confluence and SharePoint via remote MCP servers, and produces structured manual
test cases. Results are shown on a web page for human approval/rejection.

## Setup
```bash
npm install
cp .env.example .env   # fill in values
npm start
```

## JIRA webhook
JIRA → Settings → System → WebHooks: URL `https://<host>/webhook/jira?secret=<WEBHOOK_SECRET>`,
events: Issue created/updated (optionally JQL `issuetype = Story AND labels = generate-tests`
to control when it fires). Non-Story issues are ignored. For local testing expose the port with a tunnel.

## Review
Open `/reviews` (or the link the agent comments on the JIRA issue). Approve, reject, or regenerate.
Results are stored in `./data`. Protect the review UI behind your SSO/reverse proxy in production.

## MCP
`MCP_SERVERS` is a JSON map of remote servers (streamable HTTP, e.g. `{"transport":"http","url":...,"headers":{...}}`).
All tools from every server are given to the agent.

## Test without JIRA
```bash
curl -X POST "localhost:3000/webhook/jira?secret=change-me" -H 'content-type: application/json' -d '{"issue":{"key":"DEMO-1","fields":{"summary":"Login","issuetype":{"name":"Story"},"description":"As a user I want to log in.\n\nAcceptance Criteria\n- Valid credentials sign in\n- 5 failed attempts lock the account"}}}'
```

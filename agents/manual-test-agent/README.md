# Manual Test Agent

Supervised AI agent that turns a JIRA story into **draft** manual test cases, checks acceptance-criteria coverage and duplicates, and publishes only after an authorized human approves. Node 22, TypeScript (strict), Fastify, LangGraph.js, MCP TypeScript SDK, Zod, PostgreSQL, Azure Service Bus, Entra ID, Claude Opus on Azure AI Foundry.

- API (`src/api`) validates the request, authorizes the user per project, stores the job and enqueues a versioned message.
- Worker (`src/worker`) consumes messages and runs the 14-node LangGraph workflow (`src/graph`).
- Drafts stay drafts. Review, approval and publication are separate, audited, application-enforced steps; the model never calls privileged tools.

Docs: [architecture](docs/architecture.md), [security](docs/security.md), [operations](docs/operations.md), [runbook](docs/runbook.md), [deployment](docs/deployment.md), [model & MCP configuration](docs/model-configuration.md).

## Run locally (no Azure, no Docker needed)

Local mode runs API and worker in one process with an embedded PGlite database, a mock MCP adapter, a fake model and an in-memory queue.

```bash
npm install                     # from the repo root
cd agents/manual-test-agent
npm run dev:local               # http://127.0.0.1:3000 (override with PORT)
```

```bash
P='x-dev-principal: {"id":"alice","roles":["QA.Generator","QA.Reviewer","QA.Publisher"]}'
R='x-dev-principal: {"id":"bob","roles":["QA.Generator","QA.Reviewer","QA.Publisher"]}'
curl -s -XPOST localhost:3000/api/v1/generations -H "$P" -H 'content-type: application/json' -d '{"issueKey":"PROJ-101"}'
curl -s localhost:3000/api/v1/generations/<jobId> -H "$P"
curl -s localhost:3000/api/v1/generations/<jobId>/test-cases -H "$P"
curl -s localhost:3000/api/v1/generations/<jobId>/coverage -H "$P"
curl -s -XPOST localhost:3000/api/v1/generations/<jobId>/review -H "$R" -H 'content-type: application/json' \
  -d '{"decisionId":"<new-uuid>","action":"approve","draftVersion":1}'
curl -s -XPOST localhost:3000/api/v1/generations/<jobId>/publish -H "$R" -H 'content-type: application/json' -d '{"draftVersion":1}'
```

Mock stories: `PROJ-101` (full flow), `PROJ-102` (missing acceptance criteria → `needs_clarification`), `PROJ-103` (prompt-injection content), `OTHER-5` (other project). By default the reviewer must differ from the requester (`REQUIRE_DISTINCT_REVIEWER`).

### Against real PostgreSQL

```bash
docker compose up -d postgres
cp .env.example .env            # DATABASE_URL points at the compose database
npm run migrate                 # applies migrations/*.sql
```

Set `CHECKPOINTER=postgres` to use the PostgreSQL LangGraph checkpointer. Run `npm run dev:api` and `npm run dev:worker` as separate processes (see `package.json`).

## Test and quality commands

```bash
npm run check        # typecheck + eslint + prettier
npm test             # unit, integration (PGlite) and e2e (mock MCP + fake model)
npm run build
```

No production credentials are required.

## Layout

`src/{api,auth,config,graph,graph/nodes,mcp,models,prompts,schemas,services,repositories,messaging,database,observability,security,shared,worker,local}`, `migrations/`, `helm/manual-test-agent/`, `infra/` (Bicep), `tests/{unit,integration,e2e,fixtures}`. CI/CD is in the repo root `.github/workflows/manual-test-agent-*.yml`.

## Docker

```bash
docker build -f agents/manual-test-agent/Dockerfile -t manual-test-agent:local .   # from the repo root
```

The image sets `NODE_ENV=production`, so it refuses dev auth, mock adapters, in-memory queue and wildcard project membership. It does not include PGlite, so local mode runs outside the image. The worker uses `node dist/worker/main.js`.

import { startServer } from "@microsoft/agents-hosting-express";
import { app, handleTeamsCommand } from "./app.js";
import { createTeamsAgent } from "./teams-adapter.js";
import { config, validateConfig } from "../config/index.js";
import { AGENT_NAME } from "../graph/summary.js";
import { logError } from "../observability/logger.js";

if (process.env.NODE_ENV !== "test") {
  validateConfig();
  const authConfig = {
    clientId: config.teams.appId,
    clientSecret: config.teams.appPassword,
    tenantId: config.auth.tenantId,
  };
  const agent = createTeamsAgent(handleTeamsCommand, {
    teams: config.teams,
    authConfig,
    onError: (error) => logError("teams.command", error),
  });
  startServer(agent, {
    port: config.port,
    routePath: "/api/teams/messages",
    authConfig,
    beforeListen: (server) => {
      server.use(app);
    },
  });
  console.log(`${AGENT_NAME} listening on port ${config.port}`);
}

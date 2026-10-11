import { app } from "./app.js";
import { config } from "../config/index.js";
import { AGENT_NAME } from "../graph/review.js";

const server = app.listen(config.port, () => {
  console.log(`${AGENT_NAME} listening on port ${config.port}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) {
        console.error("HTTP server shutdown failed", error);
        process.exitCode = 1;
      }
    });
  });
}

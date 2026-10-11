# Build context MUST be the repository root (shared npm workspace lockfile):
#   docker build -f agents/manual-test-agent/Dockerfile -t manual-test-agent:local .
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/agent-common/package.json packages/agent-common/package.json
COPY packages/agent-common/src packages/agent-common/src
COPY agents/manual-test-agent/package.json agents/manual-test-agent/
# Other workspaces are not part of this image; npm ci only needs the selected workspace manifest.
RUN npm ci --workspace=@workitem3/manual-test-agent --include-workspace-root=false --ignore-scripts
COPY agents/manual-test-agent/tsconfig.json agents/manual-test-agent/tsconfig.build.json agents/manual-test-agent/
COPY agents/manual-test-agent/src agents/manual-test-agent/src
RUN npm run build --workspace=@workitem3/manual-test-agent

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/agent-common/package.json packages/agent-common/package.json
COPY packages/agent-common/src packages/agent-common/src
COPY agents/manual-test-agent/package.json agents/manual-test-agent/
RUN npm ci --workspace=@workitem3/manual-test-agent --include-workspace-root=false --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/agents/manual-test-agent/dist ./agents/manual-test-agent/dist
COPY --from=build --chown=node:node /repo/packages/agent-common ./packages/agent-common
COPY --chown=node:node agents/manual-test-agent/migrations ./agents/manual-test-agent/migrations
COPY --chown=node:node agents/manual-test-agent/package.json ./agents/manual-test-agent/package.json
WORKDIR /app/agents/manual-test-agent
USER 10001:10001
EXPOSE 3000 8080
# Default command is the API; the worker deployment overrides it with: node dist/worker/main.js
CMD ["node", "dist/api/main.js"]

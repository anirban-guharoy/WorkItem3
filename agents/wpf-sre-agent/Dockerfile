FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/langsmith-ui/package.json apps/langsmith-ui/package.json
COPY agents/manual-test-agent/package.json agents/manual-test-agent/package.json
COPY agents/manual-test-review-agent/package.json agents/manual-test-review-agent/package.json
COPY agents/wpf-sre-agent/package.json agents/wpf-sre-agent/package.json
COPY packages/langchain-runtime/package.json packages/langchain-runtime/package.json
COPY packages/test-case-contract/package.json packages/test-case-contract/package.json
COPY packages/xray-cloud/package.json packages/xray-cloud/package.json
COPY packages/entra-auth/package.json packages/entra-auth/package.json
RUN npm ci --omit=dev --workspace=@workitem3/wpf-sre-agent --workspace=@workitem3/langchain-runtime --workspace=@workitem3/entra-auth --include-workspace-root=false

FROM node:22-alpine
ENV NODE_ENV=production PORT=3002
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/langsmith-ui/package.json apps/langsmith-ui/package.json
COPY agents/manual-test-agent/package.json agents/manual-test-agent/package.json
COPY agents/manual-test-review-agent/package.json agents/manual-test-review-agent/package.json
COPY agents/wpf-sre-agent/package.json agents/wpf-sre-agent/package.json
COPY agents/wpf-sre-agent/src agents/wpf-sre-agent/src
COPY agents/wpf-sre-agent/config agents/wpf-sre-agent/config
COPY packages/langchain-runtime/package.json packages/langchain-runtime/package.json
COPY packages/langchain-runtime/src packages/langchain-runtime/src
COPY packages/entra-auth/package.json packages/entra-auth/package.json
COPY packages/entra-auth/src packages/entra-auth/src
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3002/healthz || exit 1
CMD ["node", "agents/wpf-sre-agent/src/server.js"]

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/langsmith-ui/package.json apps/langsmith-ui/package.json
COPY agents/manual-test-agent/package.json agents/manual-test-agent/package.json
COPY agents/manual-test-review-agent/package.json agents/manual-test-review-agent/package.json
COPY packages/langchain-runtime/package.json packages/langchain-runtime/package.json
COPY packages/test-case-contract/package.json packages/test-case-contract/package.json
COPY packages/xray-cloud/package.json packages/xray-cloud/package.json
COPY packages/entra-auth/package.json packages/entra-auth/package.json
RUN npm ci --omit=dev --workspace=@workitem3/manual-test-review-agent --workspace=@workitem3/langchain-runtime --workspace=@workitem3/test-case-contract --workspace=@workitem3/xray-cloud --workspace=@workitem3/entra-auth --include-workspace-root=false

FROM node:22-alpine
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/langsmith-ui/package.json apps/langsmith-ui/package.json
COPY agents/manual-test-review-agent/package.json agents/manual-test-review-agent/package.json
COPY agents/manual-test-review-agent/src agents/manual-test-review-agent/src
COPY agents/manual-test-review-agent/config agents/manual-test-review-agent/config
COPY packages/langchain-runtime/package.json packages/langchain-runtime/package.json
COPY packages/langchain-runtime/src packages/langchain-runtime/src
COPY packages/test-case-contract/package.json packages/test-case-contract/package.json
COPY packages/test-case-contract/src packages/test-case-contract/src
COPY packages/xray-cloud/package.json packages/xray-cloud/package.json
COPY packages/xray-cloud/src packages/xray-cloud/src
COPY packages/entra-auth/package.json packages/entra-auth/package.json
COPY packages/entra-auth/src packages/entra-auth/src
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3001/healthz || exit 1
CMD ["node", "agents/manual-test-review-agent/src/server.js"]

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
RUN npm ci --omit=dev --workspace=@workitem3/manual-test-agent --workspace=@workitem3/langchain-runtime --workspace=@workitem3/test-case-contract --workspace=@workitem3/xray-cloud --workspace=@workitem3/entra-auth --include-workspace-root=false

FROM node:22-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/langsmith-ui/package.json apps/langsmith-ui/package.json
COPY agents/manual-test-agent/package.json agents/manual-test-agent/package.json
COPY agents/manual-test-agent/src agents/manual-test-agent/src
COPY agents/manual-test-agent/config agents/manual-test-agent/config
COPY packages/langchain-runtime/package.json packages/langchain-runtime/package.json
COPY packages/langchain-runtime/src packages/langchain-runtime/src
COPY packages/test-case-contract/package.json packages/test-case-contract/package.json
COPY packages/test-case-contract/src packages/test-case-contract/src
COPY packages/xray-cloud/package.json packages/xray-cloud/package.json
COPY packages/xray-cloud/src packages/xray-cloud/src
COPY packages/entra-auth/package.json packages/entra-auth/package.json
COPY packages/entra-auth/src packages/entra-auth/src
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "agents/manual-test-agent/src/server.js"]

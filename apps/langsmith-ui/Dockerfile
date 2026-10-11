FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/langsmith-ui/package.json apps/langsmith-ui/package.json
COPY agents/manual-test-agent/package.json agents/manual-test-agent/package.json
COPY agents/manual-test-review-agent/package.json agents/manual-test-review-agent/package.json
COPY packages/entra-auth/package.json packages/entra-auth/package.json
COPY packages/langchain-runtime/package.json packages/langchain-runtime/package.json
COPY packages/test-case-contract/package.json packages/test-case-contract/package.json
COPY packages/xray-cloud/package.json packages/xray-cloud/package.json
RUN npm ci --workspace=@workitem3/langsmith-ui --include-workspace-root=false
COPY apps/langsmith-ui apps/langsmith-ui
RUN npm run build --workspace=@workitem3/langsmith-ui

FROM node:22-alpine AS production
WORKDIR /app
COPY package*.json ./
COPY apps/langsmith-ui/package.json apps/langsmith-ui/package.json
COPY agents/manual-test-agent/package.json agents/manual-test-agent/package.json
COPY agents/manual-test-review-agent/package.json agents/manual-test-review-agent/package.json
COPY packages/entra-auth/package.json packages/entra-auth/package.json
COPY packages/langchain-runtime/package.json packages/langchain-runtime/package.json
COPY packages/test-case-contract/package.json packages/test-case-contract/package.json
COPY packages/xray-cloud/package.json packages/xray-cloud/package.json
RUN npm ci --omit=dev --workspace=@workitem3/langsmith-ui --workspace=@workitem3/entra-auth --include-workspace-root=false
COPY apps/langsmith-ui/src apps/langsmith-ui/src
COPY --from=build /app/apps/langsmith-ui/public apps/langsmith-ui/public
COPY packages/entra-auth/src packages/entra-auth/src
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "apps/langsmith-ui/src/server.js"]

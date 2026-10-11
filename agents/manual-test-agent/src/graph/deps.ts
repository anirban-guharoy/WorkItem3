import type { Logger } from 'pino';
import type { ProjectAuthorizer } from '../auth/authorizer.js';
import type { AppConfig } from '../config/index.js';
import type { Db } from '../database/db.js';
import type { McpCallContext, McpReadGateway, McpWriteGateway } from '../mcp/types.js';
import type { TestGenerationModel } from '../models/types.js';
import { repositoriesFor, type Repositories } from '../repositories/index.js';
import type { GraphState } from './state.js';

export interface GraphDeps {
  db: Db;
  read: McpReadGateway;
  /** Absent when publishing is not configured; the publish node then refuses to run. */
  write: McpWriteGateway | undefined;
  model: TestGenerationModel;
  authorizer: ProjectAuthorizer;
  config: AppConfig;
  log: Logger;
  workerId: string;
}

export const reposOf = (deps: GraphDeps): Repositories => repositoriesFor(deps.db);

export const mcpContext = (state: GraphState): McpCallContext => ({
  correlationId: state.correlationId ?? 'unknown',
  jobId: state.jobId,
  projectKey: state.projectKey ?? 'unknown',
});

export async function audit(
  deps: GraphDeps,
  state: GraphState,
  eventType: string,
  details: Record<string, unknown> = {},
  actor = 'worker',
): Promise<void> {
  await reposOf(deps).audit.append({
    jobId: state.jobId,
    eventType,
    actor,
    correlationId: state.correlationId ?? null,
    details: { attempt: state.attempt, ...details },
  });
}

export const requireField = <T>(value: T | undefined, name: string): T => {
  if (value === undefined) throw new Error(`Workflow state is missing "${name}"`);
  return value;
};

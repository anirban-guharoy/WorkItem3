import type { Principal } from './principal.js';
import type { ProjectConfig } from '../config/index.js';

export type Action = 'generate' | 'view' | 'review' | 'publish' | 'cancel';

export interface RoleNames {
  generator: string;
  reviewer: string;
  publisher: string;
  reader: string;
}

/**
 * Project-level authorization = (global app role for the action) AND (project membership).
 * Entra does not know about JIRA projects, so membership is configured (PROJECTS_JSON) by
 * Entra object id of users or groups. This is enforced by the application; it is independent of
 * whatever identity the MCP server uses towards JIRA.
 */
export class ProjectAuthorizer {
  constructor(
    private readonly projects: ProjectConfig,
    private readonly roles: RoleNames,
  ) {}

  isMember(principal: Principal, projectKey: string): boolean {
    const project = this.projects[projectKey] ?? this.projects['*'];
    if (!project) return false;
    return project.members.some((m) => m === '*' || m === principal.id || principal.groups.includes(m));
  }

  hasRole(principal: Principal, action: Action): boolean {
    const has = (r: string) => principal.roles.includes(r);
    switch (action) {
      case 'generate':
        return has(this.roles.generator);
      case 'review':
        return has(this.roles.reviewer);
      case 'publish':
        return has(this.roles.publisher);
      case 'cancel':
        return has(this.roles.generator) || has(this.roles.reviewer);
      case 'view':
        return [this.roles.reader, this.roles.generator, this.roles.reviewer, this.roles.publisher].some(has);
    }
  }

  can(principal: Principal, projectKey: string, action: Action): boolean {
    return this.hasRole(principal, action) && this.isMember(principal, projectKey);
  }

  projectConfig(projectKey: string) {
    return this.projects[projectKey] ?? this.projects['*'];
  }

  knownProjects(): string[] {
    return Object.keys(this.projects);
  }
}

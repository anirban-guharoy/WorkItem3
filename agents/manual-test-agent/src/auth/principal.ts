export interface Principal {
  id: string;
  tenantId: string;
  displayName: string;
  roles: string[];
  scopes: string[];
  groups: string[];
}

/** Compact, non-secret snapshot persisted with a job so the worker can re-check authorization. */
export const snapshotOf = (p: Principal): string[] => [p.id, ...p.groups, ...p.roles.map((r) => `role:${r}`)];

export function principalFromSnapshot(id: string, snapshot: string[]): Principal {
  return {
    id,
    tenantId: 'snapshot',
    displayName: id,
    roles: snapshot.filter((s) => s.startsWith('role:')).map((s) => s.slice(5)),
    scopes: [],
    groups: snapshot.filter((s) => !s.startsWith('role:') && s !== id),
  };
}

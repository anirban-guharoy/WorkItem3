import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Principal } from './principal.js';
import { unauthenticated, forbidden } from '../shared/errors.js';

export interface EntraOptions {
  tenantId: string;
  audience: string;
  requiredScope: string;
  /** Test seam; production resolves signing keys from the tenant's JWKS endpoint. */
  keyResolver?: JWTVerifyGetKey;
}

export type Authenticator = (headers: Record<string, string | string[] | undefined>) => Promise<Principal>;

export function createEntraAuthenticator(opts: EntraOptions): Authenticator {
  const keys =
    opts.keyResolver ??
    createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${opts.tenantId}/discovery/v2.0/keys`), {
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });
  const issuer = `https://login.microsoftonline.com/${opts.tenantId}/v2.0`;

  return async (headers) => {
    const raw = headers['authorization'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const match = header ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header) : null;
    if (!match?.[1]) throw unauthenticated('Bearer token required');

    let payload;
    try {
      ({ payload } = await jwtVerify(match[1], keys, {
        issuer,
        audience: opts.audience,
        algorithms: ['RS256'],
        clockTolerance: 30,
        requiredClaims: ['exp', 'iss', 'aud', 'tid'],
      }));
    } catch (err) {
      if (err instanceof errors.JOSEError) throw unauthenticated('Invalid or expired token');
      throw unauthenticated('Token validation failed');
    }
    if (payload.tid !== opts.tenantId) throw unauthenticated('Token tenant is not allowed');

    const scopes = typeof payload['scp'] === 'string' ? payload['scp'].split(' ') : [];
    const roles = Array.isArray(payload['roles'])
      ? payload['roles'].filter((r): r is string => typeof r === 'string')
      : [];
    if (!scopes.includes(opts.requiredScope) && !roles.includes(opts.requiredScope)) {
      throw forbidden(`Required scope or role: ${opts.requiredScope}`);
    }
    const id = typeof payload['oid'] === 'string' ? payload['oid'] : payload.sub;
    if (!id) throw unauthenticated('Token has no subject');
    const groups = Array.isArray(payload['groups'])
      ? payload['groups'].filter((g): g is string => typeof g === 'string')
      : [];
    return {
      id,
      tenantId: opts.tenantId,
      displayName: typeof payload['name'] === 'string' ? payload['name'] : id,
      roles,
      scopes,
      groups,
    };
  };
}

/** Development-only authenticator driven by an `x-dev-principal` JSON header. Rejected by config in staging/production. */
export function createDevAuthenticator(): Authenticator {
  return async (headers) => {
    const raw = headers['x-dev-principal'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) throw unauthenticated('x-dev-principal header required in dev auth mode');
    try {
      const p = JSON.parse(value) as Partial<Principal>;
      if (!p.id) throw new Error('id');
      return {
        id: p.id,
        tenantId: 'dev',
        displayName: p.displayName ?? p.id,
        roles: p.roles ?? [],
        scopes: p.scopes ?? [],
        groups: p.groups ?? [],
      };
    } catch {
      throw unauthenticated('Invalid x-dev-principal header');
    }
  };
}

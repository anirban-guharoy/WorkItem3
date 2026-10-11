import { createRemoteJWKSet, jwtVerify } from "jose";

export function hasAppRole(roles, requiredRole) {
  return !requiredRole || (Array.isArray(roles) && roles.includes(requiredRole));
}

export function createEntraBearerAuth({ tenantId, audience, requiredScope, requiredRole }) {
  const jwks = tenantId
    ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`))
    : undefined;

  return async function entraBearerAuth(req, res, next) {
    if (!tenantId || !audience || !requiredScope || !jwks) {
      return res.status(503).json({ error: "Entra ID API authentication is not configured" });
    }

    const authorization = req.get("authorization") || "";
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) return res.status(401).json({ error: "Bearer access token required" });

    try {
      const { payload } = await jwtVerify(match[1], jwks, {
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        audience,
        algorithms: ["RS256"],
      });
      if (payload.tid !== tenantId) return res.status(401).json({ error: "Token tenant is not allowed" });
      const scopes = typeof payload.scp === "string" ? payload.scp.split(" ") : [];
      if (!scopes.includes(requiredScope)) return res.status(403).json({ error: `Required scope: ${requiredScope}` });
      const roles = Array.isArray(payload.roles)
        ? payload.roles.filter((role) => typeof role === "string")
        : [];
      if (!hasAppRole(roles, requiredRole)) {
        return res.status(403).json({ error: `Required app role: ${requiredRole}` });
      }

      req.auth = {
        subject: payload.sub,
        userId: typeof payload.oid === "string" ? payload.oid : payload.sub,
        name: typeof payload.name === "string" ? payload.name : "",
        username: typeof payload.preferred_username === "string" ? payload.preferred_username : "",
        tenantId: payload.tid,
        scopes,
        roles,
      };
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired Entra ID access token" });
    }
  };
}

/**
 * JWT verification + role helpers — mirrors svc-mcp-knowledge/src/auth.ts.
 * Wraps @aisha/security so the JWKS cache + AuthError shape is consistent
 * across all microservices. Local AuthError re-thrown so route handlers
 * doing `err instanceof AuthError` keep working.
 */
import { type JWTPayload } from "jose";
import {
  createJwtVerifier,
  AuthError as SecurityAuthError,
} from "@aisha/security";
import { config } from "./config.js";

const verifier = createJwtVerifier({
  jwksUrl: config.jwksUrl,
  issuer: config.kcIssuer,
  service: "svc-ide-context",
});

export interface VerifiedUser {
  userId: string;
  email?: string;
  roles: string[];
  scopes: string[];
  claims: JWTPayload;
}

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function asStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function collectRoles(payload: JWTPayload): string[] {
  const record = payload as Record<string, unknown>;
  const realmAccess = record.realm_access as { roles?: unknown } | undefined;
  const resourceAccess = record.resource_access as
    | Record<string, { roles?: unknown }>
    | undefined;
  const roles = new Set<string>([
    ...asStringArray(record.roles),
    ...asStringArray(realmAccess?.roles),
  ]);
  if (resourceAccess && typeof resourceAccess === "object") {
    for (const access of Object.values(resourceAccess)) {
      for (const role of asStringArray(access.roles)) roles.add(role);
    }
  }
  return [...roles];
}

function collectScopes(payload: JWTPayload): string[] {
  const record = payload as Record<string, unknown>;
  const scopeClaim =
    typeof record.scope === "string" ? record.scope.split(/\s+/) : [];
  return [...new Set([...scopeClaim, ...asStringArray(record.scp)])].filter(
    Boolean,
  );
}

function isAllowedClient(payload: JWTPayload): boolean {
  if (config.kcAllowedClients.length === 0) return true;
  const allowed = new Set(config.kcAllowedClients);
  const record = payload as Record<string, unknown>;
  const azp = typeof record.azp === "string" ? record.azp : "";
  return (
    allowed.has(azp) ||
    asStringArray(payload.aud).some((audience) => allowed.has(audience))
  );
}

export async function verifyToken(
  authHeader: string | undefined,
): Promise<VerifiedUser> {
  let payload: JWTPayload;
  try {
    payload = await verifier.verify(authHeader);
  } catch (err) {
    if (err instanceof SecurityAuthError) {
      throw new AuthError(err.statusCode, err.message);
    }
    throw err;
  }
  if (!isAllowedClient(payload)) {
    throw new AuthError(403, "Keycloak client not allowed");
  }
  return {
    userId: payload.sub as string,
    email: (payload as Record<string, unknown>).email as string | undefined,
    roles: collectRoles(payload),
    scopes: collectScopes(payload),
    claims: payload,
  };
}

export function isAdminOrStaff(user: VerifiedUser): boolean {
  return user.roles.includes("admin") || user.roles.includes("staff");
}

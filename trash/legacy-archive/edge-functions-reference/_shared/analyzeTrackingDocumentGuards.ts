export type GuardFailure = {
  status: number;
  error: string;
};

import { isOriginAllowed } from "./cors.ts";

export function corsGuard(params: {
  origin: string | null;
  allowedOriginsRaw: string | undefined | null;
}): GuardFailure | null {
  const { origin, allowedOriginsRaw } = params;
  if (!origin) return null;

  return isOriginAllowed(origin, allowedOriginsRaw)
    ? null
    : { status: 403, error: "Origin not allowed" };
}

export function methodGuard(params: { method: string }): GuardFailure | null {
  if (params.method === "OPTIONS") return null;
  if (params.method !== "POST") return { status: 405, error: "Method not allowed" };
  return null;
}

export function bearerTokenGuard(params: {
  authorizationHeader: string | null;
}): { token: string } | GuardFailure {
  const header = params.authorizationHeader ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) return { status: 401, error: "Not authenticated" };
  return { token };
}

export function documentIdGuard(params: {
  documentId: unknown;
}): { documentId: string } | GuardFailure {
  const { documentId } = params;
  if (typeof documentId !== "string" || documentId.length === 0) {
    return { status: 400, error: "documentId is required" };
  }
  return { documentId };
}

export function rateLimitGuard(params: { rateLimited: boolean }): GuardFailure | null {
  return params.rateLimited ? { status: 429, error: "Rate limit exceeded" } : null;
}

export function ownerOnlyNoLeakGuard(params: {
  requesterUserId: string;
  documentOwnerUserId: string;
}): GuardFailure | null {
  if (params.documentOwnerUserId !== params.requesterUserId) {
    return { status: 404, error: "Not found" };
  }
  return null;
}

export function consentGuard(params: { hasConsent: boolean }): GuardFailure | null {
  return params.hasConsent ? null : { status: 403, error: "Consent required" };
}

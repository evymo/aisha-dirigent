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

export function bearerHeaderGuard(params: {
  authorizationHeader: string | null;
}): GuardFailure | null {
  const header = params.authorizationHeader ?? "";
  return header.startsWith("Bearer ") ? null : { status: 401, error: "Unauthorized" };
}

export function jsonContentTypeGuard(params: {
  contentTypeHeader: string | null;
}): GuardFailure | null {
  const contentType = (params.contentTypeHeader ?? "").toLowerCase();
  return contentType.includes("application/json")
    ? null
    : { status: 415, error: "Unsupported content type" };
}

export function jsonBodyGuard<T>(params: {
  bodyText: string;
  maxBodyBytes: number;
}): { body: T } | GuardFailure {
  const bytes = new TextEncoder().encode(params.bodyText).length;
  if (bytes > params.maxBodyBytes) {
    return { status: 413, error: "Request body too large" };
  }

  try {
    return { body: JSON.parse(params.bodyText) as T };
  } catch {
    return { status: 400, error: "Invalid request body" };
  }
}

export function requiredFieldsGuard(params: {
  event_type: unknown;
  reference_table: unknown;
  reference_id: unknown;
  payload: unknown;
}): GuardFailure | null {
  const { event_type, reference_table, reference_id, payload } = params;
  if (!event_type || !reference_table || !reference_id || !payload) {
    return { status: 400, error: "Missing required fields" };
  }
  return null;
}

export function allowlistGuard(params: {
  value: string;
  allowlist: ReadonlySet<string>;
  error: string;
}): GuardFailure | null {
  return params.allowlist.has(params.value) ? null : { status: 400, error: params.error };
}

export function payloadSizeGuard(params: {
  payload: unknown;
  maxJsonChars: number;
}): { payloadJson: string } | GuardFailure {
  let json: string;
  try {
    json = JSON.stringify(params.payload);
  } catch {
    return { status: 400, error: "Invalid payload" };
  }

  if (json.length > params.maxJsonChars) {
    return { status: 413, error: "Payload too large" };
  }

  return { payloadJson: json };
}

export function rateLimitGuard(params: {
  recentCount: number;
  limit: number;
}): GuardFailure | null {
  return params.recentCount >= params.limit
    ? { status: 429, error: "Rate limit exceeded" }
    : null;
}

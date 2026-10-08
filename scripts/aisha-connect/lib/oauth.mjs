/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628) + refresh + revocation against
 * the instance's Keycloak realm.
 *
 * Device flow because it works everywhere a developer types commands: a laptop,
 * an SSH session, a dev container or a cloud sandbox — the browser that approves
 * the code may be on another device. The public client is the one the AISHA
 * gateway and MCP server already accept (KC_ALLOWED_CLIENTS: aisha-dirigent-device).
 */

import { request, describeResponse } from "./http.mjs";
import { safeUrl } from "./discovery.mjs";

export const DEFAULT_CLIENT_ID = "aisha-dirigent-device";
export const DEFAULT_SCOPE = "openid profile email";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export class OAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

/** Raised when there is no usable session — the user has to run `login` again. */
export class LoginRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "LoginRequiredError";
  }
}

/** Payload of a JWT, or null. No signature check: the resource servers verify. */
export function decodeJwt(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export async function startDeviceAuthorization({ endpoint, clientId, scope, fetchImpl }) {
  if (!endpoint) throw new OAuthError("unsupported", "the realm does not offer the device authorization grant");
  const res = await request(endpoint, { method: "POST", form: { client_id: clientId, scope }, fetchImpl });
  if (!res.ok || !res.body?.device_code) {
    throw new OAuthError(res.body?.error || "device_authorization_failed", `device authorization → ${describeResponse(res)}`);
  }
  const b = res.body;
  return {
    device_code: b.device_code,
    user_code: b.user_code,
    // The user opens this — police it like any URL we hand out.
    verification_uri: safeUrl(b.verification_uri, "verification_uri"),
    verification_uri_complete: b.verification_uri_complete ? safeUrl(b.verification_uri_complete, "verification_uri_complete") : "",
    expires_in: Number(b.expires_in) || 600,
    interval: Number(b.interval) || 5,
  };
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the token endpoint until the user approves, denies, or the code expires.
 * @returns {Promise<object>} raw token response
 */
export async function pollDeviceToken({ tokenEndpoint, clientId, device, fetchImpl, sleep = sleepMs, now = Date.now }) {
  const deadline = now() + device.expires_in * 1000;
  let interval = device.interval;
  while (now() < deadline) {
    await sleep(interval * 1000);
    const res = await request(tokenEndpoint, {
      method: "POST",
      form: { grant_type: DEVICE_GRANT, device_code: device.device_code, client_id: clientId },
      fetchImpl,
    });
    if (res.ok && res.body?.access_token) return res.body;
    const code = res.body?.error;
    if (code === "authorization_pending") continue;
    if (code === "slow_down") {
      interval += 5;
      continue;
    }
    if (code === "access_denied") throw new OAuthError(code, "login was denied in the browser");
    if (code === "expired_token") break;
    throw new OAuthError(code || "token_error", `token endpoint → ${describeResponse(res)}`);
  }
  throw new OAuthError("expired_token", "the login code expired before it was approved — run login again");
}

/** Normalise a token response into what we persist. */
export function toCredential(tokens, { issuer, clientId, now = Date.now }) {
  const t = now();
  const claims = decodeJwt(tokens.access_token) || {};
  return {
    issuer,
    clientId,
    token_type: tokens.token_type || "Bearer",
    scope: tokens.scope || "",
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || "",
    expires_at: claims.exp ? claims.exp * 1000 : t + (Number(tokens.expires_in) || 300) * 1000,
    // Keycloak: 0 = offline token without idle expiry.
    refresh_expires_at:
      tokens.refresh_expires_in === undefined ? null : Number(tokens.refresh_expires_in) === 0 ? null : t + Number(tokens.refresh_expires_in) * 1000,
    subject: claims.sub || "",
    email: claims.email || "",
    username: claims.preferred_username || "",
    obtained_at: new Date(t).toISOString(),
  };
}

/**
 * What is wrong with an access token for this profile (empty = fine).
 * @returns {string[]}
 */
export function accessTokenProblems(accessToken, { issuer, clientId, now = Date.now }) {
  const claims = decodeJwt(accessToken);
  if (!claims) return ["access token is not a JWT"];
  const problems = [];
  if (claims.iss !== issuer) problems.push(`iss is ${claims.iss}, expected ${issuer}`);
  if (clientId && claims.azp && claims.azp !== clientId) problems.push(`azp is ${claims.azp}, expected ${clientId}`);
  if (!claims.exp || claims.exp * 1000 <= now()) problems.push("token is expired");
  return problems;
}

export async function refreshCredential({ tokenEndpoint, credential, fetchImpl, now = Date.now }) {
  if (!credential.refresh_token) throw new LoginRequiredError("no refresh token stored");
  const res = await request(tokenEndpoint, {
    method: "POST",
    form: { grant_type: "refresh_token", refresh_token: credential.refresh_token, client_id: credential.clientId },
    fetchImpl,
  });
  if (!res.ok || !res.body?.access_token) {
    if (res.body?.error === "invalid_grant") throw new LoginRequiredError(`session ended (${describeResponse(res)})`);
    throw new OAuthError(res.body?.error || "refresh_failed", `refresh → ${describeResponse(res)}`);
  }
  const next = toCredential(res.body, { issuer: credential.issuer, clientId: credential.clientId, now });
  // Keycloak may not rotate the refresh token; keep the old one then.
  if (!next.refresh_token) {
    next.refresh_token = credential.refresh_token;
    next.refresh_expires_at = credential.refresh_expires_at;
  }
  return next;
}

/**
 * A credential whose access token is valid for at least `minValiditySec`,
 * refreshing (and persisting) when needed.
 * @param {{ profile: object, credential: object|null, persist: (c: object) => void,
 *           reload?: () => object|null, minValiditySec?: number, fetchImpl?: typeof fetch, now?: () => number }} args
 */
export async function ensureFreshCredential({ profile, credential, persist, reload, minValiditySec = 60, fetchImpl, now = Date.now }) {
  if (!credential?.access_token) throw new LoginRequiredError("not logged in");
  if (credential.issuer !== profile.oidc.issuer) {
    throw new LoginRequiredError(`stored login belongs to ${credential.issuer}, profile now uses ${profile.oidc.issuer}`);
  }
  if (credential.expires_at - minValiditySec * 1000 > now()) return credential;
  if (credential.refresh_expires_at && credential.refresh_expires_at <= now()) {
    throw new LoginRequiredError("session expired");
  }
  try {
    const next = await refreshCredential({ tokenEndpoint: profile.oidc.token_endpoint, credential, fetchImpl, now });
    persist(next);
    return next;
  } catch (err) {
    // Another process (a second Claude session's headersHelper) may have refreshed
    // first with a rotating refresh token — use its result instead of failing.
    const latest = reload?.();
    if (err instanceof LoginRequiredError && latest?.access_token && latest.access_token !== credential.access_token &&
        latest.expires_at - minValiditySec * 1000 > now()) {
      return latest;
    }
    throw err;
  }
}

/** Best effort: a failed revocation must not block a local logout. */
export async function revokeRefreshToken({ revocationEndpoint, credential, fetchImpl }) {
  if (!revocationEndpoint || !credential?.refresh_token) return { revoked: false, reason: "nothing to revoke" };
  try {
    const res = await request(revocationEndpoint, {
      method: "POST",
      form: { token: credential.refresh_token, token_type_hint: "refresh_token", client_id: credential.clientId },
      fetchImpl,
    });
    return res.ok ? { revoked: true } : { revoked: false, reason: describeResponse(res) };
  } catch (err) {
    return { revoked: false, reason: err.message };
  }
}

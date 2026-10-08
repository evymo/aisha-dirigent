/**
 * Instance discovery: the API base is the ONLY input. Everything else comes from
 * the instance itself — `/.well-known/app-config.json` (served by the gateway,
 * the same document the web/mobile/IDE clients bootstrap from) and the OIDC
 * discovery document of the Keycloak realm it names.
 *
 * Nothing about a particular instance is hard-coded here: a local stack, a
 * self-hosted AISHA and the official hosted one are discovered the same way.
 */

import { request, describeResponse } from "./http.mjs";

/** Hosts where plain http is acceptable (tokens never leave the machine). */
export function isLoopbackHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * Parse and police a URL that tokens may be sent to: https, or http on loopback
 * only; no embedded credentials. Returns it without a trailing slash.
 * @param {unknown} value
 * @param {string} label  what the URL is, for the error message
 */
export function safeUrl(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}: missing URL`);
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label}: not a valid URL (${value})`);
  }
  if (url.username || url.password) {
    throw new Error(`${label}: URL must not embed credentials`);
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new Error(`${label}: plain http is only allowed for localhost — use https for ${url.host}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label}: unsupported protocol ${url.protocol}`);
  }
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function sameOrigin(a, b) {
  return new URL(a).origin === new URL(b).origin;
}

/** Endpoints a CLI client may send tokens to — all must live on the issuer's origin. */
const OIDC_TOKEN_ENDPOINTS = ["token_endpoint", "device_authorization_endpoint", "userinfo_endpoint", "revocation_endpoint"];

export async function fetchAppConfig(apiBase, { fetchImpl } = {}) {
  const url = `${apiBase}/.well-known/app-config.json`;
  const res = await request(url, { fetchImpl, followRedirects: true });
  if (!res.ok || !res.body || typeof res.body !== "object") {
    const hint =
      typeof res.body === "string" && /<html/i.test(res.body)
        ? " (got HTML — this looks like the web app host; pass the API base, e.g. https://api.<domain>)"
        : "";
    throw new Error(`app-config: ${url} → ${describeResponse(res)}${hint}`);
  }
  const raw = res.body;
  const appConfig = {
    version: raw.version ?? null,
    aisha_url: safeUrl(raw.aisha_url, "app-config aisha_url"),
    mcp_url: safeUrl(raw.mcp_url, "app-config mcp_url"),
    keycloak_url: safeUrl(raw.keycloak_url, "app-config keycloak_url"),
    anon_key: typeof raw.anon_key === "string" ? raw.anon_key : "",
  };
  for (const key of ["web_url", "ask_url", "n8n_trigger_url"]) {
    appConfig[key] = typeof raw[key] === "string" && raw[key] ? safeUrl(raw[key], `app-config ${key}`) : "";
  }
  return appConfig;
}

export async function fetchOidcConfig(issuer, { fetchImpl } = {}) {
  const url = `${issuer}/.well-known/openid-configuration`;
  const res = await request(url, { fetchImpl, followRedirects: true });
  if (!res.ok || !res.body || typeof res.body !== "object") {
    throw new Error(`oidc: ${url} → ${describeResponse(res)}`);
  }
  const raw = res.body;
  const discoveredIssuer = safeUrl(raw.issuer, "oidc issuer");
  // Mix-up defence: the realm app-config names must be the one that answers.
  if (discoveredIssuer !== issuer) {
    throw new Error(`oidc: issuer mismatch — app-config names ${issuer}, discovery answers ${discoveredIssuer}`);
  }
  const oidc = { issuer: discoveredIssuer };
  for (const key of [...OIDC_TOKEN_ENDPOINTS, "authorization_endpoint", "end_session_endpoint", "jwks_uri"]) {
    if (typeof raw[key] === "string" && raw[key]) oidc[key] = safeUrl(raw[key], `oidc ${key}`);
  }
  if (!oidc.token_endpoint) throw new Error("oidc: discovery has no token_endpoint");
  for (const key of OIDC_TOKEN_ENDPOINTS) {
    if (oidc[key] && !sameOrigin(oidc[key], issuer)) {
      throw new Error(`oidc: ${key} (${oidc[key]}) is not on the issuer origin ${new URL(issuer).origin}`);
    }
  }
  oidc.grant_types_supported = Array.isArray(raw.grant_types_supported) ? raw.grant_types_supported : [];
  return oidc;
}

/** RFC 9728 metadata — informative only; a missing document is not an error. */
export async function fetchProtectedResource(apiBase, { fetchImpl } = {}) {
  const url = `${new URL(apiBase).origin}/.well-known/oauth-protected-resource`;
  try {
    const res = await request(url, { fetchImpl, followRedirects: true });
    if (!res.ok || !res.body || typeof res.body !== "object") return null;
    const servers = Array.isArray(res.body.authorization_servers) ? res.body.authorization_servers : [];
    return { resource: res.body.resource ?? null, authorization_servers: servers.map(String) };
  } catch {
    return null;
  }
}

/**
 * Discover an instance from its API base.
 * @param {string} apiBaseInput
 * @param {{ fetchImpl?: typeof fetch, now?: () => number }} [opts]
 */
export async function discoverInstance(apiBaseInput, { fetchImpl, now = Date.now } = {}) {
  const apiBase = safeUrl(apiBaseInput, "--url");
  const appConfig = await fetchAppConfig(apiBase, { fetchImpl });
  const oidc = await fetchOidcConfig(appConfig.keycloak_url, { fetchImpl });
  const protectedResource = await fetchProtectedResource(apiBase, { fetchImpl });
  return { apiBase, appConfig, oidc, protectedResource, discoveredAt: new Date(now()).toISOString() };
}

/**
 * Profile name derived from the API base: `https://api.example.org` → `example.org`,
 * any loopback host → `local`.
 */
export function profileNameFromUrl(apiBase) {
  const { hostname } = new URL(apiBase);
  if (isLoopbackHost(hostname)) return "local";
  return hostname.toLowerCase().replace(/^api\./, "");
}

const PROFILE_NAME = /^[a-z0-9][a-z0-9._-]{0,62}$/;

/** Profile names end up in a shell command (headersHelper) — keep them boring. */
export function assertProfileName(name) {
  if (typeof name !== "string" || !PROFILE_NAME.test(name)) {
    throw new Error(`invalid profile name "${name}" — use lowercase letters, digits, '.', '_' or '-'`);
  }
  return name;
}

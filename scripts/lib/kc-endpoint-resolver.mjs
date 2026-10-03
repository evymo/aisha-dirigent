// =============================================================================
// kc-endpoint-resolver.mjs — model-driven Keycloak OIDC endpoint resolver
// =============================================================================
// Pure, side-effect-free. Shared by:
//   - scripts/lib/kc-host-auth.mjs        (local-warmup adapter)
//   - scripts/local-compose-gen.mjs       (via the adapter)
//   - scripts/e2e/run-local.mjs           (e2e env emission)
//   - src/tests/gates/*-host-auth-integral.gate.test.ts + kc-endpoint-resolver gate
//
// WHY — the local/e2e stacks must DECOUPLE the token `iss` (host-facing: the
// loopback the browser / iOS-sim reaches) from the JWKS/token/userinfo fetch
// (in-network: this stack's Keycloak via docker DNS). Prod compose already does
// this correctly; only the local/e2e *derivation* was broken, and it was broken
// across FOUR env-key conventions (KC_*, OAUTH2_PROXY_OIDC_*, AUTH_KEYCLOAK_*,
// KEYCLOAK_ISSUER). Enumerating key names is fragile, so this resolver classifies
// every OIDC URL by its **path** — universal, key-name-agnostic.
//
// DYNAMIC — this module contains ZERO deployment literals. Every host/port/scheme
// /realm is a caller-supplied parameter (local: config/local-presets.mjs vars +
// hostPorts; e2e: E2E_KC_* env). The only constants are the OIDC *spec paths*.
// =============================================================================

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireParam(params, key) {
  const v = params[key];
  if (v === undefined || v === null || v === "") {
    throw new Error(`resolveKcEndpoints: missing required param '${key}'`);
  }
  return v;
}

function buildBase(scheme, host, port) {
  // Always explicit port — keeps in-network "aisha-keycloak:80" and host-facing
  // "127.0.0.1:8180" stable and matchable by the gates.
  return `${scheme}://${host}:${port}`;
}

/**
 * Pure value computer. Derives the canonical Keycloak endpoints from variables.
 * NO defaulting to any literal — every field is required.
 * @param {{hostFacingHost:string, hostFacingPort:string|number, hostFacingScheme:string,
 *          inNetworkHost:string, inNetworkPort:string|number, inNetworkScheme:string,
 *          realm:string}} params
 * @returns {{hostFacingBase, inNetworkBase, realm, issuer, hostFacingAuth, hostFacingLogout,
 *            wellKnown, inNetworkJwks, inNetworkToken, inNetworkUserinfo}}
 */
export function resolveKcEndpoints(params) {
  const hostFacingHost = requireParam(params, "hostFacingHost");
  const hostFacingPort = requireParam(params, "hostFacingPort");
  const hostFacingScheme = requireParam(params, "hostFacingScheme");
  const inNetworkHost = requireParam(params, "inNetworkHost");
  const inNetworkPort = requireParam(params, "inNetworkPort");
  const inNetworkScheme = requireParam(params, "inNetworkScheme");
  const realm = requireParam(params, "realm");

  const hostFacingBase = buildBase(hostFacingScheme, hostFacingHost, hostFacingPort);
  const inNetworkBase = buildBase(inNetworkScheme, inNetworkHost, inNetworkPort);
  const realmPath = `/realms/${realm}`;
  const oidc = (base, suffix) => `${base}${realmPath}/protocol/openid-connect/${suffix}`;

  return {
    hostFacingBase,
    inNetworkBase,
    realm,
    // host-facing (browser reaches these; the issuer string the token carries)
    issuer: `${hostFacingBase}${realmPath}`,
    hostFacingAuth: oidc(hostFacingBase, "auth"),
    hostFacingLogout: oidc(hostFacingBase, "logout"),
    wellKnown: `${hostFacingBase}${realmPath}/.well-known/openid-configuration`,
    // in-network (server-side fetch via docker DNS)
    inNetworkJwks: oidc(inNetworkBase, "certs"),
    inNetworkToken: oidc(inNetworkBase, "token"),
    inNetworkUserinfo: oidc(inNetworkBase, "userinfo"),
  };
}

/**
 * Classify a Keycloak OIDC URL by its PATH (key-name-agnostic). Tolerant of an
 * empty host (`https:///realms/...`) — matches on the path, not `new URL()`.
 * Only matches the GIVEN realm (so `/realms/master` admin URLs are left alone).
 * @returns {{kind:'issuer'|'authorize'|'logout'|'discovery'|'jwks'|'token'|'userinfo'|'other'}|null}
 */
export function classifyKcUrl(value, realm) {
  if (typeof value !== "string" || !realm) return null;
  // scheme://authority(/path) — authority may be empty (https:///...)
  const m = value.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i);
  if (!m) return null;
  const path = m[1] || "";
  // Must be THIS realm (boundary so `aisha` != `aisha-other`).
  if (!new RegExp(`/realms/${escapeRe(realm)}(?:/|$)`).test(path)) return null;

  if (/\/\.well-known\/openid-configuration\/?$/.test(path)) return { kind: "discovery" };
  if (/\/protocol\/openid-connect\/certs\/?$/.test(path)) return { kind: "jwks" };
  if (/\/protocol\/openid-connect\/token\/?$/.test(path)) return { kind: "token" };
  if (/\/protocol\/openid-connect\/userinfo\/?$/.test(path)) return { kind: "userinfo" };
  if (/\/protocol\/openid-connect\/auth\/?$/.test(path)) return { kind: "authorize" };
  if (/\/protocol\/openid-connect\/logout\/?$/.test(path)) return { kind: "logout" };
  if (new RegExp(`/realms/${escapeRe(realm)}/?$`).test(path)) return { kind: "issuer" };
  return { kind: "other" }; // some other /protocol/... — left untouched, logged by caller
}

// ── env helpers (object + array shapes; what `docker compose config` emits) ──
function splitEnvLine(line) {
  const eq = line.indexOf("=");
  return eq < 0 ? [line, undefined] : [line.slice(0, eq), line.slice(eq + 1)];
}

export function getEnvValue(svc, key) {
  const env = svc?.environment;
  if (Array.isArray(env)) {
    for (const e of env) {
      if (typeof e !== "string") continue;
      const [k, v] = splitEnvLine(e);
      if (k === key) return v;
    }
    return undefined;
  }
  if (env && typeof env === "object") {
    return Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined;
  }
  return undefined;
}

export function setEnvValue(svc, key, value) {
  if (!svc.environment) svc.environment = {};
  const env = svc.environment;
  if (Array.isArray(env)) {
    const line = `${key}=${value}`;
    const idx = env.findIndex((e) => typeof e === "string" && splitEnvLine(e)[0] === key);
    if (idx >= 0) env[idx] = line;
    else env.push(line);
    return;
  }
  env[key] = value;
}

/**
 * Mutate the merged compose `doc` in place: rewrite EVERY Keycloak OIDC URL (in
 * any service's `environment` and `command`) to host-facing or in-network per its
 * path, and stamp the KC server's KC_HOSTNAME. No-op when the KC server (matched
 * by `kcContainer`) is absent from the stack.
 *
 * Guardrails: only `/realms/<realm>` URLs are touched, so PGRST_JWT_SECRET,
 * KEYCLOAK_URL (`http://aisha-keycloak:80`, no `/realms`), and `/realms/master`
 * admin URLs are inert.
 *
 * @param {object} doc       merged compose doc ({ services: {...} })
 * @param {object} endpoints output of resolveKcEndpoints()
 * @param {{realm:string, kcContainer:string, onChange?:Function}} opts
 * @returns {object} the same doc
 */
export function rewriteKcOidcUrlsInDoc(doc, endpoints, { realm, kcContainer, onChange } = {}) {
  const services = doc?.services ?? {};
  const kcSvc = Object.values(services).find((s) => s?.container_name === kcContainer);
  if (!kcSvc) return doc; // KC not in this stack → nothing host-facing to anchor.

  const byKind = {
    issuer: endpoints.issuer,
    authorize: endpoints.hostFacingAuth,
    logout: endpoints.hostFacingLogout,
    discovery: endpoints.wellKnown,
    jwks: endpoints.inNetworkJwks,
    token: endpoints.inNetworkToken,
    userinfo: endpoints.inNetworkUserinfo,
    other: null, // leave unrecognised /protocol/* untouched
  };

  const rewriteString = (v) => {
    const c = classifyKcUrl(v, realm);
    if (!c) return v;
    const target = byKind[c.kind];
    return target ?? v;
  };

  for (const [svcName, svc] of Object.entries(services)) {
    const env = svc?.environment;
    if (Array.isArray(env)) {
      for (let i = 0; i < env.length; i++) {
        if (typeof env[i] !== "string") continue;
        const [k, v] = splitEnvLine(env[i]);
        if (v === undefined) continue;
        const nv = rewriteString(v);
        if (nv !== v) { env[i] = `${k}=${nv}`; onChange?.(svcName, k, v, nv); }
      }
    } else if (env && typeof env === "object") {
      for (const [k, v] of Object.entries(env)) {
        if (typeof v !== "string") continue;
        const nv = rewriteString(v);
        if (nv !== v) { env[k] = nv; onChange?.(svcName, k, v, nv); }
      }
    }
    if (Array.isArray(svc.command)) {
      svc.command = svc.command.map((c) => (typeof c === "string" ? rewriteString(c) : c));
    }
  }

  // KC server: stamp the host-facing issuer; allow the in-network backchannel.
  setEnvValue(kcSvc, "KC_HOSTNAME", endpoints.hostFacingBase);
  setEnvValue(kcSvc, "KC_HOSTNAME_STRICT", "false");

  return doc;
}

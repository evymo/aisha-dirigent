// =============================================================================
// kc-host-auth.mjs — local-warmup adapter over the shared OIDC endpoint resolver
// =============================================================================
// Thin, side-effect-free adapter. Feeds scripts/lib/kc-endpoint-resolver.mjs the
// LOCAL variable sources (config/local-presets.mjs named vars + hostPorts + the
// KC container name) and applies the resulting path-based rewrite to the merged
// local compose doc. The e2e stack uses the SAME resolver via scripts/e2e/run-local.mjs.
//
// WHY — the local stack must DECOUPLE token `iss` (host-facing: the loopback the
// browser/iOS-sim uses, the host KC stamps into `iss`) from the JWKS/token/userinfo
// fetch (in-network: aisha-keycloak:80 via docker DNS). The gateway mints an HS256
// PostgREST JWT iff decodeJwt(token).iss === config.kcIssuer
// (services/gateway/src/auth/postgrest-jwt.ts); PostgREST stays HS256-only. The
// resolver classifies EVERY OIDC URL by its path, so this covers all four key
// conventions (KC_*, OAUTH2_PROXY_OIDC_*, AUTH_KEYCLOAK_*, KEYCLOAK_ISSUER) without
// enumerating key names. See src/tests/gates/local-host-auth-integral.gate.test.ts.
// =============================================================================

import {
  hostPorts,
  devEnvDefaults,
  KC_HOST_FACING_HOST,
  KC_HOST_FACING_SCHEME,
} from "../../config/local-presets.mjs";
import {
  resolveKcEndpoints,
  rewriteKcOidcUrlsInDoc,
  getEnvValue,
  setEnvValue,
} from "./kc-endpoint-resolver.mjs";

// The local Keycloak's container DNS name + in-network HTTP port (KC_HTTP_PORT=80
// in docker-compose.coolify-keycloak.yml).
export const KC_CONTAINER = "aisha-keycloak";
export const KC_IN_NETWORK_PORT = 80;
export const KC_IN_NETWORK_SCHEME = "http";

// Back-compat re-exports (importers used these from here historically).
export { getEnvValue, setEnvValue };

/**
 * Resolve the canonical host-client auth parameters for the LOCAL stack from the
 * presets, so the generator, the VITE_* app config, and the gate never drift.
 * Returns the legacy fields plus the full `endpoints` object.
 */
export function resolveKcHostAuth() {
  const kcHostPort = hostPorts[KC_CONTAINER]?.[KC_IN_NETWORK_PORT] ?? 8180;
  const realm = devEnvDefaults.KEYCLOAK_REALM ?? "aisha";
  const endpoints = resolveKcEndpoints({
    hostFacingHost: KC_HOST_FACING_HOST,
    hostFacingPort: kcHostPort,
    hostFacingScheme: KC_HOST_FACING_SCHEME,
    inNetworkHost: KC_CONTAINER,
    inNetworkPort: KC_IN_NETWORK_PORT,
    inNetworkScheme: KC_IN_NETWORK_SCHEME,
    realm,
  });
  return {
    kcHostPort,
    realm,
    hostFacingBase: endpoints.hostFacingBase,
    issuer: endpoints.issuer,
    inNetworkJwks: endpoints.inNetworkJwks,
    inNetworkToken: endpoints.inNetworkToken,
    inNetworkUserinfo: endpoints.inNetworkUserinfo,
    hostFacingAuth: endpoints.hostFacingAuth,
    wellKnown: endpoints.wellKnown,
    endpoints,
  };
}

/**
 * Mutate the merged compose `doc` in place so a HOST-reaching client (local web /
 * iOS Simulator) can OIDC-login and call authed RPCs — and so every admin/monitoring
 * UI oauth2-proxy logs in too. Delegates to the path-based resolver. No-op when the
 * local Keycloak is not in the selected stack.
 *
 * @param {object} doc        merged compose document ({ services: {...} })
 * @param {object} [hostAuth] resolveKcHostAuth() output (or a raw endpoints object)
 * @returns {object} the same doc
 */
export function applyHostClientAuthFix(doc, hostAuth = resolveKcHostAuth()) {
  const endpoints = hostAuth?.endpoints ?? hostAuth;
  return rewriteKcOidcUrlsInDoc(doc, endpoints, {
    realm: endpoints.realm ?? hostAuth.realm,
    kcContainer: KC_CONTAINER,
  });
}

/**
 * Local Host-Client Auth — Integral Design Gate (model-driven resolver)
 *
 * For the LOCAL WARMUP stack (npm run warmup → scripts/local-warmup.sh →
 * scripts/local-compose-gen.mjs → docker-compose.local.generated.json, gitignored).
 * Asserts the SOURCE OF TRUTH: the shared scripts/lib/kc-endpoint-resolver.mjs
 * (via the scripts/lib/kc-host-auth.mjs adapter) and the VITE_* app config in
 * config/local-presets.mjs — string/logic-level, no docker exec (CI-portable).
 *
 * Same decoupling as the e2e gate, but now KEY-NAME-AGNOSTIC: the resolver
 * classifies every OIDC URL by its PATH, so it fixes ALL consumer conventions —
 * KC_* (gateway/svc-mcp-knowledge/svc-plugin-system), OAUTH2_PROXY_OIDC_*
 * (admin/monitoring oauth2-proxy sidecars), KEYCLOAK_ISSUER (svc-matrix) — with
 * issuer/auth → host-facing 127.0.0.1:<kcPort> and jwks/token/userinfo →
 * in-network aisha-keycloak:80. The gateway then MINTS the HS256 PostgREST JWT.
 */
import { describe, expect, test } from "vitest";
import {
  applyHostClientAuthFix,
  resolveKcHostAuth,
  KC_CONTAINER,
} from "../../../scripts/lib/kc-host-auth.mjs";
import { devEnvDefaults, hostPorts } from "../../../config/local-presets.mjs";

// EXACT post-`transformForLocal` broken shapes (verified from a fresh
// `node scripts/local-compose-gen.mjs --preset full-light`):
//   host-facing keys (issuer/auth) = "https:///realms/aisha" (empty host — KEYCLOAK_DOMAIN_PUBLIC unset)
//   in-network keys (jwks/token/userinfo) = "http://localhost:8180/..." (localhost-rewritten → self)
function brokenDoc() {
  const certs = "http://localhost:8180/realms/aisha/protocol/openid-connect/certs";
  const token = "http://localhost:8180/realms/aisha/protocol/openid-connect/token";
  const userinfo = "http://localhost:8180/realms/aisha/protocol/openid-connect/userinfo";
  const issuerBad = "https:///realms/aisha";
  const authBad = "https:///realms/aisha/protocol/openid-connect/auth";
  return {
    services: {
      keycloak: { container_name: "aisha-keycloak", environment: { KC_HOSTNAME: "", KC_HTTP_PORT: "80" } },
      gateway: {
        container_name: "aisha-gateway",
        environment: {
          KC_ISSUER: issuerBad,
          KC_JWKS_URL: certs,
          KC_TOKEN_URL: token,
          KEYCLOAK_URL: "http://aisha-keycloak:80", // in-network admin base — must stay
        },
      },
      "svc-mcp-knowledge": { container_name: "aisha-svc-mcp-knowledge", environment: { KC_ISSUER: issuerBad, KC_JWKS_URL: certs } },
      "svc-plugin-system": { container_name: "aisha-svc-plugin-system", environment: { KC_ISSUER: issuerBad, KC_JWKS_URL: certs } },
      "nocodb-auth": {
        container_name: "aisha-nocodb-auth",
        environment: {
          OAUTH2_PROXY_OIDC_ISSUER_URL: issuerBad,
          OAUTH2_PROXY_LOGIN_URL: authBad,
          OAUTH2_PROXY_OIDC_JWKS_URL: certs,
          OAUTH2_PROXY_REDEEM_URL: token,
          OAUTH2_PROXY_PROFILE_URL: userinfo,
          OAUTH2_PROXY_SKIP_OIDC_DISCOVERY: "true",
        },
      },
      "svc-matrix": { container_name: "aisha-svc-matrix", environment: { KEYCLOAK_ISSUER: issuerBad } },
      postgrest: { container_name: "aisha-postgrest", environment: { PGRST_JWT_SECRET: "${JWT_SECRET}" } },
    },
  };
}

const IN_NETWORK_OK = /^http:\/\/aisha-keycloak(?::\d+)?\/realms\//;
const NOT_LOCAL_OR_PUBLIC = /https:\/\/|\.guru|\.cz|localhost|127\.0\.0\.1/;

describe("Local Host-Client Auth — Integral Design (model-driven resolver)", () => {
  const ha = resolveKcHostAuth();
  const { issuer, inNetworkJwks, inNetworkToken, hostFacingBase, hostFacingAuth, kcHostPort } = ha;

  test("KC host port + issuer derive from the local presets (no hardcoded drift)", () => {
    expect(kcHostPort, "from hostPorts['aisha-keycloak'][80]").toBe(hostPorts[KC_CONTAINER]?.[80]);
    expect(issuer).toBe(`http://127.0.0.1:${kcHostPort}/realms/${devEnvDefaults.KEYCLOAK_REALM}`);
  });

  test("KC server: KC_HOSTNAME host-facing loopback + STRICT=false (ATS-safe for iOS sim)", () => {
    const doc = applyHostClientAuthFix(brokenDoc());
    expect(doc.services.keycloak.environment.KC_HOSTNAME).toBe(hostFacingBase);
    expect(doc.services.keycloak.environment.KC_HOSTNAME).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(doc.services.keycloak.environment.KC_HOSTNAME_STRICT).toBe("false");
  });

  test("custom KC_* consumers: issuer host-facing, jwks/token in-network (gateway MINTS)", () => {
    const doc = applyHostClientAuthFix(brokenDoc());
    for (const name of ["gateway", "svc-mcp-knowledge", "svc-plugin-system"]) {
      const e = doc.services[name].environment;
      expect(e.KC_ISSUER, `${name} KC_ISSUER`).toBe(issuer);
      expect(e.KC_JWKS_URL, `${name} KC_JWKS_URL`).toMatch(IN_NETWORK_OK);
      expect(e.KC_JWKS_URL, `${name} KC_JWKS_URL not local/public`).not.toMatch(NOT_LOCAL_OR_PUBLIC);
      expect(e.KC_JWKS_URL).toBe(inNetworkJwks);
    }
    expect(doc.services.gateway.environment.KC_TOKEN_URL).toBe(inNetworkToken);
    expect(doc.services.gateway.environment.KC_TOKEN_URL).not.toMatch(NOT_LOCAL_OR_PUBLIC);
  });

  test("oauth2-proxy consumers fixed by PATH not key-name: issuer/login host-facing, jwks/redeem/profile in-network", () => {
    const e = applyHostClientAuthFix(brokenDoc()).services["nocodb-auth"].environment;
    expect(e.OAUTH2_PROXY_OIDC_ISSUER_URL, "issuer → host-facing").toBe(issuer);
    expect(e.OAUTH2_PROXY_LOGIN_URL, "login(authorize) → host-facing").toBe(hostFacingAuth);
    for (const k of ["OAUTH2_PROXY_OIDC_JWKS_URL", "OAUTH2_PROXY_REDEEM_URL", "OAUTH2_PROXY_PROFILE_URL"]) {
      expect(e[k], k).toMatch(IN_NETWORK_OK);
      expect(e[k], `${k} not local/public (would point at the proxy itself)`).not.toMatch(NOT_LOCAL_OR_PUBLIC);
    }
    expect(e.OAUTH2_PROXY_SKIP_OIDC_DISCOVERY, "discovery flag passed through").toBe("true");
  });

  test("svc-matrix KEYCLOAK_ISSUER → host-facing issuer", () => {
    expect(applyHostClientAuthFix(brokenDoc()).services["svc-matrix"].environment.KEYCLOAK_ISSUER).toBe(issuer);
  });

  test("PostgREST stays HS256-only; KEYCLOAK_URL admin base untouched (inert guardrail)", () => {
    const doc = applyHostClientAuthFix(brokenDoc());
    expect(doc.services.postgrest.environment.PGRST_JWT_SECRET).toBe("${JWT_SECRET}");
    expect(doc.services.postgrest.environment.PGRST_JWT_SECRET).not.toMatch(/("keys"|\{[^\n]*keys)/);
    expect(doc.services.gateway.environment.KEYCLOAK_URL, "in-network admin base must stay").toBe("http://aisha-keycloak:80");
  });

  test("no-op when the local Keycloak is not in the selected stack (e.g. preset minimum)", () => {
    const doc = { services: { gateway: { container_name: "aisha-gateway", environment: { KC_ISSUER: "https:///realms/aisha" } } } };
    const before = JSON.stringify(doc);
    applyHostClientAuthFix(doc);
    expect(JSON.stringify(doc), "must not touch the gateway when KC is absent").toBe(before);
  });

  test("VITE_* app config carries the SAME host:port as the token iss (oidc-client validation)", () => {
    expect(devEnvDefaults.VITE_KC_AUTHORITY, "must equal the KC issuer").toBe(issuer);
    expect(devEnvDefaults.VITE_KC_URL, "must equal the host-facing KC base").toBe(hostFacingBase);
    expect(devEnvDefaults.VITE_KC_AUTHORITY).not.toMatch(/localhost/);
  });
});

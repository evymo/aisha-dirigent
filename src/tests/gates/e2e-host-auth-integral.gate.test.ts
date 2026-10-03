/**
 * E2E / Local Host-Client Auth — Integral Design Gate (model-driven)
 *
 * The e2e stack (docker-compose.coolify.yml + docker-compose.coolify-keycloak.yml
 * + docker-compose.e2e.yml, launched by scripts/e2e/run-local.mjs) must let a
 * HOST-reaching client (iOS Simulator / local web) complete OIDC login and call
 * an authenticated RPC: host client ──(KC RS256)──▶ aisha-gateway verifies + MINTS
 * a short HS256 PostgREST JWT (services/gateway/src/auth/postgrest-jwt.ts) ──▶
 * aisha-postgrest (HS256-only).
 *
 * The bug this prevents (memory project_local_host_client_auth_2026-06-06): the
 * gateway's KC_ISSUER was overridden to 127.0.0.1 but KC_JWKS_URL was left
 * inheriting coolify.yml's PUBLIC `https://${KEYCLOAK_DOMAIN}` → local tokens
 * verified against PROD keys → kid mismatch → 401, and on iss drift the raw RS256
 * token was passed to PostgREST → PGRST301.
 *
 * Now UNIFIED with local-warmup: docker-compose.e2e.yml references the
 * ${KC_ISSUER}/${KC_JWKS_URL}/${KC_TOKEN_URL}/${KC_HOSTNAME} that run-local.mjs
 * computes from the SHARED scripts/lib/kc-endpoint-resolver.mjs — so `iss` and the
 * JWKS-fetch URL are DECOUPLED from a single source, no hand-coded literals.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveKcEndpoints } from "../../../scripts/lib/kc-endpoint-resolver.mjs";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");
const e2e = read("docker-compose.e2e.yml");
const runLocal = read("scripts/e2e/run-local.mjs");

// The exact values run-local.mjs injects (E2E_KC_PORT default 8080; in-network
// aisha-keycloak:80). Asserting against the resolver output ties the YAML to the
// shared resolver — stronger than asserting a literal.
const kc = resolveKcEndpoints({
  hostFacingHost: "127.0.0.1",
  hostFacingPort: "8080",
  hostFacingScheme: "http",
  inNetworkHost: "aisha-keycloak",
  inNetworkPort: "80",
  inNetworkScheme: "http",
  realm: "aisha",
});

describe("E2E / Local Host-Client Auth — Integral Design", () => {
  test("e2e.yml references the resolver-injected KC vars (not hand-coded literals)", () => {
    expect(e2e, "gateway KC_ISSUER must reference ${KC_ISSUER}").toMatch(/KC_ISSUER:\s*["']?\$\{KC_ISSUER\}/);
    expect(
      e2e,
      "gateway must override KC_JWKS_URL to the in-network local KC — leaving it inherits coolify.yml's PUBLIC KC (the original bug).",
    ).toMatch(/KC_JWKS_URL:\s*["']?\$\{KC_JWKS_URL\}/);
    expect(e2e, "keycloak KC_HOSTNAME must reference ${KC_HOSTNAME}").toMatch(/KC_HOSTNAME:\s*["']?\$\{KC_HOSTNAME\}/);
    expect(e2e).toMatch(/KC_HOSTNAME_STRICT:\s*["']?false/);
  });

  test("run-local.mjs computes endpoints via the shared resolver and injects them", () => {
    expect(runLocal, "imports the shared resolver").toMatch(/resolveKcEndpoints/);
    for (const k of ["KC_ISSUER", "KC_JWKS_URL", "KC_TOKEN_URL", "KC_HOSTNAME"]) {
      expect(runLocal, `injects ${k} from the resolver`).toMatch(new RegExp(`${k}:\\s*KC_ENDPOINTS`));
    }
  });

  test("injected JWKS is IN-NETWORK only (never public/localhost) — the e2e decoupling", () => {
    expect(kc.inNetworkJwks).toMatch(/^http:\/\/aisha-keycloak(?::\d+)?\/realms\//);
    expect(
      kc.inNetworkJwks,
      "local tokens are signed by the LOCAL KC reachable via docker DNS — never https/public/loopback",
    ).not.toMatch(/https:\/\/|\.guru|\.cz|localhost|127\.0\.0\.1/);
  });

  test("injected issuer host == KC_HOSTNAME host (gateway MINTS, not passes through)", () => {
    expect(kc.issuer).toBe(`${kc.hostFacingBase}/realms/aisha`);
    expect(new URL(kc.issuer).host).toBe(new URL(kc.hostFacingBase).host);
    expect(kc.hostFacingBase).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  test("PostgREST waits for migrate (PGRST202 schema-cache race guard) and stays HS256-only", () => {
    expect(
      e2e,
      "postgrest must depend on migrate (service_completed_successfully) so it doesn't cache an empty schema on fresh down -v.",
    ).toMatch(/postgrest:[\s\S]*?depends_on:[\s\S]*?migrate:[\s\S]*?service_completed_successfully/);
    expect(
      e2e,
      "must NOT stuff a JWK Set into PGRST_JWT_SECRET — the gateway mints HS256; PostgREST stays HMAC-only.",
    ).not.toMatch(/PGRST_JWT_SECRET[^\n]*("keys"|\{[^\n]*keys)/);
  });
});

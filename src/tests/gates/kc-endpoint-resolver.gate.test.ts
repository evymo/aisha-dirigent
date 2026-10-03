/**
 * kc-endpoint-resolver — unit gate
 *
 * The shared, model-driven OIDC endpoint resolver (scripts/lib/kc-endpoint-resolver.mjs)
 * used by BOTH local-warmup and e2e. Asserts:
 *   - the pure value computer derives every endpoint purely from inputs (zero literals),
 *   - the path classifier is key-name-agnostic and realm-scoped (master/other realms inert),
 *   - the doc mutator never touches PGRST_JWT_SECRET / KEYCLOAK_URL and no-ops without KC.
 */
import { describe, expect, test } from "vitest";
import {
  resolveKcEndpoints,
  classifyKcUrl,
  rewriteKcOidcUrlsInDoc,
  getEnvValue,
} from "../../../scripts/lib/kc-endpoint-resolver.mjs";

const P = {
  hostFacingHost: "127.0.0.1",
  hostFacingPort: "8180",
  hostFacingScheme: "http",
  inNetworkHost: "aisha-keycloak",
  inNetworkPort: "80",
  inNetworkScheme: "http",
  realm: "aisha",
};

describe("kc-endpoint-resolver — pure value computer", () => {
  test("derives endpoints purely from inputs", () => {
    const e = resolveKcEndpoints(P);
    expect(e.issuer).toBe("http://127.0.0.1:8180/realms/aisha");
    expect(e.hostFacingAuth).toBe("http://127.0.0.1:8180/realms/aisha/protocol/openid-connect/auth");
    expect(e.wellKnown).toBe("http://127.0.0.1:8180/realms/aisha/.well-known/openid-configuration");
    expect(e.inNetworkJwks).toBe("http://aisha-keycloak:80/realms/aisha/protocol/openid-connect/certs");
    expect(e.inNetworkToken).toBe("http://aisha-keycloak:80/realms/aisha/protocol/openid-connect/token");
    expect(e.inNetworkUserinfo).toBe("http://aisha-keycloak:80/realms/aisha/protocol/openid-connect/userinfo");
  });

  test("changing inputs changes outputs (port + realm + in-network host)", () => {
    const e = resolveKcEndpoints({ ...P, hostFacingPort: "8080", realm: "other", inNetworkHost: "kc" });
    expect(e.issuer).toBe("http://127.0.0.1:8080/realms/other");
    expect(e.inNetworkJwks).toBe("http://kc:80/realms/other/protocol/openid-connect/certs");
  });

  test("throws on any missing param (no defaulting to literals)", () => {
    for (const k of Object.keys(P)) {
      const bad: Record<string, unknown> = { ...P };
      delete bad[k];
      expect(() => resolveKcEndpoints(bad), `missing ${k}`).toThrow(/missing required param/);
    }
  });
});

describe("kc-endpoint-resolver — path classifier (key-name-agnostic)", () => {
  const cases: Array<[string, string]> = [
    ["http://127.0.0.1:8180/realms/aisha", "issuer"],
    ["https:///realms/aisha", "issuer"], // empty host tolerated
    ["http://x/realms/aisha/protocol/openid-connect/auth", "authorize"],
    ["http://x/realms/aisha/protocol/openid-connect/certs", "jwks"],
    ["http://x/realms/aisha/protocol/openid-connect/token", "token"],
    ["http://x/realms/aisha/protocol/openid-connect/userinfo", "userinfo"],
    ["http://x/realms/aisha/.well-known/openid-configuration", "discovery"],
    ["http://x/realms/aisha/protocol/openid-connect/logout", "logout"],
  ];
  for (const [url, kind] of cases) {
    test(`classifies ${url} → ${kind}`, () => {
      expect(classifyKcUrl(url, "aisha")?.kind).toBe(kind);
    });
  }

  test("non-KC / other-realm / non-URL → null (inert)", () => {
    expect(classifyKcUrl("http://aisha-keycloak:80", "aisha"), "KEYCLOAK_URL admin base").toBeNull();
    expect(classifyKcUrl("http://x/realms/master/protocol/openid-connect/certs", "aisha"), "master realm").toBeNull();
    expect(classifyKcUrl("${JWT_SECRET}", "aisha"), "PGRST secret").toBeNull();
    expect(classifyKcUrl("http://x/realms/aisha-other", "aisha"), "realm boundary").toBeNull();
  });
});

describe("kc-endpoint-resolver — doc mutator guardrails", () => {
  const endpoints = resolveKcEndpoints(P);

  test("never touches PGRST_JWT_SECRET / KEYCLOAK_URL / master-realm URLs", () => {
    const doc = {
      services: {
        keycloak: { container_name: "aisha-keycloak", environment: { KC_HOSTNAME: "" } },
        postgrest: { container_name: "aisha-postgrest", environment: { PGRST_JWT_SECRET: "${JWT_SECRET}" } },
        gateway: {
          container_name: "aisha-gateway",
          environment: {
            KEYCLOAK_URL: "http://aisha-keycloak:80",
            KC_ADMIN_TOKEN_URL: "http://aisha-keycloak:80/realms/master/protocol/openid-connect/token",
            KC_JWKS_URL: "http://localhost:8180/realms/aisha/protocol/openid-connect/certs",
          },
        },
      },
    };
    rewriteKcOidcUrlsInDoc(doc, endpoints, { realm: "aisha", kcContainer: "aisha-keycloak" });
    expect(doc.services.postgrest.environment.PGRST_JWT_SECRET).toBe("${JWT_SECRET}");
    expect(doc.services.gateway.environment.KEYCLOAK_URL).toBe("http://aisha-keycloak:80");
    expect(doc.services.gateway.environment.KC_ADMIN_TOKEN_URL).toBe("http://aisha-keycloak:80/realms/master/protocol/openid-connect/token");
    // but the real aisha-realm JWKS IS rewritten in-network
    expect(doc.services.gateway.environment.KC_JWKS_URL).toBe(endpoints.inNetworkJwks);
  });

  test("no-op when the KC container is absent", () => {
    const doc = { services: { gateway: { container_name: "aisha-gateway", environment: { KC_ISSUER: "https:///realms/aisha" } } } };
    const before = JSON.stringify(doc);
    rewriteKcOidcUrlsInDoc(doc, endpoints, { realm: "aisha", kcContainer: "aisha-keycloak" });
    expect(JSON.stringify(doc)).toBe(before);
  });

  test("handles array-shape environment", () => {
    const doc = {
      services: {
        keycloak: { container_name: "aisha-keycloak", environment: [] as string[] },
        gateway: {
          container_name: "aisha-gateway",
          environment: ["KC_JWKS_URL=http://localhost:8180/realms/aisha/protocol/openid-connect/certs"],
        },
      },
    };
    rewriteKcOidcUrlsInDoc(doc, endpoints, { realm: "aisha", kcContainer: "aisha-keycloak" });
    expect(getEnvValue(doc.services.gateway, "KC_JWKS_URL")).toBe(endpoints.inNetworkJwks);
  });
});

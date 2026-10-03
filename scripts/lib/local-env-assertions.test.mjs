/**
 * Unit tests for the pure local-stack env assertions (the "env doctor").
 * Deterministic: no I/O, no network, no docker — pure value judgements.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertCookieSecret,
  assertJwtShape,
  assertNonEmpty,
  assertNonEmptyUrlHost,
  assertNotPlaceholder,
  validateLocalStackEnv,
} from "./local-env-assertions.mjs";

// A REAL HS256 JWT shape (same minting as config/local-presets.mjs mintDevServiceJwt).
function mintJwt(secret = "dev_secret_32chars__padding_padding_pad") {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ role: "service_role" });
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
}

describe("assertJwtShape", () => {
  it("passes a real 3-segment base64url JWT", () => {
    expect(() => assertJwtShape("POSTGREST_SERVICE_TOKEN", mintJwt())).not.toThrow();
  });
  it("rejects a placeholder string (not a JWT)", () => {
    expect(() => assertJwtShape("POSTGREST_SERVICE_TOKEN", "dev-service-role-key")).toThrow(/3 non-empty segments/);
  });
  it("rejects an empty string", () => {
    expect(() => assertJwtShape("POSTGREST_SERVICE_TOKEN", "")).toThrow(/non-empty JWT/);
  });
  it("rejects a 2-segment token", () => {
    expect(() => assertJwtShape("X", "aaa.bbb")).toThrow(/segment/);
  });
  it("rejects a segment with a non-base64url char", () => {
    expect(() => assertJwtShape("X", "aaa.b+b.ccc")).toThrow(/base64url/);
  });
});

describe("assertNonEmptyUrlHost", () => {
  it("passes a normal http URL with host:port", () => {
    expect(() => assertNonEmptyUrlHost("KC_ISSUER", "http://127.0.0.1:8180/realms/testrealm")).not.toThrow();
  });
  it("passes an in-network service host", () => {
    expect(() => assertNonEmptyUrlHost("POSTGREST_URL", "http://aisha-postgrest:3000")).not.toThrow();
  });
  it("rejects an empty-host URL (https:///path malformed class)", () => {
    expect(() => assertNonEmptyUrlHost("KC_ISSUER", "https:///realms/testrealm")).toThrow(/empty host/);
  });
  it("rejects a non-URL string", () => {
    expect(() => assertNonEmptyUrlHost("KEYCLOAK_URL", "not-a-url")).toThrow(/scheme:\/\/authority/);
  });
  it("rejects an empty value", () => {
    expect(() => assertNonEmptyUrlHost("KEYCLOAK_URL", "")).toThrow(/non-empty URL/);
  });
});

describe("assertNonEmpty", () => {
  it("passes a 32+ char secret", () => {
    expect(() => assertNonEmpty("JWT_SECRET", "dev_secret_32chars__padding_padding_pad", 32)).not.toThrow();
  });
  it("rejects an empty JWT_SECRET", () => {
    expect(() => assertNonEmpty("JWT_SECRET", "", 32)).toThrow(/non-empty string/);
  });
  it("rejects a too-short secret", () => {
    expect(() => assertNonEmpty("JWT_SECRET", "short", 32)).toThrow(/at least 32/);
  });
});

describe("assertNotPlaceholder", () => {
  it("passes a real value", () => {
    expect(() => assertNotPlaceholder("X", "a-genuine-dev-value-9281")).not.toThrow();
  });
  it.each(["changeme", "placeholder", "TODO", "xxx", "dev-service-role-key", "dev-anon-role-key", ""])(
    "rejects placeholder %s",
    (v) => {
      expect(() => assertNotPlaceholder("X", v)).toThrow();
    },
  );
});

describe("validateLocalStackEnv", () => {
  const goodToken = mintJwt();

  it("passes a clean resolved-env map", () => {
    const services = {
      "svc-mcp-knowledge": {
        env: {
          POSTGREST_SERVICE_TOKEN: goodToken,
          JWT_SECRET: "dev_secret_32chars__padding_padding_pad",
          KC_JWKS_URL: "http://aisha-keycloak:80/realms/testrealm/protocol/openid-connect/certs",
          KC_ISSUER: "http://127.0.0.1:8180/realms/testrealm",
          KEYCLOAK_URL: "http://aisha-keycloak:80",
          POSTGREST_URL: "http://aisha-postgrest:3000",
        },
      },
    };
    expect(() => validateLocalStackEnv(services)).not.toThrow();
    expect(validateLocalStackEnv(services).checked).toBe(6);
  });

  it("collects ALL failures and names every failing service.KEY", () => {
    const services = {
      "svc-mcp-knowledge": {
        env: {
          POSTGREST_SERVICE_TOKEN: "dev-service-role-key", // placeholder + bad shape
          JWT_SECRET: "", // empty
          KC_ISSUER: "https:///realms/testrealm", // empty host
        },
      },
      gateway: {
        env: { POSTGREST_URL: "http://aisha-postgrest:3000" }, // fine
      },
    };
    let caught;
    try {
      validateLocalStackEnv(services);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/svc-mcp-knowledge\.POSTGREST_SERVICE_TOKEN/);
    expect(caught.message).toMatch(/svc-mcp-knowledge\.JWT_SECRET/);
    expect(caught.message).toMatch(/svc-mcp-knowledge\.KC_ISSUER/);
    // gateway POSTGREST_URL is valid → not named
    expect(caught.message).not.toMatch(/gateway\.POSTGREST_URL/);
  });

  it("only judges keys a service actually declares (skips absent)", () => {
    const services = { svc: { env: { JWT_SECRET: "dev_secret_32chars__padding_padding_pad" } } };
    expect(validateLocalStackEnv(services).checked).toBe(1);
  });

  it("ignores services with no env", () => {
    expect(() => validateLocalStackEnv({ svc: {} })).not.toThrow();
  });
});

describe("assertCookieSecret — oauth2-proxy AES key size (16/24/32 bytes)", () => {
  it("accepts exactly 16, 24, or 32 bytes", () => {
    expect(() => assertCookieSecret("C", "x".repeat(16))).not.toThrow();
    expect(() => assertCookieSecret("C", "x".repeat(24))).not.toThrow();
    expect(() => assertCookieSecret("C", "x".repeat(32))).not.toThrow();
  });
  it("rejects the 39-byte D32 default (the pgadmin/pki/n8n crash-loop class)", () => {
    expect(() => assertCookieSecret("STUDIO_COOKIE_SECRET", "dev_secret_32chars__padding_padding_pad"))
      .toThrow(/exactly 16, 24, or 32 bytes \(got 39\)/);
  });
  it("rejects other off sizes + empty", () => {
    expect(() => assertCookieSecret("C", "x".repeat(20))).toThrow(/got 20/);
    expect(() => assertCookieSecret("C", "")).toThrow(/non-empty/);
  });
});

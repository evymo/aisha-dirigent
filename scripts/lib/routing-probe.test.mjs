/**
 * Unit tests for routing-probe — the live-routing arbiter.
 * Deterministic, no network (pure classifiers only; probeRoute's fetch is not exercised).
 */
import { describe, expect, it } from "vitest";
import { isTraefikDefault404, expectedSignal, scopeProbable } from "./routing-probe.mjs";

describe("isTraefikDefault404", () => {
  it("true for the Traefik no-router default backend (19B text/plain, no service header)", () => {
    expect(isTraefikDefault404({ status: 404, headers: { "content-type": "text/plain; charset=utf-8" }, bodyLen: 19 })).toBe(true);
  });
  it("false for a working registry 200", () => {
    expect(isTraefikDefault404({ status: 200, headers: { "docker-distribution-api-version": "registry/2.0" }, bodyLen: 2 })).toBe(false);
  });
  it("false for a real backend 404 (json / large body / service header)", () => {
    expect(isTraefikDefault404({ status: 404, headers: { "content-type": "application/json" }, bodyLen: 120 })).toBe(false);
    expect(isTraefikDefault404({ status: 404, headers: { "content-type": "text/plain", "docker-distribution-api-version": "registry/2.0" }, bodyLen: 19 })).toBe(false);
  });
});

describe("expectedSignal", () => {
  it("registry accepts only 200 + distribution header", () => {
    const s = expectedSignal("registry");
    expect(s.path).toBe("/v2/");
    expect(s.accept({ status: 200, headers: { "docker-distribution-api-version": "registry/2.0" } })).toBe(true);
    expect(s.accept({ status: 200, headers: {} })).toBe(false);
  });
  it("oauth2 accepts a redirect or 401/403 (a login front does not 200 at /)", () => {
    const s = expectedSignal("oauth2");
    expect(s.accept({ status: 302, headers: {} })).toBe(true);
    expect(s.accept({ status: 401, headers: {} })).toBe(true);
    expect(s.accept({ status: 200, headers: {} })).toBe(false);
  });
  it("http rejects only the default-404, accepts any other coherent response", () => {
    const s = expectedSignal("http");
    expect(s.accept({ status: 200, headers: {} })).toBe(true);
    expect(s.accept({ status: 404, headers: { "content-type": "text/plain" }, bodyLen: 19 })).toBe(false);
  });
});

describe("scopeProbable", () => {
  it("keeps externally-reachable hosts, skips internal + sentinel", () => {
    const got = scopeProbable(
      ["tenantcache.staging.example.com", "keycloak.backend.example.com", "x.invalid"],
      { internalTld: "example.com" },
    );
    expect(got).toEqual(["tenantcache.staging.example.com"]);
  });
});

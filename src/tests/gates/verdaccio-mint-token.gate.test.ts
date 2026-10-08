/**
 * Gate: Verdaccio publish token is AUTO-MINTED, never a hardcoded/stale token.
 *
 * Locks the fix for the 2026-06-13 incident: the static VERDACCIO_TOKEN (a
 * Verdaccio JWT with `jwt.sign.expiresIn: 30d`) expired, so every @aisha/*
 * publish and every Docker build's `npm install` of @aisha/* failed E401 and
 * blocked the deploy. Cold-start and CI now mint a fresh token from
 * VERDACCIO_USER + VERDACCIO_PASSWORD each run.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf-8") : "");

const mintScript = read("scripts/verdaccio-mint-token.mjs");
const coldStart = read("scripts/aisha-cold-start.sh");
const publishWf = read(".github/workflows/aisha-packages-publish.yml");

describe("Verdaccio token auto-mint", () => {
  test("the mint script exists", () => {
    expect(mintScript.length).toBeGreaterThan(0);
  });

  test("mint uses the WEB-login endpoint (survives max_users:-1)", () => {
    // The couchdb `PUT /-/user/org.couchdb.user:<user>` path is the REGISTRATION
    // endpoint — Verdaccio rejects it with HTTP 409 under `max_users: -1` (our
    // prod config), even for existing users. The web-login endpoint authenticates
    // existing htpasswd users regardless. (Verified live 2026-06-13.)
    expect(mintScript).toContain("/-/verdaccio/sec/login");
    // the actual request must be the web-login POST, not a couchdb-user PUT
    expect(mintScript).not.toMatch(/method:\s*["']PUT["']/);
  });

  test("mint is no-hardcoded: registry comes from VERDACCIO_URL env", () => {
    expect(mintScript).toMatch(/process\.env\.VERDACCIO_URL/);
    // no REAL internal registry host baked into the script (doc examples like
    // npm.example.com are fine — they are not deployment config)
    expect(mintScript).not.toMatch(/\bnpm\.id3a\.cz\b/);
  });

  test("mint is back-compat: no-op (not fatal) when user/password absent", () => {
    // Both empty → skip + exit 0, so installs that only need read ($all) and
    // operators who still use a static token are unaffected.
    expect(mintScript).toMatch(/VERDACCIO_USER/);
    expect(mintScript).toMatch(/VERDACCIO_PASSWORD/);
    expect(mintScript).toMatch(/process\.exit\(0\)/);
  });

  test("cold-start wires the mint (auto-refresh from vault user/password)", () => {
    expect(coldStart).toMatch(/verdaccio-mint-token\.mjs/);
    expect(coldStart).toMatch(/VERDACCIO_USER/);
    expect(coldStart).toMatch(/VERDACCIO_PASSWORD/);
  });

  test("publish workflow prefers minting, falls back to the static secret", () => {
    expect(publishWf).toMatch(/verdaccio-mint-token\.mjs/);
    expect(publishWf).toMatch(/secrets\.VERDACCIO_USER/);
    expect(publishWf).toMatch(/secrets\.VERDACCIO_PASSWORD/);
    // static token still supported as fallback
    expect(publishWf).toMatch(/secrets\.VERDACCIO_TOKEN/);
  });
});

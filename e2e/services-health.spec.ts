/**
 * Services Health Check — verifies the current self-hosted AISHA stack.
 *
 * The default local E2E stack starts PostgreSQL/PostgREST, Keycloak, the
 * gateway, and the Vite web app. Optional external consoles are checked only
 * when their URLs are explicitly provided via env.
 *
 * Run: npx playwright test e2e/services-health.spec.ts
 */

import { test, expect } from "@playwright/test";

// ── Service URLs (required via env — no hardcoded fallbacks) ──
const _tld = process.env.PUBLIC_TLD;
const API = process.env.VITE_AISHA_GATEWAY_URL ?? process.env.VITE_AISHA_POSTGREST_URL
  ?? (_tld ? `https://api.${_tld}` : (() => { throw new Error("E2E: set VITE_AISHA_GATEWAY_URL or PUBLIC_TLD"); })());
const WEB = process.env.E2E_BASE_URL
  ?? (_tld ? `https://web.${_tld}` : (() => { throw new Error("E2E: set E2E_BASE_URL or PUBLIC_TLD"); })());
const KC = process.env.E2E_KC_URL ?? process.env.VITE_KC_URL ?? process.env.KC_URL
  ?? (_tld ? `https://auth.${_tld}` : (() => { throw new Error("E2E: set E2E_KC_URL or PUBLIC_TLD"); })());
const LANGFUSE = process.env.LANGFUSE_URL;
const NOCODB = process.env.NOCODB_URL;
const APPSMITH = process.env.APPSMITH_URL;

const describeIf = (condition: boolean) => condition ? test.describe : test.describe.skip;

test.describe("Services Health: AISHA Core", () => {
  test("gateway health endpoint is healthy", async ({ request }) => {
    const res = await request.get(`${API}/health`, { timeout: 10_000 });
    expect(res.ok()).toBeTruthy();

    const health = await res.json();
    expect(health.status).toBe("ok");
  });

  test("PostgREST is available", async ({ request }) => {
    // GET / returns OpenAPI spec
    const res = await request.get(`${API}/rest/v1/`, { timeout: 10_000 });
    // 200 with schema or 401 without key — both mean service is UP
    expect([200, 401]).toContain(res.status());
  });

  test("gateway functions router is reachable", async ({ request }) => {
    const res = await request.get(`${API}/functions/v1/`, { timeout: 10_000 });
    // 404 is fine here — it means the gateway router is up and no function was selected.
    expect(res.status()).toBeLessThan(500);
  });

  test("auth compatibility route redirects to Keycloak", async ({ request }) => {
    const res = await request.get(
      `${API}/auth/v1/authorize?provider=keycloak&redirect_to=${encodeURIComponent(`${WEB}/auth/callback`)}`,
      { maxRedirects: 0, timeout: 10_000 },
    );

    expect([302, 303]).toContain(res.status());
    expect(res.headers().location).toContain("/protocol/openid-connect/auth");
  });

  test("Keycloak JWT is accepted by PostgREST through gateway", async ({ request }) => {
    const tokenRes = await request.post(`${KC}/realms/aisha/protocol/openid-connect/token`, {
      timeout: 20_000,
      form: {
        client_id: "aisha-app",
        grant_type: "password",
        password: "Admin123!",
        scope: "openid email profile",
        username: "admin@platform.rtn",
      },
    });
    expect(tokenRes.ok(), `KC token endpoint returned ${tokenRes.status()}`).toBeTruthy();

    const tokens = await tokenRes.json();
    expect(typeof tokens.access_token).toBe("string");

    const rpcRes = await request.post(`${API}/rest/v1/rpc/get_my_stories_audited`, {
      timeout: 15_000,
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      data: { p_limit: 1 },
    });
    expect(rpcRes.ok(), `RPC returned ${rpcRes.status()}: ${await rpcRes.text()}`).toBeTruthy();

    const stories = await rpcRes.json();
    expect(Array.isArray(stories)).toBeTruthy();
  });
});

test.describe("Services Health: Keycloak", () => {
  test("OIDC discovery endpoint returns config", async ({ request }) => {
    const res = await request.get(
      `${KC}/realms/aisha/.well-known/openid-configuration`,
      { timeout: 20_000 },
    );
    expect(res.ok()).toBeTruthy();

    const cfg = await res.json();
    expect(cfg.issuer).toContain("/realms/aisha");
    expect(cfg.authorization_endpoint).toBeTruthy();
    expect(cfg.token_endpoint).toBeTruthy();
  });

  test("admin console is reachable", async ({ request }) => {
    const res = await request.get(`${KC}/admin/master/console/`, { timeout: 20_000 });
    expect(res.status()).toBeLessThan(500);
  });
});

describeIf(Boolean(LANGFUSE))("Services Health: Langfuse", () => {
  test("Langfuse responds (not 5xx)", async ({ request }) => {
    const res = await request.get(`${LANGFUSE}/`, { timeout: 15_000 });
    expect(res.status(), `Langfuse returned ${res.status()} — service may be DOWN`).toBeLessThan(500);
  });

  test("Langfuse API health", async ({ request }) => {
    const res = await request.get(`${LANGFUSE}/api/public/health`, { timeout: 15_000 });
    expect(res.status()).toBeLessThan(500);
  });
});

describeIf(Boolean(NOCODB))("Services Health: NocoDB", () => {
  test("NocoDB responds", async ({ request }) => {
    const res = await request.get(`${NOCODB}/`, { timeout: 15_000 });
    // Behind OAuth2 proxy: may redirect (302) or show login — NOT 5xx
    expect(res.status()).toBeLessThan(500);
  });
});

describeIf(Boolean(APPSMITH))("Services Health: Appsmith", () => {
  test("Appsmith responds", async ({ request }) => {
    const res = await request.get(`${APPSMITH}/`, { timeout: 15_000 });
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe("Services Health: MCP Knowledge Server", () => {
  test("MCP endpoint rejects unauthenticated correctly (401, not 5xx)", async ({ request }) => {
    const res = await request.post(`${API}/functions/v1/mcp-knowledge-server`, {
      timeout: 15_000,
      headers: { "Content-Type": "application/json" },
      data: { jsonrpc: "2.0", method: "tools/list", id: 1 },
    });

    // 401 = correct (auth required), anything < 500 = service is running
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe("Services Health: Web Application", () => {
  test("SPA bundle loads (200 with HTML)", async ({ request }) => {
    const res = await request.get(`${WEB}/`, { timeout: 10_000 });
    expect(res.ok()).toBeTruthy();

    const html = await res.text();
    expect(html.toLowerCase()).toContain("<!doctype html");
    expect(html).toContain("src="); // JS bundles referenced
  });

  test("static assets serve correctly", async ({ request }) => {
    // Fetch the HTML to discover asset paths
    const html = await (await request.get(`${WEB}/`)).text();
    const jsMatch = html.match(/src="(\/assets\/[^"]+\.js)"/);

    if (jsMatch) {
      const jsRes = await request.get(`${WEB}${jsMatch[1]}`, { timeout: 10_000 });
      expect(jsRes.ok(), `JS bundle ${jsMatch[1]} returned ${jsRes.status()}`).toBeTruthy();
      expect((await jsRes.body()).byteLength).toBeGreaterThan(1000);
    }
  });

  test("SPA routing works (client-side routes return HTML)", async ({ request }) => {
    // All routes should return index.html (SPA catch-all)
    const routes = ["/studies", "/knowledge", "/rules", "/auth", "/guild"];
    for (const route of routes) {
      const res = await request.get(`${WEB}${route}`, { timeout: 10_000 });
      expect(res.ok(), `Route ${route} returned ${res.status()}`).toBeTruthy();
    }
  });
});

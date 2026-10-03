#!/usr/bin/env node
/**
 * Production Smoke Tests
 * Validates that all critical services are responding correctly.
 * Usage: node scripts/smoke-prod.mjs
 */

import { DIRIGENT_API_URL, DIRIGENT_URL, N8N_URL } from './lib/env.mjs';

const API = DIRIGENT_API_URL;
const WEB = DIRIGENT_URL;
const KC_URL = process.env.KEYCLOAK_URL ?? (() => { throw new Error("KEYCLOAK_URL required (e.g. https://auth.<your-domain>)"); })();
const KC_REALM = process.env.KEYCLOAK_REALM ?? "aisha";
const MCP_ENDPOINT = process.env.AISHA_MCP_URL ?? (() => { throw new Error("AISHA_MCP_URL required (e.g. https://api.<your-domain>/functions/v1/mcp-knowledge-server)"); })();
const ANON = process.env.AISHA_POSTGREST_ANON_KEY;
const AISHA_ACCESS_TOKEN = process.env.AISHA_ACCESS_TOKEN || process.env.AISHA_KEYCLOAK_ACCESS_TOKEN || "";
const SRK = process.env.AISHA_POSTGREST_SERVICE_KEY;

if (!ANON || !SRK || !AISHA_ACCESS_TOKEN) {
  console.error("ERROR: AISHA_POSTGREST_ANON_KEY, AISHA_POSTGREST_SERVICE_KEY and AISHA_ACCESS_TOKEN must be set in environment.");
  console.error("  export AISHA_POSTGREST_ANON_KEY=<anon-key>");
  console.error("  export AISHA_POSTGREST_SERVICE_KEY=<service-role-key>");
  console.error("  export AISHA_ACCESS_TOKEN=<keycloak-access-token>");
  process.exit(1);
}

const results = [];

async function check(name, url, opts = {}) {
  const { method = "GET", headers = {}, body, expect = 200, redirect } = opts;
  try {
    const fetchOpts = { method, headers, signal: AbortSignal.timeout(10000) };
    if (body) {
      fetchOpts.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    if (redirect) fetchOpts.redirect = redirect;
    const res = await fetch(url, fetchOpts);
    const ok = res.status === expect;
    const symbol = ok ? "✅" : "❌";
    console.log(`  ${symbol} ${name}: ${res.status} (expected ${expect})`);
    results.push({ name, status: res.status, expected: expect, ok });
    return res;
  } catch (err) {
    console.log(`  ❌ ${name}: ERROR — ${err.message}`);
    results.push({ name, status: "ERROR", expected: expect, ok: false });
    return null;
  }
}

console.log("==========================================");
console.log(`  PRODUCTION SMOKE TESTS — ${new Date().toISOString()}`);
console.log("==========================================\n");

// 1. Infrastructure
console.log("── Infrastructure ──");
await check("Frontend", WEB);
await check("Auth Health", `${API}/auth/v1/health`, { headers: { apikey: ANON } });
await check("PostgREST", `${API}/rest/v1/`, { headers: { apikey: ANON } });
await check("Edge Functions (MCP)", MCP_ENDPOINT, {
  method: "POST",
  headers: { Authorization: `Bearer ${AISHA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: { method: "tools/list" },
});
await check("n8n Health", `${N8N_URL}/healthz`);

// 1b. OAuth & Identity Providers
console.log("\n── OAuth Providers ──");
await check("KeyCloak /health/ready", `${KC_URL}/health/ready`);
await check("KeyCloak Health", `${KC_URL}/realms/${KC_REALM}/.well-known/openid-configuration`);
await check("OAuth: Keycloak redirect", `${API}/auth/v1/authorize?provider=keycloak`, {
  headers: { apikey: ANON },
  expect: 302,
  redirect: "manual",
});
await check("OAuth: Google redirect", `${API}/auth/v1/authorize?provider=google`, {
  headers: { apikey: ANON },
  expect: 302,
  redirect: "manual",
});
await check("OAuth: Apple redirect", `${API}/auth/v1/authorize?provider=apple`, {
  headers: { apikey: ANON },
  expect: 302,
  redirect: "manual",
});

// 2. Public RPC functions (anon access)
console.log("\n── Public RPC Functions ──");
await check("get_public_hero_slides", `${API}/rest/v1/rpc/get_public_hero_slides`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: {},
});
await check("get_public_products", `${API}/rest/v1/rpc/get_public_products`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: {},
});
await check("get_public_homepage_stats", `${API}/rest/v1/rpc/get_public_homepage_stats`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: {},
});

// 3. Auth login flow
console.log("\n── Auth Login ──");
const loginRes = await check("Login (seed-admin)", `${API}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: { email: "seed-admin@platform.local", password: "seedadmin123" },
});

let accessToken = null;
if (loginRes && loginRes.ok) {
  const loginData = await loginRes.json();
  accessToken = loginData.access_token;
  console.log(`  ℹ️  Token obtained (user_id: ${loginData.user?.id?.slice(0, 8)}...)`);
} else if (loginRes) {
  const errBody = await loginRes.text().catch(() => "");
  console.log(`  ℹ️  Login response: ${errBody.slice(0, 200)}`);
}

// 4. Authenticated RPC (requires login)
if (accessToken) {
  console.log("\n── Authenticated RPC Functions ──");
  const authHeaders = {
    apikey: ANON,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  await check("get_my_user_roles", `${API}/rest/v1/rpc/get_my_user_roles`, {
    method: "POST", headers: authHeaders, body: {},
  });
  await check("get_my_notifications", `${API}/rest/v1/rpc/get_my_notifications`, {
    method: "POST", headers: authHeaders, body: { p_limit: 5 },
  });
  await check("get_my_health_check_ins_audited", `${API}/rest/v1/rpc/get_my_health_check_ins_audited`, {
    method: "POST", headers: authHeaders, body: { p_limit: 5 },
  });
  await check("get_my_gamification_stats", `${API}/rest/v1/rpc/get_my_gamification_stats`, {
    method: "POST", headers: authHeaders, body: {},
  });
}

// 5. MCP Knowledge validation
console.log("\n── MCP Knowledge Server ──");
const mcpRes = await check("MCP tools/list", MCP_ENDPOINT, {
  method: "POST",
  headers: { Authorization: `Bearer ${AISHA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: { method: "tools/list" },
});
if (mcpRes && mcpRes.ok) {
  const mcpData = await mcpRes.clone().json().catch((_parseErr) => null);
  if (mcpData?.tools) {
    console.log(`  ℹ️  MCP tools available: ${mcpData.tools.length}`);
  }
}

// Summary
console.log("\n==========================================");
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
const total = results.length;
console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) {
  console.log("  Failed:");
  results.filter((r) => !r.ok).forEach((r) => {
    console.log(`    ❌ ${r.name}: got ${r.status}, expected ${r.expected}`);
  });
}
console.log("==========================================");

process.exit(failed > 0 ? 1 : 0);

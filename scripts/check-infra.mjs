#!/usr/bin/env node
/**
 * scripts/check-infra.mjs — Check status of all Evymo infrastructure
 *
 * Verifies: Coolify stacks, n8n, Ragnarok, MCP Knowledge Server, pg-meta.
 *
 * Usage:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/check-infra.mjs
 */
import { pg, mcp, AISHA_POSTGREST_URL, SERVICE_KEY, ANON_KEY, MCP_URL, createTestRunner } from './lib/remote-api.mjs';
import { N8N_URL } from './lib/env.mjs';
import { resolveAllAishaUuids, clearCache } from './lib/coolify-resolve-uuid.mjs';
import { probeRoute, scopeProbable } from './lib/routing-probe.mjs';

const COOLIFY_URL = process.env.COOLIFY_URL ? `${process.env.COOLIFY_URL}/api/v1` : '';
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN || process.env.COOLIFY_API_TOKEN || '';

// Multi-server expectation map: which application names AISHA expects to find
// on which server. UUIDs are resolved at runtime via the shared Coolify
// resolver (scripts/lib/coolify-resolve-uuid.mjs) — never hardcoded.
//
// Invariant (memory: feedback_bootstrap_creds_generator_pushes.md): each
// --wipe rebuilds Coolify apps with new UUIDs; storing UUIDs in code or env
// would break on every rebuild. Names are the stable identifier.
const SERVER_EXPECTATIONS = {
  frontend: {
    role: 'production',
    expects: ['aisha-core', 'aisha-keycloak', 'aisha-integration', 'aisha-langfuse', 'aisha-admin'],
  },
  backend: {
    role: 'backend',
    expects: ['aisha-integration-backend', 'aisha-llm-gateway', 'aisha-openclaw', 'aisha-langgraph-runner'],
  },
  experimental: {
    role: 'staging',
    expects: ['aisha-staging', 'aisha-exec'],
  },
};

// Health endpoints for direct checks (no Coolify API needed)
const BASE_DOMAIN = process.env.AISHA_DOMAIN || process.env.INTERNAL_TLD;
if (!BASE_DOMAIN) {
  console.error("ERROR: AISHA_DOMAIN (or INTERNAL_TLD) not set — env-driven, no hardcoded internal host.");
  process.exit(1);
}
const PUBLIC_TLD = process.env.PUBLIC_TLD;
if (!PUBLIC_TLD) {
  console.error("ERROR: PUBLIC_TLD not set — env-driven, no hardcoded public host.");
  process.exit(1);
}
const HEALTH_ENDPOINTS = {
  keycloak: { url: process.env.KEYCLOAK_URL || `https://kc.${BASE_DOMAIN}/realms/${process.env.KEYCLOAK_REALM}`, description: 'Keycloak OIDC' },
  frontend: { url: process.env.FRONTEND_URL || `https://dirigent.${BASE_DOMAIN}`, description: 'Frontend SPA' },
  api: { url: process.env.API_URL || `https://dirigent-api.${BASE_DOMAIN}/rest/v1/`, description: 'aisha-gateway (PostgREST)' },
  langfuse: { url: process.env.LANGFUSE_URL || `https://langfuse.${BASE_DOMAIN}`, description: 'Langfuse' },
  n8n: { url: N8N_URL, description: 'n8n Workflow' },
  pki: { url: process.env.PKI_URL || `https://pki.${BASE_DOMAIN}`, description: 'OpenXPKI WebUI' },
  game: { url: process.env.GAME_URL || `https://game.${BASE_DOMAIN}`, description: 'Game Frontend' },
  'game-api': { url: process.env.GAME_API_URL || `https://game-api.${BASE_DOMAIN}/api/health`, description: 'Game Gateway' },
};

// Production user-facing endpoints (public ${PUBLIC_TLD} domain) — these MUST
// be reachable for end users. Different layer than HEALTH_ENDPOINTS which
// targets internal *.${INTERNAL_TLD} services. Used for outage detection (e.g., Frontend
// cluster outage 2026-04-29 manifested as 503 across all of these while
// internal services on Backend were healthy).
//
// Reference: docs/reports/INCIDENT_2026-04-29_FRONTEND_OUTAGE.md
const PUBLIC_PROD_ENDPOINTS = {
  'aisha-root': { url: `https://${PUBLIC_TLD}`, expect: [200, 301, 302, 401, 403] },
  'aisha-app': { url: `https://app.${PUBLIC_TLD}`, expect: [200, 301, 302, 401, 403] },
  'aisha-web': { url: `https://web.${PUBLIC_TLD}`, expect: [200] },
  'aisha-auth': { url: `https://${process.env.KEYCLOAK_DOMAIN}/realms/${process.env.KEYCLOAK_REALM}/.well-known/openid-configuration`, expect: [200] },
  'aisha-mcp': { url: `https://mcp.${PUBLIC_TLD}/healthz`, expect: [200] },
  'aisha-api': { url: `https://api.${PUBLIC_TLD}/health`, expect: [200] },
};

const { test, summary } = createTestRunner();

async function fetchSafe(url, opts = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000), ...opts });
    return { status: r.status, ok: r.ok, text: await r.text().catch(() => '') };
  } catch (e) {
    return { status: 0, ok: false, text: e.message };
  }
}

/**
 * Jediný domov verdiktu „žije to" — `scripts/lib/routing-probe.mjs`.
 *
 * Vrací i třetí výrok: hostitel, který se z principu zvenčí nepřekládá
 * (vnitřní jméno), NENÍ nemocný — jen se odsud změřit nedá. Tvrdit o něm
 * cokoli by byla červená bez nálezu.
 */
async function probeUrl(url, expect = null) {
  const u = new URL(url);
  const host = u.host;
  if (scopeProbable([host.replace(/:\d+$/, '')]).length === 0) {
    return { ok: true, skipped: true, status: 0, detail: 'NEZMĚŘENO — vnitřní jméno, odsud se měřit nedá' };
  }
  const r = await probeRoute(host, 'http', {
    scheme: u.protocol.replace(':', ''),
    path: `${u.pathname}${u.search}`,
    expect,
    timeoutMs: 10000,
  });
  return {
    ok: r.routed,
    skipped: false,
    status: r.status ?? 0,
    detail: r.routed ? `HTTP ${r.status}` : `HTTP ${r.status ?? 0}${r.reason ? ` — ${r.reason}` : ''}`,
  };
}

async function main() {
  console.log('🏗️ Evymo Infrastructure Check (Multi-Server, dynamic UUIDs)\n');

  // --- Coolify Stacks (per server, UUIDs resolved dynamically by app name) ---
  let allUuids = {};
  try {
    // resolveAllAishaUuids reads COOLIFY_URL + COOLIFY_API_TOKEN/COOLIFY_TOKEN
    // and returns { 'aisha-core': 'uuid', ... } for every aisha-* app present.
    allUuids = await resolveAllAishaUuids();
    console.log(`📡 Resolved ${Object.keys(allUuids).length} aisha-* apps from Coolify\n`);
  } catch (err) {
    console.log(`⚠ Could not resolve UUIDs from Coolify (${String(err).slice(0, 120)}); per-app checks will be skipped.\n`);
  }

  for (const [serverName, server] of Object.entries(SERVER_EXPECTATIONS)) {
    console.log(`📦 ${serverName.toUpperCase()} (${server.role})`);
    for (const appName of server.expects) {
      const uuid = allUuids[appName];
      if (!uuid) {
        console.log(`   ⏭️  ${appName}: not found in Coolify — skipped (may be optional or not deployed)`);
        continue;
      }
      const r = await fetchSafe(`${COOLIFY_URL.replace(/\/api\/v1$/, '')}/api/v1/applications/${uuid}`, {
        headers: { Authorization: `Bearer ${COOLIFY_TOKEN}`, Accept: 'application/json' },
      });
      let status = 'unknown';
      if (r.ok) {
        try {
          status = JSON.parse(r.text).status;
        } catch (err) {
          console.warn(`      ⚠️  non-JSON response from ${appName}: ${err?.message || err}`);
          status = r.text.substring(0, 50);
        }
      }
      test(`${serverName}/${appName}`, r.ok, `HTTP ${r.status}: ${r.text.substring(0, 80)}`);
      if (r.ok) console.log(`      uuid=${uuid.slice(0, 8)}… status=${status}`);
    }
    console.log('');
  }
  clearCache();

  // --- Health endpoints (direct HTTP) ---
  //
  // Verdikt „žije to" má JEDEN domov — `scripts/lib/routing-probe.mjs`.
  //
  // ⛔ Dřív tady stálo `r.status >= 200 && r.status < 400`, tedy „cokoli, co
  // není chyba". Na hostu se search doménou s wildcardem projde i mrtvá služba:
  // neznámé jméno se přeloží na síťovou appliance a ta odpoví přesměrováním,
  // které do toho rozsahu spadá. Zbytek podmínky nebyl důkaz, ale tvar.
  console.log('\n🌐 Health Endpoints');
  for (const [name, ep] of Object.entries(HEALTH_ENDPOINTS)) {
    const v = await probeUrl(ep.url);
    test(`${ep.description} (${name})`, v.ok, v.detail);
  }

  // --- Public production endpoints (user-facing ${PUBLIC_TLD}) ---
  console.log(`\n🚦 Public Production Endpoints (${PUBLIC_TLD})`);
  for (const [name, ep] of Object.entries(PUBLIC_PROD_ENDPOINTS)) {
    // Kurátorovaný nárok se PŘEDÁVÁ dál — je bohatší než druh služby. Přebít
    // jím diskvalifikaci ale nelze: kdo čeká 302 a dostane odraz od appliance,
    // nedostal svou službu.
    const v = await probeUrl(ep.url, ep.expect);
    test(`public/${name}`, v.ok, v.detail);
    // 503 across multiple = Traefik upstream issue (likely stuck container)
    if (v.status === 503) {
      console.log(`      ⚠ 503 from ${ep.url} — Traefik has no healthy upstream`);
    }
  }

  // --- pg-meta ---
  console.log('\n🐘 PostgreSQL (pg-meta)');
  {
    try {
      const rows = await pg('SELECT count(*) as cnt FROM expert_rules WHERE status = \'published\'');
      const cnt = rows?.[0]?.cnt;
      test('pg-meta query works', parseInt(cnt) > 0, `rules=${cnt}`);
      console.log(`      published rules: ${cnt}`);
    } catch (e) {
      test('pg-meta query works', false, e.message);
    }
  }

  // --- MCP Knowledge Server ---
  console.log('\n🧠 MCP Knowledge Server');
  {
    const r = await fetchSafe(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'infra-check' } } }),
    });
    let version = '';
    if (r.ok) {
      try {
        version = JSON.parse(r.text).result?.serverInfo?.version || '';
      } catch (err) {
        console.warn(`      ⚠️  MCP initialize returned non-JSON: ${err?.message || err}`);
      }
    }
    test('MCP server responds', r.ok, `HTTP ${r.status}`);
    if (version) console.log(`      version: ${version}`);
  }

  // --- Ragnarok ---
  console.log('\n🔍 Ragnarok (via MCP search_ragnarok)');
  {
    try {
      const r = await mcp('search_ragnarok', { query: 'test health', project: 'evymo', top_k: 1 });
      const hasResult = (typeof r === 'string' && r.length > 10) || r?.results?.length > 0;
      test('Ragnarok search works', hasResult, `type=${typeof r}, len=${typeof r === 'string' ? r.length : r?.results?.length}`);
    } catch (e) {
      test('Ragnarok search works', false, e.message);
    }
  }

  // --- Admin health check ---
  console.log('\n🏥 Admin Health Check (MCP)');
  {
    try {
      const r = await mcp('admin_health_check', {});
      const text = typeof r === 'string' ? r : JSON.stringify(r);
      test('Health check returns data', text.length > 20, `len=${text.length}`);
      // Print service statuses
      if (typeof r === 'object' && r.services) {
        for (const [svc, info] of Object.entries(r.services)) {
          console.log(`      ${svc}: ${info.status || JSON.stringify(info).substring(0, 60)}`);
        }
      }
    } catch (e) {
      test('Health check', false, e.message);
    }
  }

  // --- Knowledge Stats ---
  console.log('\n📊 Knowledge Base Stats');
  {
    try {
      const r = await mcp('get_knowledge_stats', {});
      const text = typeof r === 'string' ? r : '';
      test('KB stats available', text.length > 20 || (typeof r === 'object' && Object.keys(r).length > 0), `type=${typeof r}`);
      if (text) console.log(`      ${text.substring(0, 200)}`);
    } catch (e) {
      test('KB stats', false, e.message);
    }
  }

  const { failed } = summary();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

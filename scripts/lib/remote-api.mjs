/**
 * scripts/lib/remote-api.mjs — Shared helpers for remote Supabase API calls
 *
 * Provides pg-meta query, MCP tool call, and Supabase RPC helpers.
 * Keys are loaded from AISHA_POSTGREST_SERVICE_KEY / AISHA_POSTGREST_ANON_KEY env vars
 * or fallback to the self-hosted Coolify deployment defaults.
 *
 * Usage:
 *   import { pg, mcp, AISHA_POSTGREST_URL, STORY_ID } from './lib/remote-api.mjs';
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Load .env.aisha if present
try {
  const content = readFileSync(join(ROOT, '.env.aisha'), 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.aisha not found — rely on process env (CI / inline run)
}

// --- Config ---
export const AISHA_POSTGREST_URL = process.env.AISHA_POSTGREST_URL;
if (!AISHA_POSTGREST_URL) {
  console.error("ERROR: AISHA_POSTGREST_URL not set (env-driven; no hardcoded host)");
  process.exit(1);
}
export const SERVICE_KEY = process.env.AISHA_POSTGREST_SERVICE_KEY || '';
export const ANON_KEY = process.env.AISHA_POSTGREST_ANON_KEY || '';
export const AISHA_ACCESS_TOKEN = process.env.AISHA_ACCESS_TOKEN || process.env.AISHA_KEYCLOAK_ACCESS_TOKEN || '';
const MCP_FUNCTION_PATH = '/functions/v1/mcp-knowledge-server';
function defaultMcpUrl(supabaseUrl) {
  return `${supabaseUrl}${MCP_FUNCTION_PATH}`;
}
export const MCP_URL = process.env.AISHA_MCP_URL || process.env.MCP_URL || defaultMcpUrl(AISHA_POSTGREST_URL);
export const PG_URL = `${AISHA_POSTGREST_URL}/pg/query`;

// Current project story — update if story changes
export const STORY_ID = process.env.AISHA_STORY_ID || 'cd4eb095-cbf9-493a-9d77-75f324ffb60b';

/**
 * Execute a SQL query via pg-meta REST API (service_role).
 * @param {string} sql
 * @returns {Promise<any[]>}
 */
export async function pg(sql) {
  const r = await fetch(PG_URL, {
      signal: AbortSignal.timeout(30000),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`pg-meta ${r.status}: ${text.substring(0, 200)}`);
  }
  return r.json();
}

/**
 * Call an MCP tool on the Knowledge Server edge function.
 * Returns parsed JSON if the response text is JSON, raw text otherwise.
 * @param {string} tool — tool name
 * @param {Record<string, any>} args — tool arguments
 * @returns {Promise<any>}
 */
export async function mcp(tool, args = {}) {
  if (!AISHA_ACCESS_TOKEN) {
    throw new Error('AISHA_ACCESS_TOKEN is required for MCP calls. Authenticate via Keycloak first.');
  }

  const r = await fetch(MCP_URL, {
      signal: AbortSignal.timeout(30000),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AISHA_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`MCP HTTP ${r.status}: ${text.substring(0, 200)}`);
  }
  const json = await r.json();
  if (json.error) {
    throw new Error(`MCP error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  const text = json.result?.content?.[0]?.text || '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Simple test runner — tracks pass/fail and prints summary.
 */
export function createTestRunner() {
  let passed = 0;
  let failed = 0;
  let total = 0;

  function test(name, condition, detail) {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✅ ${name}`);
    } else {
      failed++;
      console.log(`  ❌ ${name} — ${detail || 'FAIL'}`);
    }
  }

  function summary() {
    console.log('\n' + '='.repeat(60));
    console.log(`📊 RESULTS: ${passed}/${total} passed, ${failed} failed`);
    console.log('='.repeat(60));
    if (failed === 0) console.log('🎉 ALL TESTS PASSED!');
    else console.log(`⚠️  ${failed} test(s) need attention`);
    return { passed, failed, total };
  }

  return { test, summary };
}

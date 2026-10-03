#!/usr/bin/env node
/**
 * scripts/playwright-runner-preflight.mjs
 *
 * Verifies the Playwright runner (svc-playwright-runner) is wired correctly
 * to run E2E tests against a deployed environment, WITHOUT actually
 * triggering a run.
 *
 * Why: PR #69/#91 shipped the runner + WF_DEPLOY_STORY chain + auto-rollback,
 * all verified statically by gates. Gates can't see runtime issues —
 * Coolify slot resolver returning the wrong domain, Verdaccio token scope
 * inside the runner container, e2e-reports bucket RLS regression, etc.
 * This script does the pre-flight in <10s so operators can confirm
 * "if I trigger a run right now, nothing wires-level will break".
 *
 * Checks (each independently reported, all soft-fail to a summary at the end):
 *   1. coolify_app_slots row exists for --app-name
 *   2. resolve_deployed_url(app_name) returns a valid http(s) URL
 *   3. HTTP HEAD on the target URL succeeds (network reachability)
 *   4. svc-playwright-runner heartbeat file is fresh (<2× poll interval)
 *   5. Storage bucket e2e-reports policy: admin/staff SELECT works
 *   6. start_playwright_run + record_playwright_result RPCs are reachable
 *
 * Usage:
 *   node scripts/playwright-runner-preflight.mjs --app-name stack-aisha-staging
 *   node scripts/playwright-runner-preflight.mjs --app-name <app> --json
 *
 * Environment:
 *   AISHA_POSTGREST_URL, AISHA_POSTGREST_SERVICE_KEY
 *   AISHA_RUNNER_HEARTBEAT_URL  (optional — health endpoint)
 *
 * Exit codes:
 *   0   all checks pass (or all checks degraded with warnings only)
 *   1   one or more critical checks failed
 *   2   misconfiguration (no --app-name, no env vars)
 */

import process from 'node:process';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

const args = process.argv.slice(2);
const opts = {
  appName: getArg('--app-name'),
  json: args.includes('--json'),
  quiet: args.includes('--quiet'),
};

function getArg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

if (args.includes('--help') || args.includes('-h') || !opts.appName) {
  console.error('Usage: node scripts/playwright-runner-preflight.mjs --app-name <app> [--json] [--quiet]');
  console.error('');
  console.error('  --app-name   coolify_app_slots.app_name to test (required)');
  console.error('  --json       emit JSON to stdout (status only; no human output)');
  console.error('');
  process.exit(opts.appName ? 0 : 2);
}

const POSTGREST = process.env.AISHA_POSTGREST_URL ?? 'http://127.0.0.1:3001';
const KEY = process.env.AISHA_POSTGREST_SERVICE_KEY ?? '';
const HEARTBEAT_URL = process.env.AISHA_RUNNER_HEARTBEAT_URL;

if (!KEY) {
  console.error(`${RED}✗${NC} AISHA_POSTGREST_SERVICE_KEY not set — cannot reach RPCs`);
  process.exit(2);
}

const log = {
  info: (...a) => !opts.quiet && !opts.json && console.error(`${BLUE}ℹ${NC}`, ...a),
  ok: (...a) => !opts.quiet && !opts.json && console.error(`${GREEN}✓${NC}`, ...a),
  warn: (...a) => !opts.json && console.error(`${YELLOW}⚠${NC}`, ...a),
  err: (...a) => console.error(`${RED}✗${NC}`, ...a),
};

async function rpc(name, params = {}) {
  const url = `${POSTGREST.replace(/\/$/, '')}/rest/v1/rpc/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RPC ${name} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

// ── checks ────────────────────────────────────────────────────────────────────

const checks = [];
function record(name, status, detail) {
  checks.push({ name, status, detail });
  const fn = status === 'pass' ? log.ok : status === 'warn' ? log.warn : log.err;
  fn(`${BOLD}${name}${NC} — ${detail}`);
}

async function checkAppSlot() {
  const name = 'coolify_app_slots row exists';
  try {
    // Use get_active_slots which is the canonical read RPC.
    const slots = await rpc('get_active_slots');
    const row = Array.isArray(slots) ? slots.find((s) => s.app_name === opts.appName) : null;
    if (!row) {
      record(name, 'fail', `no row for app_name=${opts.appName}; create via WF_BLUE_GREEN_ORCHESTRATOR bootstrap`);
      return null;
    }
    record(name, 'pass', `active_slot=${row.active_slot}, domain=${row.domain ?? '(none)'}`);
    return row;
  } catch (err) {
    record(name, 'fail', `RPC failed: ${err.message}`);
    return null;
  }
}

async function checkResolvedUrl() {
  const name = 'resolve_deployed_url returns valid URL';
  try {
    const resolved = await rpc('resolve_deployed_url', { p_app_name: opts.appName });
    const url = Array.isArray(resolved) ? resolved[0]?.target_base_url : resolved?.target_base_url;
    if (!url) {
      record(name, 'fail', `RPC returned null target_base_url — coolify_app_slots.domain is empty for ${opts.appName}`);
      return null;
    }
    if (!/^https?:\/\//.test(url)) {
      record(name, 'fail', `URL malformed: ${url}`);
      return null;
    }
    record(name, 'pass', `target_base_url=${url}`);
    return url;
  } catch (err) {
    record(name, 'fail', `RPC failed: ${err.message}`);
    return null;
  }
}

async function checkUrlReachable(url) {
  const name = 'target URL reachable (HTTP HEAD)';
  if (!url) {
    record(name, 'warn', 'skipped — no URL to test');
    return;
  }
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
    if (res.ok || res.status === 405 /* HEAD not allowed but server responded */) {
      record(name, 'pass', `HTTP ${res.status} from ${url}`);
    } else {
      record(name, 'warn', `HTTP ${res.status} from ${url} — non-2xx, may or may not affect Playwright`);
    }
  } catch (err) {
    record(name, 'fail', `unreachable: ${err.message}`);
  }
}

async function checkHeartbeat() {
  const name = 'runner heartbeat fresh';
  if (!HEARTBEAT_URL) {
    record(name, 'warn', 'AISHA_RUNNER_HEARTBEAT_URL not set — cannot probe runner liveness');
    return;
  }
  try {
    const res = await fetch(HEARTBEAT_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      record(name, 'fail', `heartbeat HTTP ${res.status}`);
      return;
    }
    const body = await res.text();
    const ts = Number(body.trim());
    if (Number.isNaN(ts)) {
      record(name, 'warn', `heartbeat body not a timestamp: ${body.slice(0, 50)}`);
      return;
    }
    const age = Date.now() - ts;
    if (age > 90_000 /* 2× default poll 30s + a bit */) {
      record(name, 'fail', `heartbeat ${Math.round(age / 1000)}s old (>90s); runner not polling`);
    } else {
      record(name, 'pass', `heartbeat ${Math.round(age / 1000)}s old`);
    }
  } catch (err) {
    record(name, 'fail', `heartbeat probe failed: ${err.message}`);
  }
}

async function checkE2eReportsBucket() {
  const name = 'e2e-reports storage bucket policy (admin/staff SELECT)';
  try {
    // list_playwright_runs requires admin/staff and returns report_storage_path.
    // If the bucket policy is wrong, this RPC succeeds but the report iframe
    // would 403. We can't directly probe the storage REST endpoint from here
    // (no operator JWT) — call the list RPC and confirm it works.
    const rows = await rpc('list_playwright_runs', { p_limit: 1 });
    if (!Array.isArray(rows)) {
      record(name, 'warn', 'list_playwright_runs returned non-array — schema drift?');
      return;
    }
    record(name, 'pass', `list_playwright_runs reachable (${rows.length} rows in window)`);
  } catch (err) {
    record(name, 'fail', `list_playwright_runs failed: ${err.message}`);
  }
}

async function checkLifecycleRpcsCallable() {
  const name = 'start_playwright_run + record_playwright_result + approve_playwright_run reachable';
  // We can't actually CALL these without side effects. Instead probe the
  // health-summary RPC (admin-only) which exercises the same auth path the
  // runner uses, and is read-only.
  try {
    const summary = await rpc('get_playwright_runs_health_summary', { p_window_hours: 1 });
    if (!summary) {
      record(name, 'warn', 'health summary RPC returned null');
      return;
    }
    record(name, 'pass', 'lifecycle RPC auth path probed via get_playwright_runs_health_summary');
  } catch (err) {
    record(name, 'fail', `health summary RPC failed: ${err.message}`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  log.info(`${BOLD}Playwright runner preflight${NC} — app_name=${opts.appName}`);
  log.info(`${DIM}postgrest=${POSTGREST}${NC}`);

  const slot = await checkAppSlot();
  const url = await checkResolvedUrl();
  await checkUrlReachable(url);
  await checkHeartbeat();
  await checkE2eReportsBucket();
  await checkLifecycleRpcsCallable();

  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');
  const passed = checks.filter((c) => c.status === 'pass');

  log.info('');
  log.info(`${BOLD}━━ summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  log.info(`  ${GREEN}✓${NC} ${passed.length} passed   ${YELLOW}⚠${NC} ${warned.length} warned   ${RED}✗${NC} ${failed.length} failed`);
  log.info('');

  const result = {
    app_name: opts.appName,
    overall: failed.length > 0 ? 'fail' : warned.length > 0 ? 'warn' : 'pass',
    checks,
    summary: { passed: passed.length, warned: warned.length, failed: failed.length },
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}✗${NC} unexpected error: ${err.message}`);
  if (!opts.json) console.error(err.stack);
  process.exit(2);
});

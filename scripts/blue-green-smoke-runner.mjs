#!/usr/bin/env node
// =============================================================================
// blue-green-smoke-runner.mjs — Smoke test executor pro B/G switch
// =============================================================================
// Konzumuje declarative config z config/blue-green-smoke.mjs a spouští smoke
// test idle slotu před tím, než blue-green-deploy.sh PATCH-ne BG_ACTIVE_HOST.
//
// Podporuje dvě metody (vybráno podle prostředí spuštění):
//   --method=api    Coolify API status poll. Funguje z libovolného prostředí
//                   (operator laptop, n8n workflow, CI), pouze potřebuje
//                   COOLIFY_API_KEY/TOKEN. Default — bezpečné pro manual fallback.
//   --method=http   Direct HTTP probe na internalUrl (např. http://aisha-X-blue/...).
//                   Vyžaduje, aby runner běžel uvnitř Coolify Docker network
//                   (n8n container, exec sandbox) — selže s ECONNREFUSED z LANu.
//
// Output: jeden JSON řádek na stdout pro programmatic konzumaci, lidsky čitelný
// stderr log. Exit code 0 = pass, 1 = fail (smoke), 2 = config/usage error.
//
// Spouští se z:
//   • scripts/blue-green-deploy.sh (Step 2/4 — replaces former stub)
//   • n8n WF_BLUE_GREEN_ORCHESTRATOR (call přes shell node z working tree)
// =============================================================================

import { smokeTests, resolveSmokeUrl } from "../config/blue-green-smoke.mjs";
import { jeProkazatelneZdrava, jeProkazatelneSpatna } from "./lib/coolify-app-status.mjs";

// ── Args ─────────────────────────────────────────────────────────────────────
function parseArgs() {
  const out = { method: "api" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 2) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (a.startsWith("--") && i + 1 < argv.length) {
      out[a.slice(2)] = argv[++i];
    } else if (a === "-h" || a === "--help") {
      out.help = true;
    }
  }
  return out;
}

function usage() {
  process.stderr.write(
    [
      "Usage: blue-green-smoke-runner.mjs --app <app> --slot <blue|green> [opts]",
      "",
      "Required:",
      "  --app <name>          App key from config/blue-green-smoke.mjs (keycloak, edge, …)",
      "  --slot <blue|green>   Target slot being tested",
      "",
      "Method-specific:",
      "  --uuid <coolify-uuid> [api method] Coolify application UUID",
      "  --method <api|http>   Probe method (default: api)",
      "",
      "Auth:",
      "  COOLIFY_API_TOKEN env var (or COOLIFY_API_KEY alias)",
      "  COOLIFY_URL env var (required for method=api; per-environment URL)",
      "",
      "Examples:",
      "  blue-green-smoke-runner.mjs --app keycloak --slot blue --uuid abc123",
      "  blue-green-smoke-runner.mjs --app edge --slot green --method http",
      "",
    ].join("\n"),
  );
}

const args = parseArgs();
if (args.help) {
  usage();
  process.exit(0);
}
if (!args.app || !args.slot) {
  usage();
  process.stderr.write("\nERROR: --app and --slot are required\n");
  process.exit(2);
}

const cfg = smokeTests[args.app];
if (!cfg) {
  process.stderr.write(
    `ERROR: no smoke contract for app "${args.app}" in config/blue-green-smoke.mjs\n` +
      `       available: ${Object.keys(smokeTests).join(", ")}\n`,
  );
  process.exit(2);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function emit(result) {
  // structured one-line JSON for programmatic consumption (n8n, bash)
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function withTimeout(promise, ms, label) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise(ctrl.signal);
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`${label} timeout after ${ms}ms`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Method: HTTP direct probe ────────────────────────────────────────────────
async function runHttpProbe() {
  const url = resolveSmokeUrl(cfg.internalUrl, args.slot, args.app);
  const expected = new Set(cfg.expectedStatus ?? [200]);
  let lastErr = null;
  for (let attempt = 1; attempt <= (cfg.retries ?? 1); attempt++) {
    try {
      const status = await withTimeout(
        async (signal) => {
          const res = await fetch(url, { signal: signal, redirect: "manual" });
          return res.status;
        },
        cfg.timeout_ms ?? 5000,
        `HTTP ${url}`,
      );
      if (expected.has(status)) {
        return { ok: true, method: "http", app: args.app, slot: args.slot, url, status, attempts: attempt };
      }
      lastErr = `unexpected status ${status} (expected one of ${[...expected].join(",")})`;
    } catch (err) {
      lastErr = err.message;
    }
    if (attempt < (cfg.retries ?? 1)) {
      process.stderr.write(`  attempt ${attempt}/${cfg.retries} failed: ${lastErr} — retry in ${cfg.retryDelayMs ?? 3000}ms\n`);
      await sleep(cfg.retryDelayMs ?? 3000);
    }
  }
  return { ok: false, method: "http", app: args.app, slot: args.slot, url, error: lastErr, attempts: cfg.retries ?? 1 };
}

// ── Method: Coolify API status poll ─────────────────────────────────────────
async function runCoolifyApiCheck() {
  if (!args.uuid) {
    return {
      ok: false,
      method: "api",
      app: args.app,
      slot: args.slot,
      error: "--uuid required for method=api (Coolify application UUID)",
    };
  }
  const token = process.env.COOLIFY_API_TOKEN ?? process.env.COOLIFY_API_KEY ?? "";
  if (!token) {
    return {
      ok: false,
      method: "api",
      app: args.app,
      slot: args.slot,
      error: "COOLIFY_API_TOKEN (or COOLIFY_API_KEY) env var is required",
    };
  }
  const rawBaseUrl = process.env.COOLIFY_URL ?? "";
  if (!rawBaseUrl) {
    return {
      ok: false,
      method: "api",
      app: args.app,
      slot: args.slot,
      error: "COOLIFY_URL env var is required (per-environment Coolify base URL — frontend/backend/staging/etc.)",
    };
  }
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/api/v1/applications/${args.uuid}`;

  let lastErr = null;
  for (let attempt = 1; attempt <= (cfg.retries ?? 5); attempt++) {
    try {
      const status = await withTimeout(
        async (signal) => {
          const res = await fetch(endpoint, {
            signal: signal,
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          return json.status ?? "unknown";
        },
        cfg.timeout_ms ?? 5000,
        `Coolify API`,
      );
      // Coolify status format: e.g. "running:healthy", "exited:unhealthy", "starting"
      // Pass when running and healthy; transient "starting" → retry; fail otherwise.
      //
      // ⛔ NAMĚŘENO 2026-08-17: dřívější `/running.*healthy/i` propouštělo i
      // `running:unhealthy` — `.*` přeskočilo „un". B/G přepnutí tak mohlo
      // proběhnout nad slotem, jehož kontejner neprocházel healthcheckem.
      if (jeProkazatelneZdrava(status)) {
        return { ok: true, method: "api", app: args.app, slot: args.slot, status, attempts: attempt };
      }
      if (jeProkazatelneSpatna(status)) {
        // hard fail — don't retry on definitive bad state past first observation
        if (attempt >= 2) {
          return {
            ok: false,
            method: "api",
            app: args.app,
            slot: args.slot,
            status,
            attempts: attempt,
            error: `app reached terminal unhealthy state: ${status}`,
          };
        }
      }
      lastErr = `status="${status}" not yet running:healthy`;
    } catch (err) {
      lastErr = err.message;
    }
    if (attempt < (cfg.retries ?? 5)) {
      process.stderr.write(
        `  attempt ${attempt}/${cfg.retries ?? 5}: ${lastErr} — retry in ${cfg.retryDelayMs ?? 5000}ms\n`,
      );
      await sleep(cfg.retryDelayMs ?? 5000);
    }
  }
  return {
    ok: false,
    method: "api",
    app: args.app,
    slot: args.slot,
    error: lastErr ?? "exceeded retries",
    attempts: cfg.retries ?? 5,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
let result;
try {
  if (args.method === "http") {
    result = await runHttpProbe();
  } else if (args.method === "api") {
    result = await runCoolifyApiCheck();
  } else {
    process.stderr.write(`ERROR: unsupported --method "${args.method}" (use api or http)\n`);
    process.exit(2);
  }
} catch (err) {
  result = { ok: false, method: args.method, app: args.app, slot: args.slot, error: err?.message ?? String(err) };
}

emit(result);
process.exit(result.ok ? 0 : 1);

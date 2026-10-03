#!/usr/bin/env node
/**
 * aisha-mesh-toggle.mjs — Flip the platform's mesh routing on/off.
 *
 * Single switch (`MESH_ENABLED`) controls how edge-proxy reaches backend
 * services when those services live on a different server (Frontend→Backend):
 *
 *   off (default):  edge-proxy → public TLS to *.backend.${INTERNAL_TLD} via Backend's
 *                   Traefik. Cross-server reach without mesh dependency.
 *                   This is the current de-facto stable state — works
 *                   regardless of NetBird/PKI bootstrap progress.
 *
 *   on:             edge-proxy → mesh-router (iptables DNAT 8080/3001)
 *                   → WireGuard wt0 → core peer. Requires healthy
 *                   netbird-internal-tls + valid AISHA PKI cert.
 *
 * What this script does:
 *   1. Reads COOLIFY_API_TOKEN from .env-prod-backup (or env override).
 *   2. Resolves the <APP_NAME_PREFIX>-edge app uuid via /applications, confined
 *      to COOLIFY_PROJECT_UUID (double gate: project scope AND app prefix).
 *   3. PATCHes envs/bulk to set MESH_ENABLED=<true|false>.
 *   4. Triggers redeploy with force=true.
 *   5. Polls until edge-proxy reports healthy or timeout.
 *
 * Modes:
 *   --status              Show current MESH_ENABLED + edge-proxy upstream
 *                         pinning (per-service overrides, if any).
 *   --on                  Set MESH_ENABLED=true + redeploy edge.
 *   --off                 Set MESH_ENABLED=false + redeploy edge.
 *   --pin-mcp <URL>       Pin MCP_UPSTREAM regardless of MESH_ENABLED.
 *   --pin-api <URL>       Pin API_UPSTREAM regardless of MESH_ENABLED.
 *   --pin-dirigent <URL>  Pin DIRIGENT_UPSTREAM regardless of MESH_ENABLED.
 *   --unpin               Remove all per-service upstream pins.
 *   --no-deploy           Don't trigger redeploy (env change only).
 *   --no-wait             Trigger redeploy but don't wait for healthy.
 *
 * Examples:
 *   node scripts/aisha-mesh-toggle.mjs --status
 *   node scripts/aisha-mesh-toggle.mjs --off
 *   node scripts/aisha-mesh-toggle.mjs --on
 *   node scripts/aisha-mesh-toggle.mjs --pin-api https://api.example.com
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectScope } from "./lib/coolify-project-scope.mjs";
import { toStoryApp, appPrefix } from "./lib/story-app.mjs";
import { createCoolifyClient } from "./lib/coolify-http.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
// Slot-aware: a fork/story deploy keeps its operator env in its OWN backup file
// (config/coolify-environments.env → COOLIFY_<SLOT>_ENV_BACKUP, e.g.
// .env-<fork>-staging-backup). Falling back to the upstream .env-prod-backup would
// read ANOTHER tenant's token. COOLIFY_ENV_BACKUP lets the wrapper pass the slot's.
const ENV_BACKUP = resolve(ROOT, process.env.COOLIFY_ENV_BACKUP || ".env-prod-backup");

// This deployment's edge app name — every user-facing message must name the app
// it ACTUALLY touched. Printing a literal "aisha-edge" while holding a riq uuid is
// how the cross-tenant bug hid in plain sight (--status looked fine).
const EDGE_APP = toStoryApp("aisha-edge");

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const flag = (name) => argv.includes(name);

const STATUS = flag("--status");
const ON = flag("--on");
const OFF = flag("--off");
const NO_DEPLOY = flag("--no-deploy");
const NO_WAIT = flag("--no-wait");
const PIN_MCP = arg("--pin-mcp");
const PIN_API = arg("--pin-api");
const PIN_DIRIGENT = arg("--pin-dirigent");
const UNPIN = flag("--unpin");

if (!STATUS && !ON && !OFF && !PIN_MCP && !PIN_API && !PIN_DIRIGENT && !UNPIN) {
  console.error("Usage: aisha-mesh-toggle.mjs (--status|--on|--off|--pin-* <url>|--unpin)");
  process.exit(2);
}
if (ON && OFF) {
  console.error("Cannot specify both --on and --off");
  process.exit(2);
}

// ── Color helpers ────────────────────────────────────────────────────────────
const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const ok = (s) => console.log(`  ${C.green("✓")} ${s}`);
const info = (s) => console.log(`  ${C.blue("ℹ")} ${s}`);
const warn = (s) => console.log(`  ${C.yellow("⚠")} ${s}`);
const err = (s) => console.error(`  ${C.red("✗")} ${s}`);

// ── Coolify API client ───────────────────────────────────────────────────────
function loadToken() {
  if (process.env.COOLIFY_API_TOKEN) {
    return process.env.COOLIFY_API_TOKEN.replace(/^["']|["']$/g, "");
  }
  if (!existsSync(ENV_BACKUP)) {
    throw new Error(`COOLIFY_API_TOKEN not set and ${ENV_BACKUP} missing`);
  }
  for (const line of readFileSync(ENV_BACKUP, "utf8").split(/\r?\n/)) {
    if (line.startsWith("COOLIFY_API_TOKEN=")) {
      return line.slice("COOLIFY_API_TOKEN=".length).trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("COOLIFY_API_TOKEN not found");
}

const TOKEN = loadToken();
const COOLIFY_BASE = (() => {
  const v = process.env.COOLIFY_URL;
  if (!v) { process.stderr.write("FATAL: COOLIFY_URL required\n"); process.exit(2); }
  return v;
})();

// ⛔ VLASTNÍ KOPIE KLIENTA opakovala jen 5xx a síťové výpadky — 429 NE. Přitom
// tenhle skript běží v cold-startu, kde je rozpočet požadavků (200/okno)
// vyčerpaný a fronta nasazení plná. Sdílený klient obě podoby 429 rozlišuje
// a ctí `Retry-After`; plnou frontu značí `err.backpressure`.
const coolify = createCoolifyClient({ baseUrl: COOLIFY_BASE, token: TOKEN });


// ── Resolve <prefix>-edge uuid ───────────────────────────────────────────────
// DOUBLE GATE (project scope AND app prefix), mirroring aisha-redeploy.mjs:431
// and coolify-wipe-all.mjs: either gate alone failing makes this a no-op rather
// than a cross-tenant write.
//
// WHY: this tool matched `a.name === "aisha-edge"` literally — the one survivor
// of the #600 prefix generalisation that lib/story-app.mjs was created for
// ("Every tool that matched apps by a hardcoded `aisha-` prefix silently did
// nothing on a non-aisha deploy"). Here it was worse than a no-op: on a fork
// (APP_NAME_PREFIX=riq) `--on/--off` resolved AISHA's edge and would have
// flipped mesh routing on a FOREIGN production tenant sharing the Coolify node.
// Caught 2026-07-16 by --status printing "aisha-edge uuid: sasg…" during a riq
// deploy (<fork>-edge is k26v…). Same class as #600/#603/#617.
async function resolveEdgeUuid() {
  const wanted = toStoryApp("aisha-edge"); // "aisha-edge" → "<prefix>-edge"
  // NOT wrapped in try/catch on purpose: createProjectScope throws without
  // COOLIFY_PROJECT_UUID ("refusing to enumerate or mutate Coolify resources by
  // global name prefix on a SHARED host"). Swallowing that would restore the
  // cross-tenant hole this fix closes. No global fallback — same as redeploy:428.
  const scope = await createProjectScope(coolify);
  const apps = await coolify("/applications");
  const scoped = (apps || []).filter((a) => scope.inProject(a) && a.name === wanted);

  if (scoped.length === 0) {
    throw new Error(
      `${wanted} application not found in Coolify project ${scope.projectUuid}.\n` +
        `APP_NAME_PREFIX=${appPrefix()} — set it to this deployment's prefix ` +
        `(the prefix its Coolify apps are named with) and COOLIFY_PROJECT_UUID to its project.`,
    );
  }
  if (scoped.length > 1) {
    throw new Error(
      `Ambiguous: ${scoped.length} apps named ${wanted} in project ` +
        `${scope.projectUuid} (${scoped.map((a) => a.uuid).join(", ")}).`,
    );
  }
  return scoped[0].uuid;
}

async function readEnv(uuid) {
  const envs = await coolify(`/applications/${uuid}/envs`);
  // Coolify keeps TWO env sets per app and /envs returns BOTH interleaved: the
  // production set (is_preview=false) and the preview-deployment set
  // (is_preview=true). Every key therefore appears twice.
  //
  // Ignoring that flag meant the preview row overwrote the production row in the
  // key→value map (last-wins), so --status reported the PREVIEW value as if it
  // were live. Invisible while both sets agree — which they do for every key
  // until someone writes one side. Caught 2026-07-16: --off correctly set
  // production MESH_ENABLED=false, then --status read back "true" (the preview
  // row) and looked like a silently dropped write.
  //
  // This tool only ever manages production routing → production rows only.
  const out = {};
  const entries = [];
  for (const e of envs || []) {
    if (e.is_preview) continue;
    out[e.key] = e.value;
    entries.push(e);
  }
  return { values: out, entries };
}

async function setEnv(uuid, kv) {
  // Split into upserts (non-empty values) and deletes (empty/null values).
  // PATCH /envs/bulk with value="" is silent-dropped by Coolify v4; use the
  // per-key DELETE endpoint for clearing.
  const upserts = [];
  const deletes = [];
  for (const [key, value] of Object.entries(kv)) {
    if (value === "" || value === null || value === undefined) {
      deletes.push(key);
    } else {
      upserts.push({ key, value, is_build_time: false, is_preview: false });
    }
  }

  if (upserts.length > 0) {
    await coolify(`/applications/${uuid}/envs/bulk`, {
      method: "PATCH",
      body: { data: upserts },
    });
  }

  if (deletes.length > 0) {
    // Need env entry uuids for DELETE — re-read to get fresh list
    const { entries } = await readEnv(uuid);
    for (const key of deletes) {
      const entry = entries.find((e) => e.key === key);
      if (!entry) continue; // already absent
      await coolify(`/applications/${uuid}/envs/${entry.uuid}`, {
        method: "DELETE",
        timeoutMs: 30_000,
      }).catch((e) => warn(`DELETE ${key} (${entry.uuid}): ${e.message}`));
    }
  }
}

async function triggerDeploy(uuid) {
  return coolify(`/deploy?uuid=${uuid}&force=true`, { method: "POST" });
}

async function waitForHealthy(uuid, timeoutMs = 180_000) {
  const start = Date.now();
  let lastStatus = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const app = await coolify(`/applications/${uuid}`, { timeoutMs: 15_000 });
      const status = app?.status ?? "unknown";
      if (status !== lastStatus) {
        info(`status: ${status}`);
        lastStatus = status;
      }
      if (status === "running:healthy") return true;
    } catch (e) {
      warn(`status poll: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return false;
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`\n${C.bold("aisha-mesh-toggle")} — edge backend routing strategy\n`);
// Print the guard's reason, not a stack trace: both failure modes here are
// operator misconfiguration with a specific remedy (declare the project /
// the app prefix), and the safety rationale is the message itself.
let uuid;
try {
  uuid = await resolveEdgeUuid();
} catch (e) {
  err(e.message);
  process.exit(2);
}
info(`${EDGE_APP} uuid: ${uuid} (project ${process.env.COOLIFY_PROJECT_UUID})`);

const { values: env } = await readEnv(uuid);
const current = (env.MESH_ENABLED ?? "false").toLowerCase();
const meshOn = ["true", "1", "yes", "on"].includes(current);

console.log();
console.log(C.bold("  Current state:"));
console.log(`    MESH_ENABLED       ${meshOn ? C.green("true (mesh ON)") : C.yellow("false (mesh OFF)")}`);
console.log(`    MCP_UPSTREAM       ${env.MCP_UPSTREAM || C.dim("(derived from MESH_ENABLED)")}`);
console.log(`    API_UPSTREAM       ${env.API_UPSTREAM || C.dim("(derived from MESH_ENABLED)")}`);
console.log(`    DIRIGENT_UPSTREAM  ${env.DIRIGENT_UPSTREAM || C.dim("(derived from MESH_ENABLED)")}`);
console.log();

if (STATUS) {
  process.exit(0);
}

// ── Determine target env ─────────────────────────────────────────────────────
const targetEnv = {};
if (ON) targetEnv.MESH_ENABLED = "true";
if (OFF) targetEnv.MESH_ENABLED = "false";
if (PIN_MCP) targetEnv.MCP_UPSTREAM = PIN_MCP;
if (PIN_API) targetEnv.API_UPSTREAM = PIN_API;
if (PIN_DIRIGENT) targetEnv.DIRIGENT_UPSTREAM = PIN_DIRIGENT;
if (UNPIN) {
  targetEnv.MCP_UPSTREAM = "";
  targetEnv.API_UPSTREAM = "";
  targetEnv.DIRIGENT_UPSTREAM = "";
}

console.log(C.bold("  Applying:"));
for (const [k, v] of Object.entries(targetEnv)) {
  console.log(`    ${k.padEnd(18)} = ${v === "" ? C.dim("<unset>") : v}`);
}
console.log();

await setEnv(uuid, targetEnv);
ok(`env updated on ${EDGE_APP}`);

if (NO_DEPLOY) {
  warn("--no-deploy: skipping redeploy. Run a redeploy manually for changes to take effect.");
  process.exit(0);
}

console.log();
info("triggering redeploy");
const deploy = await triggerDeploy(uuid);
ok(`deploy queued: ${deploy?.deployment_uuid || JSON.stringify(deploy).slice(0, 60)}`);

if (NO_WAIT) {
  console.log();
  warn("--no-wait: skipping health wait. Check status with:");
  console.log(`    node scripts/aisha-mesh-toggle.mjs --status`);
  process.exit(0);
}

console.log();
info(`waiting for ${EDGE_APP} to settle to running:healthy (up to 180s)`);
const healthy = await waitForHealthy(uuid, 180_000);

console.log();
if (healthy) {
  ok(`${EDGE_APP} healthy. Mesh mode: ${ON ? "ON" : OFF ? "OFF" : "(unchanged)"}`);
  process.exit(0);
} else {
  err("timeout waiting for healthy. Check logs:");
  console.log(`    Coolify UI: ${COOLIFY_BASE}/applications/${uuid}/logs`);
  process.exit(1);
}

#!/usr/bin/env node
// =============================================================================
// coolify-drift-check.mjs — Detekuje divergence mezi git manifestem a live
// Coolify state (orphaned apps, missing apps, compose drift, env drift).
// =============================================================================
//
// Use cases:
//   - Periodicky (CI / cron): "změnil se Coolify state proti gitu?"
//   - Pre-deploy: "co se stane když re-deploynu?"
//   - Post-incident: "co bylo manuálně přepsáno v UI?"
//
// 4 kategorie driftu:
//   1. ORPHANED   — app v Coolify, ale ne v manifestu (manuálně přidaná?)
//   2. MISSING    — app v manifestu, ale ne v Coolify (smazaná?)
//   3. COMPOSE    — docker_compose_location v Coolify ≠ manifest
//   4. SERVER     — app na jiném serveru než manifest říká
//
// Exit codes:
//   0 — žádný drift
//   1 — fatal drift (orphaned/missing apps)
//   2 — warning drift (jen compose/server divergence)
//
// Usage:
//   node scripts/coolify-drift-check.mjs                # pretty output
//   node scripts/coolify-drift-check.mjs --json         # machine-readable
//   node scripts/coolify-drift-check.mjs --fix-compose  # patch docker_compose_location na manifest hodnoty
//   node scripts/coolify-drift-check.mjs --manifest <path>   # explicitní manifest
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectScope } from "./lib/coolify-project-scope.mjs";
import {
  resolveManifestPath,
  assertManifestMatchesInstance,
} from "./lib/coolify-instance-scope.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// Which instance does this run serve, and may it act on this manifest? Both
// answers come from lib/coolify-instance-scope.mjs so the boundary is shared with
// every other tool (and with the shell) instead of re-derived here.
const MANIFEST_PATH = (() => {
  const flag = process.argv.indexOf("--manifest");
  const explicit = flag > -1 ? process.argv[flag + 1] : undefined;
  const path = resolveManifestPath({ explicit });
  // Refuses a manifest belonging to another instance — including one passed
  // explicitly, which is how a foreign inventory would otherwise get applied here.
  assertManifestMatchesInstance(path);
  return path;
})();
const ENV_BACKUP = join(REPO_ROOT, ".env-prod-backup");

const argv = process.argv.slice(2);
const JSON_MODE = argv.includes("--json");
const FIX_COMPOSE = argv.includes("--fix-compose");
const HELP = argv.includes("--help") || argv.includes("-h");

if (HELP) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf-8")
    .split("\n").filter((_, i) => i < 32).join("\n"));
  process.exit(0);
}

// ── Config ──────────────────────────────────────────────────────────────────
const COOLIFY_BASE = (() => {
  const v = process.env.COOLIFY_BASE_URL;
  if (!v) { process.stderr.write("FATAL: COOLIFY_BASE_URL required\n"); process.exit(2); }
  return v;
})();
const API_BASE = `${COOLIFY_BASE}/api/v1`;

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

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const log = JSON_MODE ? () => {} : (...a) => console.log(...a);
const ok = (s) => log(`  ${C.green("✓")} ${s}`);
const warn = (s) => log(`  ${C.yellow("⚠")} ${s}`);
const fail = (s) => log(`  ${C.red("✗")} ${s}`);
const info = (s) => log(`  ${C.blue("ℹ")} ${s}`);

async function coolify(path, { method = "GET", body, timeoutMs = 20_000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ── Parse manifest ──────────────────────────────────────────────────────────
function parseManifest(text) {
  const apps = [];
  // The manifest DECLARES its story (`story: <instance>`), and Coolify app
  // names are `<story>-<role>`. That declaration is the app-name prefix — it was
  // previously hardcoded to `aisha-`, so on any other instance every app came out
  // as MISSING (manifest side) while the live apps were invisible (filter side).
  const story = /^story:\s*(\S+)\s*$/m.exec(text)?.[1];
  if (!story) {
    throw new Error(
      `manifest has no 'story:' line — cannot derive the Coolify app-name prefix. ` +
        "Add e.g. 'story: aisha' (see coolify/manifests/_template.manifest).",
    );
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^app:\s*([a-z0-9_-]+):([a-z0-9_-]+):(\S+?\.yml)(?::(\S+))?\s*$/i);
    if (!m) continue;
    const tags = {};
    if (m[4]) {
      // Tags separator: comma (`,`) or colon (`:`) — both supported
      for (const part of m[4].split(/[,:]/)) {
        const eq = part.indexOf("=");
        if (eq > 0) tags[part.slice(0, eq)] = part.slice(eq + 1);
        else if (part) tags[part] = true;
      }
    }
    apps.push({
      name: m[1],
      coolifyName: `${story}-${m[1]}`,
      host: m[2],
      composeFile: m[3],
      tags,
    });
  }
  return { apps, story };
}

// ── Server name → UUID resolution ───────────────────────────────────────────
// UUIDs are deployment-specific and must be read from env (set by
// cold-start from operator's .env-prod-backup or Coolify API discovery).
// Returns null when the env var for that host is not set, which signals
// "skip drift check for this server" upstream.
function serverUuidFor(host) {
  const map = {
    frontend: process.env.COOLIFY_SERVER_UUID_FRONTEND,
    backend:  process.env.COOLIFY_SERVER_UUID_BACKEND,
    experimental: process.env.COOLIFY_SERVER_UUID_EXPERIMENTAL,
  };
  return map[host] || null;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log(C.bold("\n🔍 Coolify drift check\n"));
  log(`  ${C.dim("Coolify:")}  ${COOLIFY_BASE}`);
  log(`  ${C.dim("Manifest:")} ${MANIFEST_PATH}`);
  log("");

  // Load manifest
  if (!existsSync(MANIFEST_PATH)) {
    fail(`Manifest missing: ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const { apps: manifestApps, story } = parseManifest(readFileSync(MANIFEST_PATH, "utf-8"));
  info(`Manifest declares ${manifestApps.length} apps`);

  // Fetch live Coolify state
  let liveApps;
  try {
    liveApps = await coolify("/applications");
  } catch (e) {
    fail(`Coolify API failed: ${e.message}`);
    process.exit(1);
  }
  // Confine drift comparison to OUR project's environments — a foreign tenant's
  // same-named app on the shared host is not our drift. Fail-loud
  // without COOLIFY_PROJECT_UUID (no global fallback). The name filter uses the
  // manifest's own story, so a fork sees its apps instead of an empty set.
  const scope = await createProjectScope(coolify);
  const aishaLive = (liveApps || []).filter((a) => scope.inProject(a) && a.name?.startsWith(`${story}-`));
  info(`Coolify has ${aishaLive.length} ${story}-* apps`);
  log("");

  // Build sets for diff
  const manifestByName = new Map(manifestApps.map((a) => [a.coolifyName, a]));
  const liveByName = new Map(aishaLive.map((a) => [a.name, a]));

  const drift = {
    orphaned: [],   // in Coolify but not in manifest
    missing: [],    // in manifest but not in Coolify
    composeDrift: [],  // docker_compose_location mismatch
    serverDrift: [],   // server_uuid mismatch
  };

  // 1. Orphaned (live but not declared)
  for (const [name, app] of liveByName) {
    if (!manifestByName.has(name)) {
      drift.orphaned.push({ name, uuid: app.uuid, server: app.server_uuid });
    }
  }

  // 2. Missing (declared but not live)
  for (const [name] of manifestByName) {
    if (!liveByName.has(name)) {
      drift.missing.push({ name });
    }
  }

  // 3. Compose drift
  for (const [name, app] of liveByName) {
    const manifest = manifestByName.get(name);
    if (!manifest) continue;
    const liveCompose = (app.docker_compose_location || "").replace(/^\//, "");
    const expectedCompose = manifest.composeFile;
    if (liveCompose !== expectedCompose) {
      drift.composeDrift.push({
        name,
        live: liveCompose || "(empty)",
        expected: expectedCompose,
        uuid: app.uuid,
      });
    }
  }

  // 4. Server drift
  for (const [name, app] of liveByName) {
    const manifest = manifestByName.get(name);
    if (!manifest) continue;
    const expectedUuid = serverUuidFor(manifest.host);
    if (expectedUuid && app.server_uuid && app.server_uuid !== expectedUuid) {
      drift.serverDrift.push({
        name,
        liveServer: app.server_uuid,
        expectedServer: expectedUuid,
        expectedHost: manifest.host,
        uuid: app.uuid,
      });
    }
  }

  // Render
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(drift, null, 2) + "\n");
  } else {
    log(C.bold("Drift report:"));
    if (drift.orphaned.length === 0 && drift.missing.length === 0
        && drift.composeDrift.length === 0 && drift.serverDrift.length === 0) {
      ok("No drift detected — Coolify state matches manifest exactly");
    }

    if (drift.orphaned.length > 0) {
      log(`\n  ${C.red("ORPHANED")} (in Coolify, not in manifest):`);
      for (const a of drift.orphaned) {
        log(`    ${a.name.padEnd(30)} ${C.dim(a.uuid)}`);
      }
      log(`  ${C.dim("Action: review intentional manual additions, or remove via Coolify UI.")}`);
    }

    if (drift.missing.length > 0) {
      log(`\n  ${C.red("MISSING")} (in manifest, not in Coolify):`);
      for (const a of drift.missing) {
        log(`    ${a.name}`);
      }
      // Quote THIS run's manifest, not a fixed one: following the old line on a
      // fork would hand story-init another instance's inventory and create its
      // apps here.
      log(`  ${C.dim(`Action: bash scripts/coolify-story-init.sh --manifest ${relative(REPO_ROOT, MANIFEST_PATH) || MANIFEST_PATH}`)}`);
    }

    if (drift.composeDrift.length > 0) {
      log(`\n  ${C.yellow("COMPOSE_DRIFT")} (docker_compose_location mismatch):`);
      for (const a of drift.composeDrift) {
        log(`    ${a.name.padEnd(22)} live=${a.live}`);
        log(`    ${" ".repeat(22)} want=${a.expected}`);
      }
      log(`  ${C.dim("Action: --fix-compose patches Coolify docker_compose_location to manifest values.")}`);
    }

    if (drift.serverDrift.length > 0) {
      log(`\n  ${C.yellow("SERVER_DRIFT")} (app on wrong server):`);
      for (const a of drift.serverDrift) {
        log(`    ${a.name.padEnd(22)} expected ${a.expectedHost} (${a.expectedServer.slice(0,12)}…), live=${a.liveServer.slice(0,12)}…`);
      }
      log(`  ${C.dim("Action: requires manual move via Coolify UI (server change is destructive).")}`);
    }
  }

  // ── Optional fix mode ────────────────────────────────────────────────────
  if (FIX_COMPOSE && drift.composeDrift.length > 0) {
    log("");
    log(C.bold(C.yellow("━━━ FIX MODE — patching docker_compose_location ━━━")));
    for (const a of drift.composeDrift) {
      try {
        await coolify(`/applications/${a.uuid}`, {
          method: "PATCH",
          body: { docker_compose_location: `/${a.expected}` },
        });
        ok(`patched ${a.name}: ${a.live} → ${a.expected}`);
      } catch (e) {
        fail(`${a.name} patch failed: ${e.message}`);
      }
    }
  }

  // Exit code
  if (drift.orphaned.length > 0 || drift.missing.length > 0) {
    process.exit(1);  // fatal
  }
  if (drift.composeDrift.length > 0 || drift.serverDrift.length > 0) {
    process.exit(2);  // warning
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});

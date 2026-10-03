#!/usr/bin/env node
/**
 * bootstrap-env-from-coolify.mjs
 *
 * Extracts canonical env values from a Coolify project's existing apps and
 * writes them to a single env file (the file aisha-cold-start.sh expects at
 * the path defined by COOLIFY_<ENV>_ENV_BACKUP in config/coolify-environments.env).
 *
 * Use case:
 *   First-run autonomous cold-start for forks where the env-backup file
 *   doesn't yet exist on disk (gitignored). Without this helper the operator
 *   has to hand-curate dozens of secrets from the Coolify UI. With this
 *   helper, cold-start can bootstrap itself from the existing Coolify state.
 *
 * Why this exists:
 *   - cold-start-env.sh hard-fails if ENV_BACKUP missing → manual operator step
 *   - But all canonical secrets already exist on Coolify apps' Environment tab
 *   - Reading them via API and writing to the expected file = autonomous
 *
 * Aggregation policy (when same key appears in multiple apps):
 *   - First non-empty value wins (apps iterated in Coolify-returned order)
 *   - Drift warnings logged to stderr for keys with conflicting values
 *   - Operator must reconcile manually if drift detected
 *
 * File format:
 *   - KEY=VALUE per line (shell-source compatible)
 *   - Values containing newlines/quotes get heredoc encoding
 *   - File permissions 0600 (gitignored, owner-readable only)
 *   - Header comments document provenance + timestamp
 *
 * Usage:
 *   COOLIFY_API_TOKEN=… node scripts/lib/bootstrap-env-from-coolify.mjs \
 *     --coolify-url=https://<coolify-host> \
 *     --project-uuid=<project-uuid> \
 *     --output=<path-to-gitignored-env-backup>
 *
 * BEZPEČNOST: token se NEPŘEDÁVÁ argumentem. Argumenty procesu jsou v `ps`
 * čitelné každému uživateli na stroji; proměnná prostředí ne. Fork ho posílal
 * jako --coolify-token=… — sem jde mechanismus, ne ten způsob předání.
 *
 * Exit codes:
 *   0  — file written successfully
 *   1  — required arg missing
 *   2  — Coolify API failure
 *   3  — no apps found in project
 *   4  — output path is not writable
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hodnotaZCoolify } from "./coolify-env-hodnota.mjs";

/** @typedef {{value: string, source: string}} EnvSource */
/** @typedef {{key: string, value?: string, real_value?: string}} CoolifyEnv */
/** @typedef {{uuid: string, name: string, environment_id?: number, environment?: {project?: {uuid?: string}}}} CoolifyApp */

const argv = process.argv.slice(2);

/**
 * Read a CLI flag in `--name=value` OR `--name value` form.
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function flag(name, fallback = "") {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const space = argv.indexOf(`--${name}`);
  if (space >= 0 && space < argv.length - 1) return argv[space + 1];
  return fallback;
}

const COOLIFY_URL = flag("coolify-url");
const COOLIFY_TOKEN = process.env.COOLIFY_API_TOKEN || "";
const PROJECT_UUID = flag("project-uuid");
const OUTPUT = flag("output");
const FORCE = argv.includes("--force");

if (!COOLIFY_URL || !COOLIFY_TOKEN || !PROJECT_UUID || !OUTPUT) {
  console.error(
    "Usage: bootstrap-env-from-coolify.mjs " +
      "--coolify-url=URL --project-uuid=UUID --output=PATH [--force]\n" +
      "  COOLIFY_API_TOKEN must be in the ENVIRONMENT (never an argument — `ps` leaks argv)\n" +
      "  --force  overwrite existing OUTPUT (default: refuse)",
  );
  process.exit(1);
}

/**
 * Řídicí proměnné běhu cold-startu — NEJSOU konfigurace instance a do zálohy nepatří.
 *
 * Aplikace je v env mívají (netinit má v compose `DRY_RUN: ${DRY_RUN:-0}`). Kdyby
 * prošly do zálohy, cold-start by si je `load_env_file_keys … overwrite` načetl zpět
 * a přepsal příznak z příkazové řádky. NAMĚŘENO 2026-09-24: staging `--dry-run --wipe`
 * tak běžel naostro. Týž seznam drží scripts/lib/env-file-keys.sh (CS_RIDICI_PROMENNE);
 * shodu hlídá brána cold-start-zamer-behu-neprepise-soubor.
 */
const RIDICI_PROMENNE = new Set([
  "DRY_RUN",
  "SKIP_CREATE",
  "SKIP_DEPLOY",
  "SKIP_DOCTOR",
  "WIPE",
  "WIPE_VOLUMES",
  "SKIP_ORPHAN_CLEANUP",
  "WIPE_PENDING",
  "REWARMUP_APPS",
  "AISHA_ENV",
]);

const outAbs = resolve(OUTPUT);
if (existsSync(outAbs) && !FORCE) {
  console.error(`Refusing to overwrite ${outAbs} — pass --force to allow.`);
  process.exit(4);
}

/**
 * Fetch JSON from Coolify v1 API.
 * @param {string} path - e.g. "/applications"
 * @returns {Promise<unknown>}
 */
async function apiGet(path) {
  const res = await fetch(`${COOLIFY_URL}/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${COOLIFY_TOKEN}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Coolify GET ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Encode a value for shell-source-compatible env file.
 * Single-quote wrap, escape literal single quotes via `'\''`.
 * Multi-line values get heredoc.
 * @param {string} v
 * @returns {string}
 */
function encodeValue(v) {
  if (v.includes("\n")) {
    // Multi-line → heredoc. Marker chosen to be unlikely in content.
    const marker = "EOF_BOOTSTRAP_" + Math.random().toString(36).slice(2, 8).toUpperCase();
    return `<<'${marker}'\n${v}\n${marker}`;
  }
  // Single-line → single-quote wrap with escape for literal single quotes
  return `'${v.replace(/'/g, "'\\''")}'`;
}

// 1. Resolve project's environment IDs via /projects/{uuid}.
//    Coolify v4 doesn't expand environment.project.uuid on /applications, so we
//    look up the project's environment IDs (typically 2× per project: production
//    + development) and then filter /applications by environment_id.
/** @type {{environments?: Array<{id: number, name: string}>}} */
let projectDetail;
try {
  projectDetail = /** @type {{environments?: Array<{id: number, name: string}>}} */ (
    await apiGet(`/projects/${PROJECT_UUID}`)
  );
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Coolify GET /projects/${PROJECT_UUID} failed: ${msg}`);
  process.exit(2);
}

const projectEnvIds = new Set((projectDetail.environments ?? []).map((e) => e.id));
if (projectEnvIds.size === 0) {
  console.error(`Project ${PROJECT_UUID} has no environments`);
  process.exit(3);
}
console.error(
  `Project has ${projectEnvIds.size} environment(s): ` +
    (projectDetail.environments ?? []).map((e) => `${e.name}(id=${e.id})`).join(", "),
);

// 2. List all applications, then filter by environment_id ∈ projectEnvIds.
let appsList;
try {
  appsList = await apiGet("/applications");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Coolify GET /applications failed: ${msg}`);
  process.exit(2);
}

if (!Array.isArray(appsList)) {
  console.error(`Coolify /applications did not return array (got ${typeof appsList})`);
  process.exit(2);
}

/** @type {Array<CoolifyApp & {environment_id?: number}>} */
const typedApps = /** @type {Array<CoolifyApp & {environment_id?: number}>} */ (appsList);

const projectApps = typedApps.filter(
  (app) => typeof app.environment_id === "number" && projectEnvIds.has(app.environment_id),
);

if (projectApps.length === 0) {
  console.error(`No apps found in project ${PROJECT_UUID}`);
  process.exit(3);
}

console.error(`Discovered ${projectApps.length} apps in project ${PROJECT_UUID}`);

// Aggregate env values across apps. First non-empty value wins per key.
// Log drift warnings to stderr when same key has different values.
/** @type {Map<string, EnvSource>} */
const aggregated = new Map();
/** @type {Map<string, Array<{app: string, value: string}>>} */
const driftReport = new Map();

for (const app of projectApps) {
  /** @type {CoolifyEnv[]} */
  let envs;
  try {
    envs = /** @type {CoolifyEnv[]} */ (await apiGet(`/applications/${app.uuid}/envs`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Skipping ${app.name}: ${msg}`);
    continue;
  }
  if (!Array.isArray(envs)) continue;

  for (const e of envs) {
    const key = e.key;
    const value = hodnotaZCoolify(e);
    if (!key || !value) continue;
    if (RIDICI_PROMENNE.has(key)) continue;

    const existing = aggregated.get(key);
    if (!existing) {
      aggregated.set(key, { value, source: app.name });
    } else if (existing.value !== value) {
      // Drift: same key has different values across apps
      let drift = driftReport.get(key);
      if (!drift) {
        drift = [{ app: existing.source, value: existing.value }];
        driftReport.set(key, drift);
      }
      drift.push({ app: app.name, value });
    }
  }
}

// Drift warnings to stderr
if (driftReport.size > 0) {
  console.error("");
  console.error(`⚠ Drift detected for ${driftReport.size} key(s) — first value taken:`);
  for (const [key, sources] of driftReport) {
    console.error(`  ${key}:`);
    for (const s of sources) {
      const masked = s.value.length > 8 ? `${s.value.slice(0, 4)}…${s.value.slice(-2)} (len=${s.value.length})` : `(len=${s.value.length})`;
      console.error(`    ${s.app}: ${masked}`);
    }
  }
  console.error("");
  console.error("  ↑ Reconcile manually after bootstrap — drift means some apps");
  console.error("    have stale values. Re-run cold-start (without --wipe) to sync");
  console.error("    from the canonical file produced here.");
}

// Write output file. Format: shell-sourceable KEY=VALUE.
const lines = [
  "# ============================================================================",
  "# AUTO-GENERATED by scripts/lib/bootstrap-env-from-coolify.mjs",
  `# Generated at: ${new Date().toISOString()}`,
  `# Source: ${COOLIFY_URL} project=${PROJECT_UUID}`,
  `# Apps scanned: ${projectApps.length}`,
  `# Keys extracted: ${aggregated.size}`,
  `# Drift keys: ${driftReport.size}`,
  "# ============================================================================",
  "# CONFIDENTIAL: this file is gitignored. Permissions 0600. Owner-readable only.",
  "# Edit values manually after bootstrap. Subsequent cold-start runs",
  "# (without --wipe) PRESERVE these values via preserve_or_gen() in",
  "# aisha-cold-start.sh — fresh-generate only missing keys.",
  "# ============================================================================",
  "",
  "# Coolify access (required by cold-start-env.sh)",
  `COOLIFY_API_TOKEN=${encodeValue(COOLIFY_TOKEN)}`,
  `COOLIFY_URL=${encodeValue(COOLIFY_URL)}`,
  "",
  "# Extracted application env (key=value, alphabetical by key):",
];

const sortedKeys = [...aggregated.keys()].sort();
for (const key of sortedKeys) {
  const { value, source } = /** @type {EnvSource} */ (aggregated.get(key));
  // Skip COOLIFY_* keys re-set above (they appear in some apps' envs too)
  if (key === "COOLIFY_API_TOKEN" || key === "COOLIFY_URL") continue;
  lines.push(`# Source: ${source}`);
  lines.push(`${key}=${encodeValue(value)}`);
}

try {
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, lines.join("\n") + "\n", { mode: 0o600 });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Failed to write ${outAbs}: ${msg}`);
  process.exit(4);
}

console.error(`✓ Wrote ${aggregated.size} keys to ${outAbs}`);
console.error(`  Permissions: 0600 (owner-readable only)`);
if (driftReport.size > 0) {
  console.error(`  ⚠ ${driftReport.size} drift key(s) — see warnings above`);
}

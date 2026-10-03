#!/usr/bin/env node
/**
 * coolify-wipe-all.mjs — Cold-restart helper: smaže aisha-* aplikace,
 * databases a services JEN v NAŠEM Coolify projektu (vč. volumes a images).
 *
 * SAFETY (incident 2026-07-05): the Coolify host is SHARED with ~12 tenant
 * instances, all AISHA-based. A name prefix is NOT a safe boundary — another
 * tenant's `aisha-*` apps live in a different environment, and a tenant whose
 * apps are named `tenant-*` running this same filter would delete OUR apps and
 * none of its own. So the PRIMARY boundary is the declared project's
 * environments (createProjectScope, fail-loud without COOLIFY_PROJECT_UUID);
 * the `aisha-` prefix is only a secondary belt-and-braces filter WITHIN it.
 * Override prefix via --prefix=foo (NOT recommended).
 *
 * Bezpečnostní pojistka:
 *   - vyžaduje --confirm-wipe-everything
 *   - vyžaduje COOLIFY_API_TOKEN env (nebo z .env-prod-backup)
 *   - vyžaduje COOLIFY_PROJECT_UUID / COOLIFY_PROD_PROJECT_UUID (scope; fail-loud)
 *
 * Po dokončení: GET /applications | filter (in-project + aisha-*) → []
 *
 * Usage:
 *   COOLIFY_PROJECT_UUID=<uuid> node scripts/coolify-wipe-all.mjs --confirm-wipe-everything
 *   COOLIFY_PROJECT_UUID=<uuid> node scripts/coolify-wipe-all.mjs --confirm-wipe-everything --dry-run
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createCoolifyClient } from "./lib/coolify-http.mjs";
import { createProjectScope } from "./lib/coolify-project-scope.mjs";
import { appPrefix } from "./lib/story-app.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm-wipe-everything");
const DRY_RUN = args.includes("--dry-run");
const PREFIX_ARG = args.find((a) => a.startsWith("--prefix="));
const NAME_PREFIX = (PREFIX_ARG ? PREFIX_ARG.slice("--prefix=".length) : `${appPrefix()}-`).toLowerCase();

// PRESERVE list — apps/services/databases jejichž jméno (case-insensitive)
// JE v této množině NESMÍ být wipnuto, i když matchují --prefix.
//
// Default chrání `aisha-registry` (pull-through Docker Hub cache):
//   bez něj by každý cold-start musel pullovat všechny upstream images
//   přímo z hub.docker.io a okamžitě narazil na anonymous rate-limit.
//
// Override: --preserve=aisha-foo,aisha-bar  (override = nahradí default)
// Vypnutí ochrany: --preserve=  (prázdné — nic se nechrání, riskantní)
const PRESERVE_ARG = args.find((a) => a.startsWith("--preserve="));
const DEFAULT_PRESERVE = [`${appPrefix()}-registry`];
const PRESERVE_LIST = (
  PRESERVE_ARG !== undefined
    ? PRESERVE_ARG.slice("--preserve=".length).split(",")
    : DEFAULT_PRESERVE
)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const PRESERVE_SET = new Set(PRESERVE_LIST);

if (!CONFIRM) {
  console.error(
    "[wipe] Refusing to run without --confirm-wipe-everything. This DELETES production resources.",
  );
  process.exit(2);
}

const COOLIFY_BASE = (() => {
  const v = process.env.COOLIFY_BASE_URL;
  if (!v) { process.stderr.write("FATAL: COOLIFY_BASE_URL required\n"); process.exit(2); }
  return v;
})();
let TOKEN = process.env.COOLIFY_API_TOKEN ?? "";

if (!TOKEN) {
  const envFile = resolve(ROOT, ".env-prod-backup");
  if (existsSync(envFile)) {
    const txt = readFileSync(envFile, "utf-8");
    const m = txt.match(/^COOLIFY_API_TOKEN\s*=\s*"?([^"\n\r]+)"?/m);
    if (m) TOKEN = m[1].trim();
  }
}
if (!TOKEN) {
  console.error("[wipe] Missing COOLIFY_API_TOKEN (env or .env-prod-backup)");
  process.exit(2);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

// Return parsed JSON or raw text. Single-line `return` makes the intent
// (type-flexible body, not error swallowing) explicit and machine-checkable.
function parseJsonOrText(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function api(method, path, init = {}) {
  const url = `${COOLIFY_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: HEADERS,
    signal: AbortSignal.timeout(30_000),
    ...init,
  });
  const text = await res.text();
  // Coolify sometimes returns non-JSON (HTML error pages, plain text on 5xx).
  // We treat raw text as the body in those cases — not an error condition,
  // just protocol flexibility for downstream callers.
  const body = parseJsonOrText(text);
  return { ok: res.ok, status: res.status, body };
}

async function listAll(path) {
  const r = await api("GET", path);
  if (!r.ok) {
    console.error(`[wipe] GET ${path} -> ${r.status}`, r.body);
    return [];
  }
  return Array.isArray(r.body) ? r.body : [];
}

async function deleteOne(kind, uuid, name) {
  // Coolify v4 supports cleanup query params
  const path = `/api/v1/${kind}/${uuid}?cleanup=true&deleteVolumes=true&deleteImages=true&dockerCleanup=true&deleteConnectedNetworks=true`;
  if (DRY_RUN) {
    console.log(`[dry-run] DELETE ${kind}/${uuid} (${name})`);
    return true;
  }
  const r = await api("DELETE", path);
  if (r.ok || r.status === 404) {
    console.log(`[ok] ${kind} ${uuid} (${name}) deleted (status ${r.status})`);
    return true;
  }
  console.error(`[FAIL] ${kind} ${uuid} (${name}) -> ${r.status}`, r.body);
  return false;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function wipeKind(kind, label, scope) {
  console.log(`\n=== ${label} ===`);
  const allItems = await listAll(`/api/v1/${kind}`);
  // PRIMARY boundary: the declared project's environments. On a shared host a
  // name prefix is NOT a safe boundary (another tenant's aisha-* apps live in a
  // different environment); scope.inProject confines the wipe to OUR project so
  // it can never delete a foreign tenant's resources.
  const inScope = allItems.filter((it) => scope.inProject(it));
  const foreignAisha = allItems.filter(
    (it) => !scope.inProject(it) && String(it.name ?? "").toLowerCase().startsWith(NAME_PREFIX),
  );
  if (foreignAisha.length) {
    // Loud, non-fatal: a same-named resource in ANOTHER project is exactly what
    // the global name filter used to delete by mistake. We now skip it.
    console.log(
      `[wipe] SKIPPING ${foreignAisha.length} foreign "${NAME_PREFIX}" ${label} outside our project: ` +
        foreignAisha.map((it) => it.name).join(", "),
    );
  }
  // SECONDARY belt-and-braces: within our project, still honor the name prefix
  // so a stray non-aisha resource an operator parked in our project is left be.
  const matched = inScope.filter((it) =>
    String(it.name ?? "").toLowerCase().startsWith(NAME_PREFIX),
  );
  const items = matched.filter((it) => {
    const name = String(it.name ?? "").toLowerCase();
    return !PRESERVE_SET.has(name);
  });
  const preservedNames = matched
    .map((it) => String(it.name ?? "").toLowerCase())
    .filter((n) => PRESERVE_SET.has(n));
  const skipped = allItems.length - matched.length;
  console.log(
    `[wipe] ${items.length} ${label} in project + match prefix "${NAME_PREFIX}" (skipping ${skipped} out-of-scope/foreign resources)`,
  );
  if (preservedNames.length) {
    console.log(`[wipe] preserving ${preservedNames.length} ${label}: ${preservedNames.join(", ")}`);
  }
  let ok = 0,
    fail = 0;
  for (const it of items) {
    const uuid = it.uuid ?? it.id;
    const name = it.name ?? it.fqdn ?? "unnamed";
    if (!uuid) {
      console.warn("[wipe] item without uuid, skipping:", it);
      continue;
    }
    const success = await deleteOne(kind, uuid, name);
    if (success) ok++;
    else fail++;
    await sleep(800);
  }
  console.log(`[wipe] ${label}: ${ok} deleted, ${fail} failed`);
  return { ok, fail };
}

async function main() {
  console.log(`[wipe] Coolify base: ${COOLIFY_BASE}`);
  console.log(`[wipe] Mode: ${DRY_RUN ? "DRY-RUN" : "DESTRUCTIVE"}`);

  // Resolve the project scope FIRST. createProjectScope fails loud when no
  // COOLIFY_PROJECT_UUID/COOLIFY_PROD_PROJECT_UUID is declared — a destructive
  // wipe must never fall back to a global name filter on the shared host.
  const coolify = createCoolifyClient({ baseUrl: COOLIFY_BASE, token: TOKEN });
  const scope = await createProjectScope(coolify);
  console.log(
    `[wipe] scoped to project ${scope.projectUuid} (environment ids: ${[...scope.envIds].join(", ")})`,
  );

  const results = {};
  results.applications = await wipeKind("applications", "Applications", scope);
  results.services = await wipeKind("services", "Services", scope);
  results.databases = await wipeKind("databases", "Databases", scope);

  // Verify — count only IN-SCOPE survivors; a foreign tenant's aisha-* app is
  // not our concern and must not fail our wipe.
  console.log("\n=== Verify ===");
  const remaining = {};
  for (const k of ["applications", "services", "databases"]) {
    const list = await listAll(`/api/v1/${k}`);
    const matching = list.filter(
      (it) => scope.inProject(it) && String(it.name ?? "").toLowerCase().startsWith(NAME_PREFIX),
    );
    remaining[k] = matching.length;
    console.log(
      `[verify] ${k}: ${matching.length} remaining (in project + prefix "${NAME_PREFIX}")`,
    );
  }

  const totalFail =
    results.applications.fail + results.services.fail + results.databases.fail;
  const totalRemaining =
    remaining.applications + remaining.services + remaining.databases;

  if (DRY_RUN) {
    console.log("\n[wipe] DRY-RUN complete (no resources deleted)");
    process.exit(0);
  }
  if (totalFail > 0 || totalRemaining > 0) {
    console.error(
      `\n[wipe] INCOMPLETE: failed=${totalFail}, remaining=${totalRemaining}`,
    );
    process.exit(1);
  }
  console.log("\n[wipe] DONE: all resources removed cleanly");
}

main().catch((err) => {
  console.error("[wipe] FATAL:", err);
  process.exit(1);
});

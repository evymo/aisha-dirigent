#!/usr/bin/env node
/**
 * fix-empty-runtime-envs.mjs — removes empty is_buildtime=false duplicate env entries
 *
 * Problem: After fix-buildtime-flags.mjs set all entries to is_buildtime=true,
 * subsequent PATCH /envs/bulk calls created empty is_buildtime=false (runtime)
 * duplicates. Coolify includes BOTH in the compose .env file; the empty runtime
 * entry overwrites the buildtime entry → containers get empty passwords/secrets.
 *
 * Fix: DELETE all env var entries where is_buildtime=false AND value is empty,
 * but only if a non-empty is_buildtime=true entry exists for the same key.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectScope } from "./lib/coolify-project-scope.mjs";
import { hodnotaZCoolify } from "./lib/coolify-env-hodnota.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_BACKUP = resolve(ROOT, ".env-prod-backup");
const COOLIFY_BASE = (() => {
  const v = process.env.COOLIFY_BASE_URL;
  if (!v) { process.stderr.write("FATAL: COOLIFY_BASE_URL required\n"); process.exit(2); }
  return v;
})();
const API_BASE = `${COOLIFY_BASE}/api/v1`;
const DRY_RUN = process.argv.includes("--dry-run");

if (DRY_RUN) console.log("🔍 DRY RUN — no changes will be made");

function loadToken() {
  if (process.env.COOLIFY_API_TOKEN) {
    return process.env.COOLIFY_API_TOKEN.replace(/^["']|["']$/g, "");
  }
  for (const line of readFileSync(ENV_BACKUP, "utf8").split(/\r?\n/)) {
    if (line.startsWith("COOLIFY_API_TOKEN=")) {
      return line.slice("COOLIFY_API_TOKEN=".length).trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("COOLIFY_API_TOKEN missing");
}
const TOKEN = loadToken();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
      });
      const t = await r.text();
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status} ${path}: ${t.slice(0, 200)}`);
      return t ? JSON.parse(t.replace(/[\x00-\x1f]/g, "")) : null;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await sleep(attempt * 1500);
    }
  }
  throw lastErr;
}

async function getApps() {
  const apps = await api("/applications");
  // Confine to OUR project — never PATCH/DELETE another tenant's same-named
  // aisha-* app env on the shared host. Fail-loud without COOLIFY_PROJECT_UUID.
  const scope = await createProjectScope(api);
  return apps.filter((a) => scope.inProject(a) && a.name?.toLowerCase().startsWith("aisha-"));
}

async function fixApp(app) {
  const { uuid, name } = app;
  const envs = await api(`/applications/${uuid}/envs`);
  if (!Array.isArray(envs)) return { deleted: 0, errors: 0 };

  // Group by key
  const byKey = new Map();
  for (const e of envs) {
    const k = e.key;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }

  let deleted = 0;
  let errors = 0;

  for (const [key, entries] of byKey) {
    if (entries.length < 2) continue; // no duplicate

    // Prázdný LITERÁL má real_value `''` (2 znaky) — rozhoduje skutečná hodnota.
    const hasValueEntry = entries.some((e) => hodnotaZCoolify(e).length > 0);
    if (!hasValueEntry) continue; // all empty, nothing to protect

    // Find empty runtime=false entries to delete
    const emptyRuntime = entries.filter(
      (e) =>
        e.is_buildtime === false &&
        !e.is_preview &&
        hodnotaZCoolify(e) === ""
    );

    for (const e of emptyRuntime) {
      if (DRY_RUN) {
        console.log(`  [DRY] Would DELETE ${name}/${key} (uuid=${e.uuid}, buildtime=false, value=empty)`);
        deleted++;
        continue;
      }
      try {
        await api(`/applications/${uuid}/envs/${e.uuid}`, { method: "DELETE" });
        console.log(`  ✓ DELETED ${name}/${key} (uuid=${e.uuid}, empty runtime duplicate)`);
        deleted++;
        await sleep(200);
      } catch (err) {
        console.error(`  ✗ FAILED to delete ${name}/${key} uuid=${e.uuid}: ${err.message}`);
        errors++;
      }
    }
  }

  return { deleted, errors };
}

async function main() {
  console.log("Fetching aisha-* apps...");
  const apps = await getApps();
  console.log(`Found ${apps.length} apps\n`);

  let totalDeleted = 0;
  let totalErrors = 0;

  for (const app of apps) {
    process.stdout.write(`Processing ${app.name}...`);
    try {
      const { deleted, errors } = await fixApp(app);
      console.log(` deleted=${deleted} errors=${errors}`);
      totalDeleted += deleted;
      totalErrors += errors;
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
      totalErrors++;
    }
    await sleep(300);
  }

  console.log(`\nDone. Total deleted=${totalDeleted} errors=${totalErrors}`);
  if (totalDeleted > 0 && !DRY_RUN) {
    console.log("\n⚠️  Redeploy affected apps to pick up corrected env vars.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

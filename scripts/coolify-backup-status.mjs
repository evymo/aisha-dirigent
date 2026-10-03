#!/usr/bin/env node
// =============================================================================
// coolify-backup-status.mjs — List database backups across AISHA stack
// =============================================================================
// Coolify v4 podporuje per-database scheduled backups (Postgres, MariaDB,
// ClickHouse). Tento skript dotáže Coolify API a vyrobí přehled:
//   - Per database: kolik backup files je k dispozici
//   - Latest backup timestamp + size
//   - Schedule status (active / paused / never run)
//   - Retention policy
//
// Use cases:
//   - Pre-deploy check: "máme čerstvé backupy pro disaster recovery?"
//   - Periodic audit: cron — alert pokud žádný backup za >24h
//   - Pre-restore: "který backup target je relevantní?"
//
// Usage:
//   node scripts/coolify-backup-status.mjs                  # pretty
//   node scripts/coolify-backup-status.mjs --json           # machine-readable
//   node scripts/coolify-backup-status.mjs --stale-hours=48 # warn pokud >48h
//
// Exit codes:
//   0 — všechny backupy fresh
//   1 — Coolify API failure
//   2 — některé backupy stale
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ENV_BACKUP = join(ROOT, ".env-prod-backup");

const argv = process.argv.slice(2);
const arg = (name) => {
  const m = argv.find((a) => a.startsWith(`${name}=`));
  return m ? m.slice(name.length + 1) : null;
};
const flag = (name) => argv.includes(name);

if (flag("--help") || flag("-h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf-8")
    .split("\n").filter((_, i) => i < 26).join("\n"));
  process.exit(0);
}

const JSON_MODE = flag("--json");
const STALE_HOURS = parseInt(arg("--stale-hours") || "24", 10);

const COOLIFY_BASE = (() => {
  const v = process.env.COOLIFY_BASE_URL || process.env.COOLIFY_URL;
  if (!v) { process.stderr.write("FATAL: COOLIFY_URL (or COOLIFY_BASE_URL) required\n"); process.exit(2); }
  return v;
})();
const API_BASE = `${COOLIFY_BASE}/api/v1`;

function loadToken() {
  if (process.env.COOLIFY_API_TOKEN) {
    return process.env.COOLIFY_API_TOKEN.replace(/^["']|["']$/g, "");
  }
  if (process.env.COOLIFY_API_KEY) {
    return process.env.COOLIFY_API_KEY.replace(/^["']|["']$/g, "");
  }
  // Override path via AISHA_PROD_BACKUP_FILE — testy nastavují na /dev/null
  // pro isolation od real production creds.
  const backupPath = process.env.AISHA_PROD_BACKUP_FILE || ENV_BACKUP;
  if (backupPath !== "/dev/null" && existsSync(backupPath)) {
    for (const line of readFileSync(backupPath, "utf8").split(/\r?\n/)) {
      if (line.startsWith("COOLIFY_API_TOKEN=")) {
        return line.slice("COOLIFY_API_TOKEN=".length).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  throw new Error("COOLIFY_API_TOKEN not found");
}
const TOKEN = loadToken();

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

async function coolify(path, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs || 15_000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  if (!JSON_MODE) {
    console.log(C.bold("\n🗄  Coolify Database Backup Status\n"));
    console.log(`  ${C.dim("Coolify:")}        ${COOLIFY_BASE}`);
    console.log(`  ${C.dim("Stale threshold:")} ${STALE_HOURS}h`);
    console.log("");
  }

  // Coolify API endpoints (best-effort — actual shape varies between versions):
  //   GET /databases — list database services
  //   GET /databases/{uuid}/backups — list backups for one DB
  //
  // If endpoints differ, gracefully degrade with helpful error.

  let dbs;
  try {
    dbs = await coolify("/databases");
  } catch (e) {
    if (JSON_MODE) {
      process.stdout.write(JSON.stringify({ error: e.message, hint: "Coolify v4 may use different endpoint shape; manual check via UI" }) + "\n");
    } else {
      console.error(`  ${C.red("✗")} Coolify API call /databases failed: ${e.message}`);
      console.error(`  ${C.dim("Hint: Coolify v4 may not expose this endpoint; check via UI")}`);
    }
    process.exit(1);
  }

  const list = Array.isArray(dbs) ? dbs : (dbs?.data || dbs?.databases || []);
  if (list.length === 0) {
    if (JSON_MODE) process.stdout.write("[]\n");
    else console.log(`  ${C.yellow("⚠")} No databases found`);
    process.exit(0);
  }

  const now = Date.now();
  const staleCutoff = now - STALE_HOURS * 3600 * 1000;
  const report = [];

  for (const db of list) {
    const name = db.name || db.uuid;
    let backups = [];
    try {
      const r = await coolify(`/databases/${db.uuid}/backups`);
      backups = Array.isArray(r) ? r : (r?.data || r?.backups || []);
    } catch (e) {
      report.push({ name, uuid: db.uuid, error: e.message, latest: null, stale: true });
      continue;
    }

    const latest = backups
      .map((b) => ({ ...b, _ts: b.created_at ? new Date(b.created_at).getTime() : 0 }))
      .sort((a, b) => b._ts - a._ts)[0];

    const stale = !latest || latest._ts < staleCutoff;
    report.push({
      name,
      uuid: db.uuid,
      backup_count: backups.length,
      latest_at: latest?.created_at || null,
      latest_size_bytes: latest?.size || null,
      stale,
    });
  }

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({ databases: report, stale_threshold_hours: STALE_HOURS }, null, 2) + "\n");
  } else {
    console.log(`  ${"DATABASE".padEnd(28)} ${"BACKUPS".padEnd(8)} LATEST          STATUS`);
    console.log(`  ${"─".repeat(28)} ${"─".repeat(8)} ${"─".repeat(15)} ${"─".repeat(8)}`);
    for (const r of report) {
      const ageH = r.latest_at ? Math.round((now - new Date(r.latest_at).getTime()) / 3600000) : null;
      const ageStr = ageH != null ? `${ageH}h ago`.padEnd(15) : "(never)".padEnd(15);
      const statusFmt = r.stale ? C.red("STALE") : C.green("FRESH");
      console.log(`  ${r.name.padEnd(28)} ${String(r.backup_count).padEnd(8)} ${ageStr} ${statusFmt}`);
      if (r.error) console.log(`    ${C.dim("error: " + r.error)}`);
    }
    console.log("");
    const staleCount = report.filter((r) => r.stale).length;
    if (staleCount === 0) {
      console.log(`  ${C.green("✓")} All ${report.length} databases have fresh backups`);
    } else {
      console.log(`  ${C.yellow("⚠")} ${staleCount}/${report.length} databases stale`);
    }
  }

  const anyStale = report.some((r) => r.stale);
  process.exit(anyStale ? 2 : 0);
}

main().catch((e) => {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ error: e.message }) + "\n");
  else console.error(`  ${C.red("✗")} ${e.message}`);
  process.exit(1);
});

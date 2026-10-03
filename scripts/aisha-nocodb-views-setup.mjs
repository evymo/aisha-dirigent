#!/usr/bin/env node
/**
 * AISHA NocoDB Analytical Views Setup
 *
 * Idempotent script that creates analytical views in NocoDB
 * for Aisha operational dashboards. Safe to re-run — skips
 * views that already exist.
 *
 * Requires: NOCODB_URL, NOCODB_API_TOKEN in .env.aisha or environment.
 *
 * @example
 *   npm run aisha:nocodb:views          # create all views
 *   npm run aisha:nocodb:views --dry    # dry-run, show what would be created
 *   npm run aisha:nocodb:views --status # just check existing views
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const DRY_RUN =
  process.argv.includes("--dry") || process.argv.includes("--dry-run");
const STATUS_ONLY = process.argv.includes("--status");

// ─── Config ──────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = join(ROOT, ".env.aisha");
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const NOCODB_URL_RAW = process.env.NOCODB_URL || env.NOCODB_URL;
if (!NOCODB_URL_RAW) {
  console.error("ERROR: NOCODB_URL not set (env-driven; no hardcoded host). Set NOCODB_URL in .env.aisha or as env var.");
  process.exit(1);
}
const NOCODB_URL = NOCODB_URL_RAW.replace(/\/$/, "");
const NOCODB_API_TOKEN =
  process.env.NOCODB_API_TOKEN || env.NOCODB_API_TOKEN || "";

/**
 * Analytical views to create in NocoDB.
 * Each entry maps a target table to a named view with optional filters/sorts.
 */
const VIEWS = [
  {
    table: "stories",
    view_name: "stories_overview",
    description: "All stories with status, priority, assigned agents",
    type: "grid",
    sort: [{ field: "updated_at", direction: "desc" }],
  },
  {
    table: "integration_services",
    view_name: "integration_health",
    description: "Integration services health status dashboard",
    type: "grid",
    sort: [{ field: "service_name", direction: "asc" }],
  },
  {
    table: "ai_sessions",
    view_name: "ai_sessions_audit",
    description: "AI sessions audit trail — recent sessions with agent + model",
    type: "grid",
    sort: [{ field: "created_at", direction: "desc" }],
  },
  {
    table: "ai_trace_events",
    view_name: "aisha_operations_log",
    description: "Aisha operation log — trace events by run_id",
    type: "grid",
    sort: [{ field: "created_at", direction: "desc" }],
  },
  {
    table: "story_entries",
    view_name: "story_entries_log",
    description: "Story entries — decisions, transitions, patches",
    type: "grid",
    sort: [{ field: "created_at", direction: "desc" }],
  },
  {
    table: "agent_catalog",
    view_name: "agent_routing_overview",
    description: "Agent catalog with routing config and allowed tools",
    type: "grid",
    sort: [{ field: "slug", direction: "asc" }],
  },
  {
    table: "story_reminders",
    view_name: "reminders_board",
    description: "Story reminders — upcoming and overdue",
    type: "grid",
    sort: [{ field: "remind_at", direction: "asc" }],
  },
];

// ─── NocoDB API ──────────────────────────────────────────────────────────

async function nocoFetch(path, options = {}) {
  if (!NOCODB_API_TOKEN) {
    throw new Error(
      "NOCODB_API_TOKEN is required. Set in .env.aisha or environment.",
    );
  }

  const url = `${NOCODB_URL}/api/v1${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "xc-auth": NOCODB_API_TOKEN,
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`NocoDB API ${resp.status} ${path}: ${body.slice(0, 500)}`);
  }

  return resp.json();
}

// ─── Discover Tables ─────────────────────────────────────────────────────

async function getProjectTables() {
  // NocoDB v2 API: list bases (projects), then tables
  const bases = await nocoFetch("/db/meta/projects/");
  const baseList = bases?.list ?? bases ?? [];

  const tables = {};

  for (const base of Array.isArray(baseList) ? baseList : [baseList]) {
    const baseId = base.id;
    if (!baseId) continue;

    try {
      const tablesResp = await nocoFetch(`/db/meta/projects/${baseId}/tables`);
      const tableList = tablesResp?.list ?? tablesResp ?? [];
      for (const t of Array.isArray(tableList) ? tableList : []) {
        tables[t.title ?? t.table_name] = { id: t.id, baseId };
      }
    } catch {
      // skip bases we can't read
    }
  }

  return tables;
}

async function getTableViews(tableId) {
  const resp = await nocoFetch(`/db/meta/tables/${tableId}/views`);
  return resp?.list ?? resp ?? [];
}

// ─── Create Views ────────────────────────────────────────────────────────

async function createView(tableId, viewDef) {
  const payload = {
    title: viewDef.view_name,
    type: viewDef.type === "grid" ? 3 : 1, // NocoDB: 3=grid, 1=form, 2=gallery, 5=kanban
  };

  const created = await nocoFetch(`/db/meta/tables/${tableId}/views`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  // Apply sort if specified
  if (viewDef.sort?.length && created?.id) {
    for (const s of viewDef.sort) {
      try {
        await nocoFetch(`/db/meta/views/${created.id}/sorts`, {
          method: "POST",
          body: JSON.stringify({
            fk_column_id: null, // NocoDB resolves by field name
            field: s.field,
            direction: s.direction,
          }),
        });
      } catch {
        // sort creation is best-effort
      }
    }
  }

  return created;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n═══ AISHA NocoDB Views Setup ═══");
  console.log(`  NocoDB: ${NOCODB_URL}`);
  console.log(`  Mode: ${DRY_RUN ? "DRY-RUN" : STATUS_ONLY ? "STATUS" : "CREATE"}`);

  // 1. Discover tables
  console.log("\n── Discovering tables...");
  const tables = await getProjectTables();
  const tableNames = Object.keys(tables);
  console.log(`  Found ${tableNames.length} tables`);

  // 2. Process each view definition
  let created = 0;
  let skipped = 0;
  let missing = 0;

  console.log("\n── Processing views...\n");

  for (const viewDef of VIEWS) {
    const tableInfo = tables[viewDef.table];

    if (!tableInfo) {
      console.log(`  ⚠ Table "${viewDef.table}" not found — skipping ${viewDef.view_name}`);
      missing++;
      continue;
    }

    // Check if view already exists
    const existingViews = await getTableViews(tableInfo.id);
    const exists = existingViews.some(
      (v) => (v.title ?? v.alias) === viewDef.view_name,
    );

    if (exists) {
      console.log(`  ✓ ${viewDef.view_name} — already exists (table: ${viewDef.table})`);
      skipped++;
      continue;
    }

    if (STATUS_ONLY || DRY_RUN) {
      console.log(
        `  ${STATUS_ONLY ? "✗" : "[DRY]"} ${viewDef.view_name} — would create (table: ${viewDef.table})`,
      );
      if (!STATUS_ONLY) created++;
      continue;
    }

    // Create the view
    try {
      await createView(tableInfo.id, viewDef);
      console.log(`  ✓ ${viewDef.view_name} — created (table: ${viewDef.table})`);
      created++;
    } catch (err) {
      console.log(`  ✗ ${viewDef.view_name} — ERROR: ${err.message}`);
    }
  }

  // Summary
  console.log("\n── Summary");
  console.log(`  Created: ${created}`);
  console.log(`  Skipped (exists): ${skipped}`);
  console.log(`  Missing tables: ${missing}`);
  console.log("");
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});

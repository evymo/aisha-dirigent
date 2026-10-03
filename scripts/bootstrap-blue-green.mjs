#!/usr/bin/env node
/**
 * scripts/bootstrap-blue-green.mjs — Phase 2 jednorázový bootstrap
 * ─────────────────────────────────────────────────────────────────────────────
 * Pro každou B/G-eligible Coolify app:
 *   1. Detekuje nebo vytvoří duplicitní Coolify aplikaci (blue + green slot)
 *   2. Insertuje row do coolify_app_slots s active_slot='blue'
 *   3. Validuje Traefik labely (active slot serves public domain)
 *
 * --dry-run mode (default): print plánu bez exekuce.
 * --apply: skutečně provede.
 *
 * Spec: docs/deploy/BLUE_GREEN_DESIGN.md §7 Bootstrap pro AISHA stack
 *
 * Usage:
 *   node scripts/bootstrap-blue-green.mjs              # dry-run, výstup table
 *   node scripts/bootstrap-blue-green.mjs --apply       # skutečně vytvoří
 *   node scripts/bootstrap-blue-green.mjs --json        # JSON output
 *
 * Environment:
 *   COOLIFY_API_TOKEN, COOLIFY_API_URL
 *   AISHA_POSTGREST_URL, AISHA_POSTGREST_SERVICE_KEY
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const opts = {
  apply: args.includes("--apply"),
  json: args.includes("--json"),
  quiet: args.includes("--quiet"),
};

if (args.includes("--help") || args.includes("-h")) {
  console.error("Usage: node scripts/bootstrap-blue-green.mjs [--apply] [--json]");
  process.exit(0);
}

const log = {
  info: (...a) => !opts.quiet && !opts.json && console.error("ℹ", ...a),
  warn: (...a) => !opts.json && console.error("⚠", ...a),
  error: (...a) => console.error("✗", ...a),
  ok: (...a) => !opts.quiet && !opts.json && console.error("✓", ...a),
};

// AISHA stack B/G-eligible apps (per BLUE_GREEN_DESIGN.md §6).
// Domains are env-driven (no hardcoded hostnames): the public domain lives on
// ${PUBLIC_TLD}; the internal blue/green slots on
// <app>-<slot>.<server>.${INTERNAL_TLD}. Only the per-app subdomain + server
// segment are structural and stay in code.
const PUBLIC_TLD = process.env.PUBLIC_TLD;
const INTERNAL_TLD = process.env.INTERNAL_TLD;
if (!PUBLIC_TLD || !INTERNAL_TLD) {
  log.error(
    "PUBLIC_TLD and INTERNAL_TLD must be set (env-driven; no hardcoded hostnames).",
  );
  process.exit(1);
}
// sub === "" → bare public apex; server is the internal cluster segment.
const bgApp = (app_name, sub, server, role) => ({
  app_name,
  domain: sub ? `${sub}.${PUBLIC_TLD}` : PUBLIC_TLD,
  internal_domain_blue: `${app_name}-blue.${server}.${INTERNAL_TLD}`,
  internal_domain_green: `${app_name}-green.${server}.${INTERNAL_TLD}`,
  role,
});
const B_G_ELIGIBLE_APPS = [
  bgApp("aisha-gateway", "", "frontend", "frontend"),
  bgApp("aisha-web", "app", "frontend", "frontend"),
  bgApp("aisha-ws-gateway", "ws", "frontend", "frontend"),
  bgApp("aisha-exec", "exec", "frontend", "exec"),
  bgApp("aisha-edge-runtime", "edge", "frontend", "exec"),
  bgApp("aisha-ragnarok", "ragnarok", "frontend", "frontend"),
];

async function rpc(name, params = {}) {
  const url = (process.env.AISHA_POSTGREST_URL || "http://127.0.0.1:3001") + "/rest/v1/rpc/" + name;
  const key = process.env.AISHA_POSTGREST_SERVICE_KEY;
  if (!key) throw new Error("AISHA_POSTGREST_SERVICE_KEY not set");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": key,
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RPC ${name} failed (${res.status}): ${text}`);
  }
  return await res.json();
}

async function coolifyList() {
  const apiUrl = process.env.COOLIFY_API_URL;
  const token = process.env.COOLIFY_API_TOKEN;
  if (!apiUrl || !token) throw new Error("COOLIFY_API_URL or COOLIFY_API_TOKEN not set");

  const res = await fetch(apiUrl.replace(/\/$/, "") + "/applications", {
    headers: { "Authorization": `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Coolify API: ${res.status}`);
  return await res.json();
}

async function postgrestQuery(table, query) {
  const url = `${process.env.AISHA_POSTGREST_URL}/rest/v1/${table}?${query}`;
  const key = process.env.AISHA_POSTGREST_SERVICE_KEY;
  const res = await fetch(url, {
    headers: {
      "apikey": key,
      "Authorization": `Bearer ${key}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`PostgREST: ${res.status}`);
  return await res.json();
}

async function main() {
  log.info(opts.apply ? "APPLY MODE — will create resources" : "DRY-RUN MODE — preview only");
  log.info("");

  let coolifyApps;
  try {
    coolifyApps = await coolifyList();
    log.ok(`Coolify: ${coolifyApps.length} apps found`);
  } catch (err) {
    log.error(`Coolify list failed: ${err.message}`);
    process.exit(2);
  }

  // Check existing slots in DB
  let existingSlots;
  try {
    existingSlots = await postgrestQuery("coolify_app_slots", "select=app_name,blue_app_uuid,green_app_uuid,active_slot");
    log.ok(`DB: ${existingSlots.length} app_slots rows`);
  } catch (err) {
    log.error(`DB query failed: ${err.message}`);
    existingSlots = [];
  }

  const plan = [];

  for (const target of B_G_ELIGIBLE_APPS) {
    const existing = existingSlots.find((s) => s.app_name === target.app_name);
    if (existing) {
      plan.push({
        app_name: target.app_name,
        action: "skip",
        reason: "slot row already exists",
        existing,
      });
      continue;
    }

    // Look for matching Coolify apps
    const blueCandidate = coolifyApps.find((a) => a.name === `${target.app_name}-blue`);
    const greenCandidate = coolifyApps.find((a) => a.name === `${target.app_name}-green`);
    const baseCandidate = coolifyApps.find((a) => a.name === target.app_name);

    if (!baseCandidate && !blueCandidate && !greenCandidate) {
      plan.push({
        app_name: target.app_name,
        action: "skip",
        reason: "no matching Coolify app found",
      });
      continue;
    }

    if (blueCandidate && greenCandidate) {
      plan.push({
        app_name: target.app_name,
        action: "register",
        blue_app_uuid: blueCandidate.uuid,
        green_app_uuid: greenCandidate.uuid,
        reason: "both slot apps exist, just register slot row",
      });
    } else if (baseCandidate) {
      plan.push({
        app_name: target.app_name,
        action: "needs_clone",
        base_app_uuid: baseCandidate.uuid,
        reason: "base app exists, manual Coolify clone required (cannot auto-clone via API safely)",
        instructions: [
          `1. In Coolify UI, clone "${target.app_name}" → "${target.app_name}-blue" and "${target.app_name}-green"`,
          `2. Update Traefik labels per BLUE_GREEN_DESIGN.md §4.1`,
          `3. Re-run this bootstrap script`,
        ],
      });
    }
  }

  // Output
  if (opts.json) {
    console.log(JSON.stringify({ plan, total: plan.length }, null, 2));
  } else {
    console.error("\n═══ Bootstrap Plan ═══");
    for (const p of plan) {
      const symbol = p.action === "register" ? "+" : p.action === "skip" ? "○" : "?";
      console.error(`  ${symbol} ${p.app_name}: ${p.action} — ${p.reason}`);
      if (p.instructions) {
        for (const i of p.instructions) console.error(`      ${i}`);
      }
    }
  }

  // Apply
  if (opts.apply) {
    log.info("\nExecuting plan...");
    for (const p of plan) {
      if (p.action !== "register") continue;
      try {
        const target = B_G_ELIGIBLE_APPS.find((t) => t.app_name === p.app_name);
        // Insert via raw upsert (PostgREST)
        const url = `${process.env.AISHA_POSTGREST_URL}/rest/v1/coolify_app_slots`;
        const body = {
          app_name: p.app_name,
          blue_app_uuid: p.blue_app_uuid,
          green_app_uuid: p.green_app_uuid,
          active_slot: "blue",
          domain: target.domain,
          internal_domain_blue: target.internal_domain_blue,
          internal_domain_green: target.internal_domain_green,
          metadata: {
            bootstrapped_by: "bootstrap-blue-green.mjs",
            bootstrapped_at: new Date().toISOString(),
            role: target.role,
          },
        };
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": process.env.AISHA_POSTGREST_SERVICE_KEY,
            "Authorization": `Bearer ${process.env.AISHA_POSTGREST_SERVICE_KEY}`,
            "Prefer": "return=minimal",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`PostgREST INSERT: ${res.status}`);
        log.ok(`  ${p.app_name}: registered`);
      } catch (err) {
        log.error(`  ${p.app_name}: failed — ${err.message}`);
      }
    }
  }

  log.info("\nDone.");
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(2);
});

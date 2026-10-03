#!/usr/bin/env node
// =============================================================================
// n8n-schedules.mjs — Audit & fix periodic workflow schedules on production n8n
// =============================================================================
//
// Commands:
//   node scripts/n8n-schedules.mjs              # List all workflows + schedules from production
//   node scripts/n8n-schedules.mjs --fix        # Set all periodic triggers to max 1x/day
//   node scripts/n8n-schedules.mjs --dry-run    # Show what --fix would change (no writes)
//   node scripts/n8n-schedules.mjs --local      # Scan local n8n/workflows/*.json only
//
// Environment (from .env.aisha):
//   N8N_URL or N8N_WEBHOOK_URL  — n8n base URL (e.g. https://mcp.${PUBLIC_TLD})
//   N8N_API_KEY                 — n8n REST API key
// =============================================================================

import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname, join, basename } from "path";
import { fileURLToPath } from "url";
import { porovnej } from "./lib/razeni.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ENV_PATH = join(ROOT, ".env.aisha");

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FIX_MODE = args.includes("--fix") || DRY_RUN;
const LOCAL_ONLY = args.includes("--local");

// ── Colors ──────────────────────────────────────────────────────────────────
const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

// ── Env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const env = {};
  for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const fileEnv = loadEnv();
const N8N_URL = (
  process.env.N8N_URL ||
  process.env.N8N_WEBHOOK_URL ||
  fileEnv.N8N_WEBHOOK_URL ||
  fileEnv.N8N_URL ||
  ""
).replace(/\/$/, "");
const N8N_API_KEY =
  process.env.N8N_API_KEY || fileEnv.N8N_API_KEY || "";

// ── Schedule analysis helpers ───────────────────────────────────────────────

/**
 * Parse a cron expression and return approximate interval in minutes
 */
function cronToMinutes(expr) {
  if (!expr) return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every N minutes: */N * * * *
  if (minute.startsWith("*/") && hour === "*") {
    return parseInt(minute.slice(2), 10);
  }
  // Every N hours: 0 */N * * *
  if (hour.startsWith("*/") && dayOfMonth === "*") {
    return parseInt(hour.slice(2), 10) * 60;
  }
  // Specific hour each day: M H * * *
  if (!minute.includes("*") && !hour.includes("*") && dayOfMonth === "*" && month === "*") {
    if (dayOfWeek === "*") return 24 * 60; // daily
    return 7 * 24 * 60; // weekly
  }
  // Every hour: 0 * * * *
  if (!minute.includes("*") && hour === "*" && dayOfMonth === "*") {
    return 60;
  }
  return null; // can't determine
}

/**
 * Describe a schedule interval in human-readable form
 */
function describeInterval(iv) {
  const field = iv.field || "hours";
  switch (field) {
    case "cronExpression":
      return `cron: ${iv.expression || "?"}`;
    case "hours":
      return `every ${iv.hoursInterval || "?"}h`;
    case "days":
      return `daily at ${iv.triggerAtHour ?? "?"}:00`;
    case "weeks":
      return `weekly day=${JSON.stringify(iv.triggerAtDay || "?")} at ${iv.triggerAtHour ?? "?"}:00`;
    case "minutes":
      return `every ${iv.minutesInterval || "?"}min`;
    case "months":
      return `monthly day=${iv.triggerAtDayOfMonth || "?"} at ${iv.triggerAtHour ?? "?"}:00`;
    default:
      return JSON.stringify(iv);
  }
}

/**
 * Get interval in minutes for a schedule rule entry
 */
function intervalMinutes(iv) {
  const field = iv.field || "hours";
  switch (field) {
    case "cronExpression":
      return cronToMinutes(iv.expression);
    case "minutes":
      return iv.minutesInterval || 5;
    case "hours":
      return (iv.hoursInterval || 1) * 60;
    case "days":
      return 24 * 60;
    case "weeks":
      return 7 * 24 * 60;
    case "months":
      return 30 * 24 * 60;
    default:
      return null;
  }
}

/**
 * Check if interval is more frequent than once per day (1440 min)
 */
function isTooFrequent(iv) {
  const mins = intervalMinutes(iv);
  return mins !== null && mins < 1440;
}

/**
 * Convert a too-frequent interval to daily at 3:00 AM
 */
function toDailyInterval() {
  return {
    field: "days",
    triggerAtHour: 3,
  };
}

// ── Local scan ──────────────────────────────────────────────────────────────

function scanLocal() {
  const dir = join(ROOT, "n8n", "workflows");
  if (!existsSync(dir)) {
    console.error(c.red("n8n/workflows/ not found"));
    process.exit(1);
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  console.log(c.bold(`\nLocal workflow files: ${files.length}\n`));

  let totalScheduled = 0;
  let tooFrequent = 0;

  for (const file of files.sort()) {
    const wf = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    const nodes = wf.nodes || [];
    const scheduleNodes = nodes.filter(
      (n) =>
        n.type === "n8n-nodes-base.scheduleTrigger" ||
        n.type === "n8n-nodes-base.cron"
    );

    if (scheduleNodes.length === 0) continue;
    totalScheduled++;

    const name = basename(file, ".json");
    const lines = [];

    for (const node of scheduleNodes) {
      const rule = node.parameters?.rule || {};
      const intervals = rule.interval || [];
      for (const iv of intervals) {
        const desc = describeInterval(iv);
        const mins = intervalMinutes(iv);
        const freq = isTooFrequent(iv);
        if (freq) tooFrequent++;
        const tag = freq
          ? c.red("⚠ TOO FREQUENT")
          : c.green("✓ OK");
        lines.push(
          `  ${node.name}: ${desc} (${mins ? mins + "min" : "?"}) ${tag}`
        );
      }
    }

    console.log(`${c.cyan(name)}:`);
    for (const l of lines) console.log(l);
  }

  console.log(
    `\n${c.bold("Summary:")} ${totalScheduled} scheduled workflows, ${tooFrequent > 0 ? c.red(tooFrequent + " too frequent") : c.green("all OK")}\n`
  );
}

// ── Production API ──────────────────────────────────────────────────────────

async function apiGet(path) {
  const resp = await fetch(`${N8N_URL}${path}`, {
    headers: {
      "X-N8N-API-KEY": N8N_API_KEY,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    throw new Error(`API ${path}: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

async function apiPut(path, body) {
  const resp = await fetch(`${N8N_URL}${path}`, {
    method: "PUT",
    headers: {
      "X-N8N-API-KEY": N8N_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API PUT ${path}: ${resp.status} ${resp.statusText}\n${text}`);
  }
  return resp.json();
}

async function scanProduction() {
  if (!N8N_URL || !N8N_API_KEY) {
    console.error(
      c.red(
        "Missing N8N_URL/N8N_WEBHOOK_URL or N8N_API_KEY.\nSet in .env.aisha or environment."
      )
    );
    process.exit(1);
  }

  console.log(c.bold(`\nConnecting to ${N8N_URL} ...\n`));

  // Fetch all workflows (paginated)
  let allWorkflows = [];
  let cursor = undefined;
  let page = 0;
  while (true) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const resp = await apiGet(`/api/v1/workflows?${params}`);
    const wfs = resp.data || [];
    allWorkflows.push(...wfs);
    page++;
    cursor = resp.nextCursor;
    if (!cursor || wfs.length === 0) break;
  }

  console.log(
    c.bold(`Found ${allWorkflows.length} workflows on production\n`)
  );

  let totalScheduled = 0;
  let tooFrequent = 0;
  const fixQueue = [];

  for (const wf of allWorkflows.sort((a, b) => porovnej(a.name, b.name))) {
    const nodes = wf.nodes || [];
    const scheduleNodes = nodes.filter(
      (n) =>
        n.type === "n8n-nodes-base.scheduleTrigger" ||
        n.type === "n8n-nodes-base.cron"
    );

    if (scheduleNodes.length === 0) continue;
    totalScheduled++;

    const active = wf.active ? c.green("[ACTIVE]") : c.dim("[inactive]");
    console.log(`${c.cyan(wf.name)} ${active} (id=${wf.id}):`);

    for (const node of scheduleNodes) {
      const rule = node.parameters?.rule || {};
      const intervals = rule.interval || [];
      for (let i = 0; i < intervals.length; i++) {
        const iv = intervals[i];
        const desc = describeInterval(iv);
        const mins = intervalMinutes(iv);
        const freq = isTooFrequent(iv);
        if (freq) tooFrequent++;
        const tag = freq ? c.red("⚠ TOO FREQUENT") : c.green("✓ OK");
        console.log(
          `  ${node.name}: ${desc} (${mins ? mins + "min" : "?"}) ${tag}`
        );

        if (freq && FIX_MODE) {
          fixQueue.push({
            workflowId: wf.id,
            workflowName: wf.name,
            nodeName: node.name,
            nodeIndex: nodes.indexOf(node),
            intervalIndex: i,
            oldInterval: iv,
            newInterval: toDailyInterval(),
            oldDesc: desc,
            newDesc: describeInterval(toDailyInterval()),
          });
        }
      }
    }
  }

  // Also list non-schedule workflows that are active for awareness
  const activeOther = allWorkflows.filter(
    (wf) =>
      wf.active &&
      !(wf.nodes || []).some(
        (n) =>
          n.type === "n8n-nodes-base.scheduleTrigger" ||
          n.type === "n8n-nodes-base.cron"
      )
  );

  if (activeOther.length > 0) {
    console.log(c.bold(`\nOther active workflows (webhook/event-triggered):`));
    for (const wf of activeOther.sort((a, b) => porovnej(a.name, b.name))) {
      const triggers = (wf.nodes || [])
        .filter((n) => n.type?.includes("Trigger") || n.type?.includes("webhook"))
        .map((n) => n.type?.split(".").pop() || "?")
        .join(", ");
      console.log(`  ${wf.name} (id=${wf.id}): ${c.dim(triggers || "manual")}`);
    }
  }

  console.log(
    `\n${c.bold("Summary:")} ${totalScheduled} scheduled workflows, ${tooFrequent > 0 ? c.red(tooFrequent + " too frequent") : c.green("all OK")}`
  );
  console.log(
    `  Active total: ${allWorkflows.filter((w) => w.active).length}/${allWorkflows.length}\n`
  );

  // ── Fix mode ──────────────────────────────────────────────────────────────
  if (fixQueue.length > 0) {
    console.log(
      c.bold(
        `\n${DRY_RUN ? "[DRY RUN] " : ""}Fixing ${fixQueue.length} too-frequent schedule(s):\n`
      )
    );

    // Group fixes by workflow
    const byWorkflow = {};
    for (const fix of fixQueue) {
      if (!byWorkflow[fix.workflowId]) byWorkflow[fix.workflowId] = [];
      byWorkflow[fix.workflowId].push(fix);
    }

    for (const [wfId, fixes] of Object.entries(byWorkflow)) {
      const wfName = fixes[0].workflowName;
      console.log(`${c.cyan(wfName)} (id=${wfId}):`);

      // Fetch full workflow
      const fullWf = await apiGet(`/api/v1/workflows/${wfId}`);
      let modified = false;

      for (const fix of fixes) {
        const node = fullWf.nodes[fix.nodeIndex];
        if (!node) {
          console.log(c.red(`  ✗ Node index ${fix.nodeIndex} not found, skipping`));
          continue;
        }

        const intervals = node.parameters?.rule?.interval;
        if (!intervals || !intervals[fix.intervalIndex]) {
          console.log(c.red(`  ✗ Interval index ${fix.intervalIndex} not found, skipping`));
          continue;
        }

        console.log(
          `  ${fix.nodeName}: ${c.red(fix.oldDesc)} → ${c.green(fix.newDesc)}`
        );

        if (!DRY_RUN) {
          intervals[fix.intervalIndex] = fix.newInterval;
          modified = true;
        }
      }

      if (modified && !DRY_RUN) {
        try {
          // n8n API rejects extra/read-only properties — send only writable fields
          const payload = {
            name: fullWf.name,
            nodes: fullWf.nodes,
            connections: fullWf.connections,
            settings: fullWf.settings,
            staticData: fullWf.staticData,
          };
          if (fullWf.pinData) payload.pinData = fullWf.pinData;
          await apiPut(`/api/v1/workflows/${wfId}`, payload);
          console.log(c.green(`  ✓ Updated successfully`));
        } catch (err) {
          console.error(c.red(`  ✗ Failed to update: ${err.message}`));
        }
      }
    }

    if (DRY_RUN) {
      console.log(c.yellow("\n[DRY RUN] No changes made. Run with --fix to apply.\n"));
    } else {
      console.log(c.green("\nAll fixes applied.\n"));
    }
  } else if (FIX_MODE) {
    console.log(c.green("\nNo fixes needed — all schedules are ≤ 1x/day.\n"));
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(c.bold("=== n8n Schedule Audit ==="));
  if (DRY_RUN) console.log(c.yellow("[DRY RUN MODE]"));

  if (LOCAL_ONLY) {
    scanLocal();
  } else {
    await scanProduction();
  }
}

main().catch((err) => {
  console.error(c.red(`\nError: ${err.message}`));
  process.exit(1);
});

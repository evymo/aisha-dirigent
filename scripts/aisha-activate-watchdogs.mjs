#!/usr/bin/env node
/**
 * AISHA Watchdog Workflow Activation
 *
 * Activates n8n workflows that depend on community nodes (n8n-nodes-aisha).
 * Run AFTER community nodes are installed via `npm run aisha:nodes:api`.
 *
 * @example
 *   npm run aisha:watchdogs:activate        # activate all watchdog workflows
 *   npm run aisha:watchdogs:activate --dry   # dry-run, show status only
 *   npm run aisha:watchdogs:status           # just check status
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
const N8N_URL_RAW =
  process.env.N8N_WEBHOOK_URL ||
  env.N8N_URL ||
  env.N8N_WEBHOOK_URL;
if (!N8N_URL_RAW) {
  console.error("ERROR: N8N_URL not set (env-driven; no hardcoded host). Set N8N_URL or N8N_WEBHOOK_URL in .env.aisha or as env var.");
  process.exit(1);
}
const N8N_URL = N8N_URL_RAW.replace(/\/$/, "");
const N8N_API_KEY = process.env.N8N_API_KEY || env.N8N_API_KEY || "";

/**
 * Workflows that depend on community nodes and should be activated
 * after n8n-nodes-aisha is installed.
 */
const WATCHDOG_WORKFLOWS = [
  {
    id: "__REMAP_WF_ADMIN_HEALTH_MONITOR__",
    name: "WF_ADMIN_HEALTH_MONITOR",
    description: "Platform health monitoring — checks DB, API, workflows",
  },
  {
    id: "__REMAP_WF_ADMIN_ORCHESTRATION__",
    name: "WF_ADMIN_ORCHESTRATION",
    description: "Self-orchestration — manages workflow lifecycle",
  },
  {
    id: "__REMAP_WF_NODE_FACTORY__",
    name: "WF_NODE_FACTORY",
    description: "Dynamic node generation from templates",
  },
  {
    id: "__REMAP_WF_LANGFUSE_PERFORMANCE_REVIEW__",
    name: "WF_LANGFUSE_PERFORMANCE_REVIEW",
    description: "LLM performance analysis from Langfuse traces",
  },
  {
    id: "__REMAP_WF_NIGHTLY_STORY_AUDIT__",
    name: "WF_NIGHTLY_STORY_AUDIT",
    description: "Nightly story validation and audit",
  },
  {
    id: "__REMAP_WF_STORY_SCAFFOLD__",
    name: "WF_STORY_SCAFFOLD",
    description: "Story scaffolding — creates structure from template",
  },
  {
    id: "__REMAP_WF_STORY_REMINDER_CRON__",
    name: "WF_STORY_REMINDER_CRON",
    description: "Cron-based story reminders and notifications",
  },
  {
    id: "__REMAP_WF_GUILD_MATCH__",
    name: "WF_GUILD_MATCH",
    description: "Guild expert matching — scores and assigns specialists",
  },
  {
    id: "__REMAP_WF_SELF_LEARNING_LOOP__",
    name: "WF_SELF_LEARNING_LOOP",
    description: "Self-learning loop — evaluates proposals, creates PRs, rate-limited",
  },
  {
    id: "__REMAP_WF_SELF_DEPLOY__",
    name: "WF_SELF_DEPLOY",
    description: "Self-deploy — detects version drift, updates n8n nodes",
  },
  {
    id: "__REMAP_WF_SELF_LEARNING_TRIGGER__",
    name: "WF_SELF_LEARNING_TRIGGER",
    description: "Self-learning trigger — daily anomaly scan, feeds improvement proposals",
  },
];

// ─── n8n API ─────────────────────────────────────────────────────────────

async function n8nFetch(path, options = {}) {
  if (!N8N_API_KEY) {
    throw new Error(
      "N8N_API_KEY is required. Set in .env.aisha or environment.",
    );
  }

  const url = `${N8N_URL}/api/v1${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": N8N_API_KEY,
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`n8n API ${resp.status} ${path}: ${body.slice(0, 500)}`);
  }

  return resp.json();
}

// ─── Check Community Nodes ───────────────────────────────────────────────

async function checkCommunityNodes() {
  console.log("\n═══ Community Nodes Status ═══");

  try {
    const pkgs = await n8nFetch("/community-packages");
    const evymo = Array.isArray(pkgs)
      ? pkgs.find((p) => p.packageName === "@aisha/n8n-nodes-aisha" || p.packageName === "n8n-nodes-aisha")
      : null;

    if (evymo) {
      const nodeCount = evymo.installedNodes?.length ?? 0;
      console.log(
        `  ✓ n8n-nodes-aisha@${evymo.installedVersion} — ${nodeCount} nodes loaded`,
      );
      if (evymo.installedNodes) {
        for (const node of evymo.installedNodes) {
          console.log(`    • ${node.name} (${node.type || "?"})`);
        }
      }
      return true;
    } else {
      console.log("  ✗ n8n-nodes-aisha NOT installed");
      console.log("    Install first: npm run aisha:nodes:api");
      return false;
    }
  } catch (err) {
    console.log(`  ⚠ Could not check: ${err.message}`);
    return false;
  }
}

// ─── Resolve __REMAP__ Placeholder IDs ───────────────────────────────────

async function resolveWorkflowIds() {
  const hasPlaceholders = WATCHDOG_WORKFLOWS.some((w) =>
    w.id.startsWith("__REMAP_"),
  );
  if (!hasPlaceholders) return;

  console.log("\n═══ Resolving Workflow IDs ═══");

  try {
    const res = await n8nFetch("/workflows");
    const workflows = res.data ?? res;
    const byName = new Map();
    for (const wf of Array.isArray(workflows) ? workflows : []) {
      byName.set(wf.name, wf.id);
    }

    for (const entry of WATCHDOG_WORKFLOWS) {
      if (!entry.id.startsWith("__REMAP_")) continue;

      const resolved = byName.get(entry.name);
      if (resolved) {
        console.log(`  ✓ ${entry.name} → ${resolved}`);
        entry.id = resolved;
      } else {
        console.log(`  ⚠ ${entry.name} — not found in n8n (placeholder kept)`);
      }
    }
  } catch (err) {
    console.log(`  ⚠ Could not resolve IDs: ${err.message}`);
  }
}

// ─── Workflow Status ─────────────────────────────────────────────────────

async function getWorkflowStatus() {
  console.log("\n═══ Watchdog Workflow Status ═══");

  const results = [];

  for (const wf of WATCHDOG_WORKFLOWS) {
    try {
      const data = await n8nFetch(`/workflows/${wf.id}`);
      const active = !!data.active;
      const nodeCount = data.nodes?.length ?? 0;
      const icon = active ? "✓" : "✗";

      console.log(
        `  ${icon} ${wf.name} — ${active ? "ACTIVE" : "INACTIVE"} (${nodeCount} nodes)`,
      );
      console.log(`    ${wf.description}`);

      results.push({ ...wf, active, nodeCount, data });
    } catch (err) {
      console.log(`  ⚠ ${wf.name} — Error: ${err.message}`);
      results.push({ ...wf, active: false, error: err.message });
    }
  }

  return results;
}

// ─── Activate Workflows ─────────────────────────────────────────────────

async function activateWorkflows(workflows) {
  console.log("\n═══ Activating Workflows ═══");

  const toActivate = workflows.filter((w) => !w.active && !w.error);

  if (toActivate.length === 0) {
    console.log("  ℹ All watchdog workflows are already active!");
    return;
  }

  console.log(`  Found ${toActivate.length} inactive workflow(s) to activate`);

  for (const wf of toActivate) {
    if (DRY_RUN) {
      console.log(`  [DRY] Would activate: ${wf.name} (${wf.id})`);
      continue;
    }

    try {
      // PUT workflow with active: true
      const payload = {
        name: wf.data.name,
        nodes: wf.data.nodes,
        connections: wf.data.connections,
        settings: wf.data.settings || {},
        active: true,
      };

      const result = await n8nFetch(`/workflows/${wf.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      if (result.active) {
        console.log(`  ✓ Activated: ${wf.name}`);
      } else {
        console.log(
          `  ⚠ ${wf.name} — API returned but active=${result.active}`,
        );
      }
    } catch (err) {
      console.log(`  ✗ ${wf.name} — Failed: ${err.message}`);
      if (err.message.includes("community")) {
        console.log(
          `    Hint: Community nodes may not be installed. Run: npm run aisha:nodes:api`,
        );
      }
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     AISHA Watchdog Workflow Activation                   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  n8n: ${N8N_URL}`);
  console.log(
    `  Mode: ${STATUS_ONLY ? "status" : DRY_RUN ? "dry-run" : "activate"}`,
  );

  // 1. Check community nodes
  const nodesInstalled = await checkCommunityNodes();

  // 1b. Resolve placeholder workflow IDs by name
  await resolveWorkflowIds();

  // 2. Check workflow status
  const workflows = await getWorkflowStatus();

  // 3. Activate if requested
  if (!STATUS_ONLY && !DRY_RUN && !nodesInstalled) {
    console.log(
      "\n⚠ Community nodes not installed — skipping activation.",
    );
    console.log(
      "  Install first: npm run aisha:nodes:api\n  Then re-run:   npm run aisha:watchdogs:activate",
    );
  } else if (!STATUS_ONLY) {
    await activateWorkflows(workflows);
  }

  // Summary
  const active = workflows.filter((w) => w.active).length;
  const total = workflows.length;
  console.log(`\n═══ Summary: ${active}/${total} watchdog workflows active ═══\n`);
}

main().catch((err) => {
  console.error(`\n✗ Error: ${err.message}`);
  process.exit(1);
});

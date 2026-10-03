#!/usr/bin/env node
/**
 * deploy-agent-prompts.mjs — Deploy updated system prompts to n8n agents
 *
 * Reads local workflow JSONs, extracts system prompts, and pushes
 * them to the running n8n instance via API.
 *
 * Usage:
 *   node scripts/deploy-agent-prompts.mjs              # Deploy all
 *   node scripts/deploy-agent-prompts.mjs --dry-run    # Show diff only
 *   node scripts/deploy-agent-prompts.mjs --agent dirigent  # Single agent
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Load env ──────────────────────────────────────────────────────────
function loadEnv() {
  const envFiles = [".env", ".env.aisha"];
  const env = {};
  for (const f of envFiles) {
    try {
      const content = readFileSync(join(ROOT, f), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (/^[A-Z0-9_]+$/.test(key)) env[key] = val;
      }
    } catch (err) {
      console.warn(`[deploy-agent-prompts] env file ${f} skipped: ${err?.message || err}`);
    }
  }
  return env;
}

const env = loadEnv();
if (!env.N8N_WEBHOOK_URL) {
  console.error("ERROR: N8N_WEBHOOK_URL not set (env-driven; no hardcoded host). Set it in .env or .env.aisha.");
  process.exit(1);
}
const N8N_URL = env.N8N_WEBHOOK_URL.replace(/\/$/, "");
const N8N_API_KEY = env.N8N_API_KEY;

if (!N8N_API_KEY) {
  console.error("❌ N8N_API_KEY not found in .env or .env.aisha");
  process.exit(1);
}

const API = `${N8N_URL}/api/v1`;

// ── Workflow mapping ──────────────────────────────────────────────────
const AGENTS = {
  knowledge: {
    file: "WF_KNOWLEDGE_AGENT.json",
    agentNodeName: "Knowledge Agent",
  },
  compliance: {
    file: "WF_COMPLIANCE_AGENT.json",
    agentNodeName: "Compliance Agent",
  },
  delivery: {
    file: "WF_DELIVERY_AGENT.json",
    agentNodeName: "Delivery Agent",
  },
  dirigent: {
    file: "WF_DIRIGENT_AGENT.json",
    agentNodeName: "AISHA Dirigent",
  },
};

// ── API helpers ───────────────────────────────────────────────────────
async function apiGet(path) {
  const res = await fetch(`${API}${path}`, {
      signal: AbortSignal.timeout(30000),
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`${API}${path}`, {
      signal: AbortSignal.timeout(30000),
    method: "PUT",
    headers: {
      "X-N8N-API-KEY": N8N_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Find workflow on server by name ───────────────────────────────────
async function findWorkflowByName(name) {
  // Strip .json suffix for matching
  const workflowName = name.replace(".json", "");
  const { data } = await apiGet("/workflows?active=true&limit=50");
  return data.find((w) => w.name === workflowName);
}

// ── Extract system prompt from local JSON ─────────────────────────────
function extractLocalPrompt(agentKey) {
  const config = AGENTS[agentKey];
  const filePath = join(ROOT, "n8n", "workflows", config.file);
  const workflow = JSON.parse(readFileSync(filePath, "utf-8"));
  const agentNode = workflow.nodes.find(
    (n) => n.name === config.agentNodeName && n.type === "@n8n/n8n-nodes-langchain.agent"
  );
  if (!agentNode) {
    throw new Error(`Agent node '${config.agentNodeName}' not found in ${config.file}`);
  }
  return agentNode.parameters?.options?.systemMessage || "";
}

// ── Extract system prompt from server workflow ────────────────────────
function extractServerPrompt(workflow, agentNodeName) {
  const agentNode = workflow.nodes.find(
    (n) => n.name === agentNodeName && n.type === "@n8n/n8n-nodes-langchain.agent"
  );
  if (!agentNode) return "(not found)";
  return agentNode.parameters?.options?.systemMessage || "";
}

// ── Deploy prompt to server ──────────────────────────────────────────
async function deployPrompt(agentKey, dryRun = false) {
  const config = AGENTS[agentKey];
  const localPrompt = extractLocalPrompt(agentKey);

  // Find workflow on server
  const serverWorkflow = await findWorkflowByName(config.file);
  if (!serverWorkflow) {
    console.log(`  ⚠️  ${agentKey}: workflow not found on server — skipping`);
    return { status: "skipped", reason: "not found" };
  }

  // Get full workflow from server
  const fullWorkflow = await apiGet(`/workflows/${serverWorkflow.id}`);
  const serverPrompt = extractServerPrompt(fullWorkflow, config.agentNodeName);

  // Compare
  if (localPrompt === serverPrompt) {
    console.log(`  ✅ ${agentKey}: prompts already match — no deploy needed`);
    return { status: "unchanged" };
  }

  // Show diff summary
  const localLines = localPrompt.split("\\n").length;
  const serverLines = serverPrompt.split("\\n").length;
  console.log(
    `  📝 ${agentKey}: local=${localLines} lines, server=${serverLines} lines — CHANGED`
  );

  if (dryRun) {
    console.log(`     [DRY RUN] Would update system prompt for '${config.agentNodeName}'`);
    return { status: "would-update" };
  }

  // Update the agent node's system prompt
  const updatedNodes = fullWorkflow.nodes.map((node) => {
    if (
      node.name === config.agentNodeName &&
      node.type === "@n8n/n8n-nodes-langchain.agent"
    ) {
      return {
        ...node,
        parameters: {
          ...node.parameters,
          options: {
            ...node.parameters.options,
            systemMessage: localPrompt,
          },
        },
      };
    }
    return node;
  });

  // Push update (deactivate first, then PUT, then reactivate for webhook registration)
  const wfId = serverWorkflow.id;

  // Deactivate
  await fetch(`${API}/workflows/${wfId}/deactivate`, {
      signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });

  // PUT update with new prompt
  await apiPut(`/workflows/${wfId}`, {
    name: fullWorkflow.name,
    nodes: updatedNodes,
    connections: fullWorkflow.connections,
    settings: fullWorkflow.settings,
  });

  // Reactivate (re-registers webhooks in Queue Mode)
  await fetch(`${API}/workflows/${wfId}/activate`, {
      signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: { "X-N8N-API-KEY": N8N_API_KEY },
  });

  console.log(`  🚀 ${agentKey}: system prompt deployed to '${config.agentNodeName}'`);
  return { status: "deployed" };
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const agentIdx = args.indexOf("--agent");
  const agentFilter = agentIdx !== -1 ? args[agentIdx + 1] : undefined;
  const targetAgent = agentFilter || args.find((a) => !a.startsWith("--"));

  console.log(`\n🎯 DEPLOY AGENT PROMPTS${dryRun ? " (DRY RUN)" : ""}\n`);
  console.log(`   n8n: ${N8N_URL}\n`);

  const agentKeys = targetAgent
    ? [targetAgent]
    : Object.keys(AGENTS);

  const results = {};
  for (const key of agentKeys) {
    if (!AGENTS[key]) {
      console.log(`  ❌ Unknown agent: ${key}`);
      continue;
    }
    try {
      results[key] = await deployPrompt(key, dryRun);
    } catch (err) {
      console.log(`  ❌ ${key}: ${err.message}`);
      results[key] = { status: "error", error: err.message };
    }
  }

  // Summary
  console.log("\n── Summary ──");
  const deployed = Object.values(results).filter((r) => r.status === "deployed").length;
  const unchanged = Object.values(results).filter((r) => r.status === "unchanged").length;
  const errors = Object.values(results).filter((r) => r.status === "error").length;
  console.log(`   Deployed: ${deployed}, Unchanged: ${unchanged}, Errors: ${errors}`);

  if (deployed > 0 && !dryRun) {
    console.log("\n   ⚡ Workflows may need reactivation if prompts changed significantly.");
    console.log("   Run: npm run aisha:tools:status\n");
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});

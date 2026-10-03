#!/usr/bin/env node
/**
 * sync-workflows-from-server.mjs
 * 
 * Downloads current workflow state from n8n server and writes
 * clean portable JSONs to n8n/workflows/ directory.
 * 
 * Usage: node scripts/sync-workflows-from-server.mjs
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WF_DIR = resolve(ROOT, "n8n/workflows");
const ENV_PATH = resolve(ROOT, ".env.aisha");

function loadEnv() {
  if (!existsSync(ENV_PATH)) throw new Error(".env.aisha not found");
  const env = {};
  for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const N8N_URL = env.N8N_URL || env.N8N_WEBHOOK_URL;
if (!N8N_URL) {
  console.error("ERROR: N8N_URL not set (env-driven; no hardcoded host). Set N8N_URL or N8N_WEBHOOK_URL in .env.aisha or as env var.");
  process.exit(1);
}
const N8N_API_KEY = env.N8N_API_KEY;
if (!N8N_API_KEY) throw new Error("N8N_API_KEY not set");

// Name-to-file mapping
const WORKFLOW_FILE_MAP = {
  "WF_DIRIGENT_AGENT": "WF_DIRIGENT_AGENT",
  "WF_KNOWLEDGE_AGENT": "WF_KNOWLEDGE_AGENT", 
  "WF_COMPLIANCE_AGENT": "WF_COMPLIANCE_AGENT",
  "WF_DELIVERY_AGENT": "WF_DELIVERY_AGENT",
  "WF_MCP_BRIDGE": "WF_MCP_BRIDGE",
  "WF_COMPLIANCE_REROUTE": "WF_COMPLIANCE_REROUTE",
  "WF_MODEL_ROUTER": "WF_MODEL_ROUTER",
  "WF_NIGHTLY_STORY_AUDIT": "WF_NIGHTLY_STORY_AUDIT",
  "WF_PR_COMPLIANCE_GATE": "WF_PR_COMPLIANCE_GATE",
};

async function main() {
  console.log("📥 Syncing workflows from n8n server...\n");

  const res = await fetch(`${N8N_URL}/api/v1/workflows?limit=50`, {
      signal: AbortSignal.timeout(30000),
    headers: { "X-N8N-API-KEY": N8N_API_KEY }
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  
  const { data: workflows } = await res.json();
  let synced = 0;

  for (const brief of workflows) {
    const fileName = WORKFLOW_FILE_MAP[brief.name];
    if (!fileName) {
      console.log(`  ⏭️  ${brief.name} — not in file map, skipping`);
      continue;
    }

    // Fetch full workflow
    const wfRes = await fetch(`${N8N_URL}/api/v1/workflows/${brief.id}`, {
        signal: AbortSignal.timeout(30000),
      headers: { "X-N8N-API-KEY": N8N_API_KEY }
    });
    if (!wfRes.ok) { console.error(`Failed to fetch ${brief.name}: ${wfRes.status}`); continue; }
    const wf = await wfRes.json();

    // Clean export
    const clean = {
      name: wf.name,
      nodes: wf.nodes.map(n => {
        const out = {
          parameters: n.parameters || {},
          id: n.id,
          name: n.name,
          type: n.type,
          typeVersion: n.typeVersion,
          position: n.position,
        };
        if (n.credentials) out.credentials = n.credentials;
        return out;
      }),
      connections: wf.connections,
      settings: wf.settings || { executionOrder: "v1" },
      meta: { templateCredsSetupCompleted: false, instanceId: "aisha-aisha" },
      tags: wf.tags?.map(t => ({ name: t.name })) || [],
    };

    const filePath = resolve(WF_DIR, `${fileName}.json`);
    writeFileSync(filePath, JSON.stringify(clean, null, 2) + "\n");
    
    const toolCodeCount = clean.nodes.filter(n => n.type?.includes("toolCode")).length;
    const toolWfCount = clean.nodes.filter(n => n.type?.includes("toolWorkflow")).length;
    const active = brief.active ? "🟢" : "🔴";
    
    console.log(`  ${active} ${fileName.padEnd(30)} ${clean.nodes.length} nodes (toolCode: ${toolCodeCount}, toolWorkflow: ${toolWfCount})`);
    synced++;
  }

  console.log(`\n✅ ${synced} workflows synced to n8n/workflows/`);
}

main().catch(e => { console.error("💥", e.message); process.exit(1); });

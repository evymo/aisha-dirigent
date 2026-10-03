#!/usr/bin/env node
/**
 * Check n8n credentials and the working OpenAI node version.
 */
import { N8N_URL, N8N_API_KEY } from './lib/env.mjs';
import { porovnej } from './lib/razeni.mjs';

const API = `${N8N_URL}/api/v1`;
const h = { "X-N8N-API-KEY": N8N_API_KEY };

// Workflow IDs are env-driven — no hardcoded upstream IDs in source. Importing
// ./lib/env.mjs above already loaded config/domains.env, .env.aisha and
// .env-prod-backup into process.env, so these resolve from the same canonical
// sources as the rest of the toolchain. Missing config = fail fast.
function requireWorkflowId(name) {
  const v = process.env[name];
  if (!v) {
    console.error(
      `ERROR: ${name} not set. Add it to .env.aisha (or export ${name}=...) ` +
      `— no hardcoded workflow IDs allowed in source.`,
    );
    process.exit(1);
  }
  return v;
}

const KNOWLEDGE_WORKFLOW_ID = requireWorkflowId("N8N_KNOWLEDGE_WORKFLOW_ID");
const COMPLIANCE_WORKFLOW_ID = requireWorkflowId("N8N_COMPLIANCE_WORKFLOW_ID");
const MODEL_ROUTER_WORKFLOW_ID = requireWorkflowId("N8N_MODEL_ROUTER_WORKFLOW_ID");

async function main() {
  // 1. Check credentials
  console.log("=== Credentials ===");
  const credResp = await fetch(`${API}/credentials?limit=50`, { signal: AbortSignal.timeout(30_000), headers: h });
  if (!credResp.ok) { console.error(`credentials API ${credResp.status}`); return; }
  const creds = (await credResp.json()).data || [];
  for (const c of creds.sort((a, b) => porovnej(a.name, b.name))) {
    console.log(`  ${c.id} | ${c.type} | ${c.name}`);
  }

  // 2. Check a WORKING workflow's OpenAI config for comparison
  console.log("\n=== Working Knowledge Agent's model config ===");
  const knResp = await fetch(`${API}/workflows/${KNOWLEDGE_WORKFLOW_ID}`, { signal: AbortSignal.timeout(30_000), headers: h });
  if (!knResp.ok) { console.error(`workflow API ${knResp.status}`); return; }
  const kn = await knResp.json();
  for (const n of kn.nodes || []) {
    if (n.type?.includes("lmChat") || n.type?.includes("openAi")) {
      console.log(`  ${n.name} (${n.type} v${n.typeVersion})`);
      console.log(`  params: ${JSON.stringify(n.parameters)}`);
      console.log(`  creds: ${JSON.stringify(n.credentials)}`);
    }
  }

  // 3. Check Compliance Agent too
  console.log("\n=== Compliance Agent's model config ===");
  const compResp = await fetch(`${API}/workflows/${COMPLIANCE_WORKFLOW_ID}`, { signal: AbortSignal.timeout(30_000), headers: h });
  if (!compResp.ok) { console.error(`workflow API ${compResp.status}`); return; }
  const comp = await compResp.json();
  for (const n of comp.nodes || []) {
    if (n.type?.includes("lmChat") || n.type?.includes("openAi")) {
      console.log(`  ${n.name} (${n.type} v${n.typeVersion})`);
      console.log(`  params: ${JSON.stringify(n.parameters)}`);
      console.log(`  creds: ${JSON.stringify(n.credentials)}`);
    }
  }

  // 4. Check the working Dirigent before our update (model router's config)
  console.log("\n=== Model Router's config ===");
  const mrResp = await fetch(`${API}/workflows/${MODEL_ROUTER_WORKFLOW_ID}`, { signal: AbortSignal.timeout(30_000), headers: h });
  if (!mrResp.ok) { console.error(`workflow API ${mrResp.status}`); return; }
  const mr = await mrResp.json();
  for (const n of mr.nodes || []) {
    if (n.type?.includes("lmChat") || n.type?.includes("openAi") || n.type?.includes("Chat")) {
      console.log(`  ${n.name} (${n.type} v${n.typeVersion})`);
      console.log(`  params: ${JSON.stringify(n.parameters)}`);
      console.log(`  creds: ${JSON.stringify(n.credentials)}`);
    }
  }
}

main().catch((e) => console.error(e.message));

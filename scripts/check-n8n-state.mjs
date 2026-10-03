#!/usr/bin/env node
// Temporary script to check n8n server state vs local workflow files
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { N8N_URL } from './lib/env.mjs';
import { porovnej } from './lib/razeni.mjs';

const API_KEY = process.env.N8N_API_KEY || "";
if (!API_KEY) { console.error("Missing N8N_API_KEY env var"); process.exit(1); }
const ROOT = new URL("..", import.meta.url).pathname;

async function main() {
  // Fetch server workflows
  const res = await fetch(`${N8N_URL}/api/v1/workflows?limit=100`, {
      signal: AbortSignal.timeout(30000),
    headers: { "X-N8N-API-KEY": API_KEY },
  });
  if (!res.ok) { console.error(`n8n API ${res.status}`); process.exit(1); }
  const body = await res.json();
  const wfs = body.data || [];

  console.log(`\n=== n8n server workflows (${wfs.length}) ===`);
  for (const w of wfs.sort((a, b) => porovnej(a.name, b.name))) {
    const icon = w.active ? "✅" : "⬜";
    console.log(`${icon} ${w.name} (id: ${w.id}, nodes: ${w.nodes?.length || "?"})`);
  }

  // Load local workflows
  const localDir = join(ROOT, "n8n", "workflows");
  const localFiles = readdirSync(localDir).filter((f) => f.endsWith(".json"));
  const serverNames = new Set(wfs.map((w) => w.name));
  const serverByName = Object.fromEntries(wfs.map((w) => [w.name, w]));

  console.log(`\n=== Local-only (NOT on server) ===`);
  let needDeploy = 0;
  for (const f of localFiles.sort()) {
    const wf = JSON.parse(readFileSync(join(localDir, f), "utf-8"));
    if (!serverNames.has(wf.name)) {
      console.log(`🆕 ${wf.name} (${f}, ${wf.nodes?.length || 0} nodes)`);
      needDeploy++;
    }
  }
  if (needDeploy === 0) console.log("  (none)");

  console.log(`\n=== Drift detection (local vs server) ===`);
  let driftCount = 0;
  for (const f of localFiles.sort()) {
    const local = JSON.parse(readFileSync(join(localDir, f), "utf-8"));
    const server = serverByName[local.name];
    if (!server) continue;

    const localNodes = local.nodes?.length || 0;
    const serverNodes = server.nodes?.length || 0;
    if (localNodes !== serverNodes) {
      console.log(`⚠️  ${local.name}: local=${localNodes} nodes, server=${serverNodes} nodes`);
      driftCount++;
    }
  }
  if (driftCount === 0) console.log("  (no drift detected)");

  console.log(`\n=== Server-only (no local JSON) ===`);
  const localNames = new Set(
    localFiles.map((f) => JSON.parse(readFileSync(join(localDir, f), "utf-8")).name),
  );
  let serverOnly = 0;
  for (const w of wfs) {
    if (!localNames.has(w.name)) {
      console.log(`🔵 ${w.name} (id: ${w.id})`);
      serverOnly++;
    }
  }
  if (serverOnly === 0) console.log("  (none)");

  console.log(`\n=== Summary ===`);
  console.log(`Server: ${wfs.length} workflows`);
  console.log(`Local:  ${localFiles.length} workflow files`);
  console.log(`Need deploy: ${needDeploy}`);
  console.log(`Drift: ${driftCount}`);
  console.log(`Server-only: ${serverOnly}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

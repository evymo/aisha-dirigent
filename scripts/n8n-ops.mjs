#!/usr/bin/env node
// =============================================================================
// n8n-ops.mjs — Unified operational tool for AISHA n8n instance
// =============================================================================
//
// All config from .env.aisha (N8N_API_KEY, N8N_WEBHOOK_URL). No hardcoded keys.
//
// Commands:
//   node scripts/n8n-ops.mjs sync        — Download live workflows → n8n/workflows/
//   node scripts/n8n-ops.mjs verify      — Health check: credentials, workflows, status
//   node scripts/n8n-ops.mjs purge-test  — Purge all workflows, re-import from source, verify
//   node scripts/n8n-ops.mjs executions  — Show recent executions (optional: --workflow=NAME)
//   node scripts/n8n-ops.mjs creds       — List all credentials
//   node scripts/n8n-ops.mjs dedup       — Find and remove duplicate credentials
//
// Environment:
//   Reads from .env.aisha in project root. Override with env vars:
//   N8N_URL, N8N_API_KEY
// =============================================================================

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WF_DIR = resolve(ROOT, "n8n/workflows");
const ENV_PATH = resolve(ROOT, ".env.aisha");

// ── Config ──────────────────────────────────────────────────────────────────

function loadEnv() {
  const env = {};
  if (existsSync(ENV_PATH)) {
    for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const fileEnv = loadEnv();
const N8N_URL = process.env.N8N_URL || fileEnv.N8N_WEBHOOK_URL || fileEnv.N8N_URL;
if (!N8N_URL) {
  console.error("ERROR: N8N_URL not set (env-driven; no hardcoded host). Set N8N_URL or N8N_WEBHOOK_URL in .env.aisha or as env var.");
  process.exit(1);
}
const N8N_API_KEY = process.env.N8N_API_KEY || fileEnv.N8N_API_KEY;

if (!N8N_API_KEY) {
  console.error("ERROR: N8N_API_KEY not found. Set it in .env.aisha or as env var.");
  process.exit(1);
}

// ── API Client ──────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const url = `${N8N_URL}/api/v1${path}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-N8N-API-KEY": N8N_API_KEY,
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status} ${path}: ${body.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ── Credential ID Stripping ─────────────────────────────────────────────────

const CRED_ID_PATTERN = /^[A-Za-z0-9]{16,}$/;
const PLACEHOLDER = "__REMAP__";

function stripCredentialIds(workflow) {
  let count = 0;
  for (const node of workflow.nodes || []) {
    if (!node.credentials) continue;
    for (const [, credRef] of Object.entries(node.credentials)) {
      if (credRef && typeof credRef === "object" && credRef.id && credRef.id !== PLACEHOLDER) {
        if (CRED_ID_PATTERN.test(credRef.id)) {
          credRef.id = PLACEHOLDER;
          count++;
        }
      }
    }
  }
  return count;
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdSync() {
  console.log(`📥 Syncing ALL workflows from ${N8N_URL} → n8n/workflows/\n`);

  const { data: workflows } = await api("/workflows?limit=100");
  let synced = 0;

  for (const brief of workflows) {
    const wfRes = await api(`/workflows/${brief.id}`);

    // Clean export: keep only portable fields
    const clean = {
      name: wfRes.name,
      nodes: (wfRes.nodes || []).map(n => {
        const out = { parameters: n.parameters || {}, id: n.id, name: n.name, type: n.type, typeVersion: n.typeVersion, position: n.position };
        if (n.credentials) out.credentials = n.credentials;
        return out;
      }),
      connections: wfRes.connections,
      settings: wfRes.settings || { executionOrder: "v1" },
    };

    // Strip production credential IDs → __REMAP__
    const stripped = stripCredentialIds(clean);

    // Write file using workflow name as filename
    const fileName = brief.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = resolve(WF_DIR, `${fileName}.json`);
    writeFileSync(filePath, JSON.stringify(clean, null, 2) + "\n");

    const active = brief.active ? "🟢" : "🔴";
    console.log(`  ${active} ${fileName.padEnd(35)} ${clean.nodes.length} nodes, ${stripped} cred IDs stripped`);
    synced++;
  }

  console.log(`\n✅ ${synced} workflows synced (credential IDs → ${PLACEHOLDER})`);
}

async function cmdVerify() {
  console.log(`🏥 Verifying n8n instance: ${N8N_URL}\n`);

  // Credentials
  const { data: creds } = await api("/credentials");
  console.log(`📋 Credentials: ${creds.length}`);
  const nameCount = {};
  for (const c of creds) {
    console.log(`  ${c.name.padEnd(35)} [${c.type}] id=${c.id}`);
    nameCount[c.name] = (nameCount[c.name] || 0) + 1;
  }
  const dupes = Object.entries(nameCount).filter(([, v]) => v > 1);
  if (dupes.length) {
    console.log(`\n⚠️  DUPLICATE CREDENTIALS (will cause remapping issues):`);
    for (const [name, count] of dupes) console.log(`  "${name}" × ${count}`);
  }

  // Workflows
  const { data: workflows } = await api("/workflows?limit=100");
  const active = workflows.filter(w => w.active);
  const inactive = workflows.filter(w => !w.active);
  console.log(`\n📦 Workflows: ${workflows.length} total, ${active.length} active, ${inactive.length} inactive`);
  for (const w of workflows) {
    console.log(`  ${w.active ? "🟢" : "🔴"} ${w.name.padEnd(35)} id=${w.id}`);
  }

  // Source file coverage
  const sourceFiles = readdirSync(WF_DIR).filter(f => f.endsWith(".json"));
  const liveNames = new Set(workflows.map(w => w.name));
  const sourceNames = new Set(sourceFiles.map(f => f.replace(".json", "")));
  const missingLive = [...sourceNames].filter(n => !liveNames.has(n));
  const missingSource = [...liveNames].filter(n => !sourceNames.has(n));

  if (missingLive.length) {
    console.log(`\n⚠️  In source but NOT live: ${missingLive.join(", ")}`);
  }
  if (missingSource.length) {
    console.log(`\n⚠️  Live but NOT in source: ${missingSource.join(", ")}`);
  }

  console.log(`\n✅ Verification complete`);
}

async function cmdCreds() {
  const { data: creds } = await api("/credentials");
  console.log(`📋 ${creds.length} credentials:\n`);
  for (const c of creds) {
    console.log(`  ${c.id.padEnd(20)} [${c.type.padEnd(20)}] ${c.name}`);
  }
}

async function cmdDedup() {
  const { data: creds } = await api("/credentials");
  const seen = new Map();
  const dupes = [];

  for (const c of creds) {
    if (seen.has(c.name)) {
      dupes.push(c);
    } else {
      seen.set(c.name, c);
    }
  }

  if (dupes.length === 0) {
    console.log("✅ No duplicate credentials found");
    return;
  }

  console.log(`🧹 Found ${dupes.length} duplicate(s):\n`);
  for (const d of dupes) {
    const kept = seen.get(d.name);
    console.log(`  "${d.name}" — deleting ${d.id}, keeping ${kept.id}`);
    await api(`/credentials/${d.id}`, { method: "DELETE" });
    console.log(`  ✅ Deleted ${d.id}`);
  }
}

async function cmdExecutions() {
  const wfArg = process.argv.find(a => a.startsWith("--workflow="));
  let url = "/executions?limit=10";

  if (wfArg) {
    const wfName = wfArg.split("=")[1];
    const { data: workflows } = await api("/workflows?limit=100");
    const wf = workflows.find(w => w.name.includes(wfName));
    if (!wf) {
      console.error(`Workflow not found: ${wfName}`);
      process.exit(1);
    }
    url = `/executions?workflowId=${wf.id}&limit=10`;
    console.log(`📊 Recent executions for "${wf.name}":\n`);
  } else {
    console.log(`📊 Recent executions (all workflows):\n`);
  }

  const { data: execs } = await api(url);
  for (const e of execs) {
    const status = e.status === "success" ? "✅" : e.status === "error" ? "❌" : "⏳";
    const time = e.stoppedAt || e.startedAt || "?";
    const wfName = e.workflowData?.name || e.workflowId || "?";
    console.log(`  ${status} #${e.id} ${wfName.padEnd(30)} ${e.status.padEnd(10)} ${time}`);
  }
}

async function cmdPurgeTest() {
  console.log(`🧪 PURGE + REDEPLOY TEST on ${N8N_URL}\n`);
  console.log("  This will DELETE all workflows and re-import from source.\n");

  // Step 1: Fetch credentials for remapping
  const { data: creds } = await api("/credentials");
  const credMap = new Map();
  for (const c of creds) credMap.set(c.name, c.id);
  console.log(`📋 ${credMap.size} credentials loaded for remapping\n`);

  // Alias map (same as self-setup.mjs)
  const CREDENTIAL_ALIASES = {
    "httpHeaderAuth:AISHA Supabase": "AISHA Supabase (Service Role)",
    // Backward compatibility: old "Evymo" names from pre-rebrand workflows
    "httpHeaderAuth:Evymo Supabase": "AISHA Supabase (Service Role)",
    "httpHeaderAuth:Supabase Service Role Key": "Supabase Service Role",
  };

  // Step 2: Delete all existing workflows
  const { data: existing } = await api("/workflows?limit=100");
  console.log(`🗑️  Purging ${existing.length} existing workflows...`);
  for (const w of existing) {
    await api(`/workflows/${w.id}`, { method: "DELETE" });
  }
  console.log(`  ✅ Purged\n`);

  // Step 3: Import from source with credential remapping
  const files = readdirSync(WF_DIR).filter(f => f.endsWith(".json")).sort();
  let created = 0, activated = 0, failed = 0, credRefs = 0;

  for (const file of files) {
    const wf = JSON.parse(readFileSync(resolve(WF_DIR, file), "utf-8"));

    // Remap credentials
    for (const node of wf.nodes || []) {
      if (!node.credentials) continue;
      for (const [credType, credRef] of Object.entries(node.credentials)) {
        if (!credRef || typeof credRef !== "object") continue;
        const aliasKey = `${credType}:${credRef.name}`;
        const resolvedName = CREDENTIAL_ALIASES[aliasKey] || credRef.name;
        if (resolvedName && credMap.has(resolvedName)) {
          credRef.id = credMap.get(resolvedName);
          if (resolvedName !== credRef.name) credRef.name = resolvedName;
          credRefs++;
        }
      }
    }

    try {
      const result = await api("/workflows", {
        method: "POST",
        body: JSON.stringify({
          name: wf.name,
          nodes: wf.nodes,
          connections: wf.connections,
          settings: wf.settings || {},
        }),
      });

      // Activate
      try {
        await api(`/workflows/${result.id}/activate`, { method: "POST" });
        activated++;
      } catch (e) {
        console.log(`  ⚠️  ${wf.name}: activation failed — ${e.message.slice(0, 80)}`);
      }

      created++;
      console.log(`  ✅ ${wf.name} (id: ${result.id})`);
    } catch (e) {
      failed++;
      console.log(`  ❌ ${wf.name}: ${e.message.slice(0, 100)}`);
    }
  }

  console.log(`\n📊 Results: ${created}/${files.length} created, ${activated} activated, ${failed} failed, ${credRefs} credential refs remapped`);

  if (failed === 0 && created === files.length) {
    console.log("🎉 PURGE + REDEPLOY TEST PASSED");
  } else {
    console.log("❌ PURGE + REDEPLOY TEST FAILED");
    process.exit(1);
  }
}

// ── Push (safe update) ─────────────────────────────────────────────────────

/**
 * n8n API writable fields — anything else gets rejected with 400
 */
const N8N_WRITABLE_FIELDS = ["name", "nodes", "connections", "settings", "staticData", "pinData"];

function pickWritable(wf) {
  const out = {};
  for (const k of N8N_WRITABLE_FIELDS) {
    if (wf[k] !== undefined) out[k] = wf[k];
  }
  return out;
}

/**
 * Deep-compare nodes schedule triggers to detect meaningful changes.
 * Returns list of change descriptions.
 */
function diffSchedules(localNodes, remoteNodes) {
  const changes = [];
  const remoteByName = new Map(remoteNodes.map(n => [n.name, n]));

  for (const localNode of localNodes) {
    const remote = remoteByName.get(localNode.name);
    if (!remote) {
      changes.push(`+ New node: ${localNode.name}`);
      continue;
    }
    // Compare parameters JSON
    const lp = JSON.stringify(localNode.parameters || {});
    const rp = JSON.stringify(remote.parameters || {});
    if (lp !== rp) {
      changes.push(`~ ${localNode.name}: parameters changed`);
    }
  }

  // Deleted nodes
  const localNames = new Set(localNodes.map(n => n.name));
  for (const remote of remoteNodes) {
    if (!localNames.has(remote.name)) {
      changes.push(`- Removed node: ${remote.name}`);
    }
  }

  return changes;
}

async function cmdPush() {
  const args = process.argv.slice(3);
  const DRY_RUN = args.includes("--dry-run");
  const nameFilter = args.find(a => a.startsWith("--workflow="))?.split("=")[1];

  console.log(`📤 Push local workflows → ${N8N_URL}${DRY_RUN ? " [DRY RUN]" : ""}\n`);

  // 1. Fetch all remote workflows
  const { data: remoteList } = await api("/workflows?limit=100");
  const remoteByName = new Map(remoteList.map(w => [w.name, w]));
  console.log(`  Remote: ${remoteList.length} workflows\n`);

  // 2. Load credentials for remapping
  const { data: creds } = await api("/credentials");
  const credMap = new Map(creds.map(c => [c.name, c.id]));
  const CREDENTIAL_ALIASES = {
    "httpHeaderAuth:AISHA Supabase": "AISHA Gateway (Service Role)",
    "httpHeaderAuth:Evymo Supabase": "AISHA Gateway (Service Role)",
    "httpHeaderAuth:Supabase Service Role Key": "Gateway Service Role",
  };

  // 3. Read local files
  const files = readdirSync(WF_DIR).filter(f => f.endsWith(".json")).sort();
  let updated = 0, skipped = 0, created = 0, failed = 0;

  for (const file of files) {
    const localWf = JSON.parse(readFileSync(resolve(WF_DIR, file), "utf-8"));
    const wfName = localWf.name;

    if (nameFilter && wfName !== nameFilter && !file.includes(nameFilter)) {
      continue;
    }

    // Remap credential IDs from __REMAP__ to actual production IDs
    let credRefs = 0;
    for (const node of localWf.nodes || []) {
      if (!node.credentials) continue;
      for (const [credType, credRef] of Object.entries(node.credentials)) {
        if (!credRef || typeof credRef !== "object") continue;
        const aliasKey = `${credType}:${credRef.name}`;
        const resolvedName = CREDENTIAL_ALIASES[aliasKey] || credRef.name;
        if (resolvedName && credMap.has(resolvedName)) {
          credRef.id = credMap.get(resolvedName);
          if (resolvedName !== credRef.name) credRef.name = resolvedName;
          credRefs++;
        }
      }
    }

    const remote = remoteByName.get(wfName);

    if (remote) {
      // Compare to detect changes
      const fullRemote = await api(`/workflows/${remote.id}`);
      const changes = diffSchedules(localWf.nodes || [], fullRemote.nodes || []);

      // Also check connections diff
      const localConn = JSON.stringify(localWf.connections || {});
      const remoteConn = JSON.stringify(fullRemote.connections || {});
      if (localConn !== remoteConn) changes.push("~ connections changed");

      if (changes.length === 0) {
        skipped++;
        continue;
      }

      console.log(`  📝 ${wfName} (id=${remote.id}):`);
      for (const c of changes) console.log(`     ${c}`);

      if (!DRY_RUN) {
        try {
          const payload = pickWritable(localWf);
          await api(`/workflows/${remote.id}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          console.log(`     ✅ Updated (${credRefs} creds remapped)`);
          updated++;
        } catch (e) {
          console.log(`     ❌ Failed: ${e.message.slice(0, 120)}`);
          failed++;
        }
      } else {
        updated++;
      }
    } else {
      // New workflow — create
      console.log(`  ➕ ${wfName} (new):`);

      if (!DRY_RUN) {
        try {
          const result = await api("/workflows", {
            method: "POST",
            body: JSON.stringify({
              name: wfName,
              nodes: localWf.nodes,
              connections: localWf.connections,
              settings: localWf.settings || {},
            }),
          });
          // Activate
          try {
            await api(`/workflows/${result.id}/activate`, { method: "POST" });
          } catch { /* activation may fail for manual workflows */ }
          console.log(`     ✅ Created (id=${result.id}, ${credRefs} creds remapped)`);
          created++;
        } catch (e) {
          console.log(`     ❌ Failed: ${e.message.slice(0, 120)}`);
          failed++;
        }
      } else {
        created++;
      }
    }
  }

  console.log(`\n📊 Results: ${updated} updated, ${created} created, ${skipped} unchanged, ${failed} failed`);
  if (DRY_RUN) console.log("  [DRY RUN] No changes made. Run without --dry-run to apply.");
  if (failed > 0) process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────────

const cmd = process.argv[2];
const commands = { sync: cmdSync, push: cmdPush, verify: cmdVerify, creds: cmdCreds, dedup: cmdDedup, executions: cmdExecutions, "purge-test": cmdPurgeTest };

if (!cmd || !commands[cmd]) {
  console.log(`Usage: node scripts/n8n-ops.mjs <command> [options]\n`);
  console.log("Commands:");
  console.log("  sync        — Download live workflows → n8n/workflows/ (strips credential IDs)");
  console.log("  push        — Push local workflows → production n8n (safe update by name)");
  console.log("               Options: --dry-run, --workflow=NAME (default: all changed)");
  console.log("  verify      — Health check: credentials, workflows, coverage");
  console.log("  creds       — List all credentials");
  console.log("  dedup       — Find and remove duplicate credentials");
  console.log("  executions  — Show recent executions (--workflow=NAME)");
  console.log("  purge-test  — Purge all workflows, re-import from source, verify");
  console.log(`\nConfig: ${ENV_PATH}`);
  console.log(`Target: ${N8N_URL}`);
  process.exit(cmd ? 1 : 0);
}

commands[cmd]().catch(e => { console.error("💥", e.message); process.exit(1); });

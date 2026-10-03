#!/usr/bin/env node
/**
 * deploy-workflows.mjs — Deploy all local workflow JSONs to n8n server.
 * Creates new, updates existing, activates those with a starting node.
 *
 * Pověření NEZAKLÁDÁ: jediný zakladatel je scripts/n8n/provision-credentials.mjs,
 * který zapíše mapu `typ::jméno → id` (N8N_POVERENI_MAPA); tady se podle ní jen
 * přemapují odkazy `__REMAP__`.
 * 
 * Usage:
 *   node scripts/deploy-workflows.mjs [--dry-run] [--force]
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORKFLOWS_DIR = join(ROOT, "n8n", "workflows");

import { isDirectRun } from "./lib/cli-entry.mjs";

const { N8N_URL, N8N_API_KEY: API_KEY } = isDirectRun(import.meta.url) ? await import("./lib/env.mjs") : {};

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

// Credential name aliases: workflow JSONs may use short names that map to canonical ones
const CREDENTIAL_ALIASES = {
  "httpHeaderAuth:AISHA Supabase": "AISHA Gateway (Service Role)",
  // Backward compatibility: old "Evymo" names from pre-rebrand workflows
  "httpHeaderAuth:Evymo Supabase": "AISHA Gateway (Service Role)",
  "httpHeaderAuth:Gateway Service Role Key": "Gateway Service Role",
};

/**
 * Remap credential IDs in workflow nodes from __REMAP__ placeholders to actual IDs.
 * Matches by credential NAME (with alias resolution).
 */
function remapWorkflowCredentials(workflow, credMap) {
  let remapped = 0;
  for (const node of workflow.nodes || []) {
    if (!node.credentials) continue;
    for (const [credType, credRef] of Object.entries(node.credentials)) {
      if (!credRef || typeof credRef !== "object") continue;
      const credName = credRef.name;
      const aliasKey = `${credType}:${credName}`;
      const resolvedName = CREDENTIAL_ALIASES[aliasKey] || credName;
      const klic = `${credType}::${resolvedName}`;
      if (resolvedName && credMap.has(klic)) {
        const newId = credMap.get(klic);
        if (credRef.id !== newId) {
          credRef.id = newId;
          if (resolvedName !== credName) credRef.name = resolvedName;
          remapped++;
        }
      }
    }
  }
  return remapped;
}

async function n8nApi(path, opts = {}) {
  const url = `${N8N_URL}/api/v1${path}`;
  const res = await fetch(url, {
      signal: AbortSignal.timeout(30000),
    ...opts,
    headers: {
      "X-N8N-API-KEY": API_KEY,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Typy, které n8n 1.79 při aktivaci NEBERE za spouštěč (active-workflow-manager
 * checkIfWorkflowCanBeActivated: spouštěč = typ s trigger/poll/webhook; STARTING_NODES
 * se přeskakují). Podworkflow s executeWorkflowTrigger se volá, neaktivuje.
 * ⛔ NAMĚŘENO 2026-09-18 (guru): WF_DEBUG_AGENT, WF_DEV_PATCH, WF_MCP_BRIDGE a
 * WF_VERIFIER padaly při aktivaci „has no node to start the workflow" a nasazení
 * je počítalo jako selhání.
 */
const NESPOUSTECI = new Set([
  "n8n-nodes-base.executeWorkflowTrigger",
  "n8n-nodes-base.manualTrigger",
  "n8n-nodes-base.errorTrigger",
  "n8n-nodes-base.start",
  "@n8n/n8n-nodes-langchain.manualChatTrigger",
]);
const POLL_TYPY = new Set(["n8n-nodes-base.cron", "n8n-nodes-base.interval", "n8n-nodes-base.webhook"]);

/** Má workflow uzel, kterým ho n8n umí spustit (a tedy aktivovat)? */
export function maSpoustec(workflow) {
  return (workflow.nodes || []).some(
    (n) => n.disabled !== true && !NESPOUSTECI.has(n.type) && (/Trigger$/.test(n.type) || POLL_TYPY.has(n.type)),
  );
}

/**
 * Odkazy, které po přemapování neukazují na pověření z mapy — `__REMAP__` i id
 * z exportu jiné instance. n8n by je nenašel („Credential with ID … does not exist").
 */
export function nepremapovane(workflow, credMap) {
  const zname = new Set([...credMap.values()].filter(Boolean));
  return (workflow.nodes || []).flatMap((n) =>
    Object.entries(n.credentials || {})
      .filter(([, ref]) => ref && typeof ref === "object" && !zname.has(ref.id))
      .map(([typ, ref]) => `${typ}::${ref.name}`),
  );
}

/**
 * Rozdělí nepřemapované odkazy: VOLITELNÉ = pověření je deklarované, ale záměrně
 * nezaložené (v mapě null — chybí klíč třetí strany, např. GITHUB_API_TOKEN);
 * CHYBĚJÍCÍ = nikdo ho nezaložil, i když měl (selhání).
 * ⛔ NAMĚŘENO 2026-09-19 (guru): bez tohohle rozlišení nasazení odmítlo
 * workflowy s volitelnou integrací (NocoDB, GitHub) úplně a v n8n zůstaly
 * jejich staré verze — aktivní a rozbité.
 */
export function roztridNepremapovane(workflow, credMap) {
  const volitelna = [];
  const chybejici = [];
  for (const k of nepremapovane(workflow, credMap)) {
    const typ = k.slice(0, k.indexOf("::"));
    const jmeno = k.slice(k.indexOf("::") + 2);
    const klic = `${typ}::${CREDENTIAL_ALIASES[`${typ}:${jmeno}`] || jmeno}`;
    (credMap.has(klic) && credMap.get(klic) === null ? volitelna : chybejici).push(k);
  }
  return { volitelna: [...new Set(volitelna)], chybejici: [...new Set(chybejici)] };
}

async function main() {
  console.log(`\n═══ Workflow Deploy to ${N8N_URL} ═══`);
  if (DRY_RUN) console.log("  (DRY RUN — no changes will be made)\n");

  // Get server state
  const serverResp = await n8nApi("/workflows?limit=100");
  const serverWFs = serverResp.data || [];
  const serverByName = Object.fromEntries(serverWFs.map((w) => [w.name, w]));
  console.log(`Server: ${serverWFs.length} workflows\n`);

  // Load local
  const files = readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  console.log(`Local: ${files.length} workflow files\n`);

  // Mapa pověření od provision-credentials (veřejné API n8n 1.79 je nevypíše:
  // GET /credentials → 405). Bez mapy by každý odkaz zůstal __REMAP__.
  const mapaCesta = process.env.N8N_POVERENI_MAPA;
  if (!mapaCesta || !existsSync(mapaCesta)) {
    console.error("❌ mapa pověření chybí (N8N_POVERENI_MAPA) — spusť nejdřív scripts/n8n/provision-credentials.mjs, který ji zapíše");
    process.exit(1);
  }
  const credMap = new Map(Object.entries(JSON.parse(readFileSync(mapaCesta, "utf-8"))));
  console.log(`Credentials: ${credMap.size} v mapě pro přemapování\n`);

/**
 * ⛔ VEŘEJNÉ API n8n PŘIJÍMÁ JEN SVŮJ SEZNAM KLÍČŮ. Naměřeno 2026-09-07 v RIQ:
 * z 93 workflowů jich 66 skončilo na `request/body/settings must NOT have
 * additional properties` — a přesně 66 souborů nese v `settings` klíč, který
 * API nezná (`callerPolicy` 66×, `availableInMCP` 63×). Ty klíče do exportu
 * patří, editor je používá; do PUT/POST na veřejné API ale ne.
 *
 * ⭐ FILTR, NE ÚPRAVA ZDROJŮ: soubory zůstávají věrným exportem z n8n. Ořezává
 * se až to, co jde na drát — jinak by se export a repo rozešly.
 */
const SETTINGS_API_KLICE = new Set([
  "saveExecutionProgress",
  "saveManualExecutions",
  "saveDataErrorExecution",
  "saveDataSuccessExecution",
  "executionTimeout",
  "errorWorkflow",
  "timezone",
  "executionOrder",
]);

/** Jen klíče, které veřejné API n8n v `settings` zná. */
function settingsProApi(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (SETTINGS_API_KLICE.has(k)) out[k] = v;
  }
  return out;
}

  const results = { deployed: 0, updated: 0, skipped: 0, failed: 0, activated: 0, bezSpoustece: 0, cekaNaVolitelne: 0 };
  const newIds = {};

  for (const file of files) {
    const local = JSON.parse(readFileSync(join(WORKFLOWS_DIR, file), "utf-8"));
    const server = serverByName[local.name];

    // Remap credential IDs before deploy
    const remapped = remapWorkflowCredentials(local, credMap);
    if (remapped > 0 && !DRY_RUN) {
      console.log(`  🔄 ${local.name}: remapped ${remapped} credential refs`);
    }
    const { volitelna, chybejici } = roztridNepremapovane(local, credMap);
    if (chybejici.length > 0) {
      console.log(`  ❌ ${local.name} — pověření, které nikdo nezaložil: ${chybejici.join(", ")}`);
      results.failed++;
      continue;
    }
    if (volitelna.length > 0) {
      console.log(`  ⏸  ${local.name} — nahraje se NEAKTIVNÍ: čeká na volitelné pověření ${volitelna.join(", ")} (chybí jeho env)`);
      results.cekaNaVolitelne++;
    }
    const aktivovat = maSpoustec(local) && volitelna.length === 0;

    if (server) {
      // Compare node counts (skip if in sync, unless --force)
      const localNodes = local.nodes?.length || 0;
      const serverNodes = server.nodes?.length || 0;

      if (localNodes === serverNodes && !FORCE) {
        console.log(`  ⏭️  ${local.name} — in sync (${localNodes} nodes)`);
        results.skipped++;
        continue;
      }

      console.log(
        `  🔄 ${local.name} — updating (${serverNodes}→${localNodes} nodes)`,
      );
      if (DRY_RUN) {
        results.updated++;
        continue;
      }

      try {
        // Deactivate first if active
        if (server.active) {
          await n8nApi(`/workflows/${server.id}/deactivate`, { method: "POST" });
        }

        await n8nApi(`/workflows/${server.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: local.name,
            nodes: local.nodes,
            connections: local.connections,
            settings: settingsProApi(local.settings),
          }),
        });

        if (aktivovat) {
          await n8nApi(`/workflows/${server.id}/activate`, { method: "POST" });
          console.log(`       ✅ Updated + activated`);
          results.activated++;
        } else {
          console.log(`       ✅ Updated (neaktivní — bez spouštěče nebo čeká na volitelné pověření)`);
          results.bezSpoustece++;
        }
        results.updated++;
      } catch (err) {
        console.log(`       ❌ FAILED: ${err.message}`);
        results.failed++;
      }
    } else {
      console.log(`  🆕 ${local.name} — deploying (${local.nodes?.length || 0} nodes)`);
      if (DRY_RUN) {
        results.deployed++;
        continue;
      }

      try {
        const created = await n8nApi("/workflows", {
          method: "POST",
          body: JSON.stringify({
            name: local.name,
            nodes: local.nodes,
            connections: local.connections,
            settings: settingsProApi(local.settings),
          }),
        });

        newIds[local.name] = created.id;
        console.log(`       ✅ Created (id: ${created.id})`);

        if (aktivovat) {
          await n8nApi(`/workflows/${created.id}/activate`, { method: "POST" });
          console.log(`       🟢 Activated`);
          results.activated++;
        } else {
          console.log(`       ⏸  neaktivní — bez spouštěče nebo čeká na volitelné pověření`);
          results.bezSpoustece++;
        }

        results.deployed++;
      } catch (err) {
        console.log(`       ❌ FAILED: ${err.message}`);
        results.failed++;
      }
    }
  }

  // Set n8n variables for new workflow IDs
  const varMappings = {
    WF_EXPERT_NOTIFICATION: "WF_EXPERT_NOTIFICATION_ID",
    WF_APPROVAL_GATE: "WF_APPROVAL_GATE_ID",
    WF_SELF_DEPLOY: "WF_SELF_DEPLOY_ID",
    WF_ADMIN_HEALTH_MONITOR: "WF_ADMIN_HEALTH_MONITOR_ID",
    WF_LANGFUSE_PERFORMANCE_REVIEW: "WF_LANGFUSE_PERF_ID",
    WF_ADMIN_ORCHESTRATION: "WF_ADMIN_ORCHESTRATION_ID",
    WF_NODE_FACTORY: "WF_NODE_FACTORY_ID",
  };

  if (Object.keys(newIds).length > 0 && !DRY_RUN) {
    console.log(`\n── Setting workflow ID variables ──`);
    for (const [wfName, varName] of Object.entries(varMappings)) {
      const id = newIds[wfName];
      if (!id) continue;
      try {
        await n8nApi("/variables", {
          method: "POST",
          body: JSON.stringify({ key: varName, value: String(id) }),
        });
        console.log(`  ✅ ${varName} = ${id}`);
      } catch (createErr) {
        // Might already exist — n8n API has no upsert; log + continue
        console.warn(`  ⏭️  ${varName} — create failed (likely already exists): ${createErr?.message || createErr}`);
      }
    }
  }

  console.log(`\n═══ Summary ═══`);
  console.log(`  Deployed: ${results.deployed}`);
  console.log(`  Updated:  ${results.updated}`);
  console.log(`  Skipped:  ${results.skipped}`);
  console.log(`  Activated: ${results.activated}`);
  console.log(`  Neaktivní (bez spouštěče / čeká na pověření): ${results.bezSpoustece}`);
  console.log(`  Čeká na volitelné pověření: ${results.cekaNaVolitelne}`);
  console.log(`  Failed:   ${results.failed}`);
  console.log(
    results.failed === 0 ? "\n✅ All operations successful!" : "\n⚠️  Some operations failed!",
  );
  // ⛔ SELHÁNÍ NESMÍ VYPADAT JAKO ÚSPĚCH. Naměřeno 2026-09-07: skript vypsal
  // „Some operations failed!" u 66 z 93 workflowů a skončil NULOU, takže
  // entrypoint zalogoval „workflow deploy ok" a nasazení mlčelo.
  if (results.failed > 0) process.exit(1);
}

if (isDirectRun(import.meta.url)) {
  main().catch((err) => {
    console.error("\n❌ Fatal:", err.message);
    process.exit(1);
  });
}

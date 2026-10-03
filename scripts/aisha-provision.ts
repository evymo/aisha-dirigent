#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env
/**
 * AISHA n8n Auto-Provisioning Script
 *
 * Importuje všechny workflow JSONy z n8n/workflows/, vytváří credentials
 * a aktivuje workflow — kompletně automatizované nasazení.
 *
 * @example
 *   N8N_API_URL=https://n8n.example.com N8N_API_KEY=xxx deno run --allow-net --allow-read --allow-env scripts/aisha-provision.ts
 *
 *   # Nebo přes npm:
 *   npm run aisha:provision
 */

// ─── Configuration ──────────────────────────────────────────────────────────

const N8N_API_URL = Deno.env.get("N8N_API_URL");
if (!N8N_API_URL) {
  console.error("ERROR: N8N_API_URL not set (env-driven; no hardcoded host)");
  Deno.exit(1);
}
const N8N_API_KEY = Deno.env.get("N8N_API_KEY") ?? "";
const DRY_RUN = Deno.env.get("DRY_RUN") === "true";

// Supabase connection details for credential creation
const AISHA_POSTGREST_URL = Deno.env.get("AISHA_POSTGREST_URL") ?? "";
const AISHA_POSTGREST_SERVICE_KEY = Deno.env.get("AISHA_POSTGREST_SERVICE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const AISHA_ACCESS_TOKEN = Deno.env.get("AISHA_ACCESS_TOKEN") ?? Deno.env.get("AISHA_KEYCLOAK_ACCESS_TOKEN") ?? "";

// ─── Helpers ────────────────────────────────────────────────────────────────

const WORKFLOWS_DIR = new URL("../n8n/workflows", import.meta.url).pathname;

interface N8nWorkflow {
  id?: string;
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  active?: boolean;
  [key: string]: unknown;
}

interface N8nCredential {
  name: string;
  type: string;
  data: Record<string, unknown>;
}

async function n8nFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${N8N_API_URL.replace(/\/$/, "")}/api/v1${path}`;
  const res = await fetch(url, {
      signal: AbortSignal.timeout(30000),
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": N8N_API_KEY,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`n8n API ${res.status} ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

function log(emoji: string, msg: string) {
  console.log(`${emoji} ${msg}`);
}

// ─── Credential Creation ────────────────────────────────────────────────────

const CREDENTIAL_DEFS: N8nCredential[] = [
  {
    name: "AISHA Gateway (Service Role)",
    type: "supabaseApi",
    data: {
      supabaseUrl: AISHA_POSTGREST_URL,
      serviceRole: AISHA_POSTGREST_SERVICE_KEY,
    },
  },
  {
    name: "OpenAI (AISHA)",
    type: "openAiApi",
    data: {
      apiKey: OPENAI_API_KEY,
    },
  },
  {
    name: "GitHub (AISHA)",
    type: "githubApi",
    data: {
      accessToken: GITHUB_TOKEN,
    },
  },
];

async function provisionCredentials(): Promise<Map<string, string>> {
  log("🔐", "Provisioning credentials...");

  // Get existing credentials
  const existing = await n8nFetch<{ data: Array<{ id: string; name: string; type: string }> }>("/credentials");
  const existingMap = new Map(existing.data.map((c) => [`${c.type}:${c.name}`, c.id]));

  const credentialIds = new Map<string, string>();

  for (const cred of CREDENTIAL_DEFS) {
    const key = `${cred.type}:${cred.name}`;

    // Skip credentials with missing data
    const hasData = Object.values(cred.data).some((v) => v && String(v).length > 0);
    if (!hasData) {
      log("⏭️", `  Skipping ${cred.name} (no env vars set)`);
      continue;
    }

    if (existingMap.has(key)) {
      log("✅", `  ${cred.name} — already exists (id: ${existingMap.get(key)})`);
      credentialIds.set(cred.name, existingMap.get(key)!);
      continue;
    }

    if (DRY_RUN) {
      log("🔍", `  [DRY RUN] Would create: ${cred.name} (${cred.type})`);
      continue;
    }

    const created = await n8nFetch<{ id: string }>("/credentials", {
      method: "POST",
      body: JSON.stringify(cred),
    });
    log("✨", `  Created: ${cred.name} (id: ${created.id})`);
    credentialIds.set(cred.name, created.id);
  }

  return credentialIds;
}

// ─── n8n Variables ──────────────────────────────────────────────────────────

const N8N_VARIABLES: Record<string, string> = {
  AISHA_POSTGREST_URL: AISHA_POSTGREST_URL,
  AISHA_ACCESS_TOKEN: AISHA_ACCESS_TOKEN,
  AISHA_POSTGREST_SERVICE_KEY: AISHA_POSTGREST_SERVICE_KEY,
};

async function provisionVariables(): Promise<void> {
  log("📋", "Provisioning n8n variables...");

  let existing: Array<{ key: string; value: string }> = [];
  try {
    const res = await n8nFetch<{ data: Array<{ key: string; value: string }> }>("/variables");
    existing = res.data ?? [];
  } catch (err) {
    console.warn("[aisha-provision] /variables endpoint unavailable (n8n < 1.x?), skipping variable provisioning:", err);
    log("⚠️", "  Could not fetch variables (might need n8n >= 1.x)");
    return;
  }

  const existingKeys = new Set(existing.map((v) => v.key));

  for (const [key, value] of Object.entries(N8N_VARIABLES)) {
    if (!value) {
      log("⏭️", `  Skipping ${key} (empty)`);
      continue;
    }

    if (existingKeys.has(key)) {
      log("✅", `  ${key} — already exists`);
      continue;
    }

    if (DRY_RUN) {
      log("🔍", `  [DRY RUN] Would set: ${key}`);
      continue;
    }

    await n8nFetch("/variables", {
      method: "POST",
      body: JSON.stringify({ key, value }),
    });
    log("✨", `  Set: ${key}`);
  }
}

// ─── Workflow Import & Activation ───────────────────────────────────────────

async function provisionWorkflows(credentialIds: Map<string, string>): Promise<void> {
  log("📦", "Importing workflows...");

  // Get existing workflows
  const existing = await n8nFetch<{ data: Array<{ id: string; name: string }> }>("/workflows");
  const existingByName = new Map(existing.data.map((w) => [w.name, w.id]));

  // Read all workflow JSONs
  const entries: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      entries.push(entry.name);
    }
  }
  entries.sort();

  for (const filename of entries) {
    const filePath = `${WORKFLOWS_DIR}/${filename}`;
    let content = await Deno.readTextFile(filePath);

    // Replace __REMAP__<credential_name>__ placeholders with actual credential IDs
    content = content.replace(/__REMAP__([^_]+(?:_[^_]+)*)__/g, (match, name) => {
      const id = credentialIds.get(name);
      if (id) {
        log("🔗", `  Remapped credential: ${name} → ${id}`);
        return id;
      }
      log("⚠️", `  No credential ID for placeholder: ${match}`);
      return match;
    });

    const workflow: N8nWorkflow = JSON.parse(content);

    // Check if already exists
    if (existingByName.has(workflow.name)) {
      const existingId = existingByName.get(workflow.name)!;
      log("🔄", `  ${workflow.name} — updating (id: ${existingId})`);

      if (!DRY_RUN) {
        // Update existing workflow
        await n8nFetch(`/workflows/${existingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            nodes: workflow.nodes,
            connections: workflow.connections,
            settings: workflow.settings,
          }),
        });

        // Activate
        await n8nFetch(`/workflows/${existingId}/activate`, {
          method: "POST",
        });
      }
      continue;
    }

    if (DRY_RUN) {
      log("🔍", `  [DRY RUN] Would import: ${workflow.name} (${filename})`);
      continue;
    }

    // Import new workflow
    const created = await n8nFetch<{ id: string }>("/workflows", {
      method: "POST",
      body: JSON.stringify({
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings ?? {},
        active: false,
      }),
    });

    log("✨", `  Imported: ${workflow.name} (id: ${created.id})`);

    // Activate the workflow
    try {
      await n8nFetch(`/workflows/${created.id}/activate`, {
        method: "POST",
      });
      log("🟢", `  Activated: ${workflow.name}`);
    } catch (err) {
      log("⚠️", `  Could not activate ${workflow.name}: ${err}`);
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  AISHA n8n Auto-Provisioning");
  console.log(`  Target: ${N8N_API_URL}`);
  console.log(`  Mode:   ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log("═══════════════════════════════════════════════════════════════");

  if (!N8N_API_KEY) {
    console.error("ERROR: N8N_API_KEY is required. Set it as an environment variable.");
    Deno.exit(1);
  }

  // 1. Credentials
  const credentialIds = await provisionCredentials();
  console.log();

  // 2. Variables
  await provisionVariables();
  console.log();

  // 3. Workflows
  await provisionWorkflows(credentialIds);
  console.log();

  log("🎉", "Provisioning complete!");
  console.log("═══════════════════════════════════════════════════════════════");
}

await main();

#!/usr/bin/env node
// =============================================================================
// AISHA Self-Setup v2 — Autonomous bootstrapping inside n8n container
// =============================================================================
//
// PURPOSE:
//   Zero-config provisioning of credentials, workflows, and activation.
//   Runs after n8n starts and self-heals on every restart.
//
// KEY FEATURES (v0.4.0):
//   - IDEMPOTENT: running N times always produces the same result
//   - Credential dedup: detects and removes duplicate credentials
//     (prevents non-deterministic remapping bugs)
//   - Credential remapping: workflow JSONs use placeholder IDs (__REMAP__),
//     self-setup remaps to actual production credential IDs by matching names
//   - Custom extension verification: checks N8N_CUSTOM_EXTENSIONS nodes
//     are loaded before activating workflows that depend on them
//   - Retry with backoff: activation retries for timing-dependent loads
//   - Health verification: final report of active/inactive/failed workflows
//   - Trace logging: logs self-setup events to PostgREST ai_trace_events
//   - FORCE_REPROVISION=1: re-run even if done marker exists
//
// N8N_CUSTOM_EXTENSIONS vs COMMUNITY PACKAGES:
//   Aisha nodes are loaded via N8N_CUSTOM_EXTENSIONS env var, NOT as
//   community packages. This means:
//   - GET /api/v1/community-packages → empty (correct, not a bug)
//   - Nodes are loaded as built-in at n8n startup
//   - Nodes may not be immediately available — timing-dependent
//   - Node availability can be verified by attempting workflow activation
//
// Environment variables (all from docker-compose / Coolify):
//   N8N_SELF_SETUP=1              — enable self-setup (default: off)
//   N8N_SELF_SETUP_DONE_MARKER    — file marker to skip re-provisioning
//   AISHA_POSTGREST_URL                 — AISHA PostgREST gateway URL
//   AISHA_POSTGREST_SERVICE_KEY         — PostgREST service_role JWT
//   OPENAI_API_KEY                — OpenAI API key (optional)
//   GOOGLE_AI_API_KEY             — Google Gemini key (optional)
//   ANTHROPIC_API_KEY             — Anthropic Claude key (optional)
//   GITHUB_TOKEN                  — GitHub token for AISHA (optional)
//   AISHA_ACCESS_TOKEN            — Keycloak/OAuth bearer for MCP tools (optional)
// =============================================================================

import { readdir, readFile, writeFile, access, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(__dirname, "..", "workflows");
const PKG_JSON_PATH = join(__dirname, "..", "package.json");
// Registry for the optional self-update check — env-driven, NO hardcoded host.
// Canonical VERDACCIO_URL (repo-wide), NPM_REGISTRY_URL kept as a legacy alias.
// Empty when unset → checkSelfUpdate() becomes a no-op (feature needs a registry).
const VERDACCIO_REGISTRY = (() => {
  const raw = process.env.VERDACCIO_URL || process.env.NPM_REGISTRY_URL || "";
  return raw ? raw.replace(/\/$/, "") + "/" : "";
})();

// ── Config from env ─────────────────────────────────────────────────────────
const N8N_API_URL = "http://127.0.0.1:5678"; // localhost inside container
const N8N_API_KEY_FILE = "/home/node/.n8n/self-setup-api-key.txt";
const DONE_MARKER = process.env.N8N_SELF_SETUP_DONE_MARKER || "/home/node/.n8n/.self-setup-done";

const AISHA_POSTGREST_URL = process.env.AISHA_POSTGREST_URL || "";
const AISHA_POSTGREST_SERVICE_KEY = process.env.AISHA_POSTGREST_SERVICE_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const AISHA_ACCESS_TOKEN = process.env.AISHA_ACCESS_TOKEN || process.env.AISHA_KEYCLOAK_ACCESS_TOKEN || "";

// Workflows that should remain inactive by default (operator chooses to enable)
const SKIP_ACTIVATION = new Set(
  (process.env.N8N_SKIP_ACTIVATION || "").split(",").map((s) => s.trim()).filter(Boolean)
);

// ── Logging ─────────────────────────────────────────────────────────────────
const log = (emoji, msg) => console.log(`[AISHA-SETUP] ${emoji} ${msg}`);

// ── n8n API client ──────────────────────────────────────────────────────────
let API_KEY = "";

async function loadOrCreateApiKey() {
  // First check if we have a saved API key from previous run
  try {
    await access(N8N_API_KEY_FILE);
    API_KEY = (await readFile(N8N_API_KEY_FILE, "utf-8")).trim();
    if (API_KEY) {
      log("🔑", "Using saved API key");
      return;
    }
  } catch {
    // No saved key
  }

  // Use N8N_API_KEY from env if available
  if (process.env.N8N_API_KEY) {
    API_KEY = process.env.N8N_API_KEY;
    log("🔑", "Using N8N_API_KEY from environment");
    return;
  }

  log("⚠️", "No API key available — self-setup requires N8N_API_KEY env var");
  log("ℹ️", "Set N8N_API_KEY in Coolify environment variables");
  process.exit(0); // graceful exit, not an error
}

async function n8nFetch(path, options = {}) {
  const url = `${N8N_API_URL}/api/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-N8N-API-KEY": API_KEY,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`n8n API ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Wait for n8n to be ready ────────────────────────────────────────────────
async function waitForN8n(maxRetries = 60, intervalMs = 5000) {
  log("⏳", "Waiting for n8n API to be ready...");
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${N8N_API_URL}/api/v1/workflows`, {
        headers: { "X-N8N-API-KEY": API_KEY },
      });
      if (res.ok) {
        log("✅", `n8n API ready (attempt ${i + 1})`);
        return true;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  log("❌", "n8n API not ready after max retries");
  return false;
}

// ── Credentials ─────────────────────────────────────────────────────────────

/** Build the desired credential set from environment variables */
function buildCredentialSpecs() {
  const specs = [];

  if (AISHA_POSTGREST_SERVICE_KEY) {
    specs.push({
      name: "AISHA PostgREST (Service Role)",
      type: "httpHeaderAuth",
      data: { name: "apikey", value: AISHA_POSTGREST_SERVICE_KEY },
    });
    specs.push({
      name: "PostgREST Service Role",
      type: "httpHeaderAuth",
      data: { name: "apikey", value: AISHA_POSTGREST_SERVICE_KEY },
    });
  }

  // LLM providers — schema requires header:false to skip conditional headerName/headerValue
  if (OPENAI_API_KEY) {
    specs.push({
      name: "OpenAi account",
      type: "openAiApi",
      data: { apiKey: OPENAI_API_KEY, header: false },
    });
  }

  if (GOOGLE_AI_API_KEY) {
    specs.push({
      name: "Google Gemini(PaLM) Api account",
      type: "googlePalmApi",
      data: { host: "https://generativelanguage.googleapis.com", apiKey: GOOGLE_AI_API_KEY },
    });
  }

  if (ANTHROPIC_API_KEY) {
    specs.push({
      name: "Anthropic account",
      type: "anthropicApi",
      data: { apiKey: ANTHROPIC_API_KEY, header: false },
    });
  }

  if (GITHUB_TOKEN) {
    specs.push({
      name: "GitHub (AISHA)",
      type: "httpHeaderAuth",
      data: { name: "Authorization", value: `Bearer ${GITHUB_TOKEN}` },
    });
    specs.push({
      name: "GitHub account",
      type: "githubApi",
      data: { accessToken: GITHUB_TOKEN },
    });
  }

  if (AISHA_ACCESS_TOKEN) {
    specs.push({
      name: "AISHA MCP OAuth",
      type: "httpHeaderAuth",
      data: { name: "Authorization", value: `Bearer ${AISHA_ACCESS_TOKEN}` },
    });
  }

  // Custom Aisha credential types (from n8n-nodes-aisha package)
  if (AISHA_POSTGREST_URL && AISHA_POSTGREST_SERVICE_KEY) {
    specs.push({
      name: "AISHA PostgREST",
      type: "aishaPostgrestApi",
      data: { postgrestUrl: AISHA_POSTGREST_URL, serviceRoleKey: AISHA_POSTGREST_SERVICE_KEY },
    });
  }

  return specs;
}

/**
 * Fetch ALL existing credentials from n8n.
 * Returns TWO structures:
 *   - credMap:    Map<name, id> — canonical name→id mapping (last wins if dupes)
 *   - credsList:  Array<{id, name, type}> — raw list for duplicate detection
 */
async function fetchExistingCredentials() {
  const credMap = new Map();  // name → id (canonical, for remapping)
  const credsList = [];       // [{id, name, type}] — full list for dedup
  try {
    const res = await n8nFetch("/credentials");
    for (const cred of res.data || []) {
      credMap.set(cred.name, cred.id);
      credsList.push({ id: cred.id, name: cred.name, type: cred.type });
      log("🔍", `  Existing cred: "${cred.name}" [${cred.type}] → ${cred.id}`);
    }
  } catch (err) {
    log("⚠️", `  Could not list credentials: ${err.message.slice(0, 100)}`);
  }
  return { credMap, credsList };
}

/**
 * Remove duplicate credentials (same name).
 * Keeps the FIRST occurrence, deletes the rest.
 * This prevents the non-deterministic credential remapping bug:
 * when two creds share a name, Map picks one randomly and workflows
 * may reference the wrong (or soon-deleted) credential.
 *
 * @param {Array} credsList - raw credential list from fetchExistingCredentials
 * @returns {number} count of deleted duplicates
 */
async function cleanupDuplicateCredentials(credsList) {
  const seen = new Map(); // name → first id
  const dupes = [];

  for (const cred of credsList) {
    if (seen.has(cred.name)) {
      dupes.push(cred);
    } else {
      seen.set(cred.name, cred.id);
    }
  }

  if (dupes.length === 0) return 0;

  log("🧹", `  Found ${dupes.length} duplicate credential(s) — cleaning up...`);
  let deleted = 0;
  for (const dupe of dupes) {
    try {
      await n8nFetch(`/credentials/${dupe.id}`, { method: "DELETE" });
      log("🗑️", `  Deleted duplicate: "${dupe.name}" (id: ${dupe.id}, keeping: ${seen.get(dupe.name)})`);
      deleted++;
    } catch (err) {
      log("⚠️", `  Could not delete duplicate ${dupe.id}: ${err.message.slice(0, 80)}`);
    }
  }
  return deleted;
}

/**
 * Attempt to create a single credential with optional retry for custom types.
 *
 * Custom credential types (e.g. aishaPostgrestApi) depend on N8N_CUSTOM_EXTENSIONS
 * being loaded. During startup, the extensions may not be ready yet, causing
 * "unknown credential type" errors. We retry with backoff for these types.
 *
 * @returns {string|null} Credential ID if created, null if failed
 */
async function createCredentialWithRetry(spec, maxRetries = 3) {
  const isCustom = spec.type.startsWith("aisha");
  const delays = [3000, 8000, 20000]; // backoff: 3s, 8s, 20s

  for (let attempt = 0; attempt <= (isCustom ? maxRetries - 1 : 0); attempt++) {
    try {
      const result = await n8nFetch("/credentials", {
        method: "POST",
        body: JSON.stringify(spec),
      });
      return result.id;
    } catch (err) {
      const msg = err.message || "";

      // Already exists — not an error
      if (msg.includes("409") || msg.includes("already exists") || msg.includes("duplicate")) {
        return null; // caller will handle re-fetch
      }

      // Custom type not yet loaded — retry with backoff
      if (isCustom && (msg.includes("not known") || msg.includes("unknown") || msg.includes("not found") || msg.includes("400"))) {
        if (attempt < maxRetries - 1) {
          const delay = delays[attempt] || 20000;
          log("⏳", `  ${spec.name}: custom credential type not ready, retry in ${delay / 1000}s (${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        log("⚠️", `  ${spec.name}: custom credential type not available after ${maxRetries} attempts`);
        log("ℹ️", `    Ensure N8N_CUSTOM_EXTENSIONS includes the aisha package.`);
        return null;
      }

      // Other error — don't retry
      throw err;
    }
  }
  return null;
}

/**
 * Idempotent credential provisioning:
 * 1. Fetch existing credentials
 * 2. Clean up duplicates (same name → keep first, delete rest)
 * 3. Create only truly missing credentials
 * 4. Return the COMPLETE name→id map for workflow remapping
 *
 * Running this N times always produces the same result.
 */
async function provisionCredentials() {
  log("🔐", "Provisioning credentials (idempotent)...");

  // Step 1: List all existing credentials
  const { credMap, credsList } = await fetchExistingCredentials();

  // Step 2: Clean up duplicates BEFORE creating anything
  const dupsRemoved = await cleanupDuplicateCredentials(credsList);
  if (dupsRemoved > 0) {
    // Re-fetch to get clean state after deletions
    const fresh = await fetchExistingCredentials();
    // Overwrite the map with clean data
    for (const [k] of credMap) credMap.delete(k);
    for (const [k, v] of fresh.credMap) credMap.set(k, v);
    log("✅", `  Cleaned ${dupsRemoved} duplicate(s), re-fetched credential map`);
  }

  // Step 3: Build desired specs from env vars
  const specs = buildCredentialSpecs();

  // Step 4: Create only missing credentials (custom types retry with backoff)
  for (const spec of specs) {
    if (credMap.has(spec.name)) {
      log("✅", `  ${spec.name} — already exists (id: ${credMap.get(spec.name)})`);
      continue;
    }

    try {
      const newId = await createCredentialWithRetry(spec);
      if (newId) {
        credMap.set(spec.name, newId);
        log("✨", `  Created: ${spec.name} (id: ${newId})`);
      } else {
        // Null means 409/duplicate — re-fetch to get the actual ID
        const fresh = await fetchExistingCredentials();
        if (fresh.credMap.has(spec.name)) {
          credMap.set(spec.name, fresh.credMap.get(spec.name));
          log("✅", `  ${spec.name} — already exists (id: ${credMap.get(spec.name)})`);
        }
      }
    } catch (err) {
      log("⚠️", `  Failed: ${spec.name} — ${err.message.slice(0, 100)}`);
    }
  }

  log("📋", `  Credential map: ${credMap.size} entries`);
  return credMap;
}

// ── Credential Remapping ────────────────────────────────────────────────────

/**
 * Remap credential IDs in workflow nodes from dev IDs to actual production IDs.
 *
 * Workflow JSONs contain hardcoded credential IDs from the dev environment.
 * Production n8n assigns different IDs. We match by credential NAME.
 *
 * This is the CRITICAL piece that was missing in v0.2.x — without it,
 * workflows import fine but can't activate because they reference
 * nonexistent credential IDs (zombies from dev or deleted duplicates).
 */
// Alias map: some workflow JSONs use shortened names. Map them to canonical names.
// Format: "credType:shortName" → "canonicalName" (type-aware to avoid collisions)
//
// Canonical names use "PostgREST" since 2026-Q1 (when AISHA migrated off Supabase
// to a Fastify + PostgREST orchestrator). Legacy alias entries below remap
// pre-migration workflow JSONs to the new credential names — necessary until
// every workflow file in n8n/workflows/ is regenerated/republished.
const CREDENTIAL_ALIASES = {
  "httpHeaderAuth:AISHA PostgREST": "AISHA PostgREST (Service Role)",
  // Legacy aliases — pre-2026 workflows referenced these names
  "httpHeaderAuth:AISHA Supabase": "AISHA PostgREST (Service Role)",
  "httpHeaderAuth:AISHA Supabase (Service Role)": "AISHA PostgREST (Service Role)",
  "httpHeaderAuth:Aisha Supabase": "AISHA PostgREST (Service Role)",
  "httpHeaderAuth:Supabase Service Role": "PostgREST Service Role",
  "httpHeaderAuth:Supabase Service Role Key": "PostgREST Service Role",
};

function remapWorkflowCredentials(workflow, credMap) {
  let remapped = 0;
  let unresolved = 0;

  // Build a set of all valid credential IDs that actually exist in n8n
  const validIds = new Set(credMap.values());

  for (const node of workflow.nodes || []) {
    if (!node.credentials) continue;

    for (const [credType, credRef] of Object.entries(node.credentials)) {
      if (!credRef || typeof credRef !== "object") continue;

      const credName = credRef.name;
      // Type-aware alias: check "type:name" first, then fallback to direct name
      const aliasKey = `${credType}:${credName}`;
      const resolvedName = CREDENTIAL_ALIASES[aliasKey] || credName;
      if (resolvedName && credMap.has(resolvedName)) {
        const newId = credMap.get(resolvedName);
        if (credRef.id !== newId) {
          const oldId = credRef.id || "(none)";
          credRef.id = newId;
          if (resolvedName !== credName) {
            credRef.name = resolvedName; // also fix the name to canonical
          }
          remapped++;
          log("🔄", `  [${node.name}] ${credName}: ${oldId} → ${newId}`);
        }
      } else if (credName) {
        // Credential name not found in n8n — check if the stored ID is valid
        const currentId = credRef.id || "";
        if (currentId === "__REMAP__" || !validIds.has(currentId)) {
          // Remove dangling reference: the credential doesn't exist in this
          // n8n instance (either __REMAP__ placeholder or stale ID from
          // another environment). Nodes with optional credentials (e.g.
          // AishaLlmRouter) will fall back to env-var auto-detection.
          delete node.credentials[credType];
          remapped++;
          log("🧹", `  [${node.name}] Removed dangling ${credType} ref ("${credName}", id=${currentId}) — credential not available in this instance`);
        } else {
          unresolved++;
          log("⚠️", `  [${node.name}] Unresolved credential: "${credName}" (type: ${credType})`);
        }
      }
    }
  }

  return { remapped, unresolved };
}

// ── Sub-Workflow ID Remapping ────────────────────────────────────────────────

/**
 * Remap sub-workflow references (toolWorkflow nodes) from source/production IDs
 * to the local n8n instance IDs. Workflow IDs are instance-specific and don't
 * survive cross-instance JSON exports.
 *
 * Two-stage resolution:
 *   1. Source ID map — match workflowId against the `id` field in source JSON files
 *   2. Name-based fuzzy match — derive tokens from node display name and find a
 *      unique workflow whose name contains ALL tokens
 */
async function remapSubWorkflowReferences(workflowIds) {
  log("🔗", "Remapping sub-workflow references...");

  // Stage 1: Build sourceId → workflowName map from JSON files on disk
  const sourceIdToName = new Map();
  try {
    const files = (await readdir(WORKFLOWS_DIR)).filter((f) => f.endsWith(".json"));
    for (const filename of files) {
      const content = await readFile(join(WORKFLOWS_DIR, filename), "utf-8");
      const wf = JSON.parse(content);
      if (wf.id && wf.name) {
        sourceIdToName.set(String(wf.id), wf.name);
      }
    }
  } catch {
    // If workflows dir doesn't exist, nothing to remap
    console.warn("⚠️ Workflows directory not found — skipping sub-workflow remap");
    return;
  }

  // Build name → localId from the workflowIds map (passed from provisionWorkflows)
  // Also fetch fresh list from n8n in case some workflows were created outside self-setup
  const existing = await n8nFetch("/workflows");
  const nameToId = new Map(existing.data.map((w) => [w.name, w.id]));
  // Merge the passed-in map (may have fresher data)
  for (const [name, id] of workflowIds) {
    nameToId.set(name, id);
  }
  const allLocalIds = new Set(nameToId.values());
  const allNames = [...nameToId.keys()];

  let totalRemapped = 0;

  // Scan each workflow for toolWorkflow nodes with stale workflowId references
  for (const wfData of existing.data) {
    const fullWf = await n8nFetch(`/workflows/${wfData.id}`);
    let changed = false;

    for (const node of fullWf.nodes || []) {
      const wfIdParam = node.parameters?.workflowId;
      if (!wfIdParam) continue;

      // Strip n8n expression prefix "=" if present
      const refId = String(wfIdParam).replace(/^=/, "");

      // Skip if already points to a valid local workflow
      if (allLocalIds.has(refId)) continue;

      // --- Resolution attempt 1: Source ID map ---
      let targetName = sourceIdToName.get(refId);
      let resolvedId = targetName ? nameToId.get(targetName) : undefined;

      // --- Resolution attempt 2: Name-based fuzzy match ---
      if (!resolvedId) {
        const nodeName = node.name || "";
        // "Knowledge Agent Tool" → ["knowledge", "agent"]
        const tokens = nodeName
          .replace(/\s*Tool\s*$/i, "")
          .split(/[\s_-]+/)
          .map((t) => t.toLowerCase())
          .filter((t) => t.length > 1);

        if (tokens.length > 0) {
          const candidates = allNames.filter((name) => {
            const lower = name.toLowerCase();
            return tokens.every((tok) => lower.includes(tok));
          });
          if (candidates.length === 1) {
            targetName = candidates[0];
            resolvedId = nameToId.get(targetName);
          }
        }
      }

      if (resolvedId) {
        // Preserve expression prefix if original had one
        const newValue = wfIdParam.startsWith("=") ? `=${resolvedId}` : resolvedId;
        node.parameters.workflowId = newValue;
        changed = true;
        totalRemapped++;
        log("🔗", `  [${fullWf.name}] ${node.name}: ${refId} → ${resolvedId} (${targetName})`);
      } else {
        log("⚠️", `  [${fullWf.name}] ${node.name}: unresolved workflowId ${refId}`);
      }
    }

    if (changed) {
      try {
        await n8nFetch(`/workflows/${wfData.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: fullWf.name,
            nodes: fullWf.nodes,
            connections: fullWf.connections,
            settings: fullWf.settings ?? {},
          }),
        });
        log("📝", `  Updated: ${fullWf.name} (sub-workflow refs)`);
      } catch (err) {
        log("❌", `  Failed to update ${fullWf.name}: ${err.message.slice(0, 100)}`);
      }
    }
  }

  log("📊", `  Sub-workflow refs: ${totalRemapped} remapped`);
}

// ── Node Type Detection ─────────────────────────────────────────────────────

/** Extract all unique node types from a workflow */
function getNodeTypes(workflow) {
  const types = new Set();
  for (const node of workflow.nodes || []) {
    if (node.type) types.add(node.type);
  }
  return types;
}

/** Check if a workflow uses custom aisha node types */
function usesCustomNodes(workflow) {
  return getNodeTypes(workflow).values().some((t) => t.startsWith("n8n-nodes-aisha."));
}

// ── Workflow Activation with Retry ──────────────────────────────────────────

/**
 * Attempt to activate a workflow with retry + backoff.
 *
 * N8N_CUSTOM_EXTENSIONS nodes are loaded at startup but may need time
 * to become available. The activation endpoint validates node types,
 * so we retry with delays for "Unrecognized node type" errors.
 *
 * @returns {string} "active" | "skipped" | "deferred" | "failed"
 */
async function activateWithRetry(workflowId, workflowName, hasCustomNodes, maxRetries = 3) {
  // Check skip list
  if (SKIP_ACTIVATION.has(workflowName)) {
    log("⏭️", `  ${workflowName}: skipped (in SKIP_ACTIVATION list)`);
    return "skipped";
  }

  const delays = [2000, 5000, 15000]; // backoff: 2s, 5s, 15s

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await n8nFetch(`/workflows/${workflowId}/activate`, { method: "POST" });
      log("✅", `  ${workflowName}: activated`);
      return "active";
    } catch (err) {
      const msg = err.message || "";

      if (msg.includes("Unrecognized node type")) {
        if (attempt < maxRetries - 1) {
          const delay = delays[attempt] || 15000;
          log("⏳", `  ${workflowName}: custom nodes not ready, retry in ${delay / 1000}s (${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        log("⚠️", `  ${workflowName}: deferred — custom nodes not loaded after ${maxRetries} attempts`);
        log("ℹ️", `    This is normal if N8N_CUSTOM_EXTENSIONS needs more time to load.`);
        log("ℹ️", `    Workflow will be activated on next restart when nodes are cached.`);
        return "deferred";
      }

      // Other errors — don't retry
      log("⚠️", `  ${workflowName}: activation failed — ${msg.slice(0, 120)}`);
      return "failed";
    }
  }
  return "failed";
}

// ── n8n Variables ───────────────────────────────────────────────────────────

/**
 * Provision n8n Variables for runtime configuration.
 * Variables are accessible in workflow expressions via $vars.KEY.
 *
 * Sets LLM_DEFAULT_PROVIDER based on which API keys are available.
 * Priority: openai > google > anthropic (openai is preferred when available).
 *
 * NOTE: n8n Variables require Enterprise license. On community edition,
 * the "Resolve LLM Provider" Code node in each workflow auto-detects
 * the provider from process.env (OPENAI_API_KEY, GOOGLE_AI_API_KEY, etc.)
 * This function is a best-effort enhancement for Enterprise installs.
 */
async function provisionVariables() {
  log("🔧", "Provisioning n8n variables...");

  // Determine default LLM provider from available API keys
  let defaultProvider = "google"; // safe fallback — Gemini is cheapest
  if (OPENAI_API_KEY) defaultProvider = "openai";
  else if (GOOGLE_AI_API_KEY) defaultProvider = "google";
  else if (ANTHROPIC_API_KEY) defaultProvider = "anthropic";

  const desiredVars = {
    LLM_DEFAULT_PROVIDER: defaultProvider,
  };

  // Fetch existing variables
  let existingVars = [];
  try {
    const res = await n8nFetch("/variables");
    existingVars = res.data || res || [];
  } catch (err) {
    const msg = err.message || "";
    if (msg.includes("403") || msg.includes("license")) {
      log("ℹ️", `  n8n Variables require Enterprise license — skipping`);
      log("ℹ️", `  Workflows use process.env auto-detection instead (LLM provider: ${defaultProvider})`);
      return;
    }
    log("⚠️", `  Could not list variables: ${msg.slice(0, 100)}`);
    return;
  }

  const existingMap = new Map();
  for (const v of existingVars) {
    if (v.key) existingMap.set(v.key, v);
  }

  for (const [key, value] of Object.entries(desiredVars)) {
    if (existingMap.has(key)) {
      const existing = existingMap.get(key);
      if (existing.value === value) {
        log("✅", `  ${key} = ${value} (unchanged)`);
      } else {
        try {
          await n8nFetch(`/variables/${existing.id}`, {
            method: "PATCH",
            body: JSON.stringify({ key, value }),
          });
          log("🔄", `  ${key}: ${existing.value} → ${value}`);
        } catch (err) {
          log("⚠️", `  Failed to update ${key}: ${err.message.slice(0, 100)}`);
        }
      }
    } else {
      try {
        await n8nFetch("/variables", {
          method: "POST",
          body: JSON.stringify({ key, value }),
        });
        log("✨", `  Created: ${key} = ${value}`);
      } catch (err) {
        log("⚠️", `  Failed to create ${key}: ${err.message.slice(0, 100)}`);
      }
    }
  }

  log("📋", `  LLM provider: ${defaultProvider} (based on available API keys)`);
}

// ── Workflows ───────────────────────────────────────────────────────────────

async function provisionWorkflows(credMap) {
  log("📦", "Importing workflows...");

  let files;
  try {
    files = (await readdir(WORKFLOWS_DIR)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    console.warn(`⚠️ No workflows directory at ${WORKFLOWS_DIR}`);
    return { workflowIds: new Map(), stats: {} };
  }

  if (files.length === 0) {
    log("⚠️", "No workflow files found");
    return { workflowIds: new Map(), stats: {} };
  }

  // Fetch existing workflows for update-or-create logic
  const existing = await n8nFetch("/workflows");
  const existingByName = new Map(
    existing.data.map((w) => [w.name, { id: w.id, active: w.active }])
  );

  const workflowIds = new Map();
  const stats = { created: 0, updated: 0, activated: 0, deferred: 0, skipped: 0, failed: 0 };

  for (const filename of files) {
    const filePath = join(WORKFLOWS_DIR, filename);
    const content = await readFile(filePath, "utf-8");
    const workflow = JSON.parse(content);
    const hasCustom = usesCustomNodes(workflow);
    const tag = hasCustom ? " [aisha-nodes]" : "";

    // Remap credential IDs BEFORE import
    const { remapped, unresolved } = remapWorkflowCredentials(workflow, credMap);
    if (remapped > 0) {
      log("🔄", `  ${workflow.name}: remapped ${remapped} credential refs`);
    }
    if (unresolved > 0) {
      log("⚠️", `  ${workflow.name}: ${unresolved} unresolved credential refs`);
    }

    // Prepare clean payload (n8n rejects extra fields)
    const payload = {
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: workflow.settings ?? {},
    };

    if (existingByName.has(workflow.name)) {
      // ── UPDATE existing workflow ──
      const { id, active } = existingByName.get(workflow.name);
      workflowIds.set(workflow.name, id);

      try {
        await n8nFetch(`/workflows/${id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        stats.updated++;
        log("📝", `  Updated: ${workflow.name}${tag} (id: ${id})`);

        // Activate if not already active
        if (!active) {
          const result = await activateWithRetry(id, workflow.name, hasCustom);
          stats[result === "active" ? "activated" : result]++;
        } else {
          log("✅", `  ${workflow.name}: already active`);
        }
      } catch (err) {
        log("❌", `  Update failed: ${workflow.name} — ${err.message.slice(0, 100)}`);
        stats.failed++;
      }
      continue;
    }

    // ── CREATE new workflow ──
    try {
      const result = await n8nFetch("/workflows", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      workflowIds.set(workflow.name, result.id);
      stats.created++;
      log("✨", `  Created: ${workflow.name}${tag} (id: ${result.id})`);

      // Activate
      const activationResult = await activateWithRetry(result.id, workflow.name, hasCustom);
      stats[activationResult === "active" ? "activated" : activationResult]++;
    } catch (err) {
      log("❌", `  Import failed: ${workflow.name} — ${err.message.slice(0, 100)}`);
      stats.failed++;
    }
  }

  log("📊", `  Summary: ${stats.created} created, ${stats.updated} updated, ${stats.activated} activated, ${stats.deferred} deferred, ${stats.skipped} skipped, ${stats.failed} failed (${files.length} files)`);
  return { workflowIds, stats };
}

// ── Health Verification ─────────────────────────────────────────────────────

async function verifyHealth() {
  log("🏥", "Health verification...");

  try {
    const res = await n8nFetch("/workflows");
    const workflows = res.data || [];
    const active = workflows.filter((w) => w.active);
    const inactive = workflows.filter((w) => !w.active);

    log("📊", `  Total: ${workflows.length} | Active: ${active.length} | Inactive: ${inactive.length}`);

    if (inactive.length > 0) {
      log("⚠️", `  Inactive workflows:`);
      for (const w of inactive) {
        log("  ", `    - ${w.name} (id: ${w.id})`);
      }
    }

    return { total: workflows.length, active: active.length, inactive: inactive.length };
  } catch (err) {
    log("❌", `  Health check failed: ${err.message.slice(0, 100)}`);
    return null;
  }
}

// ── PostgREST Trace Logging ─────────────────────────────────────────────────

/**
 * Log self-setup events to AISHA's PostgREST ai_trace_events for observability.
 * Fire-and-forget — never throws, never blocks setup.
 *
 * Note: the REST path `/rest/v1/rpc/<fn>` mirrors PostgREST's standard URL
 * scheme — coincidentally identical to the legacy Supabase platform that this
 * stack migrated off in 2026-Q1.
 */
async function tracePostgrest(action, metadata = {}) {
  if (!AISHA_POSTGREST_URL || !AISHA_POSTGREST_SERVICE_KEY) return;

  try {
    await fetch(`${AISHA_POSTGREST_URL}/rest/v1/rpc/log_n8n_trace_event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: AISHA_POSTGREST_SERVICE_KEY,
        Authorization: `Bearer ${AISHA_POSTGREST_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        p_event_type: "self_setup",
        p_event_action: action,
        p_payload: metadata,
        p_source: "n8n-self-setup",
      }),
    });
  } catch {
    // fire-and-forget — don't break setup if PostgREST is down
  }
}

// ── Self-Update — check Verdaccio for newer version ─────────────────────────
/**
 * Check if a newer version of n8n-nodes-aisha exists on Verdaccio.
 * If yes, install it and re-exec this script with the new code.
 * This is a safety net — the entrypoint also checks, but this ensures
 * correctness even if the container was restarted without rebuilding.
 *
 * @returns {Promise<boolean>} true if self-update was triggered (caller should exit)
 */
async function checkSelfUpdate() {
  if (!VERDACCIO_REGISTRY) {
    log("ℹ️", "No registry configured (VERDACCIO_URL unset) — skipping self-update check");
    return false;
  }
  try {
    const pkgJson = JSON.parse(await readFile(PKG_JSON_PATH, "utf-8"));
    const currentVersion = pkgJson.version;

    const res = await fetch(`${VERDACCIO_REGISTRY}n8n-nodes-aisha`);
    if (!res.ok) {
      log("⚠️", `Verdaccio check failed (${res.status}) — continuing with current version`);
      return false;
    }
    const registryData = await res.json();
    const latestVersion = registryData["dist-tags"]?.latest;

    if (!latestVersion || latestVersion === currentVersion) {
      log("✅", `Package up-to-date (v${currentVersion})`);
      return false;
    }

    log("🔄", `New version available: v${currentVersion} → v${latestVersion}`);
    log("📦", "Installing update from Verdaccio...");

    const nodesDir = join(__dirname, "..", "..");
    execSync(
      `npm install n8n-nodes-aisha@latest --registry ${VERDACCIO_REGISTRY}`,
      { cwd: nodesDir, stdio: "inherit", timeout: 60_000 }
    );

    // Delete done marker so the new version re-provisions
    try {
      await unlink(DONE_MARKER);
    } catch {
      // intentional: marker file may not exist on first run
    }

    log("🔁", "Re-executing self-setup with updated code...");
    // Re-exec: the updated package has new self-setup.mjs
    const newScript = join(nodesDir, "node_modules", "n8n-nodes-aisha", "bootstrap", "self-setup.mjs");
    execSync(`node ${newScript}`, { stdio: "inherit", timeout: 120_000, env: process.env });

    return true; // signal caller to exit (new process handled everything)
  } catch (err) {
    log("⚠️", `Self-update check failed: ${err.message} — continuing with current version`);
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  AISHA Self-Setup v2 — Autonomous Provisioning");
  console.log(`  ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════════════");

  // Phase 0: Self-update from Verdaccio (if newer version available)
  if (!process.env.AISHA_SKIP_SELF_UPDATE) {
    const updated = await checkSelfUpdate();
    if (updated) {
      log("✅", "Self-update complete — this process exiting");
      return;
    }
  }

  // Check done marker — skip if already provisioned this version
  const PKG_JSON = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf-8"));
  const VERSION = PKG_JSON.version || "unknown";

  try {
    await access(DONE_MARKER);
    const markerContent = (await readFile(DONE_MARKER, "utf-8")).trim();
    if (markerContent === VERSION && !process.env.FORCE_REPROVISION) {
      log("✅", `Already provisioned (v${VERSION}) — skipping`);
      log("ℹ️", `Set FORCE_REPROVISION=1 to re-run`);
      // Even if skipped, run health check to report status
      await loadOrCreateApiKey();
      if (await waitForN8n(10, 3000)) {
        await verifyHealth();
      }
      return;
    }
    if (process.env.FORCE_REPROVISION) {
      log("🔄", `Force re-provisioning (FORCE_REPROVISION=1)`);
    } else {
      log("🔄", `Version changed (${markerContent} → ${VERSION}) — re-provisioning`);
    }
  } catch {
    // intentional: first-time setup — no done marker exists yet
    console.warn(`🆕 First-time setup (v${VERSION})`);
  }

  await loadOrCreateApiKey();

  const ready = await waitForN8n();
  if (!ready) {
    log("❌", "Aborting — n8n not reachable");
    await tracePostgrest("setup_failed", { reason: "n8n_not_ready", version: VERSION });
    process.exit(1);
  }

  try {
    // Phase 1: Credentials (build complete name→id map)
    const credMap = await provisionCredentials();
    console.log();

    // Phase 1.5: Variables (LLM_DEFAULT_PROVIDER etc.)
    await provisionVariables();
    console.log();

    // Phase 2: Workflows (remap credentials, import, activate)
    const { workflowIds, stats } = await provisionWorkflows(credMap);
    console.log();

    // Phase 2.5: Remap sub-workflow references (toolWorkflow nodes)
    await remapSubWorkflowReferences(workflowIds);
    console.log();

    // Phase 3: Health verification
    const health = await verifyHealth();
    console.log();

    // Phase 4: Trace to PostgREST (fire-and-forget)
    await tracePostgrest("setup_complete", {
      version: VERSION,
      credentials: credMap.size,
      workflows: Object.fromEntries(workflowIds),
      stats,
      health,
    });

    // Write done marker
    await writeFile(DONE_MARKER, VERSION, "utf-8");
    log("🎉", `Self-setup complete (v${VERSION})!`);
    log("ℹ️", "Delete " + DONE_MARKER + " to re-run on next restart");

    // Report deferred workflows
    if (stats.deferred > 0) {
      log("⚠️", `${stats.deferred} workflow(s) deferred — custom nodes may need n8n restart to load`);
      log("ℹ️", "These will be activated on next restart when nodes are cached in volume");
    }
  } catch (err) {
    log("❌", `Setup failed: ${err.message}`);
    await tracePostgrest("setup_error", { error: err.message, version: VERSION });
    process.exit(1);
  }
}

main();

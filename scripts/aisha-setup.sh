#!/usr/bin/env bash
# =============================================================================
# aisha-setup.sh — Complete Aisha Dirigent Ecosystem Setup
# =============================================================================
#
# Orchestrates the full setup of the Aisha Dirigent ecosystem:
#   1. Diagnostics (edge functions, n8n, MCP server)
#   2. Edge functions deployment verification
#   3. n8n provisioning (credentials, variables, workflows)
#   3b. Individual MCP tool deployment (toolCode per agent)
#   4. MCP token creation
#   5. End-to-end verification
#
# Usage:
#   ./scripts/aisha-setup.sh              # Interactive guided setup
#   ./scripts/aisha-setup.sh --check      # Only diagnostics
#   ./scripts/aisha-setup.sh --provision  # Only n8n provisioning
#   ./scripts/aisha-setup.sh --tools      # Only MCP tool deployment
#   ./scripts/aisha-setup.sh --verify     # Only verification
#
# Prerequisites:
#   - .env file with required variables (see .env.example)
#   - n8n running on N8N_WEBHOOK_URL (e.g. https://n8n.example.com)
#   - AISHA Gateway / PostgREST running on API_DOMAIN (e.g. api.example.com)
#
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; }
info() { echo -e "${BLUE}ℹ${NC} $*"; }
step() { echo -e "\n${CYAN}${BOLD}── $* ──${NC}"; }

# ── Load .env (without overriding explicitly provided env vars) ─────────────
# Local-first setup: values passed on CLI/env should win over .env file.
PRE_N8N_WEBHOOK_URL="${N8N_WEBHOOK_URL-__UNSET__}"
PRE_N8N_API_KEY="${N8N_API_KEY-__UNSET__}"
PRE_API_DOMAIN="${API_DOMAIN-__UNSET__}"
PRE_AISHA_GATEWAY_URL="${AISHA_POSTGREST_URL-__UNSET__}"
PRE_AISHA_ANON_KEY="${AISHA_POSTGREST_ANON_KEY-__UNSET__}"
PRE_AISHA_ACCESS_TOKEN="${AISHA_ACCESS_TOKEN-__UNSET__}"
PRE_AISHA_SERVICE_ROLE_KEY="${AISHA_POSTGREST_SERVICE_KEY-__UNSET__}"
PRE_OPENAI_API_KEY="${OPENAI_API_KEY-__UNSET__}"
PRE_GOOGLE_AI_API_KEY="${GOOGLE_AI_API_KEY-__UNSET__}"
PRE_ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY-__UNSET__}"

ENV_FILE="$PROJECT_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
  ok "Loaded .env"
else
  warn "No .env file found — using environment variables or defaults"
fi

if [[ "$PRE_N8N_WEBHOOK_URL" != "__UNSET__" ]]; then N8N_WEBHOOK_URL="$PRE_N8N_WEBHOOK_URL"; fi
if [[ "$PRE_N8N_API_KEY" != "__UNSET__" ]]; then N8N_API_KEY="$PRE_N8N_API_KEY"; fi
if [[ "$PRE_API_DOMAIN" != "__UNSET__" ]]; then API_DOMAIN="$PRE_API_DOMAIN"; fi
if [[ "$PRE_AISHA_GATEWAY_URL" != "__UNSET__" ]]; then AISHA_POSTGREST_URL="$PRE_AISHA_GATEWAY_URL"; fi
if [[ "$PRE_AISHA_ANON_KEY" != "__UNSET__" ]]; then AISHA_POSTGREST_ANON_KEY="$PRE_AISHA_ANON_KEY"; fi
if [[ "$PRE_AISHA_ACCESS_TOKEN" != "__UNSET__" ]]; then AISHA_ACCESS_TOKEN="$PRE_AISHA_ACCESS_TOKEN"; fi
if [[ "$PRE_AISHA_SERVICE_ROLE_KEY" != "__UNSET__" ]]; then AISHA_POSTGREST_SERVICE_KEY="$PRE_AISHA_SERVICE_ROLE_KEY"; fi
if [[ "$PRE_OPENAI_API_KEY" != "__UNSET__" ]]; then OPENAI_API_KEY="$PRE_OPENAI_API_KEY"; fi
if [[ "$PRE_GOOGLE_AI_API_KEY" != "__UNSET__" ]]; then GOOGLE_AI_API_KEY="$PRE_GOOGLE_AI_API_KEY"; fi
if [[ "$PRE_ANTHROPIC_API_KEY" != "__UNSET__" ]]; then ANTHROPIC_API_KEY="$PRE_ANTHROPIC_API_KEY"; fi

# ── Local-first defaults ─────────────────────────────────────────────────────
N8N_WEBHOOK_URL="${N8N_WEBHOOK_URL:-}"
if [[ -z "$N8N_WEBHOOK_URL" ]]; then
  if curl -s -o /dev/null -w "%{http_code}" -m 2 "http://localhost:5678/" 2>/dev/null | rg -q "200|301|302"; then
    N8N_WEBHOOK_URL="http://localhost:5678"
  else
    MCP_DOMAIN="${MCP_DOMAIN:?MCP_DOMAIN required (e.g. n8n.<your-domain>)}"
    N8N_WEBHOOK_URL="https://$MCP_DOMAIN"
  fi
fi

AISHA_POSTGREST_URL="${AISHA_POSTGREST_URL:-}"
if [[ -z "$AISHA_POSTGREST_URL" ]]; then
  # Local front door derived from the topology SoT (config/local-presets.mjs
  # hostPorts → getLocalGatewayUrl). The old probe hit a stale hardcoded
  # 127.0.0.1:57421 (a long-dead E2E host port) and then inconsistently
  # assigned :3001 — so local detection could never succeed.
  LOCAL_GATEWAY_URL=$(node --input-type=module -e "
    import { getLocalGatewayUrl } from \"${PROJECT_ROOT}/config/local-presets.mjs\";
    console.log(getLocalGatewayUrl());
  " 2>/dev/null || true)
  if [[ -n "$LOCAL_GATEWAY_URL" ]] && curl -s -o /dev/null -w "%{http_code}" -m 2 "${LOCAL_GATEWAY_URL}/rest/v1/" 2>/dev/null | rg -q "200|401"; then
    AISHA_POSTGREST_URL="$LOCAL_GATEWAY_URL"
  else
    API_DOMAIN="${API_DOMAIN:?API_DOMAIN required (e.g. api.<your-domain>)}"
    AISHA_POSTGREST_URL="https://$API_DOMAIN"
  fi
fi

N8N_API_KEY="${N8N_API_KEY:-}"
AISHA_POSTGREST_ANON_KEY="${AISHA_POSTGREST_ANON_KEY:-${VITE_AISHA_GATEWAY_KEY:-${VITE_AISHA_POSTGREST_PUBLISHABLE_KEY:-}}}"
AISHA_ACCESS_TOKEN="${AISHA_ACCESS_TOKEN:-${AISHA_KEYCLOAK_ACCESS_TOKEN:-}}"
AISHA_POSTGREST_SERVICE_KEY="${AISHA_POSTGREST_SERVICE_KEY:-}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
GOOGLE_AI_API_KEY="${GOOGLE_AI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

# ── Parse args ───────────────────────────────────────────────────────────────
MODE="${1:-full}"

# =============================================================================
# PHASE 1: Diagnostics
# =============================================================================
diagnostics() {
  step "Phase 1: Diagnostics"

  local all_ok=true

  # 1a. n8n reachability
  info "Checking n8n at $N8N_WEBHOOK_URL..."
  local n8n_status
  n8n_status=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$N8N_WEBHOOK_URL/" 2>/dev/null || true)
  if [[ "$n8n_status" == "200" || "$n8n_status" == "301" || "$n8n_status" == "302" ]]; then
    ok "n8n reachable (HTTP $n8n_status)"
  else
    fail "n8n unreachable (HTTP $n8n_status) at $N8N_WEBHOOK_URL"
    all_ok=false
  fi

  # 1b. n8n API access
  if [[ -n "$N8N_API_KEY" ]]; then
    info "Checking n8n API..."
    local api_status
    api_status=$(curl -s -o /dev/null -w "%{http_code}" -m 10 \
      "$N8N_WEBHOOK_URL/api/v1/workflows" \
      -H "X-N8N-API-KEY: $N8N_API_KEY" 2>/dev/null || true)
    if [[ "$api_status" == "200" ]]; then
      ok "n8n API accessible"

      # Count existing workflows
      local wf_count
      wf_count=$(curl -s -m 10 "$N8N_WEBHOOK_URL/api/v1/workflows" \
        -H "X-N8N-API-KEY: $N8N_API_KEY" 2>/dev/null | \
        python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "?")
      info "  Existing workflows: $wf_count"
    else
      fail "n8n API returned HTTP $api_status"
      all_ok=false
    fi
  else
    warn "N8N_API_KEY not set — cannot check API. Set it in .env"
  fi

  # 1c. AISHA Gateway / PostgREST reachability
  info "Checking AISHA Gateway at $AISHA_POSTGREST_URL..."
  local sb_status
  sb_status=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$AISHA_POSTGREST_URL/rest/v1/" 2>/dev/null || true)
  if [[ "$sb_status" == "401" || "$sb_status" == "200" ]]; then
    ok "AISHA Gateway reachable (HTTP $sb_status — expected 401 without apikey)"
  else
    fail "AISHA Gateway unreachable (HTTP $sb_status)"
    all_ok=false
  fi

  # 1d. Edge Functions (MCP Knowledge Server)
  info "Checking MCP Knowledge Server..."
  local mcp_response
  mcp_response=$(curl -s -m 15 -X POST "$AISHA_POSTGREST_URL/functions/v1/mcp-knowledge-server" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${AISHA_ACCESS_TOKEN:-dummy}" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' 2>/dev/null || echo "TIMEOUT")

  if [[ "$mcp_response" == "TIMEOUT" || -z "$mcp_response" ]]; then
    fail "MCP Knowledge Server TIMEOUT — edge-functions container likely not running"
    echo -e "  ${YELLOW}Possible fixes:${NC}"
    echo "    1. Check if edge-functions container is running on Coolify"
    echo "    2. Check functions-init completed: docker logs evymo-functions-init"
    echo "    3. Check edge-functions logs: docker logs evymo-edge-functions"
    echo "    4. Restart: docker compose restart functions-init edge-functions"
    all_ok=false
  elif echo "$mcp_response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('result',{}).get('tools',[])))" 2>/dev/null | grep -q "[0-9]"; then
    local tool_count
    tool_count=$(echo "$mcp_response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('result',{}).get('tools',[])))" 2>/dev/null)
    ok "MCP Knowledge Server responding — $tool_count tools available"
  elif echo "$mcp_response" | grep -qi "unauthorized\|invalid.*token\|auth"; then
    warn "MCP Knowledge Server running but auth failed — set/verify AISHA_ACCESS_TOKEN"
  else
    warn "MCP Knowledge Server returned unexpected response"
    echo "  Response: $(echo "$mcp_response" | head -c 200)"
  fi

  # 1e. LLM Keys check
  info "Checking LLM API keys..."
  [[ -n "$OPENAI_API_KEY" ]]    && ok "  OPENAI_API_KEY set"    || warn "  OPENAI_API_KEY missing"
  [[ -n "$GOOGLE_AI_API_KEY" ]] && ok "  GOOGLE_AI_API_KEY set" || warn "  GOOGLE_AI_API_KEY missing"
  [[ -n "$ANTHROPIC_API_KEY" ]] && ok "  ANTHROPIC_API_KEY set" || warn "  ANTHROPIC_API_KEY missing"

  echo ""
  if $all_ok; then
    ok "All diagnostics passed"
  else
    warn "Some checks failed — see above for details"
  fi
  return 0
}

# =============================================================================
# PHASE 2: n8n Provisioning (Node.js fallback for systems without Deno)
# =============================================================================
provision_n8n() {
  step "Phase 2: n8n Provisioning"

  # Local-first: if a local n8n container is running, provision via CLI inside
  # the container to avoid HTTP API authentication entirely.
  if [[ "${N8N_WEBHOOK_URL:-}" == http://localhost:5678* ]] || [[ "${N8N_WEBHOOK_URL:-}" == http://127.0.0.1:5678* ]]; then
    if command -v docker &>/dev/null && docker ps --format '{{.Names}}' | rg -q '^aisha-dirigent-n8n-1$'; then
      provision_n8n_local_cli
      return $?
    fi
  fi

  if [[ -z "$N8N_API_KEY" ]]; then
    fail "N8N_API_KEY is required for remote provisioning."
    echo "  1. Open $N8N_WEBHOOK_URL → Settings → API"
    echo "  2. Create API Key"
    echo "  3. Add to .env: N8N_API_KEY=<key>"
    return 1
  fi

  # Check if Deno available (preferred), otherwise use Node.js wrapper
  if command -v deno &>/dev/null; then
    info "Using Deno runtime for provisioning..."
    (
      cd "$PROJECT_ROOT"
      N8N_API_URL="$N8N_WEBHOOK_URL" \
      N8N_API_KEY="$N8N_API_KEY" \
      AISHA_POSTGREST_URL="$AISHA_POSTGREST_URL" \
      AISHA_POSTGREST_SERVICE_KEY="$AISHA_POSTGREST_SERVICE_KEY" \
      OPENAI_API_KEY="$OPENAI_API_KEY" \
      GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
      AISHA_ACCESS_TOKEN="$AISHA_ACCESS_TOKEN" \
      deno run --allow-net --allow-read --allow-env scripts/aisha-provision.ts
    )
  else
    info "Deno not found — using Node.js provisioning wrapper..."
    provision_n8n_node
  fi
}

provision_n8n_local_cli() {
  info "Local n8n detected — provisioning via container CLI (no HTTP API keys needed)."

  # n8n CLI import is strict: workflow.name must be present (NOT NULL in DB).
  # Our repo workflow JSONs may omit "name" (it is derived in API provisioning),
  # so we normalize them inside the container into a temp folder first.
  docker exec aisha-dirigent-n8n-1 sh -lc "rm -rf /tmp/aisha-workflows-fixed && mkdir -p /tmp/aisha-workflows-fixed" || {
    fail "Failed to prepare temp workflow directory"
    return 1
  }

  docker exec -i aisha-dirigent-n8n-1 node --input-type=module << 'NODE_FIX'
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";

const SRC = "/workflows";
const DST = "/tmp/aisha-workflows-fixed";

const files = (await readdir(SRC)).filter((f) => f.toLowerCase().endsWith(".json"));
for (const file of files) {
  const full = join(SRC, file);
  const raw = await readFile(full, "utf-8");
  const wf = JSON.parse(raw);

  const fallbackName = basename(file, ".json");
  if (!wf.name || typeof wf.name !== "string" || wf.name.trim().length === 0) {
    wf.name = fallbackName;
  }
  // Local dev: import as active so webhooks register immediately.
  wf.active = true;
  wf.settings = wf.settings && typeof wf.settings === "object" ? wf.settings : {};

  await writeFile(join(DST, file), JSON.stringify(wf, null, 2));
}
console.log(`Normalized ${files.length} workflows into ${DST}`);
NODE_FIX

  # Import all workflows from the normalized temp directory.
  docker exec aisha-dirigent-n8n-1 n8n import:workflow --separate --input=/tmp/aisha-workflows-fixed || {
    fail "n8n workflow import failed"
    return 1
  }

  # Publish (activate) all workflows. Keep it simple for local dev.
  local ids
  ids="$(docker exec aisha-dirigent-n8n-1 n8n list:workflow --onlyId 2>/dev/null | rg '^[A-Za-z0-9]+$' || true)"
  if [[ -z "$ids" ]]; then
    warn "No workflows found after import (unexpected)."
    return 0
  fi

  while IFS= read -r wf_id; do
    [[ -z "$wf_id" ]] && continue
    docker exec aisha-dirigent-n8n-1 n8n publish:workflow --id="$wf_id" >/dev/null 2>&1 || \
      warn "Could not publish workflow id=$wf_id (continuing)"
  done <<< "$ids"

  ok "Local n8n workflows imported and published"
}

provision_n8n_node() {
  # Node.js implementation of the same provisioning logic
  node --input-type=module << 'NODE_SCRIPT'
const N8N_API_URL = process.env.N8N_WEBHOOK_URL || "http://localhost:5678";
const N8N_API_KEY = process.env.N8N_API_KEY || "";
const AISHA_POSTGREST_URL = process.env.AISHA_POSTGREST_URL || "";
const AISHA_POSTGREST_ANON_KEY = process.env.AISHA_POSTGREST_ANON_KEY || "";
const AISHA_POSTGREST_SERVICE_KEY = process.env.AISHA_POSTGREST_SERVICE_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const AISHA_ACCESS_TOKEN = process.env.AISHA_ACCESS_TOKEN || process.env.AISHA_KEYCLOAK_ACCESS_TOKEN || "";
const WORKFLOWS_DIR = process.env.WORKFLOWS_DIR || join(process.cwd(), "n8n", "workflows");

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const log = (emoji, msg) => console.log(`${emoji} ${msg}`);

async function n8nFetch(path, options = {}) {
  const url = `${N8N_API_URL.replace(/\/$/, "")}/api/v1${path}`;
  const res = await fetch(url, {
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
  return res.json();
}

// ── Credentials ──
const CREDENTIAL_DEFS = [
  {
    name: "AISHA Supabase (Service Role)",
    type: "httpHeaderAuth",
    data: { name: "apikey", value: AISHA_POSTGREST_SERVICE_KEY },
  },
  {
    name: "OpenAI (AISHA)",
    type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Bearer ${OPENAI_API_KEY}` },
  },
  {
    name: "AISHA MCP (Bearer)",
    type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Bearer ${AISHA_ACCESS_TOKEN}` },
  },
];

if (GITHUB_TOKEN) {
  CREDENTIAL_DEFS.push({
    name: "GitHub (AISHA)",
    type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Bearer ${GITHUB_TOKEN}` },
  });
}

async function provisionCredentials() {
  log("🔐", "Provisioning credentials...");
  
  // n8n public API may not support GET /credentials — just create and handle conflicts
  const credentialIds = new Map();

  for (const cred of CREDENTIAL_DEFS) {
    const hasData = Object.values(cred.data).some(v => v && String(v).length > 0);
    if (!hasData) { log("⏭️", `  Skipping ${cred.name} (no data)`); continue; }
    try {
      const created = await n8nFetch("/credentials", {
        method: "POST",
        body: JSON.stringify(cred),
      });
      log("✨", `  Created: ${cred.name} (id: ${created.id})`);
      credentialIds.set(cred.name, created.id);
    } catch (err) {
      if (err.message.includes("409") || err.message.includes("already exists") || err.message.includes("duplicate")) {
        log("✅", `  ${cred.name} — already exists`);
      } else {
        log("❌", `  Failed: ${cred.name} — ${err.message}`);
      }
    }
  }
  return credentialIds;
}

// ── Variables ──
async function provisionVariables() {
  log("📋", "Provisioning n8n variables...");
  const vars = {
    AISHA_POSTGREST_URL,
    AISHA_POSTGREST_ANON_KEY,
    AISHA_ACCESS_TOKEN,
    AISHA_POSTGREST_SERVICE_KEY,
    OPENAI_API_KEY,
  };

  for (const [key, value] of Object.entries(vars)) {
    if (!value) { log("⏭️", `  Skipping ${key} (empty)`); continue; }
    try {
      await n8nFetch("/variables", { method: "POST", body: JSON.stringify({ key, value }) });
      log("✨", `  Set: ${key}`);
    } catch (err) {
      if (err.message.includes("license") || err.message.includes("feat:variables")) {
        log("⏭️", `  ${key} — n8n Community (variables require paid license, values embedded in workflows)`);
      } else if (err.message.includes("already exists") || err.message.includes("409")) {
        log("✅", `  ${key} — already exists`);
      } else {
        log("❌", `  Failed: ${key} — ${err.message}`);
      }
    }
  }
  log("ℹ️", "Variables that can't be set via API are embedded directly in workflow nodes.");
}

// ── Workflows ──
async function provisionWorkflows() {
  log("📦", "Importing workflows...");
  const existing = await n8nFetch("/workflows");
  const existingByName = new Map(existing.data.map(w => [w.name, { id: w.id, active: w.active }]));

  const workflowIds = new Map();

  // Read and sort workflow files
  const files = (await readdir(WORKFLOWS_DIR)).filter(f => f.endsWith(".json")).sort();

  for (const filename of files) {
    const filePath = join(WORKFLOWS_DIR, filename);
    const content = await readFile(filePath, "utf-8");
    const workflow = JSON.parse(content);

    const workflowName = workflow.name || filename.replace(/\.json$/i, "");

    if (existingByName.has(workflowName)) {
      const { id, active } = existingByName.get(workflowName);
      log("🔄", `  ${workflowName} — updating (id: ${id})`);
      workflowIds.set(workflowName, id);

      try {
        try {
          await n8nFetch(`/workflows/${id}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: workflowName,
              nodes: workflow.nodes,
              connections: workflow.connections,
              settings: workflow.settings ?? {},
            }),
          });
        } catch (err) {
          if (String(err?.message || "").includes("405")) {
            // Older/newer n8n API variants sometimes reject PATCH; retry with PUT.
            await n8nFetch(`/workflows/${id}`, {
              method: "PUT",
              body: JSON.stringify({
                name: workflowName,
                nodes: workflow.nodes,
                connections: workflow.connections,
                settings: workflow.settings ?? {},
              }),
            });
          } else {
            throw err;
          }
        }

        if (!active) {
          try {
            await n8nFetch(`/workflows/${id}/activate`, { method: "POST" });
            log("🟢", `  Activated: ${workflowName}`);
          } catch (err) {
            log("⚠️", `  Could not activate ${workflowName}: ${err.message}`);
          }
        }
      } catch (err) {
        log("❌", `  Update failed: ${workflowName} — ${err.message}`);
      }
      continue;
    }

    try {
      const created = await n8nFetch("/workflows", {
        method: "POST",
        body: JSON.stringify({
          name: workflowName,
          nodes: workflow.nodes,
          connections: workflow.connections,
          settings: workflow.settings ?? {},
        }),
      });

      log("✨", `  Imported: ${workflowName} (id: ${created.id})`);
      workflowIds.set(workflowName, created.id);

      try {
        await n8nFetch(`/workflows/${created.id}/activate`, { method: "POST" });
        log("🟢", `  Activated: ${workflowName}`);
      } catch (err) {
        log("⚠️", `  Could not activate ${workflowName}: ${err.message}`);
      }
    } catch (err) {
      log("❌", `  Import failed: ${workflowName} — ${err.message}`);
    }
  }

  // Set workflow ID variables for Dirigent
  if (workflowIds.size > 0) {
    log("📋", "Setting workflow ID variables...");
    const idMappings = {
      "WF_KNOWLEDGE_AGENT_ID": "WF_KNOWLEDGE_AGENT",
      "WF_COMPLIANCE_AGENT_ID": "WF_COMPLIANCE_AGENT",
      "WF_DELIVERY_AGENT_ID": "WF_DELIVERY_AGENT",
      "WF_NIGHTLY_AUDIT_ID": "WF_NIGHTLY_STORY_AUDIT",
      "WF_MODEL_ROUTER_ID": "WF_MODEL_ROUTER",
    };

    for (const [varName, wfName] of Object.entries(idMappings)) {
      const wfId = workflowIds.get(wfName);
      if (wfId) {
        try {
          await n8nFetch("/variables", { method: "POST", body: JSON.stringify({ key: varName, value: String(wfId) }) });
          log("✨", `  ${varName} = ${wfId}`);
        } catch {
          log("⏭️", `  ${varName} — already exists or failed`);
        }
      }
    }
  }

  return workflowIds;
}

// ── Main ──
console.log("═══════════════════════════════════════════════════════════════");
console.log("  AISHA n8n Provisioning (Node.js)");
console.log(`  Target: ${N8N_API_URL}`);
console.log("═══════════════════════════════════════════════════════════════");

try {
  await provisionCredentials();
  console.log();
  await provisionVariables();
  console.log();
  await provisionWorkflows();
  console.log();
  log("🎉", "Provisioning complete!");
} catch (err) {
  console.error("ERROR:", err.message);
  process.exit(1);
}
NODE_SCRIPT
}

# =============================================================================
# PHASE 2b: Deploy Individual MCP Tools to AI Agents
# =============================================================================
deploy_tools() {
  step "Phase 2b: Deploy Individual MCP Tools"

  if [[ -z "$N8N_API_KEY" ]]; then
    warn "N8N_API_KEY required for tool deployment — skipping"
    return 0
  fi

  if [[ -z "$AISHA_ACCESS_TOKEN" ]]; then
    warn "AISHA_ACCESS_TOKEN required for tool deployment — skipping"
    return 0
  fi

  info "Testing toolCode sandbox (fetch() support)..."
  local test_result
  test_result=$(node "$SCRIPT_DIR/deploy-individual-tools.mjs" --test 2>&1)
  
  if echo "$test_result" | grep -q "SUCCESS"; then
    ok "toolCode sandbox test passed — fetch() works"
    
    info "Deploying individual tools to all agents..."
    local deploy_result
    deploy_result=$(node "$SCRIPT_DIR/deploy-individual-tools.mjs" --deploy-all 2>&1)
    
    if echo "$deploy_result" | grep -q "FAILED"; then
      warn "Some agents failed to deploy — check output:"
      echo "$deploy_result" | grep -E "FAILED|❌" | head -5
    else
      ok "Individual MCP tools deployed to all agents"
    fi

    # Deploy autonomous orchestration prompts
    info "Deploying agent system prompts (autonomous orchestration)..."
    local prompts_result
    prompts_result=$(node "$SCRIPT_DIR/deploy-agent-prompts.mjs" 2>&1)
    local deployed_count
    deployed_count=$(echo "$prompts_result" | grep -c "🚀" || true)
    if [[ "$deployed_count" -gt 0 ]]; then
      ok "$deployed_count agent prompt(s) deployed"
    else
      ok "Agent prompts already up-to-date"
    fi

    # Sync local workflow JSONs
    info "Syncing local workflow JSONs from server..."
    node "$SCRIPT_DIR/sync-workflows-from-server.mjs" 2>&1 | tail -3
    ok "Local workflow files synchronized"
  else
    warn "toolCode sandbox test failed — keeping MCP Bridge mode"
    echo "$test_result" | tail -5
    
    info "Deploying MCP Bridge mode (fallback)..."
    node "$SCRIPT_DIR/deploy-mcp-bridge.mjs" 2>&1 | tail -3
  fi
}

# =============================================================================
# PHASE 3: Verification
# =============================================================================
verify() {
  step "Phase 3: End-to-End Verification"

  local pass=0
  local total=0

  # 3a. MCP tools/list
  total=$((total + 1))
  info "Verifying MCP tools/list..."
  if [[ -n "$AISHA_ACCESS_TOKEN" ]]; then
    local mcp_tools
    mcp_tools=$(curl -s -m 15 -X POST "$AISHA_POSTGREST_URL/functions/v1/mcp-knowledge-server" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $AISHA_ACCESS_TOKEN" \
      -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' 2>/dev/null)

    local tool_count
    tool_count=$(echo "$mcp_tools" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('result',{}).get('tools',[])))" 2>/dev/null || echo "0")

    if [[ "$tool_count" -gt "0" ]]; then
      ok "MCP tools/list: $tool_count tools"
      pass=$((pass + 1))
    else
      fail "MCP tools/list failed"
    fi
  else
    warn "AISHA_ACCESS_TOKEN not set — skipping"
  fi

  # 3b. n8n workflows
  total=$((total + 1))
  info "Verifying n8n workflows..."
  if command -v docker &>/dev/null && docker ps --format '{{.Names}}' | rg -q '^aisha-dirigent-n8n-1$'; then
    local wf_count active_count
    wf_count="$(docker exec aisha-dirigent-n8n-1 n8n list:workflow --onlyId 2>/dev/null | rg '^[A-Za-z0-9]+$' | wc -l | tr -d ' ' || echo "0")"
    active_count="$(docker exec aisha-dirigent-n8n-1 n8n list:workflow --active=true --onlyId 2>/dev/null | rg '^[A-Za-z0-9]+$' | wc -l | tr -d ' ' || echo "0")"

    if [[ "$wf_count" -ge "6" ]]; then
      ok "n8n workflows: $wf_count total, $active_count active (via CLI)"
      pass=$((pass + 1))
    else
      warn "n8n workflows: only $wf_count (expected 8+)"
    fi
  elif [[ -n "$N8N_API_KEY" ]]; then
    local wf_data
    wf_data=$(curl -s -m 10 "$N8N_WEBHOOK_URL/api/v1/workflows" \
      -H "X-N8N-API-KEY: $N8N_API_KEY" 2>/dev/null)

    local wf_count active_count
    wf_count=$(echo "$wf_data" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
    active_count=$(echo "$wf_data" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for w in d.get('data',[]) if w.get('active')))" 2>/dev/null || echo "0")

    if [[ "$wf_count" -ge "6" ]]; then
      ok "n8n workflows: $wf_count total, $active_count active"
      pass=$((pass + 1))
    else
      warn "n8n workflows: only $wf_count (expected 8+)"
    fi
  else
    warn "N8N_API_KEY not set — skipping"
  fi

  # 3c. Dirigent Agent webhook
  total=$((total + 1))
  info "Verifying Dirigent Agent webhook..."
  local dirigent_status
  dirigent_status=$(curl -s -o /dev/null -w "%{http_code}" -m 10 \
    -X POST "$N8N_WEBHOOK_URL/webhook/dirigent-agent" \
    -H "Content-Type: application/json" \
    -d '{"message":"health_check","session_id":"setup-verify"}' 2>/dev/null || true)

  if [[ "$dirigent_status" == "200" ]]; then
    ok "Dirigent Agent webhook responding"
    pass=$((pass + 1))
  elif [[ "$dirigent_status" == "404" ]]; then
    warn "Dirigent Agent webhook 404 — viz docs/deploy/N8N_WEBHOOK_FIX.md"
    warn "  Nejpravděpodobnější příčina: chybí WEBHOOK_URL env var na n8n kontejneru"
  else
    warn "Dirigent Agent webhook returned HTTP $dirigent_status"
  fi

  # 3d. n8n-trigger edge function
  total=$((total + 1))
  info "Verifying n8n-trigger edge function..."
  if [[ -n "$AISHA_POSTGREST_SERVICE_KEY" ]]; then
    local trigger_status
    trigger_status=$(curl -s -o /dev/null -w "%{http_code}" -m 10 \
      -X POST "$AISHA_POSTGREST_URL/functions/v1/n8n-trigger" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $AISHA_POSTGREST_SERVICE_KEY" \
      -d '{"workflow":"dirigent-agent","payload":{"message":"health_check"}}' 2>/dev/null || true)

    if [[ "$trigger_status" == "200" ]]; then
      ok "n8n-trigger edge function responding"
      pass=$((pass + 1))
    else
      warn "n8n-trigger returned HTTP $trigger_status"
    fi
  else
    warn "AISHA_POSTGREST_SERVICE_KEY not set — skipping"
  fi

  echo ""
  echo -e "${BOLD}Verification: $pass/$total checks passed${NC}"
}

# =============================================================================
# PHASE 4: Summary & Next Steps
# =============================================================================
summary() {
  step "Summary"

  echo -e "${BOLD}Infrastructure Status:${NC}"
  echo "  n8n:                $N8N_WEBHOOK_URL"
  echo "  AISHA Gateway:      $AISHA_POSTGREST_URL"
  echo "  MCP Server:         $AISHA_POSTGREST_URL/functions/v1/mcp-knowledge-server"
  echo ""
  echo -e "${BOLD}Endpoints registered in n8n:${NC}"
  echo "  Dirigent Agent:     $N8N_WEBHOOK_URL/webhook/dirigent-agent"
  echo "  Knowledge Agent:    $N8N_WEBHOOK_URL/webhook/knowledge-agent"
  echo "  Compliance Agent:   $N8N_WEBHOOK_URL/webhook/compliance-agent"
  echo "  Delivery Agent:     $N8N_WEBHOOK_URL/webhook/delivery-agent"
  echo "  Model Router:       $N8N_WEBHOOK_URL/webhook/model-router"
  echo "  PR Gate:            $N8N_WEBHOOK_URL/webhook/pr-compliance-gate"
  echo "  Chat (interactive): $N8N_WEBHOOK_URL/chat/dirigent-agent"
  echo ""
  echo -e "${BOLD}VS Code Extension:${NC}"
  echo "  cd extensions/aisha-dirigent && npm install && npm run build"
  echo "  Then install: code --install-extension aisha-dirigent-0.1.0.vsix"
  echo ""
  echo -e "${BOLD}Bootstrap local Dirigent config:${NC}"
  echo '  AISHA_POSTGREST_URL="'$AISHA_POSTGREST_URL'" \'
  echo '  AISHA_POSTGREST_ANON_KEY="<AISHA_POSTGREST_ANON_KEY>" \'
  echo '  AISHA_ACCESS_TOKEN="<KEYCLOAK_ACCESS_TOKEN>" \'
  echo '  npm run dirigent:bootstrap:mcp'
}

# =============================================================================
# Main
# =============================================================================
echo "═══════════════════════════════════════════════════════════════"
echo "  AISHA Dirigent Ecosystem Setup"
echo "  $(date '+%Y-%m-%d %H:%M')"
echo "═══════════════════════════════════════════════════════════════"

case "$MODE" in
  --check)
    diagnostics
    ;;
  --provision)
    provision_n8n
    ;;
  --verify)
    verify
    ;;
  --tools)
    deploy_tools
    ;;
  full|*)
    diagnostics
    echo ""
    provision_n8n
    echo ""
    deploy_tools
    echo ""
    verify
    echo ""
    summary
    ;;
esac

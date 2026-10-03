#!/usr/bin/env bash
# =============================================================================
# provision-intranet.sh — Provision Appsmith Story Intra Workspace
# =============================================================================
# Sets up the "Story Intra" workspace in Appsmith CE for intranet users.
# Creates workspace, datasources, imports template apps, and publishes the
# Story Intra portal. This runs AFTER provision-appsmith.sh (which sets up
# the admin StoryLoop workspace).
#
# Story Intra = user's personal workspace where they have their projects,
# stories, knowledge, and can build apps from components — all backed by
# the AISHA AI backend (MCP tools, knowledge base, RPCs, n8n workflows).
#
# Usage:
#   bash scripts/provision-intranet.sh                  # auto-detect local/prod
#   bash scripts/provision-intranet.sh --local          # force local mode
#   bash scripts/provision-intranet.sh --prod           # force production mode
#   bash scripts/provision-intranet.sh --check          # verify status only
#   bash scripts/provision-intranet.sh --dry-run        # show what would be done
#
# Prerequisites:
#   1. Appsmith running with admin user (run provision-appsmith.sh first)
#   2. INTRANET_API_KEY set (shared secret for gateway ↔ datasource auth)
#   3. AISHA_POSTGREST_ANON_KEY set (for public data datasource)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATES_DIR="${PROJECT_ROOT}/appsmith/templates"

# ─── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

ok()      { echo -e "  ${GREEN}OK${NC} $*"; }
fail()    { echo -e "  ${RED}FAIL${NC} $*"; }
info()    { echo -e "  ${BLUE}INFO${NC} $*"; }
warn()    { echo -e "  ${YELLOW}WARN${NC} $*"; }
skip()    { echo -e "  ${DIM}SKIP $*${NC}"; }
section() { echo ""; echo -e "${BLUE}=== $* ===${NC}"; }

# ─── Argument parsing ───────────────────────────��─────────────
MODE=""
CHECK_ONLY=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --local)   MODE="local" ;;
    --prod)    MODE="prod" ;;
    --check)   CHECK_ONLY=true ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h)
      echo "Usage: $0 [--local|--prod] [--check] [--dry-run]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      exit 1
      ;;
  esac
done

# ─── Auto-detect mode ────────────────────────────────────────
if [[ -z "$MODE" ]]; then
  : "${INTERNAL_TLD:?INTERNAL_TLD must be set}"
  if curl -sf "http://localhost:80/api/v1/health" &>/dev/null; then
    MODE="local"
  elif curl -sf "https://appsmith.backend.${INTERNAL_TLD}/api/v1/health" &>/dev/null; then
    MODE="prod"
  else
    fail "Cannot detect Appsmith. Specify --local or --prod"
    exit 1
  fi
fi

# ─── Mode-specific config ────────────────────────────────────
if [[ "$MODE" == "local" ]]; then
  APPSMITH_URL="http://localhost:80"
  GATEWAY_URL="http://localhost:3001"
  ANON_KEY="${AISHA_POSTGREST_ANON_KEY:-}"
  INTRANET_KEY="${INTRANET_API_KEY:-intranet-local-dev-key}"
  # S2: the intranet oauth2-proxy front for the gateway's /intranet path. It
  # injects X-Auth-Request-Access-Token (the caller's verified Keycloak token),
  # which the gateway uses as the SOLE identity. Locally there is no proxy, so
  # this points straight at the gateway /intranet path (dev convenience).
  INTRANET_PROXY_URL="${INTRANET_PROXY_URL:-${GATEWAY_URL}/intranet}"
else
  APPSMITH_URL="${APPSMITH_URL:?APPSMITH_URL required (e.g. https://appsmith.<your-domain>)}"
  GATEWAY_URL="${AISHA_API_URL:?AISHA_API_URL required (e.g. https://api.<your-domain>)}"
  ANON_KEY="${AISHA_POSTGREST_ANON_KEY:?AISHA_POSTGREST_ANON_KEY is required for production}"
  INTRANET_KEY="${INTRANET_API_KEY:?INTRANET_API_KEY is required for production}"
  # S2: production MUST traverse the intranet oauth2-proxy so the verified KC
  # access token is injected — a direct gateway URL would skip identity.
  INTRANET_PROXY_URL="${INTRANET_PROXY_URL:?INTRANET_PROXY_URL required (intranet oauth2-proxy front for the gateway /intranet path, e.g. https://intranet.<your-domain>/intranet)}"
fi

WORKSPACE_NAME="Story Intra"

section "Story Intra Provisioning ($MODE)"

# ─── Appsmith API helpers ─────────────────────────────────────
# Appsmith CE uses cookie-based auth (CSRF token + session cookie).
# We login once and reuse the session for all API calls.
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

appsmith_login() {
  local email="${APPSMITH_ADMIN_EMAIL:?APPSMITH_ADMIN_EMAIL required}"
  local password="${APPSMITH_ADMIN_PASSWORD:-}"

  if [[ -z "$password" ]]; then
    fail "APPSMITH_ADMIN_PASSWORD not set"
    return 1
  fi

  local response
  response=$(curl -sf -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
    -X POST "${APPSMITH_URL}/api/v1/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\"}" 2>/dev/null || echo '{"errorCode":"FAIL"}')

  if grep -q '"errorCode"' <<< "$response"; then
    fail "Appsmith login failed: $(echo "$response" | grep -o '"message":"[^"]*"' | head -1)"
    return 1
  fi
  ok "Logged into Appsmith as ${email}"
}

appsmith_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  local args=(-sf -b "$COOKIE_JAR" -c "$COOKIE_JAR")
  args+=(-X "$method")
  args+=(-H "Content-Type: application/json")
  [[ -n "$data" ]] && args+=(-d "$data")

  curl "${args[@]}" "${APPSMITH_URL}${path}" 2>/dev/null
}

# ─── Check mode ───────────────────────────────────────────────
if [[ "$CHECK_ONLY" == "true" ]]; then
  info "Checking Story Intra status..."

  # Check Appsmith health
  HEALTH=$(curl -sf "${APPSMITH_URL}/api/v1/health" 2>/dev/null || echo "unreachable")
  if [[ "$HEALTH" != "unreachable" ]]; then
    ok "Appsmith is healthy"
  else
    fail "Appsmith not reachable at ${APPSMITH_URL}"
  fi

  # Check templates directory
  if [[ -d "$TEMPLATES_DIR" ]]; then
    TEMPLATE_COUNT=$(find "$TEMPLATES_DIR" -name "*.template.json" 2>/dev/null | wc -l)
    ok "Templates directory exists (${TEMPLATE_COUNT} templates)"
  else
    warn "Templates directory missing: ${TEMPLATES_DIR}"
  fi

  # Check gateway intranet endpoint
  INTRANET_HEALTH=$(curl -s -o /dev/null -w '%{http_code}' \
    "${GATEWAY_URL}/intranet/token-exchange" 2>/dev/null || true)
  if [[ "$INTRANET_HEALTH" == "401" ]]; then
    ok "Gateway intranet endpoint active (returns 401 without API key)"
  else
    warn "Gateway intranet endpoint status: HTTP ${INTRANET_HEALTH}"
  fi

  exit 0
fi

# ─── Dry run mode ────────────────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
  info "Dry run — showing what would be done:"
  echo ""
  echo "  1. Login to Appsmith at ${APPSMITH_URL}"
  echo "  2. Create workspace: '${WORKSPACE_NAME}'"
  echo "  3. Create datasources:"
  echo "     - AISHA Intranet API (gateway: ${GATEWAY_URL}/intranet/rpc)"
  echo "     - AISHA Knowledge (gateway: ${GATEWAY_URL}/intranet/mcp)"
  echo "     - AISHA Public Data (PostgREST: ${GATEWAY_URL}/rest/v1)"
  echo "  4. Import templates from: ${TEMPLATES_DIR}/"
  if [[ -d "$TEMPLATES_DIR" ]]; then
    for tpl in "$TEMPLATES_DIR"/*.template.json; do
      [[ -f "$tpl" ]] && echo "     - $(basename "$tpl")"
    done
  else
    echo "     (templates directory not found)"
  fi
  echo "  5. Publish Story Intra portal app"
  echo ""
  exit 0
fi

# ─── Feature flag gate (H1) ──────────────────────────────────
# The whole intranet surface is governed by ONE cold-start switch,
# INTRANET_ENABLED — the SAME flag that gates the gateway /intranet route
# registration (services/gateway/src/server.ts) and the intranet app deploy
# (config/services.json). Refuse to provision when it is not enabled so the
# intranet cannot be half-deployed (app present but gateway route ungated).
# --check / --dry-run above already returned, so diagnostics still work unflagged.
if [[ "${INTRANET_ENABLED:-}" != "true" ]]; then
  fail "INTRANET_ENABLED is not 'true' — intranet provisioning is disabled."
  info "Set INTRANET_ENABLED=true (the single intranet switch) to provision."
  exit 1
fi

# ─── Execute provisioning ────────────────────────────────────

appsmith_login || exit 1

# Step 1: Create workspace
section "Create Workspace"
EXISTING_WS=$(appsmith_api GET "/api/v1/workspaces" | \
  grep -o '"id":"[^"]*","userPermissions"[^}]*"name":"'"${WORKSPACE_NAME}"'"' | \
  grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

if [[ -n "$EXISTING_WS" ]]; then
  skip "Workspace '${WORKSPACE_NAME}' already exists (id=${EXISTING_WS})"
  WORKSPACE_ID="$EXISTING_WS"
else
  WS_RESPONSE=$(appsmith_api POST "/api/v1/workspaces" \
    "{\"name\":\"${WORKSPACE_NAME}\"}")
  WORKSPACE_ID=$(echo "$WS_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ -n "$WORKSPACE_ID" ]]; then
    ok "Created workspace '${WORKSPACE_NAME}' (id=${WORKSPACE_ID})"
  else
    fail "Failed to create workspace"
    exit 1
  fi
fi

# Step 2: Create datasources
section "Create Datasources"

create_rest_datasource() {
  local name="$1"
  local url="$2"
  local headers="$3"

  # Check if datasource already exists
  local existing
  existing=$(appsmith_api GET "/api/v1/datasources?workspaceId=${WORKSPACE_ID}" | \
    grep -o '"id":"[^"]*"[^}]*"name":"'"${name}"'"' | \
    grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

  if [[ -n "$existing" ]]; then
    skip "Datasource '${name}' already exists (id=${existing})"
    return 0
  fi

  local body
  body=$(cat <<EOF
{
  "name": "${name}",
  "workspaceId": "${WORKSPACE_ID}",
  "pluginId": "restapi-plugin",
  "datasourceConfiguration": {
    "url": "${url}",
    "headers": ${headers}
  }
}
EOF
)

  local response
  response=$(appsmith_api POST "/api/v1/datasources" "$body")
  local ds_id
  ds_id=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ -n "$ds_id" ]]; then
    ok "Created datasource '${name}' (id=${ds_id})"
  else
    warn "Failed to create datasource '${name}'"
  fi
}

# Intranet API (user-scoped RPC proxy via the intranet oauth2-proxy → gateway).
# Identity comes from the proxy-injected X-Auth-Request-Access-Token (verified KC
# token); X-Intranet-Api-Key is only a defense-in-depth pre-filter (S2).
create_rest_datasource "AISHA Intranet API" \
  "${INTRANET_PROXY_URL}" \
  "[{\"key\":\"X-Intranet-Api-Key\",\"value\":\"${INTRANET_KEY}\"},{\"key\":\"Content-Type\",\"value\":\"application/json\"}]"

# Knowledge API (MCP proxy via the same intranet oauth2-proxy path)
create_rest_datasource "AISHA Knowledge" \
  "${INTRANET_PROXY_URL}/mcp" \
  "[{\"key\":\"X-Intranet-Api-Key\",\"value\":\"${INTRANET_KEY}\"},{\"key\":\"Content-Type\",\"value\":\"application/json\"}]"

# Public Data (PostgREST — read-only, anon key)
if [[ -n "$ANON_KEY" ]]; then
  create_rest_datasource "AISHA Public Data" \
    "${GATEWAY_URL}/rest/v1" \
    "[{\"key\":\"apikey\",\"value\":\"${ANON_KEY}\"},{\"key\":\"Authorization\",\"value\":\"Bearer ${ANON_KEY}\"},{\"key\":\"Content-Type\",\"value\":\"application/json\"}]"
else
  warn "ANON_KEY not set — skipping Public Data datasource"
fi

# Reconnect an imported app's datasources. Appsmith returns an
# unConfiguredDatasourceList on a (partial) import — datasources the app
# references that must be reconnected to a live workspace datasource, else the
# re-imported app ships with dead datasources. Best-effort + non-fatal.
reconnect_datasources() {
  local app_id="$1"
  local import_response="$2"

  local unconfigured
  unconfigured=$(echo "$import_response" | grep -o '"unConfiguredDatasourceList":\[[^]]*\]' || true)
  if [[ -z "$unconfigured" ]]; then
    skip "No unconfigured datasources to reconnect (appId=${app_id})"
    return 0
  fi

  # Live workspace datasources (created above) → resolve name → id.
  local ws_datasources
  ws_datasources=$(appsmith_api GET "/api/v1/datasources?workspaceId=${WORKSPACE_ID}" || echo '')

  local reconnected=0 name ds_id
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    ds_id=$(echo "$ws_datasources" | \
      grep -o '"id":"[^"]*"[^}]*"name":"'"${name}"'"' | \
      grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
    if [[ -z "$ds_id" ]]; then
      warn "  reconnect: no workspace datasource named '${name}'"
      continue
    fi
    # Reconnect the imported app to the existing workspace datasource of that name.
    if appsmith_api POST \
      "/api/v1/applications/import/${WORKSPACE_ID}/datasources/${ds_id}?applicationId=${app_id}" \
      "{\"name\":\"${name}\"}" >/dev/null 2>&1; then
      reconnected=$((reconnected + 1))
    fi
  done <<< "$(echo "$unconfigured" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)"

  ok "Reconnected ${reconnected} datasource(s) (appId=${app_id})"
}

# Step 3: Import templates (idempotent — zero duplicate applications on re-run)
section "Import Templates"
if [[ -d "$TEMPLATES_DIR" ]]; then
  # Snapshot existing apps in the workspace ONCE for the existence guard.
  EXISTING_APPS_JSON=$(appsmith_api GET "/api/v1/applications?workspaceId=${WORKSPACE_ID}" || echo '')

  for tpl in "$TEMPLATES_DIR"/*.template.json; do
    [[ -f "$tpl" ]] || continue
    TPL_NAME=$(basename "$tpl" .template.json)

    # The app name the import will create = exportedApplication.name in the
    # template (fall back to the template filename).
    APP_NAME=$(grep -o '"name":"[^"]*"' "$tpl" | head -1 | cut -d'"' -f4)
    APP_NAME="${APP_NAME:-$TPL_NAME}"

    # (2a) Application existence guard — is an app with this name already in the
    # workspace? If so we UPDATE it in place (import with ?applicationId=…) rather
    # than POSTing a fresh import, so a second run creates ZERO duplicate apps.
    EXISTING_APP=$(echo "$EXISTING_APPS_JSON" | \
      grep -o '"id":"[^"]*"[^}]*"name":"'"${APP_NAME}"'"' | \
      grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

    local_import_url="${APPSMITH_URL}/api/v1/applications/import/${WORKSPACE_ID}"
    if [[ -n "$EXISTING_APP" ]]; then
      info "Updating existing app '${APP_NAME}' (appId=${EXISTING_APP})"
      local_import_url="${local_import_url}?applicationId=${EXISTING_APP}"
    else
      info "Importing template: ${TPL_NAME}"
    fi

    # Appsmith import is via multipart form upload.
    IMPORT_RESPONSE=$(curl -sf -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
      -X POST "${local_import_url}" \
      -F "file=@${tpl};type=application/json" 2>/dev/null || echo '{"errorCode":"FAIL"}')

    if grep -q '"errorCode"' <<< "$IMPORT_RESPONSE"; then
      warn "Failed to import ${TPL_NAME}: $(echo "$IMPORT_RESPONSE" | grep -o '"message":"[^"]*"' | head -1)"
      continue
    fi

    APP_ID=$(echo "$IMPORT_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    APP_ID="${APP_ID:-$EXISTING_APP}"
    ok "Imported ${TPL_NAME} (appId=${APP_ID})"

    # (2b) Reconnect datasources so the (re-)imported app has live datasources.
    reconnect_datasources "$APP_ID" "$IMPORT_RESPONSE"
  done
else
  warn "Templates directory not found: ${TEMPLATES_DIR}"
  info "Create templates in appsmith/templates/*.template.json"
fi

# Step 4: Summary
section "Story Intra Summary"
echo ""
echo -e "  ${GREEN}Workspace:${NC}   ${WORKSPACE_NAME} (id=${WORKSPACE_ID})"
echo -e "  ${GREEN}Gateway:${NC}     ${GATEWAY_URL}/intranet"
echo -e "  ${GREEN}Templates:${NC}   ${TEMPLATES_DIR}"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo "    1. Add users to the workspace via n8n WF_INTRANET_USER_ONBOARD"
echo "    2. Update intranet-gateway Caddy redirect to the Story Intra app slug"
echo "    3. Set INTRANET_API_KEY in Coolify env vars"
echo ""
ok "Story Intra provisioning complete ($MODE)"

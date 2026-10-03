#!/usr/bin/env bash
# =============================================================================
# provision-appsmith.sh — Provision Appsmith StoryLoop Dashboard
# =============================================================================
# Sets up Appsmith with admin user, workspace, datasources and the StoryLoop
# dashboard application. Creates the initial page structure for Aisha-powered
# StoryLoop admin dashboard.
#
# Usage:
#   bash scripts/provision-appsmith.sh                    # auto-detect local/prod
#   bash scripts/provision-appsmith.sh --local            # force local mode
#   bash scripts/provision-appsmith.sh --prod             # force production mode
#   bash scripts/provision-appsmith.sh --check            # verify status only
#
# Prerequisites:
#   1. Appsmith running (behind OAuth2 Proxy in prod, direct in local)
#   2. For production: APPSMITH_ADMIN_PASSWORD, AISHA_POSTGREST_ANON_KEY set
#   3. OAuth2 Proxy skip-auth configured for /api/v1/users/super,/api/v1/health
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

ok()      { echo -e "  ${GREEN}✓${NC} $*"; }
fail()    { echo -e "  ${RED}✗${NC} $*"; }
info()    { echo -e "  ${BLUE}ℹ${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
skip()    { echo -e "  ${DIM}○ $*${NC}"; }
section() { echo ""; echo -e "${BLUE}═══ $* ═══${NC}"; }

# ─── Argument parsing ─────────────────────────────────────────
MODE=""
CHECK_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --local) MODE="local" ;;
    --prod)  MODE="prod" ;;
    --check) CHECK_ONLY=true ;;
    --help|-h)
      echo "Usage: $0 [--local|--prod] [--check]"
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
  if curl -sf "http://localhost:8090/api/v1/health" &>/dev/null; then
    MODE="local"
  elif curl -sf "https://appsmith.${PUBLIC_TLD:?PUBLIC_TLD must be set to probe prod Appsmith}/api/v1/health" &>/dev/null; then
    MODE="prod"
  else
    fail "Cannot detect Appsmith — specify --local or --prod"
    exit 1
  fi
fi

# ─── Mode-specific config ────────────────────────────────────
if [[ "$MODE" == "local" ]]; then
  APPSMITH_URL="http://localhost:8090"
  APPSMITH_ADMIN_EMAIL="admin@evymo.local"
  APPSMITH_ADMIN_PASS="${APPSMITH_ADMIN_PASSWORD:?set APPSMITH_ADMIN_PASSWORD — no committed default}"
  # Current local stack: gateway / PostgREST exposed by local-warmup (typically 3001)
  AISHA_API_URL="http://host.docker.internal:3001"
  AISHA_ANON="${AISHA_POSTGREST_ANON_KEY:-}"
  NOCODB_URL="http://host.docker.internal:8085"
else
  APPSMITH_URL="https://${APPSMITH_DOMAIN:?APPSMITH_DOMAIN required (e.g. appsmith.<your-domain>)}"
  APPSMITH_ADMIN_EMAIL="${APPSMITH_ADMIN_EMAIL:?APPSMITH_ADMIN_EMAIL required (operator admin)}"
  APPSMITH_ADMIN_PASS="${APPSMITH_ADMIN_PASSWORD:?APPSMITH_ADMIN_PASSWORD is required for production}"
  AISHA_API_URL="https://${API_DOMAIN:?API_DOMAIN required (e.g. api.<your-domain>)}"
  AISHA_ANON="${AISHA_POSTGREST_ANON_KEY:?AISHA_POSTGREST_ANON_KEY is required for production}"
  NOCODB_URL="http://nocodb:8080"  # Internal docker network
fi

COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

section "Appsmith StoryLoop Provisioning ($MODE)"

# ─── Helper: API call ────────────────────────────────────────
api() {
  local method="$1" path="$2"
  shift 2
  curl -sS -X "$method" \
    "${APPSMITH_URL}${path}" \
    -H "Content-Type: application/json" \
    -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    "$@"
}

# Quiet version that captures HTTP status
api_status() {
  local method="$1" path="$2"
  shift 2
  curl -sS -o /dev/null -w "%{http_code}" -X "$method" \
    "${APPSMITH_URL}${path}" \
    -H "Content-Type: application/json" \
    -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    "$@"
}

# ─── 1. Health check ─────────────────────────────────────────
section "1. Health Check"
HEALTH_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "${APPSMITH_URL}/api/v1/health" --max-time 10 2>/dev/null || true)
if [[ "$HEALTH_CODE" == "200" ]]; then
  ok "Appsmith healthy ($APPSMITH_URL)"
else
  fail "Appsmith not reachable (HTTP $HEALTH_CODE)"
  info "Make sure Appsmith is running and OAuth2 Proxy skip-auth is configured"
  exit 1
fi

if $CHECK_ONLY; then
  section "Check Mode — Status"
  # Try login to verify admin exists
  LOGIN_RESP=$(api POST "/api/v1/login" -d "{\"username\":\"$APPSMITH_ADMIN_EMAIL\",\"password\":\"$APPSMITH_ADMIN_PASS\"}" 2>/dev/null)
  if echo "$LOGIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('responseMeta',{}).get('status')==200 else 1)" 2>/dev/null; then
    ok "Admin user exists and login works"
    # Check if StoryLoop app exists
    APPS=$(api GET "/api/v1/applications" 2>/dev/null)
    if echo "$APPS" | grep -q "StoryLoop"; then
      ok "StoryLoop application found"
    else
      warn "StoryLoop application not found"
    fi
  else
    warn "Admin user not yet created or credentials incorrect"
  fi
  exit 0
fi

# ─── 2. Create admin user ────────────────────────────────────
section "2. Admin User"
SUPER_RESP=$(api POST "/api/v1/users/super" -d "{
  \"name\": \"Evymo Admin\",
  \"email\": \"$APPSMITH_ADMIN_EMAIL\",
  \"password\": \"$APPSMITH_ADMIN_PASS\",
  \"allowCollectingAnonymousData\": false,
  \"signupForNewsletter\": false,
  \"role\": \"Administrator\"
}" 2>/dev/null || echo '{"error":"request_failed"}')

SUPER_STATUS=$(echo "$SUPER_RESP" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    status = d.get('responseMeta', {}).get('status', 0)
    if status == 200 or status == 201:
        print('created')
    elif 'already exists' in json.dumps(d).lower() or status == 409:
        print('exists')
    else:
        print(f'error:{status}')
except:
    print('error:parse')
" 2>/dev/null || echo "error:parse")

case "$SUPER_STATUS" in
  created) ok "Admin user created ($APPSMITH_ADMIN_EMAIL)" ;;
  exists)  ok "Admin user already exists" ;;
  *)       warn "Admin user creation response: $SUPER_STATUS" ;;
esac

# ─── 3. Login ─────────────────────────────────────────────────
section "3. Login"
LOGIN_RESP=$(api POST "/api/v1/login" -d "{
  \"username\": \"$APPSMITH_ADMIN_EMAIL\",
  \"password\": \"$APPSMITH_ADMIN_PASS\"
}" 2>/dev/null)

LOGIN_OK=$(echo "$LOGIN_RESP" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if d.get('responseMeta', {}).get('status') == 200:
        print('ok')
    else:
        print('fail')
except:
    print('fail')
" 2>/dev/null || echo "fail")

if [[ "$LOGIN_OK" != "ok" ]]; then
  fail "Login failed — check credentials"
  echo "$LOGIN_RESP" | python3 -m json.tool 2>/dev/null || echo "$LOGIN_RESP"
  exit 1
fi
ok "Logged in as $APPSMITH_ADMIN_EMAIL"

# ─── 4. Get/Create workspace ─────────────────────────────────
section "4. Workspace"
WORKSPACES_RESP=$(api GET "/api/v1/workspaces" 2>/dev/null)
WORKSPACE_ID=$(echo "$WORKSPACES_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for ws in d.get('data', []):
    print(ws['id'])
    break
" 2>/dev/null || echo "")

if [[ -n "$WORKSPACE_ID" ]]; then
  ok "Using existing workspace: $WORKSPACE_ID"
else
  WS_CREATE=$(api POST "/api/v1/workspaces" -d '{"name":"Evymo Platform"}' 2>/dev/null)
  WORKSPACE_ID=$(echo "$WS_CREATE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('data', {}).get('id', ''))
" 2>/dev/null || echo "")
  if [[ -n "$WORKSPACE_ID" ]]; then
    ok "Created workspace: $WORKSPACE_ID"
  else
    fail "Failed to create workspace"
    exit 1
  fi
fi

# ─── 5. Create/Find StoryLoop application ────────────────────
section "5. StoryLoop Application"
APPS_RESP=$(api GET "/api/v1/applications" 2>/dev/null)
APP_ID=$(echo "$APPS_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for app in d.get('data', []):
    if 'StoryLoop' in app.get('name', ''):
        print(app['id'])
        break
" 2>/dev/null || echo "")

if [[ -n "$APP_ID" ]]; then
  ok "StoryLoop app exists: $APP_ID"
else
  APP_CREATE=$(api POST "/api/v1/applications" -d "{
    \"name\": \"StoryLoop Dashboard\",
    \"workspaceId\": \"$WORKSPACE_ID\",
    \"color\": \"#4F46E5\",
    \"icon\": \"dashboard\"
  }" 2>/dev/null)
  APP_ID=$(echo "$APP_CREATE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('data', {}).get('id', ''))
" 2>/dev/null || echo "")
  if [[ -n "$APP_ID" ]]; then
    ok "Created StoryLoop app: $APP_ID"
  else
    fail "Failed to create application"
    echo "$APP_CREATE" | python3 -m json.tool 2>/dev/null || echo "$APP_CREATE"
    exit 1
  fi
fi

# ─── 6. Create AISHA datasource (PostgREST / Gateway) ───────────────────────────
section "6. Datasources — AISHA (current stack: PostgREST via Gateway)"

# Check existing datasources
DS_RESP=$(api GET "/api/v1/datasources?workspaceId=$WORKSPACE_ID" 2>/dev/null)
AISHA_DS_ID=$(echo "$DS_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for ds in d.get('data', []):
    name = ds.get('name', '').lower()
    if 'aisha' in name or 'postgrest' in name or 'gateway' in name or 'evymo' in name:
        print(ds['id'])
        break
" 2>/dev/null || echo "")

if [[ -n "$AISHA_DS_ID" ]]; then
  ok "AISHA datasource exists: $AISHA_DS_ID"
else
  DS_CREATE=$(api POST "/api/v1/datasources" -d "{
    \"name\": \"AISHA Gateway / PostgREST\",
    \"workspaceId\": \"$WORKSPACE_ID\",
    \"pluginId\": \"\",
    \"datasourceConfiguration\": {
      \"url\": \"${AISHA_API_URL}/rest/v1\",
      \"headers\": [
        {\"key\": \"apikey\", \"value\": \"${AISHA_ANON}\"},
        {\"key\": \"Authorization\", \"value\": \"Bearer ${AISHA_ANON}\"},
        {\"key\": \"Content-Type\", \"value\": \"application/json\"},
        {\"key\": \"Prefer\", \"value\": \"return=representation\"}
      ]
    }
  }" 2>/dev/null)
  AISHA_DS_ID=$(echo "$DS_CREATE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('data', {}).get('id', ''))
" 2>/dev/null || echo "")
  if [[ -n "$AISHA_DS_ID" ]]; then
    ok "Created AISHA datasource: $AISHA_DS_ID"
  else
    warn "AISHA datasource creation needs manual plugin setup"
    info "Create REST API datasource in Appsmith UI pointing to: ${AISHA_API_URL}/rest/v1"
  fi
fi

ok "AISHA API (Gateway/PostgREST): ${AISHA_API_URL}"

# NocoDB datasource (API)
NOCODB_DS_ID=$(echo "$DS_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for ds in d.get('data', []):
    if 'nocodb' in ds.get('name', '').lower():
        print(ds['id'])
        break
" 2>/dev/null || echo "")

if [[ -n "$NOCODB_DS_ID" ]]; then
  ok "NocoDB datasource exists: $NOCODB_DS_ID"
else
  info "NocoDB datasource should be created manually in Appsmith UI"
  info "URL: $NOCODB_URL/api/v1  (requires NocoDB API token)"
fi

# ─── 7. Setup pages ──────────────────────────────────────────
section "7. Dashboard Pages"

# Get existing pages for the app
PAGES_RESP=$(api GET "/api/v1/pages?applicationId=$APP_ID" 2>/dev/null)
EXISTING_PAGES=$(echo "$PAGES_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
pages = d.get('data', {}).get('pages', []) if isinstance(d.get('data'), dict) else d.get('data', [])
for p in pages:
    name = p.get('name', '') if isinstance(p, dict) else ''
    print(name)
" 2>/dev/null || echo "")

# Define StoryLoop pages
PAGES=("Overview" "Stories" "Analytics" "Monitoring" "Knowledge Base")

for page_name in "${PAGES[@]}"; do
  if echo "$EXISTING_PAGES" | grep -qi "$page_name"; then
    ok "Page '$page_name' exists"
  else
    PAGE_CREATE=$(api POST "/api/v1/pages" -d "{
      \"name\": \"$page_name\",
      \"applicationId\": \"$APP_ID\"
    }" 2>/dev/null)
    PAGE_ID=$(echo "$PAGE_CREATE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
pid = d.get('data', {}).get('id', '')
print(pid)
" 2>/dev/null || echo "")
    if [[ -n "$PAGE_ID" ]]; then
      ok "Created page '$page_name': $PAGE_ID"
    else
      warn "Failed to create page '$page_name'"
    fi
  fi
done

# ─── 8. Publish application ──────────────────────────────────
section "8. Publish"
PUBLISH_RESP=$(api POST "/api/v1/applications/publish/$APP_ID" 2>/dev/null)
PUBLISH_OK=$(echo "$PUBLISH_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('responseMeta', {}).get('status') == 200:
    print('ok')
else:
    print('fail')
" 2>/dev/null || echo "fail")

if [[ "$PUBLISH_OK" == "ok" ]]; then
  ok "Application published"
else
  warn "Publish may need manual step — check Appsmith UI"
fi

# ─── 9. Get embed/view URL ───────────────────────────────────
section "9. Embed URL"

# The default page is the app's landing page
APP_SLUG=$(echo "$APPS_RESP$APP_CREATE" | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.load(sys.stdin)
        slug = d.get('data', {}).get('slug', '') if isinstance(d.get('data'), dict) else ''
        for app in (d.get('data') if isinstance(d.get('data'), list) else [d.get('data', {})]):
            if app and isinstance(app, dict):
                s = app.get('slug', '')
                if s: print(s); exit(0)
    except:
        pass
" 2>/dev/null || echo "")

EMBED_URL="${APPSMITH_URL}/app/storyloop-dashboard"
if [[ -n "$APP_SLUG" ]]; then
  EMBED_URL="${APPSMITH_URL}/app/${APP_SLUG}"
fi

ok "Embed URL: $EMBED_URL"
info "Use this URL in AdminDashboardEmbed (via integration_services.config.embed_path)"

# ─── 10. Update integration_services record ──────────────────
section "10. Integration Services Update"
if [[ "$MODE" == "prod" ]]; then
  info "Update integration_services.health_status for appsmith:"
  info "  UPDATE integration_services SET health_status = 'healthy',"
  info "    config = jsonb_set(config, '{embed_path}', '\"$EMBED_URL\"')"
  info "    WHERE service_name = 'appsmith';"
  info ""
  info "Or via pg-meta API:"
  info "  curl -X POST https://api.\${PUBLIC_TLD}/pg/query \\"
  info "    -H 'apikey: \$SERVICE_ROLE_KEY' -H 'Authorization: Bearer \$SERVICE_ROLE_KEY' \\"
  info "    -d '{\"query\": \"UPDATE integration_services SET health_status = \\\"healthy\\\" WHERE service_name = \\\"appsmith\\\"\"}'"
fi

# ─── 11. AISHA Ops Dashboard (Phase 4 of AUTONOMOUS_DEPLOY_FLOW) ──
section "11. AISHA Ops Dashboard"
#
# AISHA Ops je separátní Appsmith app sourovo vedle StoryLoop. Builduje se
# přes scripts/build-aisha-appsmith.mjs (idempotent — content-hash check).
# Cron 30min spouští WF_APPSMITH_DASHBOARD_BUILDER, který volá tento builder.
#
# Spec: docs/deploy/APPSMITH_AISHA_OPS.md

# Find or create AISHA Ops app
AISHA_OPS_APP_ID=$(echo "$APPS_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for app in d.get('data', []):
    if app.get('name', '') == 'AISHA Ops' or app.get('slug', '') == 'aisha-ops':
        print(app['id'])
        break
" 2>/dev/null || echo "")

if [[ -n "$AISHA_OPS_APP_ID" ]]; then
  ok "AISHA Ops app exists: $AISHA_OPS_APP_ID"
else
  info "AISHA Ops app not yet created — first run will create via builder."
  info "After this script:"
  info "  export APPSMITH_AISHA_WORKSPACE_ID=$WORKSPACE_ID"
  info "  node scripts/build-aisha-appsmith.mjs --dry-run --output /tmp/aisha-ops.json"
  info "  # Review /tmp/aisha-ops.json, then run without --dry-run to import"
fi

# Show the env vars needed for builder
info ""
info "Builder requires environment:"
info "  APPSMITH_AISHA_WORKSPACE_ID=$WORKSPACE_ID"
info "  APPSMITH_URL=$APPSMITH_URL"
info "  APPSMITH_ADMIN_EMAIL=$APPSMITH_ADMIN_EMAIL"
info "  APPSMITH_ADMIN_PASSWORD=<set>"
info "  POSTGREST_URL=<api url>"
info "  POSTGREST_ANON_KEY=<anon key>"
info "  N8N_API_URL=<n8n url>, N8N_API_KEY=<key>"
info "  COOLIFY_API_URL=<api>, COOLIFY_API_TOKEN=<token>"
info "  SENTRY_URL=<url>, SENTRY_AUTH_TOKEN=<token>"


# ─── Summary ─────────────────────────────────────────────────
section "Summary"
echo ""
ok "Appsmith URL:     $APPSMITH_URL"
ok "Admin:            $APPSMITH_ADMIN_EMAIL"
ok "Workspace:        $WORKSPACE_ID"
ok "StoryLoop App:    $APP_ID"
ok "AISHA Ops App:    ${AISHA_OPS_APP_ID:-(pending first builder run)}"
ok "Embed URL:        $EMBED_URL"
ok "AISHA API:        $AISHA_API_URL"
echo ""
info "Next steps:"
info "  1. Open $APPSMITH_URL and log in (via KC SSO in prod)"
info "  2. Configure datasources (Supabase REST API + NocoDB)"
info "  3. Build StoryLoop dashboard pages (Overview, Stories, etc.)"
info "  4. Run AISHA Ops builder: node scripts/build-aisha-appsmith.mjs"
info "  5. Activate WF_APPSMITH_DASHBOARD_BUILDER in n8n (cron 30min)"
info "  6. Update integration_services.health_status to 'healthy'"
echo ""

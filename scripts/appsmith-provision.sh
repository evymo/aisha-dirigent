#!/usr/bin/env bash
# =============================================================================
# appsmith-provision.sh — Provision Appsmith datasource for AISHA DB (PostgREST)
# =============================================================================
# Creates a PostgreSQL datasource in Appsmith pointing to the local Supabase DB.
# Run after Appsmith is up and you've completed the initial signup.
#
# Usage:
#   bash scripts/appsmith-provision.sh
#   bash scripts/appsmith-provision.sh --appsmith-url http://localhost:8090
#
# Prerequisites:
#   1. Appsmith running (docker compose --profile admin up)
#   2. Initial signup completed (create admin account in Appsmith UI)
#   3. APPSMITH_API_KEY set in .env (get from Appsmith > Profile > API Key)
# =============================================================================
set -euo pipefail

APPSMITH_URL="${1:-http://localhost:8090}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; }
info() { echo -e "  ${BLUE}ℹ${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }

echo ""
echo -e "${BLUE}Appsmith Datasource Provisioning${NC}"
echo ""

# Load API key from .env
APPSMITH_API_KEY=""
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  APPSMITH_API_KEY=$(grep -E "^APPSMITH_API_KEY=" "$PROJECT_ROOT/.env" | cut -d= -f2- | tr -d '"' || true)
fi

if [[ -z "$APPSMITH_API_KEY" ]]; then
  warn "APPSMITH_API_KEY not found in .env"
  echo ""
  echo "  To get your API key:"
  echo "    1. Open ${APPSMITH_URL} in browser"
  echo "    2. Complete initial signup (if first time)"
  echo "    3. Go to Profile → API Key → Generate"
  echo "    4. Add to .env: APPSMITH_API_KEY=<your-key>"
  echo ""
  echo "  Alternatively, create the datasource manually:"
  echo "    1. Open ${APPSMITH_URL}"
  echo "    2. Create New App → Datasources → PostgreSQL"
  echo "    3. Host: host.docker.internal"
  echo "    4. Port: 57422"
  echo "    5. Database: postgres"
  echo "    6. User: postgres"
  echo "    7. Password: postgres"
  echo ""
  exit 0
fi

# Check Appsmith is up
if ! curl -sf "${APPSMITH_URL}/api/v1/health" &>/dev/null; then
  fail "Appsmith not reachable at ${APPSMITH_URL}"
  echo "  Start it: docker compose -f docker-compose.local.yml --profile admin up -d"
  exit 1
fi
ok "Appsmith running at ${APPSMITH_URL}"

# Get default workspace
info "Getting default workspace..."
WORKSPACE_ID=$(curl -sf "${APPSMITH_URL}/api/v1/workspaces" \
  -H "Authorization: Bearer ${APPSMITH_API_KEY}" \
  | grep -oE '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [[ -z "$WORKSPACE_ID" ]]; then
  fail "Could not find workspace. Is the API key correct?"
  exit 1
fi
ok "Workspace: ${WORKSPACE_ID}"

# Create datasource
info "Creating PostgreSQL datasource..."
RESPONSE=$(curl -sf -X POST "${APPSMITH_URL}/api/v1/datasources" \
  -H "Authorization: Bearer ${APPSMITH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"AISHA Local DB (PostgREST)\",
    \"pluginId\": \"\",
    \"workspaceId\": \"${WORKSPACE_ID}\",
    \"datasourceConfiguration\": {
      \"connection\": {
        \"mode\": \"READ_WRITE\"
      },
      \"endpoints\": [{
        \"host\": \"host.docker.internal\",
        \"port\": 57422
      }],
      \"authentication\": {
        \"authenticationType\": \"dbAuth\",
        \"username\": \"postgres\",
        \"password\": \"postgres\",
        \"databaseName\": \"postgres\"
      }
    }
  }" 2>&1 || echo "FAILED")

if grep -q '"id"' <<< "$RESPONSE"; then
  DS_ID=$(echo "$RESPONSE" | grep -oE '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  ok "Datasource created: ${DS_ID}"
  echo ""
  echo -e "  ${GREEN}Done!${NC} Open ${APPSMITH_URL} to start building dashboards."
  echo "  The 'AISHA Local DB (PostgREST)' datasource is ready to use."
else
  warn "Datasource creation returned unexpected response"
  echo "  You may need to create it manually in the Appsmith UI:"
  echo "    Host: host.docker.internal, Port: 57422, DB: postgres, User/Pass: postgres"
fi

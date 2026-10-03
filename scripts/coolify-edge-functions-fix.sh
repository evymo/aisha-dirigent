#!/usr/bin/env bash
# =============================================================================
# coolify-edge-functions-fix.sh — Diagnose & fix edge functions on Coolify
# =============================================================================
#
# When edge functions return timeout on Coolify, this script:
#   1. Checks container states (functions-init, edge-functions)
#   2. Rebuilds functions-init to copy latest code to volume
#   3. Restarts edge-functions container
#   4. Verifies the MCP server responds
#
# Usage:
#   SSH to Coolify server, then:
#     ./scripts/coolify-edge-functions-fix.sh
#
#   Or from local machine:
#     ssh root@<coolify-host> 'bash -s' < scripts/coolify-edge-functions-fix.sh
#
# Prerequisites:
#   - Docker running on the Coolify server
#   - evymo-* containers deployed via docker-compose.coolify.yml
#
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; }
info() { echo -e "${BLUE}ℹ${NC} $*"; }
step() { echo -e "\n${BOLD}── $* ──${NC}"; }

# ── Container names (from docker-compose.coolify.yml) ────────────────────────
FUNCTIONS_INIT="evymo-functions-init"
EDGE_FUNCTIONS="evymo-edge-functions"

step "1. Container Status"

for container in "$FUNCTIONS_INIT" "$EDGE_FUNCTIONS"; do
  status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "not_found")
  case "$status" in
    running)    ok "$container: running" ;;
    exited)
      exit_code=$(docker inspect --format='{{.State.ExitCode}}' "$container" 2>/dev/null || echo "?")
      if [[ "$container" == "$FUNCTIONS_INIT" && "$exit_code" == "0" ]]; then
        ok "$container: exited (code 0 — completed successfully)"
      else
        fail "$container: exited (code $exit_code)"
        echo "  Last logs:"
        docker logs --tail 20 "$container" 2>&1 | sed 's/^/    /'
      fi
      ;;
    not_found)  fail "$container: not found — container was never created" ;;
    *)          warn "$container: $status" ;;
  esac
done

step "2. Functions Volume Check"

# Check if functions are in the volume
info "Checking functions-data volume..."
volume_path=$(docker volume inspect --format='{{.Mountpoint}}' aisha-dirigent_functions-data 2>/dev/null \
  || docker volume inspect --format='{{.Mountpoint}}' functions-data 2>/dev/null \
  || echo "not_found")

if [[ "$volume_path" != "not_found" ]]; then
  func_count=$(find "$volume_path" -maxdepth 2 -name "index.ts" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$func_count" -gt "0" ]]; then
    ok "Functions volume has $func_count functions"
    # Check for MCP specifically
    if [[ -f "$volume_path/mcp-knowledge-server/index.ts" ]]; then
      ok "mcp-knowledge-server found in volume"
    else
      fail "mcp-knowledge-server NOT found in volume"
    fi
  else
    fail "Functions volume is empty — functions-init didn't copy files"
  fi
else
  # Try via docker exec
  info "Volume not directly accessible — checking via container..."
  func_count=$(docker exec "$EDGE_FUNCTIONS" ls /home/deno/functions/ 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  if [[ "$func_count" -gt "0" ]]; then
    ok "Edge functions container has $func_count entries in /home/deno/functions/"
    has_mcp=$(docker exec "$EDGE_FUNCTIONS" ls /home/deno/functions/mcp-knowledge-server/index.ts 2>/dev/null && echo "yes" || echo "no")
    if [[ "$has_mcp" == "yes" ]]; then
      ok "mcp-knowledge-server found in container"
    else
      fail "mcp-knowledge-server NOT in container"
    fi
  else
    fail "No functions found in container"
  fi
fi

step "3. Edge Functions Health"

# Check if edge-functions is responding internally
edge_status=$(docker exec "$EDGE_FUNCTIONS" curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/ 2>/dev/null || true)
if [[ "$edge_status" != "000" ]]; then
  ok "Edge runtime responding internally (HTTP $edge_status)"
else
  fail "Edge runtime not responding on port 9000"
fi

step "4. Kong → Edge Functions Route"

# Test from Kong to edge functions
kong_to_edge=$(docker exec "$EDGE_FUNCTIONS" curl -s -o /dev/null -w "%{http_code}" -m 5 http://localhost:9000/ 2>/dev/null || true)
if [[ "$kong_to_edge" != "000" ]]; then
  ok "edge-functions reachable (HTTP $kong_to_edge)"
else
  fail "Kong CANNOT reach edge-functions — network issue"
  echo "  Check: docker network inspect (ensure both are on same network)"
fi

step "5. Fix Actions"

echo ""
echo -e "${BOLD}If functions-init didn't run or volume is empty:${NC}"
echo ""
echo "  # Find the compose project name"
echo "  docker compose ls"
echo ""
echo "  # Re-run functions-init to copy latest code"
echo "  docker compose -f docker-compose.coolify.yml up --force-recreate functions-init"
echo ""
echo "  # Restart edge-functions to pick up new code"
echo "  docker restart $EDGE_FUNCTIONS"
echo ""
echo -e "${BOLD}If edge-functions is crashing:${NC}"
echo ""
echo "  # Check logs"
echo "  docker logs --tail 50 $EDGE_FUNCTIONS 2>&1"
echo ""
echo "  # Check memory (Deno V8 limit is set to 256MB)"
echo "  docker stats --no-stream $EDGE_FUNCTIONS"
echo ""
echo -e "${BOLD}Quick fix — rebuild and restart everything:${NC}"
echo ""
echo "  docker compose -f docker-compose.coolify.yml build --no-cache functions-init"
echo "  docker compose -f docker-compose.coolify.yml up --force-recreate functions-init"
echo "  docker restart $EDGE_FUNCTIONS"
echo ""
echo "  # Verify MCP server from inside Kong:"
echo '  docker exec '$EDGE_FUNCTIONS' curl -s -X POST http://localhost:9000/mcp-knowledge-server -H "Content-Type: application/json" -d '"'"'{"jsonrpc":"2.0","method":"tools/list","id":1}'"'"' | head -c 200'

#!/usr/bin/env bash
# =============================================================================
# Mode Switch — Toggle AISHA between local / hybrid / cloud execution
# =============================================================================
# Changes AISHA_EXECUTION_MODE in supabase/.env.local and restarts edge
# functions to apply the new mode.
#
# Usage:
#   ./scripts/ai/mode-switch.sh local      # All-local inference
#   ./scripts/ai/mode-switch.sh hybrid     # Local + cloud fallback
#   ./scripts/ai/mode-switch.sh cloud      # Cloud-first (production)
#   ./scripts/ai/mode-switch.sh            # Show current mode
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env.local"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

log_info()  { echo -e "${BLUE}[mode]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[mode]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[mode]${NC} $1"; }

# =============================================================================
# Read current mode
# =============================================================================

get_current_mode() {
  if [[ -f "${ENV_FILE}" ]]; then
    grep '^AISHA_EXECUTION_MODE=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- || echo "cloud"
  else
    echo "cloud"
  fi
}

# =============================================================================
# Show status
# =============================================================================

show_status() {
  local mode
  mode="$(get_current_mode)"

  echo ""
  echo -e "${CYAN}${BOLD}AISHA Execution Mode${NC}"
  echo -e "${DIM}─────────────────────────────${NC}"
  echo ""

  case "${mode}" in
    local)
      echo -e "  Current: ${GREEN}${BOLD}local${NC}  — all inference on local backends"
      echo -e ""
      echo -e "  ${BOLD}Model routing:${NC}"
      echo -e "    greeting      → ${GREEN}ollama-mistral-nemo${NC}"
      echo -e "    simple        → ${GREEN}ollama-mistral-nemo${NC}"
      echo -e "    moderate      → ${GREEN}ollama-mistral-nemo${NC}"
      echo -e "    complex       → ${GREEN}ollama-mistral-nemo${NC}"
      echo -e "    deep_analysis → ${GREEN}ollama-mistral-nemo${NC}"
      echo -e ""
      echo -e "  ${BOLD}Cloud backends:${NC} ${RED}blocked${NC} (not used even if keys set)"
      ;;
    hybrid)
      echo -e "  Current: ${YELLOW}${BOLD}hybrid${NC}  — local + cloud escalation"
      echo -e ""
      echo -e "  ${BOLD}Model routing:${NC}"
      echo -e "    greeting      → ${GREEN}ollama-mistral-nemo${NC}  (local)"
      echo -e "    simple        → ${GREEN}ollama-mistral-nemo${NC}  (local)"
      echo -e "    moderate      → ${GREEN}ollama-mistral-nemo${NC}  (local)"
      echo -e "    complex       → ${YELLOW}cloud model${NC}           (API key required)"
      echo -e "    deep_analysis → ${YELLOW}cloud model${NC}           (API key required)"
      echo -e ""
      echo -e "  ${BOLD}Cloud backends:${NC} active for complex/deep tasks"
      ;;
    cloud)
      echo -e "  Current: ${BLUE}${BOLD}cloud${NC}  — cloud-first (production)"
      echo -e ""
      echo -e "  ${BOLD}Model routing:${NC}"
      echo -e "    greeting      → gpt-5-mini"
      echo -e "    simple        → gpt-5-mini"
      echo -e "    moderate      → gemini-2.5-flash"
      echo -e "    complex       → claude-sonnet-4"
      echo -e "    deep_analysis → claude-sonnet-4"
      echo -e ""
      echo -e "  ${BOLD}Cloud backends:${NC} ${GREEN}active${NC} (requires API keys)"
      ;;
    *)
      echo -e "  Current: ${RED}${BOLD}${mode}${NC}  (unknown — defaulting to cloud)"
      ;;
  esac
  echo ""
}

# =============================================================================
# Switch mode
# =============================================================================

switch_mode() {
  local new_mode="$1"
  local old_mode
  old_mode="$(get_current_mode)"

  if [[ "${old_mode}" == "${new_mode}" ]]; then
    log_ok "Already in ${new_mode} mode"
    return 0
  fi

  # Validate
  case "${new_mode}" in
    local|hybrid|cloud) ;;
    *)
      echo -e "${RED}Invalid mode: ${new_mode}${NC}"
      echo "Usage: $0 {local|hybrid|cloud}"
      exit 1
      ;;
  esac

  # Update env file
  if grep -q '^AISHA_EXECUTION_MODE=' "${ENV_FILE}" 2>/dev/null; then
    sed -i '' "s/^AISHA_EXECUTION_MODE=.*/AISHA_EXECUTION_MODE=${new_mode}/" "${ENV_FILE}"
  else
    echo "" >> "${ENV_FILE}"
    echo "AISHA_EXECUTION_MODE=${new_mode}" >> "${ENV_FILE}"
  fi

  log_ok "Switched: ${old_mode} → ${new_mode}"

  # Pre-flight checks for the new mode
  if [[ "${new_mode}" == "local" ]]; then
    # Check local backends are available
    local any_local=false
    curl -sf http://localhost:11434/api/tags &>/dev/null && any_local=true
    curl -sf http://localhost:8100/v1/models &>/dev/null && any_local=true
    curl -sf http://localhost:12434/engines/v1/models &>/dev/null && any_local=true
    if ! $any_local; then
      log_warn "No local backends running! Start one first:"
      echo -e "    ${DIM}npm run ollama:setup && npm run ollama:serve${NC}"
      echo -e "    ${DIM}npm run mlx:serve${NC}"
    fi
  fi

  if [[ "${new_mode}" == "hybrid" || "${new_mode}" == "cloud" ]]; then
    # Check at least one cloud key is set
    local has_cloud=false
    [[ -n "$(grep '^OPENAI_API_KEY=.' "${ENV_FILE}" 2>/dev/null)" ]] && has_cloud=true
    [[ -n "$(grep '^ANTHROPIC_API_KEY=.' "${ENV_FILE}" 2>/dev/null)" ]] && has_cloud=true
    [[ -n "$(grep '^GOOGLE_AI_API_KEY=.' "${ENV_FILE}" 2>/dev/null)" ]] && has_cloud=true
    if ! $has_cloud; then
      log_warn "No cloud API keys configured in .env.local"
      [[ "${new_mode}" == "hybrid" ]] && log_warn "Complex/deep tasks will fail without cloud keys"
      [[ "${new_mode}" == "cloud" ]] && log_warn "All tasks will fail without cloud keys"
    fi
  fi

  # Restart edge functions to apply new mode
  log_info "Restarting edge functions..."
  docker restart supabase_edge_runtime_platform &>/dev/null 2>&1 || true
  sleep 3

  # Verify edge functions are back online
  if curl -sf "http://127.0.0.1:3001/functions/v1/ai-chat" -o /dev/null 2>&1 || \
     curl -s "http://127.0.0.1:3001/functions/v1/ai-chat" -w "%{http_code}" -o /dev/null 2>&1 | grep -E "^[24]" >/dev/null; then
    log_ok "Edge functions restarted"
  else
    log_warn "Edge functions may still be starting..."
  fi

  show_status
}

# =============================================================================
# Main
# =============================================================================

if [[ $# -eq 0 ]]; then
  show_status
  exit 0
fi

case "$1" in
  --help|-h)
    echo "Usage: $0 [local|hybrid|cloud]"
    echo ""
    echo "Modes:"
    echo "  local   All inference on local backends (Ollama, Docker, MLX)"
    echo "  hybrid  Local for simple tasks, cloud for complex/deep"
    echo "  cloud   Cloud-first (standard production mode)"
    echo ""
    echo "Without arguments: show current mode"
    exit 0
    ;;
  *)
    switch_mode "$1"
    ;;
esac

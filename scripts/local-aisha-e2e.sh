#!/usr/bin/env bash
# =============================================================================
# local-aisha-e2e.sh — Local AISHA E2E Orchestrator
# =============================================================================
# Runs a local end-to-end validation loop with backend preflight, optional warmup,
# chat behavior tests, integration tests, and a summary report.
#
# Usage:
#   bash scripts/local-aisha-e2e.sh
#   bash scripts/local-aisha-e2e.sh --model ollama-mistral-nemo
#   bash scripts/local-aisha-e2e.sh --skip-infra-start
#   bash scripts/local-aisha-e2e.sh --skip-warmup
#   bash scripts/local-aisha-e2e.sh --skip-integration
#   bash scripts/local-aisha-e2e.sh --compare
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORTS_DIR="$PROJECT_ROOT/docs/reports"
mkdir -p "$REPORTS_DIR"

START_TS="$(date +%s)"
START_HUMAN="$(date '+%Y-%m-%d %H:%M:%S')"
REPORT_FILE="$REPORTS_DIR/aisha-local-e2e-$(date +%Y%m%dT%H%M%S).md"
REPORT_LATEST="$REPORTS_DIR/aisha-local-e2e-latest.md"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err() { echo -e "${RED}[ERR]${NC} $*"; }

SKIP_INFRA_START=false
SKIP_WARMUP=false
SKIP_CHAT=false
SKIP_INTEGRATION=false
COMPARE=false
STRICT_WARMUP=false
MODEL_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL_OVERRIDE="${2:-}"
      shift 2
      ;;
    --skip-infra-start)
      SKIP_INFRA_START=true
      shift
      ;;
    --skip-warmup)
      SKIP_WARMUP=true
      shift
      ;;
    --skip-chat)
      SKIP_CHAT=true
      shift
      ;;
    --skip-integration)
      SKIP_INTEGRATION=true
      shift
      ;;
    --compare)
      COMPARE=true
      shift
      ;;
    --strict-warmup)
      STRICT_WARMUP=true
      shift
      ;;
    -h|--help)
      sed -n '1,30p' "$0"
      exit 0
      ;;
    *)
      log_err "Unknown option: $1"
      exit 1
      ;;
  esac
done

cd "$PROJECT_ROOT"

STEP_NAMES=()
STEP_STATUS=()
STEP_DURATION=()
EXIT_CODE=0

record_step() {
  local name="$1"
  local status="$2"
  local seconds="$3"
  STEP_NAMES+=("$name")
  STEP_STATUS+=("$status")
  STEP_DURATION+=("$seconds")
}

run_required_step() {
  local name="$1"
  shift
  local step_start="$(date +%s)"
  log_info "$name"
  if "$@"; then
    local elapsed=$(( $(date +%s) - step_start ))
    record_step "$name" "PASS" "$elapsed"
    log_ok "$name (${elapsed}s)"
    return 0
  fi

  local elapsed=$(( $(date +%s) - step_start ))
  record_step "$name" "FAIL" "$elapsed"
  log_err "$name (${elapsed}s)"
  EXIT_CODE=1
  return 1
}

write_report() {
  local end_ts="$(date +%s)"
  local total=$(( end_ts - START_TS ))

  {
    echo "# AISHA Local E2E Report"
    echo
    echo "- Started: ${START_HUMAN}"
    echo "- Duration: ${total}s"
    echo "- Exit code: ${EXIT_CODE}"
    echo "- Selected model: ${SELECTED_MODEL:-n/a}"
    echo "- Selected backend: ${SELECTED_BACKEND:-n/a}"
    echo
    echo "## Steps"
    for i in "${!STEP_NAMES[@]}"; do
      echo "- ${STEP_STATUS[$i]} | ${STEP_NAMES[$i]} | ${STEP_DURATION[$i]}s"
    done
  } > "$REPORT_FILE"

  cp "$REPORT_FILE" "$REPORT_LATEST"
}

trap write_report EXIT

print_banner() {
  echo
  echo -e "${CYAN}${BOLD}==============================================${NC}"
  echo -e "${CYAN}${BOLD} AISHA Local E2E Orchestrator${NC}"
  echo -e "${CYAN}${BOLD}==============================================${NC}"
  echo
}

preflight_backends() {
  local status_json
  status_json="$(bash scripts/ai/status.sh --json)"

  local pick
  pick="$(python3 - <<'PY' <<<"$status_json"
import json
import sys

def first_model(info):
    models = info.get("models") or []
    return models[0] if models else ""

def to_router_model(name, raw_model):
    if name == "mlx":
        return "local-mlx"
    if not raw_model:
        return ""
    base = raw_model.split(":", 1)[0]
    return f"{name}-{base}"

payload = json.load(sys.stdin)
backends = payload.get("backends", {})

running = []
for backend_name in ("ollama", "docker", "mlx"):
    info = backends.get(backend_name, {})
    if info.get("running"):
        running.append((backend_name, info))

if not running:
    print("none|||0")
    sys.exit(0)

selected_name = ""
selected_info = None
for preferred in ("ollama", "docker", "mlx"):
    for candidate_name, candidate_info in running:
        if candidate_name == preferred:
            selected_name = candidate_name
            selected_info = candidate_info
            break
    if selected_info is not None:
        break

raw_model = first_model(selected_info or {})
router_model = to_router_model(selected_name, raw_model)
available_count = len(running)
print(f"{selected_name}|{router_model}|{raw_model}|{available_count}")
PY
)"

  IFS='|' read -r SELECTED_BACKEND SELECTED_MODEL SELECTED_RAW_MODEL AVAILABLE_BACKENDS <<< "$pick"

  if [[ "$AVAILABLE_BACKENDS" == "0" ]]; then
    log_err "No local LLM backend is running."
    log_info "Run one of: npm run ollama:serve:bg | npm run mlx:serve:bg | npm run docker:ai:setup"
    return 1
  fi

  if [[ -n "$MODEL_OVERRIDE" ]]; then
    SELECTED_MODEL="$MODEL_OVERRIDE"
  fi

  if [[ -z "$SELECTED_MODEL" ]]; then
    log_err "Could not determine model from running backends. Use --model explicitly."
    return 1
  fi

  log_ok "Detected $AVAILABLE_BACKENDS backend(s); selected model: $SELECTED_MODEL"
  return 0
}

warmup_backend() {
  if $SKIP_WARMUP; then
    log_warn "Warmup skipped (--skip-warmup)"
    return 0
  fi

  local warmup_ok=true
  case "$SELECTED_BACKEND" in
    ollama)
      if [[ -n "${SELECTED_RAW_MODEL:-}" ]]; then
        curl -fsS "http://localhost:11434/api/generate" \
          -H "Content-Type: application/json" \
          -d "{\"model\":\"${SELECTED_RAW_MODEL}\",\"prompt\":\"ping\",\"stream\":false}" \
          >/dev/null
      else
        warmup_ok=false
      fi
      ;;
    mlx)
      if [[ -n "${SELECTED_RAW_MODEL:-}" ]]; then
        curl -fsS "http://localhost:8100/v1/chat/completions" \
          -H "Content-Type: application/json" \
          -d "{\"model\":\"${SELECTED_RAW_MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":8}" \
          >/dev/null
      else
        warmup_ok=false
      fi
      ;;
    docker)
      if [[ -n "${SELECTED_RAW_MODEL:-}" ]]; then
        curl -fsS "http://localhost:12434/engines/v1/chat/completions" \
          -H "Content-Type: application/json" \
          -d "{\"model\":\"${SELECTED_RAW_MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":8}" \
          >/dev/null
      else
        warmup_ok=false
      fi
      ;;
    *)
      warmup_ok=false
      ;;
  esac

  if $warmup_ok; then
    log_ok "Backend warmup finished"
    return 0
  fi

  log_warn "Warmup failed or unsupported for backend '${SELECTED_BACKEND}'."
  if $STRICT_WARMUP; then
    return 1
  fi
  log_warn "Continuing because strict warmup is disabled."
  return 0
}

run_chat_suite() {
  if $SKIP_CHAT; then
    log_warn "Chat suite skipped (--skip-chat)"
    return 0
  fi

  if $COMPARE; then
    npm run aisha:chat:test:local -- --model "$SELECTED_MODEL" --compare
  else
    npm run aisha:chat:test:local -- --model "$SELECTED_MODEL"
  fi
}

run_integration_suite() {
  if $SKIP_INTEGRATION; then
    log_warn "Integration suite skipped (--skip-integration)"
    return 0
  fi

  npm run aisha:integration:local
}

print_banner

if ! $SKIP_INFRA_START; then
  run_required_step "Start local infra" npm run infra:up:min || exit 1
else
  log_warn "Infra start skipped (--skip-infra-start)"
fi

run_required_step "Preflight local LLM backends" preflight_backends || exit 1
run_required_step "Warmup selected backend" warmup_backend || exit 1
run_required_step "AISHA chat behavioral test (local)" run_chat_suite || exit 1
run_required_step "AISHA integration pipeline (local)" run_integration_suite || exit 1

log_ok "Local AISHA E2E finished successfully"
log_info "Report: $REPORT_FILE"

exit 0

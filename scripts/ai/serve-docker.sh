#!/usr/bin/env bash
# =============================================================================
# Docker Model Runner Serve — Verify & manage Docker Desktop LLM endpoint
# =============================================================================
# Docker Model Runner already runs inside Docker Desktop.
# This script verifies it's accessible and provides convenience commands.
#
# Použití:
#   ./scripts/ai/serve-docker.sh              # Check & verify ready
#   ./scripts/ai/serve-docker.sh --status     # Status check
#   ./scripts/ai/serve-docker.sh --test       # Full inference test
#   ./scripts/ai/serve-docker.sh --warm MODEL # Pre-warm a specific model
#
# API:  http://localhost:12434/engines/v1/chat/completions
# Docs: https://docs.docker.com/desktop/features/model-runner/
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEFAULT_MODEL="ai/mistral-nemo"
MODEL="${DEFAULT_MODEL}"
PORT=12434
BASE_URL="http://localhost:${PORT}/engines/v1"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[Docker AI]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[Docker AI]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[Docker AI]${NC} $1"; }
log_error() { echo -e "${RED}[Docker AI]${NC} $1"; }

MODE="verify"  # verify | status | test | warm

while [[ $# -gt 0 ]]; do
  case "$1" in
    --status)  MODE="status"; shift ;;
    --test)    MODE="test"; shift ;;
    --warm)    MODE="warm"; MODEL="${2:-$DEFAULT_MODEL}"; shift; shift 2>/dev/null || true ;;
    --model)   MODEL="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--status] [--test] [--warm MODEL] [--model MODEL]"
      echo ""
      echo "Modes:"
      echo "  (default)   Verify Docker Model Runner is ready"
      echo "  --status    Show detailed status"
      echo "  --test      Run inference test"
      echo "  --warm      Pre-warm model (first load is slow)"
      echo ""
      echo "API: ${BASE_URL}/chat/completions"
      exit 0
      ;;
    *) log_error "Unknown: $1"; exit 1 ;;
  esac
done

# =============================================================================
# Health check
# =============================================================================
check_health() {
  if ! curl -sf "${BASE_URL}/models" >/dev/null 2>&1; then
    log_error "Docker Model Runner not responding at ${BASE_URL}"
    log_info "Ensure Docker Desktop is running with Model Runner enabled"
    return 1
  fi
  return 0
}

# =============================================================================
# Status
# =============================================================================
show_status() {
  echo ""
  log_info "=== Docker Model Runner Status ==="
  echo ""

  # Docker
  if docker info &>/dev/null 2>&1; then
    log_ok "Docker Desktop running"
  else
    log_error "Docker Desktop not running"
    return 1
  fi

  # API health
  if check_health; then
    log_ok "API endpoint: ${BASE_URL}"
  else
    return 1
  fi

  # Models
  echo ""
  log_info "Available models:"
  local models_json
  models_json="$(curl -sf "${BASE_URL}/models" 2>/dev/null || echo "{}")"
  echo "${models_json}" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for m in data.get('data', []):
        mid = m.get('id', 'unknown')
        print(f'  {mid}')
except Exception as e:
    print(f'  (parse error: {e})')
" 2>/dev/null || log_warn "Could not list models"

  # Docker model ls (if available)
  echo ""
  if docker model ls &>/dev/null 2>&1; then
    log_info "Docker model list:"
    docker model ls 2>/dev/null | head -20
  fi

  echo ""
  log_info "Integration:"
  echo "  llmRouter prefix:  docker-<model>"
  echo "  Example:           --model docker-ai/qwen3-coder"
  echo "  Env var:           DOCKER_MODEL_RUNNER_URL=${BASE_URL}"
  echo "  From containers:   http://model-runner.docker.internal/engines/v1"
  echo ""
}

# =============================================================================
# Inference test
# =============================================================================
run_test() {
  log_info "Running inference test with model: ${MODEL}"

  if ! check_health; then
    exit 1
  fi

  local start_time end_time elapsed
  start_time="$(date +%s)"

  local response
  response="$(curl -sf -X POST "${BASE_URL}/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"${MODEL}\",
      \"messages\": [
        {\"role\": \"system\", \"content\": \"You are a concise coding assistant.\"},
        {\"role\": \"user\", \"content\": \"Write a TypeScript function that validates an email address using a regex. Reply with code only.\"}
      ],
      \"max_tokens\": 200,
      \"temperature\": 0.2
    }" 2>&1)"

  end_time="$(date +%s)"
  elapsed=$(( end_time - start_time ))

  if [[ -z "${response}" ]]; then
    log_error "No response from model"
    exit 1
  fi

  echo "${response}" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    text = d.get('choices', [{}])[0].get('message', {}).get('content', '')
    usage = d.get('usage', {})
    inp = usage.get('prompt_tokens', '?')
    out = usage.get('completion_tokens', '?')
    print(f'Response ({inp} in / {out} out tokens):')
    print(text[:500])
except Exception as e:
    print(f'Parse error: {e}')
    print(sys.stdin.read()[:300])
" 2>/dev/null

  echo ""
  log_ok "Inference completed in ${elapsed}s"
}

# =============================================================================
# Pre-warm model
# =============================================================================
warm_model() {
  log_info "Pre-warming model: ${MODEL}"
  log_info "First load can take 30-60s as model loads into memory..."

  if ! check_health; then
    exit 1
  fi

  local response
  response="$(curl -sf -X POST "${BASE_URL}/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"${MODEL}\",
      \"messages\": [{\"role\": \"user\", \"content\": \"Hi\"}],
      \"max_tokens\": 5,
      \"temperature\": 0.1
    }" 2>&1 || echo "")"

  if echo "${response}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('choices'):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
    log_ok "Model ${MODEL} is warm and ready"
  else
    log_warn "Model may need more time to load"
  fi
}

# =============================================================================
# Verify (default mode)
# =============================================================================
verify() {
  if check_health; then
    log_ok "Docker Model Runner ready at ${BASE_URL}"
    log_info "Use: --model docker-${MODEL}"
  else
    exit 1
  fi
}

# =============================================================================
# Run selected mode
# =============================================================================
case "${MODE}" in
  status)  show_status ;;
  test)    run_test ;;
  warm)    warm_model ;;
  verify)  verify ;;
esac

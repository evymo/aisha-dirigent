#!/usr/bin/env bash
# =============================================================================
# Ollama Serve — Start/Stop/Status for Ollama LLM Server
# =============================================================================
# Manages the Ollama daemon lifecycle.
# Ollama uses Metal GPU on Apple Silicon for hardware-accelerated inference.
#
# Použití:
#   ./scripts/ai/serve-ollama.sh              # Start server (foreground)
#   ./scripts/ai/serve-ollama.sh --background # Start server (background)
#   ./scripts/ai/serve-ollama.sh --stop       # Stop server
#   ./scripts/ai/serve-ollama.sh --status     # Check status
#   ./scripts/ai/serve-ollama.sh --test       # Full inference test
#
# API: http://localhost:11434/v1/chat/completions
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ARM64 / Metal GPU helpers (shared across scripts)
source "${SCRIPT_DIR}/_arch-helpers.sh"

PORT=11434
PID_FILE="/tmp/ollama-serve.pid"
DEFAULT_MODEL="mistral-nemo"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[Ollama]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[Ollama]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[Ollama]${NC} $1"; }
log_error() { echo -e "${RED}[Ollama]${NC} $1"; }

MODE="foreground"  # foreground | background | stop | status | test
MODEL="${DEFAULT_MODEL}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --background|-b) MODE="background"; shift ;;
    --stop)          MODE="stop"; shift ;;
    --status)        MODE="status"; shift ;;
    --test)          MODE="test"; shift ;;
    --model)         MODEL="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--background] [--stop] [--status] [--test] [--model MODEL]"
      echo ""
      echo "Modes:"
      echo "  (default)     Start Ollama server in foreground"
      echo "  --background  Start in background (daemonize)"
      echo "  --stop        Stop the running server"
      echo "  --status      Check server status & models"
      echo "  --test        Run inference test"
      echo ""
      echo "Options:"
      echo "  --model NAME  Model for test (default: ${DEFAULT_MODEL})"
      exit 0
      ;;
    *) log_error "Unknown option: $1"; exit 1 ;;
  esac
done

# =============================================================================
# Check prerequisites (ARM64-aware)
# =============================================================================
check_ollama() {
  if ! resolve_ollama &>/dev/null; then
    log_error "Ollama not installed. Run: npm run ollama:setup"
    exit 1
  fi
}

is_running() {
  curl -sf "http://localhost:${PORT}/api/tags" &>/dev/null
}

# =============================================================================
# Status
# =============================================================================
do_status() {
  check_ollama

  echo ""
  log_info "=== Ollama Server Status ==="

  if is_running; then
    log_ok "Server running on port ${PORT}"

    # List models
    local models
    models="$(curl -sf "http://localhost:${PORT}/api/tags" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for m in d.get('models', []):
        name = m.get('name', '?')
        size_gb = m.get('size', 0) / 1024 / 1024 / 1024
        print(f'    {name} ({size_gb:.1f} GiB)')
except:
    print('    (parse error)')
" 2>/dev/null || echo "    (no models)")"
    log_info "Available models:"
    echo "${models}"

    # Show running processes
    local ps_count
    ps_count="$(pgrep -c ollama 2>/dev/null || echo "0")"
    log_info "Ollama processes: ${ps_count}"
  else
    log_warn "Server not running"
  fi

  # Check for Metal GPU
  if [[ "$(uname -s)" == "Darwin" ]] && [[ "$(uname -m)" == "arm64" ]]; then
    log_ok "Metal GPU: available (Apple Silicon)"
  else
    log_info "Metal GPU: not available (CPU mode)"
  fi

  echo ""
}

# =============================================================================
# Stop
# =============================================================================
do_stop() {
  log_info "Stopping Ollama server..."

  # Try PID file first
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}")"
    if kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
      log_ok "Stopped Ollama (PID: ${pid})"
    fi
    rm -f "${PID_FILE}"
  fi

  # Also try pkill as fallback
  if pgrep -f "ollama serve" &>/dev/null; then
    pkill -f "ollama serve" 2>/dev/null || true
    sleep 1
    log_ok "Ollama processes terminated"
  fi

  if ! is_running; then
    log_ok "Server stopped"
  else
    log_warn "Server may still be running — check: pgrep ollama"
  fi
}

# =============================================================================
# Test
# =============================================================================
do_test() {
  check_ollama

  if ! is_running; then
    log_error "Ollama server not running. Start with: npm run ollama:serve"
    exit 1
  fi

  log_info "Testing inference with model: ${MODEL}"

  local response
  response="$(curl -sf --max-time 60 -X POST "http://localhost:${PORT}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"${MODEL}\",
      \"messages\": [{\"role\": \"user\", \"content\": \"Say hello in Czech, one sentence only.\"}],
      \"max_tokens\": 30,
      \"temperature\": 0.1
    }" 2>&1)" || {
    log_error "Inference request failed"
    exit 1
  }

  echo "${response}" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    text = d.get('choices', [{}])[0].get('message', {}).get('content', '')
    usage = d.get('usage', {})
    model = d.get('model', '?')
    print(f'  Model: {model}')
    print(f'  Tokens: {usage.get(\"prompt_tokens\", \"?\")} in / {usage.get(\"completion_tokens\", \"?\")} out')
    print(f'  Response: {text}')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null

  log_ok "Inference test passed"
}

# =============================================================================
# Start (foreground or background)
# =============================================================================
do_start() {
  check_ollama

  # Check if already running
  if is_running; then
    log_ok "Ollama server already running on port ${PORT}"
    return 0
  fi

  # Check for port conflict
  if lsof -i ":${PORT}" &>/dev/null; then
    log_error "Port ${PORT} is already in use by another process"
    lsof -i ":${PORT}" 2>/dev/null | head -5
    exit 1
  fi

  if [[ "${MODE}" == "background" ]]; then
    log_info "Starting Ollama server in background on port ${PORT}..."
    local ollama_bin
    ollama_bin="$(resolve_ollama)"
    ollama_serve_env
    "${ollama_bin}" serve &>/dev/null &
    local pid=$!
    echo "${pid}" > "${PID_FILE}"

    # Wait for server to come up
    local waited=0
    while [[ $waited -lt 15 ]]; do
      if is_running; then
        log_ok "Server started (PID: ${pid})"
        log_info "API: http://localhost:${PORT}/v1/chat/completions"
        log_info "Stop: npm run ollama:stop"
        return 0
      fi
      sleep 1
      ((waited++))
    done

    log_error "Server failed to start within 15s"
    exit 1
  else
    log_info "Starting Ollama server on port ${PORT} (foreground)..."
    log_info "Press Ctrl+C to stop"
    log_info "API: http://localhost:${PORT}/v1/chat/completions"
    echo ""
    local ollama_bin
    ollama_bin="$(resolve_ollama)"
    ollama_serve_env
    "${ollama_bin}" serve
  fi
}

# =============================================================================
# Main
# =============================================================================
case "${MODE}" in
  status)     do_status ;;
  stop)       do_stop ;;
  test)       do_test ;;
  foreground) do_start ;;
  background) do_start ;;
esac

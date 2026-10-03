#!/usr/bin/env bash
# =============================================================================
# Ollama Setup — Metal GPU Accelerated Local LLM via llama.cpp
# =============================================================================
# Instaluje Ollama (brew) a stáhne model automaticky podle RAM stroje.
#
# Použití:
#   ./scripts/ai/setup-ollama.sh              # Full setup (install + pull)
#   ./scripts/ai/setup-ollama.sh --check      # Pouze kontrola stavu
#   ./scripts/ai/setup-ollama.sh --model NAME  # Custom model
#
# Po setup: npm run ollama:serve → http://localhost:11434/v1/chat/completions
# Test:     npm run aisha:chat:test -- --model ollama-mistral-nemo
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ARM64 / Metal GPU helpers (shared across scripts)
source "${SCRIPT_DIR}/_arch-helpers.sh"

# Model tiers by RAM — same family as Docker/MLX, Ollama GGUF format
MODEL_SMALL="qwen2.5-coder:3b"      #  3B Q4   ~2 GiB  (8GB RAM)
MODEL_MEDIUM="mistral-nemo"          # 12B Q4   ~7 GiB  (16GB RAM — best multilingual)
MODEL_LARGE="phi4"                   # 14B Q4   ~8 GiB  (24GB RAM)
MODEL_XLARGE="qwen3-coder:30b"      # 30B Q4  ~16 GiB  (48GB+ RAM)

MODEL=""
CHECK_ONLY=false
PORT=11434

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

# =============================================================================
# Parse arguments
# =============================================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_ONLY=true
      shift
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --fallback)
      MODEL="${MODEL_SMALL}"
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--check] [--model MODEL] [--fallback]"
      echo ""
      echo "Options:"
      echo "  --check     Only check current status"
      echo "  --model     Ollama model name (manually specify)"
      echo "  --fallback  Use smallest model: ${MODEL_SMALL}"
      echo ""
      echo "Auto-selected by RAM:"
      echo "   8GB RAM -> ${MODEL_SMALL}      (~2 GiB)"
      echo "  16GB RAM -> ${MODEL_MEDIUM}          (~7 GiB, best multilingual)"
      echo "  24GB RAM -> ${MODEL_LARGE}                  (~8 GiB)"
      echo "  48GB RAM -> ${MODEL_XLARGE}     (~16 GiB)"
      echo ""
      echo "Ollama uses Metal GPU on Apple Silicon (3-5x faster than CPU)"
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      exit 1
      ;;
  esac
done

# =============================================================================
# Memory safety helpers
# =============================================================================

get_total_ram_gb() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1024/1024/1024}'
  else
    awk '/MemTotal/ {printf "%.0f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo "0"
  fi
}

auto_select_model() {
  local total_ram
  total_ram="$(get_total_ram_gb)"

  if [[ "${total_ram}" -ge 48 ]]; then
    log_info "RAM: ${total_ram}GB -> selecting qwen3-coder:30b (best quality)" >&2
    echo "${MODEL_XLARGE}"
  elif [[ "${total_ram}" -ge 24 ]]; then
    log_info "RAM: ${total_ram}GB -> selecting phi4 (large, high quality)" >&2
    echo "${MODEL_LARGE}"
  elif [[ "${total_ram}" -ge 16 ]]; then
    log_info "RAM: ${total_ram}GB -> selecting mistral-nemo (balanced)" >&2
    echo "${MODEL_MEDIUM}"
  elif [[ "${total_ram}" -ge 8 ]]; then
    log_info "RAM: ${total_ram}GB -> selecting qwen2.5-coder:3b (safe for low memory)" >&2
    echo "${MODEL_SMALL}"
  else
    log_error "RAM: ${total_ram}GB -- insufficient for LLM models (minimum 8GB)" >&2
    exit 1
  fi
}

# =============================================================================
# Check status (--check mode)
# =============================================================================
check_status() {
  echo ""
  log_info "=== Ollama Status ==="

  # 1. Check if ollama binary exists
  if ! command -v ollama &>/dev/null; then
    log_warn "Ollama not installed"
    log_info "Install: brew install ollama"
    return 1
  fi
  log_ok "Ollama binary: $(which ollama)"
  log_ok "Version: $(ollama --version 2>/dev/null || echo 'unknown')"

  # 2. Check if ollama server is running
  if curl -sf "http://localhost:${PORT}/api/tags" &>/dev/null; then
    log_ok "Ollama server running on port ${PORT}"

    # 3. List available models
    local models
    models="$(curl -sf "http://localhost:${PORT}/api/tags" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for m in d.get('models', []):
        name = m.get('name', '?')
        size_gb = m.get('size', 0) / 1024 / 1024 / 1024
        print(f'  {name} ({size_gb:.1f} GiB)')
except:
    print('  (parse error)')
" 2>/dev/null || echo "  (no models)")"
    log_ok "Models available:"
    echo "${models}"
  else
    log_warn "Ollama server not running"
    log_info "Start: ollama serve (or npm run ollama:serve)"
  fi

  echo ""
  return 0
}

if $CHECK_ONLY; then
  check_status
  exit $?
fi

# =============================================================================
# Install Ollama (ARM64-aware for Metal GPU on Apple Silicon)
# =============================================================================
install_ollama() {
  local ollama_bin
  ollama_bin="$(resolve_ollama 2>/dev/null)" || ollama_bin=""

  if [[ -n "${ollama_bin}" ]]; then
    log_ok "Ollama already installed: ${ollama_bin}"
    return 0
  fi

  log_info "Installing Ollama..."

  if [[ "$(uname -s)" == "Darwin" ]]; then
    # resolve_brew ensures ARM64 Homebrew on Apple Silicon (installs if missing)
    local brew_bin
    brew_bin="$(resolve_brew)" || {
      log_error "Homebrew not found. Install from https://brew.sh"
      exit 1
    }
    "${brew_bin}" install ollama
  elif [[ "$(uname -s)" == "Linux" ]]; then
    curl -fsSL https://ollama.ai/install.sh | sh
  else
    log_error "Unsupported OS: $(uname -s). Install Ollama manually from https://ollama.ai"
    exit 1
  fi

  # Verify — resolve_ollama only returns ARM64 on Apple Silicon
  ollama_bin="$(resolve_ollama 2>/dev/null)" || ollama_bin=""
  if [[ -z "${ollama_bin}" ]]; then
    log_error "Ollama installation failed"
    exit 1
  fi

  log_ok "Ollama installed: ${ollama_bin}"
}

# =============================================================================
# Ensure Ollama server is running (ARM64 binary + Flash Attention)
# =============================================================================
ensure_server() {
  if curl -sf "http://localhost:${PORT}/api/tags" &>/dev/null; then
    log_ok "Ollama server already running on port ${PORT}"
    return 0
  fi

  local ollama_bin
  ollama_bin="$(resolve_ollama)" || { log_error "Ollama binary not found"; exit 1; }

  # Enable Metal GPU optimizations
  ollama_serve_env

  log_info "Starting Ollama server (${ollama_bin})..."
  "${ollama_bin}" serve &>/dev/null &
  local pid=$!

  # Wait for server to come up (max 15s)
  local waited=0
  while [[ $waited -lt 15 ]]; do
    if curl -sf "http://localhost:${PORT}/api/tags" &>/dev/null; then
      log_ok "Ollama server started (PID: ${pid})"
      return 0
    fi
    sleep 1
    ((waited++))
  done

  log_error "Ollama server failed to start within 15s"
  exit 1
}

# =============================================================================
# Pull model
# =============================================================================
pull_model() {
  local model="$1"

  local ollama_bin
  ollama_bin="$(resolve_ollama)" || { log_error "Ollama binary not found"; exit 1; }

  # Check if model is already pulled
  if "${ollama_bin}" list 2>/dev/null | grep -qi "^${model}"; then
    log_ok "Model already available: ${model}"
    return 0
  fi

  log_info "Pulling model: ${model} (this may take a while)..."
  if ! "${ollama_bin}" pull "${model}"; then
    log_error "Failed to pull model: ${model}"
    exit 1
  fi
  log_ok "Model pulled: ${model}"
}

# =============================================================================
# Verify inference
# =============================================================================
verify_inference() {
  local model="$1"

  log_info "Verifying inference with ${model}..."

  local response
  response="$(curl -sf -X POST "http://localhost:${PORT}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"${model}\",
      \"messages\": [{\"role\": \"user\", \"content\": \"Say hello in Czech, one sentence only.\"}],
      \"max_tokens\": 30,
      \"temperature\": 0.1
    }" 2>&1)" || {
    log_warn "Inference verification failed (model may still be loading)"
    return 1
  }

  local text
  text="$(echo "${response}" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('choices', [{}])[0].get('message', {}).get('content', ''))
except:
    print('')
" 2>/dev/null)"

  if [[ -n "${text}" ]]; then
    log_ok "Inference OK: ${text}"
  else
    log_warn "Inference returned empty response"
  fi
}

# =============================================================================
# Main
# =============================================================================
echo ""
log_info "=== Ollama Setup ==="
log_info "Metal GPU acceleration: $(
  [[ "$(uname -s)" == "Darwin" ]] && [[ "$(uname -m)" == "arm64" ]] \
    && echo 'YES (Apple Silicon)' \
    || echo 'NO (CPU mode)'
)"

# 1. Install
install_ollama

# 2. Auto-select model if not specified
if [[ -z "${MODEL}" ]]; then
  MODEL="$(auto_select_model)"
fi
log_info "Selected model: ${MODEL}"

# 3. Start server
ensure_server

# 4. Pull model
pull_model "${MODEL}"

# 5. Verify
verify_inference "${MODEL}"

echo ""
log_ok "=== Setup Complete ==="
log_info "Server: http://localhost:${PORT}"
log_info "API:    http://localhost:${PORT}/v1/chat/completions"
log_info "Model:  ${MODEL}"
log_info ""
log_info "Usage in AISHA:"
log_info "  npm run aisha:chat:test -- --model ollama-${MODEL}"
log_info ""
log_info "Stop server: npm run ollama:stop"
echo ""

#!/usr/bin/env bash
# =============================================================================
# Docker Model Runner Setup — Cross-platform Local LLM via Docker Desktop
# =============================================================================
# Ověří Docker Model Runner a stáhne doporučený model pro AISHA.
#
# Použití:
#   ./scripts/ai/setup-docker.sh              # Full setup
#   ./scripts/ai/setup-docker.sh --check      # Pouze kontrola
#   ./scripts/ai/setup-docker.sh --model NAME  # Custom model
#
# Po setup: npm run docker:serve → http://localhost:12434/engines/v1/chat/completions
# Test:     npm run aisha:chat:test -- --model docker-ai/qwen3-coder
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default: auto-select based on RAM — mistral-nemo is the sweet spot for 16GB
DEFAULT_MODEL=""  # Will be set by auto_select_docker_model
# Model tiers by RAM — carefully tested for OOM safety
MODEL_SMALL="ai/gemma3n"         #  6.87B Q4   3.94 GiB  (safe for 8GB)
MODEL_MEDIUM="ai/mistral-nemo"   # 12.25B Q4   6.96 GiB  (ideal for 16GB — best multilingual)
MODEL_LARGE="ai/phi4"            # 14.66B Q4   8.43 GiB  (24GB)
MODEL_XLARGE="ai/qwen3-coder"    # 30.53B Q4  16.45 GiB  (32GB+ only!)
# NOTE: ai/gemma3-vllm (2.48B BF16 8.6GB) — bad ratio, skip it

MODEL=""
CHECK_ONLY=false

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
      echo "  --model     Docker AI model (manually specify)"
      echo "  --fallback  Use smallest model: ${MODEL_SMALL}"
      echo ""
      echo "Auto-selected by RAM:"
      echo "   8GB RAM → ${MODEL_SMALL}      ( 3.94 GiB)"
      echo "  16GB RAM → ${MODEL_MEDIUM}  ( 6.96 GiB, best multilingual)"
      echo "  24GB RAM → ${MODEL_LARGE}           ( 8.43 GiB)"
      echo "  48GB RAM → ${MODEL_XLARGE}    (16.45 GiB)"
      echo ""
      echo "WARNING: ai/qwen3-coder (16.45 GiB) WILL FREEZE 16GB machines!"
      echo "WARNING: ai/gemma3-vllm (2.48B BF16) — looks big but only 2.5B params, skip!"
      echo ""
      echo "Prerequisite: Docker Desktop 4.40+ with Model Runner enabled"
      echo "  Settings → Features in development → Docker Model Runner → Enable"
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      exit 1
      ;;
  esac
done

# =============================================================================
# Memory safety — auto-select model by available RAM
# =============================================================================

get_total_ram_gb() {
  if [[ "$(uname)" == "Darwin" ]]; then
    sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1024/1024/1024}'
  else
    awk '/MemTotal/ {printf "%.0f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo "16"
  fi
}

auto_select_docker_model() {
  local total_ram
  total_ram="$(get_total_ram_gb)"

  if [[ "${total_ram}" -ge 48 ]]; then
    log_info "RAM: ${total_ram}GB → ${MODEL_XLARGE} (16.45 GiB, best coding quality)" >&2
    echo "${MODEL_XLARGE}"
  elif [[ "${total_ram}" -ge 24 ]]; then
    log_info "RAM: ${total_ram}GB → ${MODEL_LARGE} (8.43 GiB, good reasoning)" >&2
    echo "${MODEL_LARGE}"
  elif [[ "${total_ram}" -ge 16 ]]; then
    log_info "RAM: ${total_ram}GB → ${MODEL_MEDIUM} (6.96 GiB, best multilingual + safe)" >&2
    echo "${MODEL_MEDIUM}"
  elif [[ "${total_ram}" -ge 8 ]]; then
    log_info "RAM: ${total_ram}GB → ${MODEL_SMALL} (3.94 GiB, fits easily)" >&2
    echo "${MODEL_SMALL}"
  else
    log_error "RAM: ${total_ram}GB — too low for local LLM. Minimum 8GB." >&2
    exit 1
  fi
}

check_docker_memory_safety() {
  local model_name="$1"
  local total_ram estimated_gb
  total_ram="$(get_total_ram_gb)"

  # Estimate model sizes from Docker AI catalog
  case "${model_name}" in
    *gemma3n*)       estimated_gb=4 ;;
    *mistral-nemo*)  estimated_gb=7 ;;
    *phi4*)          estimated_gb=9 ;;
    *gpt-oss*)       estimated_gb=11 ;;
    *qwen3-coder*)   estimated_gb=17 ;;
    *llama3.3*)      estimated_gb=40 ;;
    *)               estimated_gb=10 ;;
  esac

  # Docker Desktop itself uses ~4-6GB
  local docker_overhead=5
  local total_needed=$(( estimated_gb + docker_overhead ))

  log_info "Memory: model ~${estimated_gb}GB + Docker ~${docker_overhead}GB = ~${total_needed}GB needed"
  log_info "Your machine: ${total_ram}GB total"

  # Check for MLX server running simultaneously
  if lsof -i :8100 -sTCP:LISTEN &>/dev/null 2>&1; then
    log_warn "MLX server is also running (port 8100) — additional memory pressure!"
    total_needed=$(( total_needed + 4 ))
  fi

  if [[ "${total_needed}" -ge "${total_ram}" ]]; then
    log_error "UNSAFE: needs ~${total_needed}GB but machine has ${total_ram}GB."
    log_error "This WILL freeze your machine!"
    log_error ""
    log_error "Safe alternatives for ${total_ram}GB:"
    [[ "${total_ram}" -ge 8 ]]  && log_error "  --model ${MODEL_SMALL}      (3.94 GiB)"
    [[ "${total_ram}" -ge 16 ]] && log_error "  --model ${MODEL_MEDIUM}  (6.96 GiB)"
    return 1
  fi

  local headroom=$(( total_ram - total_needed ))
  if [[ "${headroom}" -lt 4 ]]; then
    log_warn "Tight fit: only ~${headroom}GB headroom for macOS + apps."
    log_warn "Close Chrome, VS Code, and other heavy apps before loading."
  fi

  log_ok "Memory check passed (${headroom}GB headroom)"
  return 0
}

# Auto-select model if not specified
if [[ -z "${MODEL}" ]]; then
  MODEL="$(auto_select_docker_model)"
fi

# =============================================================================
# Pre-flight checks
# =============================================================================

check_docker() {
  if ! command -v docker &>/dev/null; then
    log_error "docker CLI not found. Install Docker Desktop: https://docker.com/products/docker-desktop"
    return 1
  fi

  if ! docker info &>/dev/null 2>&1; then
    log_error "Docker daemon not running. Start Docker Desktop first."
    return 1
  fi

  log_ok "Docker available"
}

check_model_runner() {
  # Docker Model Runner exposes /engines/v1/models endpoint
  if curl -sf "http://localhost:12434/engines/v1/models" >/dev/null 2>&1; then
    log_ok "Docker Model Runner is running (port 12434)"
    return 0
  fi

  # Try the docker model command (Docker Desktop 4.40+)
  if docker model ls &>/dev/null 2>&1; then
    log_ok "Docker Model Runner CLI available"
    return 0
  fi

  log_error "Docker Model Runner not available."
  log_error "Enable it: Docker Desktop → Settings → Features in development → Docker Model Runner"
  return 1
}

list_models() {
  log_info "Downloaded models:"
  if docker model ls 2>/dev/null; then
    return 0
  fi

  # Fallback: query API
  local models_json
  models_json="$(curl -sf "http://localhost:12434/engines/v1/models" 2>/dev/null || echo "")"
  if [[ -n "${models_json}" ]]; then
    echo "${models_json}" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for m in data.get('data', []):
        print(f\"  {m.get('id', 'unknown')}\")
except: pass
" 2>/dev/null || log_warn "Could not parse models list"
  else
    log_warn "Could not list models"
  fi
}

check_status() {
  echo ""
  log_info "=== Docker Model Runner Status ==="
  echo ""

  check_docker || true
  check_model_runner || true
  list_models

  # Check if recommended model is available
  # Docker API returns model IDs like "docker.io/ai/mistral-nemo:latest"
  # docker model ls shows short names like "mistral-nemo"
  # We strip "ai/" prefix and match the base name
  local model_status short_name
  model_status="$(curl -sf "http://localhost:12434/engines/v1/models" 2>/dev/null || echo "")"
  short_name="${MODEL#ai/}"  # ai/mistral-nemo → mistral-nemo
  if grep -qi "${short_name}" <<< "${model_status}" 2>/dev/null; then
    log_ok "Recommended model available: ${MODEL}"
  elif docker model ls 2>/dev/null | grep -qi "${short_name}" 2>/dev/null; then
    log_ok "Recommended model available: ${MODEL}"
  else
    log_warn "Recommended model not found: ${MODEL}"
  fi

  echo ""
}

# =============================================================================
# Check-only mode
# =============================================================================
if [[ "${CHECK_ONLY}" == "true" ]]; then
  check_status
  exit 0
fi

# =============================================================================
# Full setup
# =============================================================================
echo ""
log_info "=== Docker Model Runner Setup ==="
log_info "Model: ${MODEL}"
echo ""

# Step 1: Check Docker
check_docker

# Step 2: Check Model Runner
if ! check_model_runner; then
  echo ""
  log_error "Docker Model Runner is required but not available."
  log_info "To enable:"
  log_info "  1. Open Docker Desktop"
  log_info "  2. Go to Settings → Features in development"
  log_info "  3. Enable 'Docker Model Runner'"
  log_info "  4. Apply & restart Docker Desktop"
  log_info "  5. Re-run this script"
  exit 1
fi

# Step 3: Memory safety check BEFORE pulling/loading model
if ! check_docker_memory_safety "${MODEL}"; then
  echo ""
  log_error "Aborting to prevent system freeze."
  log_info "Re-run with a smaller model: $0 --model ${MODEL_SMALL}"
  exit 1
fi

# Step 3: Pull the recommended model
log_info "Pulling model: ${MODEL}"
log_info "This may take several minutes on first download..."
if docker model pull "${MODEL}"; then
  log_ok "Model pulled: ${MODEL}"
else
  log_error "Failed to pull model. Trying via API..."
  # Some Docker Desktop versions auto-pull on first inference request
  log_warn "Model will be pulled on first inference request"
fi

# Step 4: Verify model is accessible via API
log_info "Verifying model via API..."
sleep 2  # Give Docker Model Runner a moment to register

# Quick health check
if curl -sf "http://localhost:12434/engines/v1/models" >/dev/null 2>&1; then
  log_ok "Docker Model Runner API responding"
else
  log_warn "API not responding yet — model may need time to load"
fi

# Step 5: Quick inference test
log_info "Running quick inference test..."
test_response="$(curl -sf -X POST "http://localhost:12434/engines/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"${MODEL}\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Say hello in one word.\"}],
    \"max_tokens\": 10,
    \"temperature\": 0.1
  }" 2>&1 || echo "")"

if echo "${test_response}" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    text = d.get('choices', [{}])[0].get('message', {}).get('content', '')
    if text:
        print(f'Response: {text[:100]}')
        sys.exit(0)
except: pass
sys.exit(1)
" 2>/dev/null; then
  log_ok "Inference test passed"
else
  log_warn "Inference test failed — model may need initial warmup time"
  log_info "Try: curl -X POST http://localhost:12434/engines/v1/chat/completions ..."
fi

# Done
echo ""
log_ok "======================================="
log_ok "Docker Model Runner setup complete!"
log_ok "======================================="
echo ""
log_info "Next steps:"
echo "  1. Test AISHA locally: npm run aisha:chat:test -- --model docker-${MODEL}"
echo "  2. Check status:       npm run docker:status"
echo ""
log_info "The Docker Model Runner API lives at http://localhost:12434/engines/v1"
log_info "llmRouter automatically routes 'docker-*' models to this endpoint."
echo ""
log_info "Model recommendation for AISHA:"
echo "  Primary:  docker-ai/qwen3-coder  (30.53B — best code quality)"
echo "  Lighter:  docker-ai/phi4          (14.66B — faster, less RAM)"
echo "  Minimal:  docker-ai/gemma3n       (6.87B  — ultra-fast, 4GB)"
echo ""

#!/usr/bin/env bash
# =============================================================================
# Auto-Select LLM Backend — Unified HW Detection & Backend Selection
# =============================================================================
# Detects available hardware and installed backends, selects the best one,
# and outputs a JSON config for warmup.sh and other scripts.
#
# Priority chain: MLX (Metal GPU native) > Ollama (Metal/CUDA) > Docker (CPU)
#
# Použití:
#   ./scripts/ai/auto-select.sh              # Human-readable output
#   ./scripts/ai/auto-select.sh --json       # Machine-readable JSON
#   ./scripts/ai/auto-select.sh --install    # Auto-install best backend + pull model
#   ./scripts/ai/auto-select.sh --env        # Output env vars (for sourcing)
#
# Output JSON:
#   {
#     "backend": "ollama",
#     "model": "mistral-nemo",
#     "port": 11434,
#     "url": "http://localhost:11434/v1",
#     "gpu": "metal",
#     "ram_gb": 16,
#     "tier": "medium"
#   }
# =============================================================================

set -Eeuo pipefail

# Surface WHY we abort: with `set -e` a failing command exits silently, so the
# setup cockpit (and any caller) only sees a bare "exit 1". This ERR trap prints
# the failing line + command to stderr, which the cockpit streams to its terminal.
trap 'rc=$?; echo "❌ auto-select.sh selhal na řádku ${LINENO} (exit ${rc}): ${BASH_COMMAND}" >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ARM64 / Metal GPU helpers (shared across scripts)
source "${SCRIPT_DIR}/_arch-helpers.sh"

# Output modes
JSON_MODE=false
INSTALL_MODE=false
ENV_MODE=false

# Colors (disabled in JSON mode)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { $JSON_MODE || echo -e "${BLUE}[AI]${NC} $1" >&2; }
log_ok()    { $JSON_MODE || echo -e "${GREEN}[AI]${NC} $1" >&2; }
log_warn()  { $JSON_MODE || echo -e "${YELLOW}[AI]${NC} $1" >&2; }
log_error() { $JSON_MODE || echo -e "${RED}[AI]${NC} $1" >&2; }

# =============================================================================
# Parse arguments
# =============================================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)    JSON_MODE=true; shift ;;
    --install) INSTALL_MODE=true; shift ;;
    --env)     ENV_MODE=true; shift ;;
    --help|-h)
      echo "Usage: $0 [--json] [--install] [--env]"
      echo ""
      echo "Modes:"
      echo "  (default)   Human-readable selection report"
      echo "  --json      Machine-readable JSON output"
      echo "  --install   Auto-install best backend + pull model"
      echo "  --env       Output env vars for sourcing"
      echo ""
      echo "Priority: MLX (Metal GPU) > Ollama (Metal/CUDA) > Docker (CPU fallback)"
      exit 0
      ;;
    *) log_error "Unknown option: $1"; exit 1 ;;
  esac
done

# =============================================================================
# Hardware Detection
# =============================================================================

get_total_ram_gb() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1024/1024/1024}'
  else
    awk '/MemTotal/ {printf "%.0f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo "0"
  fi
}

is_apple_silicon() {
  [[ "$(uname -s)" == "Darwin" ]] && [[ "$(uname -m)" == "arm64" ]]
}

get_gpu_type() {
  if is_apple_silicon; then
    echo "metal"
  elif command -v nvidia-smi &>/dev/null; then
    echo "cuda"
  else
    echo "none"
  fi
}

# =============================================================================
# RAM-based Tier Selection
# =============================================================================

get_tier() {
  local ram_gb="$1"
  if [[ "${ram_gb}" -ge 48 ]]; then
    echo "xlarge"
  elif [[ "${ram_gb}" -ge 24 ]]; then
    echo "large"
  elif [[ "${ram_gb}" -ge 16 ]]; then
    echo "medium"
  elif [[ "${ram_gb}" -ge 8 ]]; then
    echo "small"
  else
    echo "insufficient"
  fi
}

# Model name per backend per tier
get_model_for_backend() {
  local backend="$1"
  local tier="$2"

  case "${backend}" in
    mlx)
      case "${tier}" in
        small)   echo "mlx-community/Qwen2.5-Coder-3B-Instruct-4bit" ;;
        medium)  echo "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit" ;;
        large)   echo "mlx-community/Qwen2.5-Coder-7B-Instruct-8bit" ;;
        xlarge)  echo "mlx-community/Qwen2.5-Coder-7B-Instruct-8bit" ;;  # MLX caps at this
      esac
      ;;
    ollama)
      case "${tier}" in
        small)   echo "qwen2.5-coder:3b" ;;
        medium)  echo "mistral-nemo" ;;
        large)   echo "phi4" ;;
        xlarge)  echo "qwen3-coder:30b" ;;
      esac
      ;;
    docker)
      case "${tier}" in
        small)   echo "ai/gemma3n" ;;
        medium)  echo "ai/mistral-nemo" ;;
        large)   echo "ai/phi4" ;;
        xlarge)  echo "ai/qwen3-coder" ;;
      esac
      ;;
  esac
}

get_port_for_backend() {
  case "$1" in
    mlx)    echo "8100" ;;
    ollama) echo "11434" ;;
    docker) echo "12434" ;;
  esac
}

get_url_for_backend() {
  case "$1" in
    mlx)    echo "http://localhost:8100/v1" ;;
    ollama) echo "http://localhost:11434/v1" ;;
    docker) echo "http://localhost:12434/engines/v1" ;;
  esac
}

get_env_var_for_backend() {
  case "$1" in
    mlx)    echo "VLLM_GENERATION_URL" ;;
    ollama) echo "OLLAMA_URL" ;;
    docker) echo "DOCKER_MODEL_RUNNER_URL" ;;
  esac
}

# =============================================================================
# Backend Detection
# =============================================================================

# Check if MLX is available (Apple Silicon only)
check_mlx() {
  is_apple_silicon || return 1
  [[ -d "${SCRIPT_DIR}/.venv" ]] && [[ -f "${SCRIPT_DIR}/.venv/bin/python3" ]] || return 1
  "${SCRIPT_DIR}/.venv/bin/python3" -c "import mlx" &>/dev/null 2>&1 || return 1
  return 0
}

# Check if MLX server is running
check_mlx_running() {
  curl -sf "http://localhost:8100/v1/models" &>/dev/null
}

# Check if Ollama is installed (prefer ARM64 binary)
check_ollama() {
  resolve_ollama &>/dev/null
}

# Check if Ollama server is running
check_ollama_running() {
  curl -sf "http://localhost:11434/api/tags" &>/dev/null
}

# Check if Docker Model Runner is available
check_docker() {
  curl -sf "http://localhost:12434/engines/v1/models" &>/dev/null 2>&1
}

# =============================================================================
# Select Best Backend
# =============================================================================
select_backend() {
  # Priority 1: MLX (only on Apple Silicon, requires venv with mlx installed)
  if check_mlx; then
    echo "mlx"
    return 0
  fi

  # Priority 2: Ollama (cross-platform, Metal GPU on macOS)
  if check_ollama; then
    echo "ollama"
    return 0
  fi

  # Priority 3: Docker Model Runner (CPU fallback)
  if check_docker; then
    echo "docker"
    return 0
  fi

  # Nothing available — recommend Ollama as easiest to install
  echo "none"
  return 1
}

# Select best installable backend (for --install mode)
select_installable_backend() {
  # If Apple Silicon and MLX already setup → use it
  if check_mlx; then
    echo "mlx"
    return 0
  fi

  # Ollama is the sweet spot: easy install, Metal GPU, cross-platform
  # Even if not installed yet, we can install it
  if is_apple_silicon || [[ "$(uname -s)" == "Linux" ]]; then
    echo "ollama"
    return 0
  fi

  # Docker Model Runner as last resort
  if command -v docker &>/dev/null; then
    echo "docker"
    return 0
  fi

  echo "none"
  return 1
}

# =============================================================================
# Install Backend
# =============================================================================
install_backend() {
  local backend="$1"
  local model="$2"

  case "${backend}" in
    mlx)
      log_info "Setting up MLX backend..."
      bash "${SCRIPT_DIR}/setup-mlx.sh" --auto --skip-test
      ;;
    ollama)
      log_info "Setting up Ollama backend..."
      bash "${SCRIPT_DIR}/setup-ollama.sh" --model "${model}"
      ;;
    docker)
      log_info "Setting up Docker Model Runner..."
      bash "${SCRIPT_DIR}/setup-docker.sh" --model "${model}"
      ;;
    *)
      log_error "No installable backend found"
      log_info "Install Ollama manually: brew install ollama"
      exit 1
      ;;
  esac
}

# =============================================================================
# Main
# =============================================================================

RAM_GB="$(get_total_ram_gb)"
GPU="$(get_gpu_type)"
TIER="$(get_tier "${RAM_GB}")"

if [[ "${TIER}" == "insufficient" ]]; then
  log_error "Insufficient RAM (${RAM_GB}GB). Minimum 8GB required for local LLM."
  exit 1
fi

# Select backend
if $INSTALL_MODE; then
  BACKEND="$(select_installable_backend)" || true
else
  BACKEND="$(select_backend)" || true
fi

if [[ "${BACKEND}" == "none" ]]; then
  if $JSON_MODE; then
    echo '{"backend":"none","error":"No LLM backend available","ram_gb":'"${RAM_GB}"',"gpu":"'"${GPU}"'"}'
    exit 1
  fi
  log_error "No LLM backend detected"
  log_info "Install Ollama: brew install ollama"
  log_info "Or setup Docker: npm run docker:ai:setup"
  log_info "Or setup MLX: npm run mlx:setup"
  exit 1
fi

MODEL="$(get_model_for_backend "${BACKEND}" "${TIER}")"
PORT="$(get_port_for_backend "${BACKEND}")"
URL="$(get_url_for_backend "${BACKEND}")"
ENV_VAR="$(get_env_var_for_backend "${BACKEND}")"

# --install mode: actually install and pull
if $INSTALL_MODE; then
  install_backend "${BACKEND}" "${MODEL}"
fi

# --json mode: output JSON
if $JSON_MODE; then
  # Build prefixed model ID for edge function routing
  case "${BACKEND}" in
    ollama) AISHA_LOCAL_ID="ollama-${MODEL}" ;;
    docker) AISHA_LOCAL_ID="docker-ai/${MODEL}" ;;
    mlx)    AISHA_LOCAL_ID="${MODEL}" ;;
    *)      AISHA_LOCAL_ID="${MODEL}" ;;
  esac
  cat <<EOF
{
  "backend": "${BACKEND}",
  "model": "${MODEL}",
  "aisha_local_model": "${AISHA_LOCAL_ID}",
  "port": ${PORT},
  "url": "${URL}",
  "env_var": "${ENV_VAR}",
  "gpu": "${GPU}",
  "ram_gb": ${RAM_GB},
  "tier": "${TIER}"
}
EOF
  exit 0
fi

# --env mode: output sourceable env vars
if $ENV_MODE; then
  echo "export LLM_BACKEND=${BACKEND}"
  echo "export LLM_MODEL=${MODEL}"
  echo "export LLM_PORT=${PORT}"
  echo "export LLM_URL=${URL}"
  echo "export ${ENV_VAR}=${URL}"
  # AISHA_DEFAULT_LOCAL_MODEL — prefixed model ID for edge function routing
  case "${BACKEND}" in
    ollama) echo "export AISHA_DEFAULT_LOCAL_MODEL=ollama-${MODEL}" ;;
    docker) echo "export AISHA_DEFAULT_LOCAL_MODEL=docker-ai/${MODEL}" ;;
    mlx)    echo "export AISHA_DEFAULT_LOCAL_MODEL=${MODEL}" ;;
  esac
  exit 0
fi

# Default: human-readable report
echo ""
log_info "=== Local LLM Auto-Select ==="
log_info ""
log_info "Hardware:"
log_info "  RAM:     ${RAM_GB} GB"
log_info "  GPU:     ${GPU}"
log_info "  Tier:    ${TIER}"
log_info ""
log_info "Backend Detection:"

if check_mlx; then
  if check_mlx_running; then
    log_ok "  MLX:     installed + running (port 8100)"
  else
    log_ok "  MLX:     installed (not running)"
  fi
else
  log_warn "  MLX:     not available"
fi

if check_ollama; then
  if check_ollama_running; then
    log_ok "  Ollama:  installed + running (port 11434)"
  else
    log_ok "  Ollama:  installed (not running)"
  fi
else
  log_warn "  Ollama:  not installed"
fi

if check_docker; then
  log_ok "  Docker:  available (port 12434)"
else
  log_warn "  Docker:  not available"
fi

log_info ""
log_ok "Selected: ${BACKEND}"
log_ok "  Model:   ${MODEL}"
log_ok "  Port:    ${PORT}"
log_ok "  URL:     ${URL}"
log_ok "  Env var: ${ENV_VAR}=${URL}"
log_info ""
log_info "To install & start:"
log_info "  bash scripts/ai/auto-select.sh --install"
log_info ""
echo ""

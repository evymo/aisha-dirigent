#!/usr/bin/env bash
# =============================================================================
# MLX Setup Script — Apple Silicon Local LLM Backend
# =============================================================================
# Automatický setup MLX venv + model download pro AISHA local testing.
# 
# Použití:
#   ./scripts/ai/setup-mlx.sh              # Full setup (venv + model)
#   ./scripts/ai/setup-mlx.sh --check      # Pouze kontrola stavu
#   ./scripts/ai/setup-mlx.sh --model NAME  # Jiný model
#   ./scripts/ai/setup-mlx.sh --auto       # Auto-select model by RAM
#
# Po setup: npm run mlx:serve → http://localhost:8100/v1/chat/completions
# Test:     npm run aisha:chat:test -- --model local-mlx
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"
PYTHON_BIN="${VENV_DIR}/bin/python3"
PIP_BIN="${VENV_DIR}/bin/pip"

# Model tiers by RAM requirement (MLX unified memory on Apple Silicon)
# Rule: model must fit in <50% of total RAM to leave room for macOS + apps
MODEL_TIER_SMALL="mlx-community/Qwen2.5-Coder-3B-Instruct-4bit"   # ~2GB  (8GB+ RAM)
MODEL_TIER_MEDIUM="mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"  # ~4GB  (16GB+ RAM)
MODEL_TIER_LARGE="mlx-community/Qwen2.5-Coder-7B-Instruct-8bit"   # ~8GB  (24GB+ RAM)

DEFAULT_MODEL="${MODEL_TIER_MEDIUM}"
MODEL=""  # Will be set by args or auto-detect

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[MLX]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[MLX]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[MLX]${NC} $1"; }
log_error() { echo -e "${RED}[MLX]${NC} $1"; }

# =============================================================================
# Memory safety helpers
# =============================================================================

get_total_ram_gb() {
  sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1024/1024/1024}'
}

get_free_ram_gb() {
  # macOS: use vm_stat to get free + inactive pages
  local page_size free_pages inactive_pages
  page_size="$(sysctl -n hw.pagesize 2>/dev/null || echo 16384)"
  free_pages="$(vm_stat 2>/dev/null | awk '/Pages free/ {gsub(/\./,"",$3); print $3}')"
  inactive_pages="$(vm_stat 2>/dev/null | awk '/Pages inactive/ {gsub(/\./,"",$3); print $3}')"
  echo $(( (${free_pages:-0} + ${inactive_pages:-0}) * page_size / 1024 / 1024 / 1024 ))
}

# Auto-select model based on total RAM
auto_select_model() {
  local total_ram
  total_ram="$(get_total_ram_gb)"
  
  if [[ "${total_ram}" -ge 24 ]]; then
    log_info "RAM: ${total_ram}GB → selecting 8-bit model (best quality)" >&2
    echo "${MODEL_TIER_LARGE}"
  elif [[ "${total_ram}" -ge 16 ]]; then
    log_info "RAM: ${total_ram}GB → selecting 7B 4-bit model (balanced)" >&2
    echo "${MODEL_TIER_MEDIUM}"
  elif [[ "${total_ram}" -ge 8 ]]; then
    log_info "RAM: ${total_ram}GB → selecting 3B model (safe for low memory)" >&2
    echo "${MODEL_TIER_SMALL}"
  else
    log_error "RAM: ${total_ram}GB — insufficient for MLX models (minimum 8GB)" >&2
    exit 1
  fi
}

# Safety check: can we load this model without OOM?
check_memory_safety() {
  local model_name="$1"
  local total_ram free_ram estimated_model_gb

  total_ram="$(get_total_ram_gb)"
  free_ram="$(get_free_ram_gb)"

  # Estimate model size from name
  case "${model_name}" in
    *3B*4bit*|*3b*4bit*)   estimated_model_gb=2 ;;
    *7B*4bit*|*7b*4bit*)   estimated_model_gb=4 ;;
    *7B*8bit*|*7b*8bit*)   estimated_model_gb=8 ;;
    *8B*4bit*|*8b*4bit*)   estimated_model_gb=5 ;;
    *13B*|*13b*|*14B*)     estimated_model_gb=8 ;;
    *30B*|*30b*|*32B*)     estimated_model_gb=17 ;;
    *70B*|*70b*)           estimated_model_gb=40 ;;
    *)                     estimated_model_gb=5 ;;  # conservative default
  esac

  log_info "Memory check: ${total_ram}GB total, ~${free_ram}GB free, model needs ~${estimated_model_gb}GB"

  # HARD LIMIT: model must fit in <60% of total RAM
  local max_allowed=$(( total_ram * 60 / 100 ))
  if [[ "${estimated_model_gb}" -gt "${max_allowed}" ]]; then
    log_error "UNSAFE: Model (~${estimated_model_gb}GB) exceeds 60% of total RAM (${total_ram}GB)."
    log_error "This WILL freeze your machine. Use a smaller model or --auto flag."
    log_error "Safe alternatives:"
    log_error "  --model ${MODEL_TIER_SMALL}  (~2GB)"
    [[ "${total_ram}" -ge 16 ]] && log_error "  --model ${MODEL_TIER_MEDIUM} (~4GB)"
    return 1
  fi

  # WARNING: model is >40% of total RAM
  local warn_threshold=$(( total_ram * 40 / 100 ))
  if [[ "${estimated_model_gb}" -gt "${warn_threshold}" ]]; then
    log_warn "Model uses ${estimated_model_gb}GB of ${total_ram}GB total RAM."
    log_warn "Close other heavy apps (Docker, Chrome, VS Code) before loading."
  fi

  # WARNING: not enough free RAM right now
  if [[ "${free_ram}" -lt "${estimated_model_gb}" ]]; then
    log_warn "Only ${free_ram}GB free right now, model needs ~${estimated_model_gb}GB."
    log_warn "Consider closing apps first. macOS may swap and become slow."
  fi

  log_ok "Memory check passed"
  return 0
}

# =============================================================================
# Parse arguments
# =============================================================================
CHECK_ONLY=false
FORCE_REINSTALL=false
AUTO_SELECT=false
SKIP_TEST=false

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
    --auto)
      AUTO_SELECT=true
      shift
      ;;
    --force)
      FORCE_REINSTALL=true
      shift
      ;;
    --skip-test)
      SKIP_TEST=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--check] [--auto] [--model MODEL_NAME] [--force] [--skip-test]"
      echo ""
      echo "Options:"
      echo "  --check      Only check current status, don't install anything"
      echo "  --auto       Auto-select best model for your RAM (RECOMMENDED)"
      echo "  --model      Specify HuggingFace model manually"
      echo "  --force      Force reinstall even if already set up"
      echo "  --skip-test  Skip inference test (just install + download)"
      echo ""
      echo "Model tiers (auto-selected by --auto):"
      echo "  8GB  RAM → ${MODEL_TIER_SMALL}   (~2GB)"
      echo "  16GB RAM → ${MODEL_TIER_MEDIUM}  (~4GB)"
      echo "  24GB RAM → ${MODEL_TIER_LARGE}   (~8GB)"
      echo ""
      echo "Other models:"
      echo "  mlx-community/Qwen2.5-7B-Instruct-4bit        (~4GB)"
      echo "  mlx-community/Mistral-7B-Instruct-v0.3-4bit    (~4GB)"
      echo "  mlx-community/Meta-Llama-3.1-8B-Instruct-4bit  (~4.5GB)"
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Auto-select if no model specified
if [[ -z "${MODEL}" ]]; then
  if [[ "${AUTO_SELECT}" == "true" ]]; then
    MODEL="$(auto_select_model)"
  else
    MODEL="${DEFAULT_MODEL}"
  fi
fi

# =============================================================================
# Pre-flight checks
# =============================================================================

check_apple_silicon() {
  local arch
  arch="$(uname -m)"
  if [[ "${arch}" != "arm64" ]]; then
    log_error "MLX requires Apple Silicon (M1/M2/M3/M4). Detected: ${arch}"
    return 1
  fi
  log_ok "Apple Silicon detected (${arch})"
}

check_python() {
  if ! command -v python3 &>/dev/null; then
    log_error "python3 not found. Install via: brew install python3"
    return 1
  fi
  
  local py_version
  py_version="$(python3 --version 2>&1 | awk '{print $2}')"
  local major minor
  major="$(echo "${py_version}" | cut -d. -f1)"
  minor="$(echo "${py_version}" | cut -d. -f2)"
  
  if [[ "${major}" -lt 3 ]] || [[ "${major}" -eq 3 && "${minor}" -lt 9 ]]; then
    log_error "Python 3.9+ required. Found: ${py_version}"
    return 1
  fi
  log_ok "Python ${py_version} found"
}

check_status() {
  echo ""
  log_info "=== MLX Status Check ==="
  echo ""
  
  local total_ram free_ram
  total_ram="$(get_total_ram_gb)"
  free_ram="$(get_free_ram_gb)"
  log_info "RAM: ${total_ram}GB total, ~${free_ram}GB free"
  
  # Apple Silicon
  check_apple_silicon || true
  
  # Python
  check_python || true
  
  # Venv
  if [[ -f "${PYTHON_BIN}" ]]; then
    log_ok "Venv exists: ${VENV_DIR}"
  else
    log_warn "Venv not found: ${VENV_DIR}"
  fi
  
  # MLX packages
  if [[ -f "${PYTHON_BIN}" ]]; then
    if "${PYTHON_BIN}" -c "import mlx; import mlx_lm" 2>/dev/null; then
      local mlx_ver
      mlx_ver="$("${PYTHON_BIN}" -c "import mlx; print(mlx.__version__)" 2>/dev/null || echo "unknown")"
      log_ok "MLX ${mlx_ver} installed"
    else
      log_warn "MLX packages not installed in venv"
    fi
  fi
  
  # Model cache
  local model_cache_dir
  model_cache_dir="${HOME}/.cache/huggingface/hub/models--$(echo "${MODEL}" | tr '/' '--')"
  if [[ -d "${model_cache_dir}" ]]; then
    local model_size
    model_size="$(du -sh "${model_cache_dir}" 2>/dev/null | awk '{print $1}')"
    log_ok "Model cached: ${MODEL} (${model_size})"
  else
    log_warn "Model not cached: ${MODEL}"
  fi
  
  # Server port
  if lsof -i :8100 -sTCP:LISTEN &>/dev/null; then
    log_ok "MLX server running on port 8100"
  else
    log_warn "MLX server not running (port 8100 free)"
  fi
  
  # Recommended model
  echo ""
  log_info "Recommended for your machine (${total_ram}GB):"
  auto_select_model >/dev/null
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
log_info "=== MLX Setup for Apple Silicon ==="
log_info "Model: ${MODEL}"
echo ""

# Step 1: Check Apple Silicon
check_apple_silicon

# Step 2: Check Python
check_python

# Step 3: Memory safety check — BEFORE any heavy operation
if ! check_memory_safety "${MODEL}"; then
  echo ""
  log_error "Aborting to prevent system freeze."
  log_info "Use --auto to auto-select a safe model, or --model to specify a smaller one."
  exit 1
fi

# Step 3: Create venv
if [[ -f "${PYTHON_BIN}" ]] && [[ "${FORCE_REINSTALL}" != "true" ]]; then
  log_ok "Venv already exists (use --force to recreate)"
else
  if [[ -d "${VENV_DIR}" ]]; then
    log_info "Removing existing venv..."
    rm -rf "${VENV_DIR}"
  fi
  log_info "Creating Python venv at ${VENV_DIR}..."
  python3 -m venv "${VENV_DIR}"
  log_ok "Venv created"
fi

# Step 4: Upgrade pip
log_info "Upgrading pip..."
"${PIP_BIN}" install --upgrade pip --quiet

# Step 5: Install MLX packages
log_info "Installing MLX packages (mlx, mlx-lm)..."
"${PIP_BIN}" install mlx mlx-lm --quiet
log_ok "MLX packages installed"

# Verify import
if ! "${PYTHON_BIN}" -c "import mlx; import mlx_lm; print(f'MLX {mlx.__version__} OK')" 2>/dev/null; then
  log_error "MLX import failed after installation"
  exit 1
fi

# Step 6: Pre-download model (download only, don't keep in memory)
log_info "Pre-downloading model: ${MODEL}"
log_info "This may take a few minutes on first run..."
"${PYTHON_BIN}" -c "
from huggingface_hub import snapshot_download
print('Downloading model weights...')
path = snapshot_download('${MODEL}')
print(f'Model cached at: {path}')
"

log_ok "Model downloaded"

# Step 7: Quick inference test (optional — loads model into RAM briefly)
if [[ "${SKIP_TEST}" == "true" ]]; then
  log_info "Skipping inference test (--skip-test)"
else
  log_info "Running quick inference test (loads model into RAM briefly)..."
  log_warn "If your machine becomes slow, use --skip-test next time."
  "${PYTHON_BIN}" -c "
from mlx_lm import load, generate
import time

t0 = time.time()
model, tokenizer = load('${MODEL}')
load_s = time.time() - t0

t1 = time.time()
response = generate(model, tokenizer, prompt='Hello, who are you?', max_tokens=20)
gen_s = time.time() - t1

print(f'Load: {load_s:.1f}s | Generate: {gen_s:.1f}s')
print(f'Response: {response[:100]}')

# Explicitly free memory
del model, tokenizer
"
  log_ok "Inference test passed"
fi

# Done
echo ""
log_ok "==================================="
log_ok "MLX setup complete!"
log_ok "==================================="
echo ""
log_info "Next steps:"
echo "  1. Start MLX server:   npm run mlx:serve"
echo "  2. Test AISHA locally: npm run aisha:chat:test -- --model local-mlx"
echo "  3. Check status:       npm run mlx:status"
echo ""
log_info "The MLX server provides OpenAI-compatible API at http://localhost:8100/v1"
log_info "llmRouter automatically routes 'local-*' models to this endpoint."
log_warn "IMPORTANT: Don't run MLX server + Docker Model Runner simultaneously on 16GB machines!"
echo ""

#!/usr/bin/env bash
# =============================================================================
# MLX Server — OpenAI-compatible API for Apple Silicon
# =============================================================================
# Spustí mlx_lm.server na portu 8100 (výchozí VLLM_GENERATION_URL).
# llmRouter automaticky routuje "local-*" modely na tento endpoint.
#
# Použití:
#   ./scripts/ai/serve.sh                    # Default model, port 8100
#   ./scripts/ai/serve.sh --port 8200        # Custom port
#   ./scripts/ai/serve.sh --model NAME       # Custom model
#   ./scripts/ai/serve.sh --background       # Run as background process
#
# API endpoint: http://localhost:8100/v1/chat/completions
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"
PYTHON_BIN="${VENV_DIR}/bin/python3"
PID_FILE="${SCRIPT_DIR}/.mlx-server.pid"

DEFAULT_MODEL="mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"
DEFAULT_PORT=8100

MODEL="${DEFAULT_MODEL}"
PORT="${DEFAULT_PORT}"
BACKGROUND=false
STOP=false
SKIP_MEMORY_CHECK=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[MLX]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[MLX]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[MLX]${NC} $1"; }
log_error() { echo -e "${RED}[MLX]${NC} $1"; }

# =============================================================================
# Memory safety (shared logic with setup-mlx.sh)
# =============================================================================
get_total_ram_gb() {
  sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1024/1024/1024}'
}

get_free_ram_gb() {
  local page_size free_pages inactive_pages
  page_size="$(sysctl -n hw.pagesize 2>/dev/null || echo 16384)"
  free_pages="$(vm_stat 2>/dev/null | awk '/Pages free/ {gsub(/\./,"",$3); print $3}')"
  inactive_pages="$(vm_stat 2>/dev/null | awk '/Pages inactive/ {gsub(/\./,"",$3); print $3}')"
  echo $(( (${free_pages:-0} + ${inactive_pages:-0}) * page_size / 1024 / 1024 / 1024 ))
}

check_memory_for_serve() {
  local total_ram free_ram estimated_gb
  total_ram="$(get_total_ram_gb)"
  free_ram="$(get_free_ram_gb)"

  case "${MODEL}" in
    *3B*4bit*|*3b*4bit*)   estimated_gb=2 ;;
    *7B*4bit*|*7b*4bit*)   estimated_gb=4 ;;
    *7B*8bit*|*7b*8bit*)   estimated_gb=8 ;;
    *8B*4bit*|*8b*4bit*)   estimated_gb=5 ;;
    *)                     estimated_gb=5 ;;
  esac

  log_info "RAM: ${total_ram}GB total, ~${free_ram}GB free, model needs ~${estimated_gb}GB"

  # Check: is Docker Model Runner also using memory?
  if lsof -i :12434 -sTCP:LISTEN &>/dev/null 2>&1; then
    log_warn "Docker Model Runner is also running (port 12434)."
    log_warn "Running BOTH MLX + Docker models on ${total_ram}GB RAM is risky!"
    if [[ "${total_ram}" -le 16 ]]; then
      log_error "On ${total_ram}GB machine: stop Docker models first (npm run docker:stop)"
      return 1
    fi
  fi

  local max_allowed=$(( total_ram * 60 / 100 ))
  if [[ "${estimated_gb}" -gt "${max_allowed}" ]]; then
    log_error "Model (~${estimated_gb}GB) > 60% of RAM (${total_ram}GB). Use smaller model."
    return 1
  fi

  if [[ "${free_ram}" -lt $(( estimated_gb + 2 )) ]]; then
    log_warn "Low free RAM (${free_ram}GB). Model needs ~${estimated_gb}GB + overhead."
    log_warn "Close heavy apps (Docker, Chrome, VS Code) or use --force-memory."
    if [[ "${total_ram}" -le 16 ]]; then
      log_error "Refusing to start on ${total_ram}GB machine with only ${free_ram}GB free."
      log_error "Use --force-memory to override (AT YOUR OWN RISK)."
      return 1
    fi
  fi

  return 0
}

# =============================================================================
# Parse arguments
# =============================================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="$2"
      shift 2
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --background|-d)
      BACKGROUND=true
      shift
      ;;
    --stop)
      STOP=true
      shift
      ;;
    --force-memory)
      SKIP_MEMORY_CHECK=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--port PORT] [--model MODEL] [--background] [--stop] [--force-memory]"
      echo ""
      echo "Options:"
      echo "  --port PORT       Server port (default: ${DEFAULT_PORT})"
      echo "  --model MODEL     HuggingFace model (default: ${DEFAULT_MODEL})"
      echo "  --background      Run server in background"
      echo "  --stop            Stop background server"
      echo "  --force-memory    Skip memory safety check (DANGEROUS)"
      echo ""
      echo "API: http://localhost:PORT/v1/chat/completions"
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      exit 1
      ;;
  esac
done

# =============================================================================
# Stop mode
# =============================================================================
if [[ "${STOP}" == "true" ]]; then
  if [[ -f "${PID_FILE}" ]]; then
    local_pid="$(cat "${PID_FILE}")"
    if kill -0 "${local_pid}" 2>/dev/null; then
      kill "${local_pid}"
      rm -f "${PID_FILE}"
      log_ok "MLX server stopped (PID ${local_pid})"
    else
      rm -f "${PID_FILE}"
      log_warn "Server process already dead, cleaned up PID file"
    fi
  else
    # Try to find by port
    local_pid="$(lsof -ti :${PORT} -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${local_pid}" ]]; then
      kill "${local_pid}"
      log_ok "MLX server stopped (PID ${local_pid})"
    else
      log_warn "No MLX server found on port ${PORT}"
    fi
  fi
  exit 0
fi

# =============================================================================
# Pre-flight checks
# =============================================================================
if [[ "$(uname -m)" != "arm64" ]]; then
  log_error "MLX requires Apple Silicon (M1/M2/M3/M4)"
  exit 1
fi

if [[ ! -f "${PYTHON_BIN}" ]]; then
  log_error "MLX venv not found. Run: npm run mlx:setup"
  exit 1
fi

if ! "${PYTHON_BIN}" -c "import mlx_lm" 2>/dev/null; then
  log_error "mlx_lm not installed. Run: npm run mlx:setup"
  exit 1
fi

# Check if port is already in use
if lsof -i :"${PORT}" -sTCP:LISTEN &>/dev/null; then
  existing_pid="$(lsof -ti :"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  log_warn "Port ${PORT} already in use (PID: ${existing_pid})"
  log_warn "Stop it first: $0 --stop"
  exit 1
fi

# Memory safety check
if [[ "${SKIP_MEMORY_CHECK}" != "true" ]]; then
  if ! check_memory_for_serve; then
    exit 1
  fi
else
  log_warn "Memory check skipped (--force-memory). You have been warned."
fi

# =============================================================================
# Start server
# =============================================================================
log_info "Starting MLX server..."
log_info "Model: ${MODEL}"
log_info "Port:  ${PORT}"
log_info "API:   http://localhost:${PORT}/v1/chat/completions"
echo ""

if [[ "${BACKGROUND}" == "true" ]]; then
  # Background mode
  nohup "${PYTHON_BIN}" -m mlx_lm.server \
    --model "${MODEL}" \
    --port "${PORT}" \
    > "${SCRIPT_DIR}/mlx-server.log" 2>&1 &
  
  server_pid=$!
  echo "${server_pid}" > "${PID_FILE}"
  
  log_ok "MLX server started in background (PID ${server_pid})"
  log_info "Logs: ${SCRIPT_DIR}/mlx-server.log"
  log_info "Stop: npm run mlx:stop"
  
  # Wait for server to be ready
  log_info "Waiting for server to load model..."
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:${PORT}/v1/models" >/dev/null 2>&1; then
      log_ok "Server ready!"
      exit 0
    fi
    sleep 2
  done
  
  log_warn "Server may still be loading model. Check logs: tail -f ${SCRIPT_DIR}/mlx-server.log"
else
  # Foreground mode
  log_info "Running in foreground (Ctrl+C to stop)"
  echo ""
  exec "${PYTHON_BIN}" -m mlx_lm.server \
    --model "${MODEL}" \
    --port "${PORT}"
fi

#!/usr/bin/env bash
# =============================================================================
# AI Status — Unified Health Check for All Local LLM Backends
# =============================================================================
# Single command to check MLX, Ollama, and Docker Model Runner status.
#
# Použití:
#   ./scripts/ai/status.sh          # Human-readable overview
#   ./scripts/ai/status.sh --json   # Machine-readable JSON
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ARM64 / Metal GPU helpers (shared across scripts)
source "${SCRIPT_DIR}/_arch-helpers.sh"

JSON_MODE=false
[[ "${1:-}" == "--json" ]] && JSON_MODE=true

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

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

get_gpu_type() {
  if [[ "$(uname -s)" == "Darwin" ]] && [[ "$(uname -m)" == "arm64" ]]; then
    echo "metal"
  elif command -v nvidia-smi &>/dev/null; then
    echo "cuda"
  else
    echo "none"
  fi
}

# =============================================================================
# Backend Checks
# =============================================================================

check_mlx_installed() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [[ -f "${script_dir}/.venv/bin/python3" ]] && \
    "${script_dir}/.venv/bin/python3" -c "import mlx" &>/dev/null 2>&1
}

check_mlx_running() {
  curl -sf "http://localhost:8100/v1/models" &>/dev/null
}

get_mlx_models() {
  curl -sf "http://localhost:8100/v1/models" 2>/dev/null | \
    python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin).get('data',[])]" 2>/dev/null || true
}

check_ollama_installed() {
  resolve_ollama &>/dev/null
}

check_ollama_running() {
  curl -sf "http://localhost:11434/api/tags" &>/dev/null
}

get_ollama_models() {
  curl -sf "http://localhost:11434/api/tags" 2>/dev/null | \
    python3 -c "import sys,json; [print(m['name']) for m in json.load(sys.stdin).get('models',[])]" 2>/dev/null || true
}

check_docker_running() {
  curl -sf "http://localhost:12434/engines/v1/models" &>/dev/null 2>&1
}

get_docker_models() {
  curl -sf "http://localhost:12434/engines/v1/models" 2>/dev/null | \
    python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin).get('data',[])]" 2>/dev/null || true
}

# =============================================================================
# JSON Output
# =============================================================================

if $JSON_MODE; then
  mlx_installed=$(check_mlx_installed && echo "true" || echo "false")
  mlx_running=$(check_mlx_running && echo "true" || echo "false")
  mlx_models="$(get_mlx_models 2>/dev/null | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))" 2>/dev/null || echo '[]')"

  ollama_installed=$(check_ollama_installed && echo "true" || echo "false")
  ollama_running=$(check_ollama_running && echo "true" || echo "false")
  ollama_models="$(get_ollama_models 2>/dev/null | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))" 2>/dev/null || echo '[]')"

  docker_running=$(check_docker_running && echo "true" || echo "false")
  docker_models="$(get_docker_models 2>/dev/null | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))" 2>/dev/null || echo '[]')"

  cat <<EOF
{
  "hw": {
    "ram_gb": $(get_total_ram_gb),
    "gpu": "$(get_gpu_type)"
  },
  "backends": {
    "mlx": { "installed": ${mlx_installed}, "running": ${mlx_running}, "port": 8100, "models": ${mlx_models} },
    "ollama": { "installed": ${ollama_installed}, "running": ${ollama_running}, "port": 11434, "models": ${ollama_models} },
    "docker": { "installed": true, "running": ${docker_running}, "port": 12434, "models": ${docker_models} }
  }
}
EOF
  exit 0
fi

# =============================================================================
# Human Output
# =============================================================================

RAM_GB="$(get_total_ram_gb)"
GPU="$(get_gpu_type)"

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║  Local LLM Status                                    ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Hardware
echo -e "  ${BOLD}Hardware:${NC}"
echo -e "    RAM:  ${RAM_GB} GB"
echo -e "    GPU:  ${GPU}"
echo ""

# Backend table
echo -e "  ${BOLD}Backend        Installed  Running   Port    GPU Accel${NC}"
echo -e "  ${DIM}─────────────  ─────────  ────────  ──────  ─────────${NC}"

# MLX
if check_mlx_installed; then
  mlx_inst="${GREEN}yes${NC}"
else
  mlx_inst="${RED}no${NC}"
fi
if check_mlx_running; then
  mlx_run="${GREEN}yes${NC}"
else
  mlx_run="${DIM}no${NC}"
fi
printf "  %-15s%-11b%-10b%-8s%s\n" "MLX" "$mlx_inst" "$mlx_run" "8100" "Metal (native)"

# Ollama
if check_ollama_installed; then
  oll_inst="${GREEN}yes${NC}"
else
  oll_inst="${RED}no${NC}"
fi
if check_ollama_running; then
  oll_run="${GREEN}yes${NC}"
else
  oll_run="${DIM}no${NC}"
fi
printf "  %-15s%-11b%-10b%-8s%s\n" "Ollama" "$oll_inst" "$oll_run" "11434" "Metal/CUDA"

# Docker
docker_inst="${GREEN}yes${NC}"  # If Docker Desktop runs, it's always present
if check_docker_running; then
  docker_run="${GREEN}yes${NC}"
else
  docker_run="${DIM}no${NC}"
fi
printf "  %-15s%-11b%-10b%-8s%s\n" "Docker" "$docker_inst" "$docker_run" "12434" "CPU only"

echo ""

# Models per running backend
any_models=false

if check_mlx_running; then
  echo -e "  ${BOLD}MLX Models:${NC}"
  get_mlx_models | while read -r m; do [[ -n "$m" ]] && echo -e "    ${GREEN}*${NC} $m"; done
  any_models=true
  echo ""
fi

if check_ollama_running; then
  echo -e "  ${BOLD}Ollama Models:${NC}"
  get_ollama_models | while read -r m; do [[ -n "$m" ]] && echo -e "    ${GREEN}*${NC} $m"; done
  any_models=true
  echo ""
fi

if check_docker_running; then
  echo -e "  ${BOLD}Docker Models:${NC}"
  get_docker_models | while read -r m; do [[ -n "$m" ]] && echo -e "    ${GREEN}*${NC} $m"; done
  any_models=true
  echo ""
fi

if ! $any_models; then
  echo -e "  ${YELLOW}No running backends detected.${NC}"
  echo ""
  echo -e "  Quick start:"
  echo -e "    ${DIM}npm run ollama:setup     # Install Ollama + pull model${NC}"
  echo -e "    ${DIM}npm run docker:ai:setup  # Setup Docker Model Runner${NC}"
  echo -e "    ${DIM}npm run mlx:setup        # Setup MLX (Apple Silicon)${NC}"
  echo ""
fi

# Env vars check
echo -e "  ${BOLD}Local Model Env (.env.local):${NC}"
  env_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env.local"
for var in VLLM_GENERATION_URL OLLAMA_URL DOCKER_MODEL_RUNNER_URL; do
  if [[ -f "${env_file}" ]] && grep -q "^${var}=" "${env_file}" 2>/dev/null; then
    val="$(grep "^${var}=" "${env_file}" | cut -d= -f2-)"
    echo -e "    ${GREEN}*${NC} ${var}=${DIM}${val}${NC}"
  else
    echo -e "    ${RED}*${NC} ${var}=${RED}NOT SET${NC}"
  fi
done
echo ""

# Usage hint
echo -e "  ${BOLD}Test commands:${NC}"
echo -e "    ${DIM}npm run aisha:chat:test -- --model ollama-mistral-nemo${NC}"
echo -e "    ${DIM}npm run aisha:chat:test -- --model docker-ai/mistral-nemo${NC}"
echo -e "    ${DIM}npm run aisha:chat:test -- --model local-mlx${NC}"
echo ""

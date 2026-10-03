#!/usr/bin/env bash
# =============================================================================
# Architecture Helpers — ARM64 / Metal GPU tooling for Apple Silicon
# =============================================================================
# Ensures Ollama and MLX run as native ARM64 binaries with Metal GPU.
# On Apple Silicon x86 (Rosetta) binaries are NEVER used — if the ARM64
# Homebrew prefix is missing the installer is invoked automatically.
#
# Source this file:  source "$(dirname "${BASH_SOURCE[0]}")/_arch-helpers.sh"
# =============================================================================

# Detect Apple Silicon
is_apple_silicon() {
  [[ "$(uname -s)" == "Darwin" ]] && [[ "$(uname -m)" == "arm64" ]]
}

# ---------------------------------------------------------------------------
# ensure_arm_brew — install ARM64 Homebrew if it is not present.
# Called automatically by resolve_brew on Apple Silicon.
# ---------------------------------------------------------------------------
ensure_arm_brew() {
  if [[ -x /opt/homebrew/bin/brew ]]; then
    return 0
  fi
  echo "[arch] ARM64 Homebrew not found — installing..." >&2
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ ! -x /opt/homebrew/bin/brew ]]; then
    echo "[arch] ERROR: ARM64 Homebrew installation failed" >&2
    return 1
  fi
  echo "[arch] ARM64 Homebrew installed at /opt/homebrew/bin/brew" >&2
}

# ---------------------------------------------------------------------------
# resolve_brew — returns the ARM64 Homebrew binary on Apple Silicon.
#
# On Apple Silicon: always /opt/homebrew/bin/brew (installs it if missing).
# On Intel Macs or Linux: returns whatever `brew` is in PATH.
# ---------------------------------------------------------------------------
resolve_brew() {
  if is_apple_silicon; then
    ensure_arm_brew || return 1
    echo "/opt/homebrew/bin/brew"
    return 0
  fi
  # Intel / Linux — use whatever is in PATH
  if command -v brew &>/dev/null; then
    command -v brew
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# resolve_ollama — returns the ARM64 ollama binary on Apple Silicon.
#
# On Apple Silicon: only /opt/homebrew/bin/ollama (x86 binary is ignored).
# On Intel / Linux: PATH lookup.
# ---------------------------------------------------------------------------
resolve_ollama() {
  if is_apple_silicon; then
    if [[ -x /opt/homebrew/bin/ollama ]]; then
      echo "/opt/homebrew/bin/ollama"
      return 0
    fi
    # x86 binary under /usr/local is intentionally ignored
    return 1
  fi
  if command -v ollama &>/dev/null; then
    command -v ollama
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# ollama_serve_env — exports optimal env vars for Metal GPU inference.
# Call before `ollama serve`.
# ---------------------------------------------------------------------------
ollama_serve_env() {
  if is_apple_silicon; then
    export OLLAMA_FLASH_ATTENTION=1
    export OLLAMA_KV_CACHE_TYPE=q8_0
  fi
}

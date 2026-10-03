#!/usr/bin/env bash
# =============================================================================
# check-prerequisites.sh — Cross-platform prerequisite check & install
# =============================================================================
# Single source of truth for all prerequisites.
#
# Usage:
#   ./check-prerequisites.sh              # JSON check (read-only)
#   ./check-prerequisites.sh --install    # check + install missing tools
#   ./check-prerequisites.sh --install docker   # install only specific tool
# =============================================================================
set -euo pipefail

MODE="${1:-check}"
TARGET="${2:-all}"      # "all" or specific tool name (node, docker, git, …)

OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"
IS_APPLE_SILICON=false
IS_WSL=false
HAS_NVIDIA=false
HAS_BREW=false

[[ "$OS_NAME" == "Darwin" ]] && [[ "$ARCH_NAME" == "arm64" ]] && IS_APPLE_SILICON=true
[[ "$OS_NAME" == "Linux" ]] && grep -qi microsoft /proc/version 2>/dev/null && IS_WSL=true
command -v nvidia-smi &>/dev/null && HAS_NVIDIA=true
command -v brew &>/dev/null && HAS_BREW=true

# ── Total RAM ──
if [[ "$OS_NAME" == "Darwin" ]]; then
  RAM_GB=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1024/1024/1024}')
else
  RAM_GB=$(awk '/MemTotal/ {printf "%.0f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo "0")
fi

# ═══════════════════════════════════════════════════════════════════════════════
# INSTALL FUNCTIONS (one per tool — used by both --install and future scripts)
# ═══════════════════════════════════════════════════════════════════════════════

install_node() {
  echo "▸ Installing Node.js…"
  if [[ "$OS_NAME" == "Darwin" ]]; then
    if $HAS_BREW; then
      brew install node
    else
      echo "  ⚠ Homebrew not found. Installing via nvm…"
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
      export NVM_DIR="$HOME/.nvm"
      # shellcheck source=/dev/null
      [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
      nvm install --lts
    fi
  elif [[ "$OS_NAME" == "Linux" ]]; then
    if command -v apt-get &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
      sudo dnf module install -y nodejs:22
    else
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
      export NVM_DIR="$HOME/.nvm"
      [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
      nvm install --lts
    fi
  else
    echo "  ❌ Automatická instalace Node.js na $(uname -s) není podporována."
    echo "  ℹ Stáhněte z https://nodejs.org"
    return 1
  fi
  echo "  ✅ Node.js $(node -v 2>/dev/null || echo 'installed')"
}

install_docker() {
  echo "▸ Installing Docker…"
  if [[ "$OS_NAME" == "Darwin" ]]; then
    if $HAS_BREW; then
      brew install --cask docker
      echo "  ℹ Docker Desktop nainstalován — spusťte ho z Launchpadu."
    else
      echo "  ❌ Nainstalujte Homebrew nebo stáhněte Docker z https://docker.com/products/docker-desktop"
      return 1
    fi
  elif [[ "$OS_NAME" == "Linux" ]]; then
    if $IS_WSL; then
      echo "  ℹ Ve WSL doporučujeme Docker Desktop pro Windows."
      echo "  ℹ Stáhněte z https://docker.com/products/docker-desktop"
      return 1
    fi
    # Officialní Docker convenience script
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER" 2>/dev/null || true
    sudo systemctl enable --now docker 2>/dev/null || true
    echo "  ✅ Docker $(docker --version 2>/dev/null || echo 'installed')"
    echo "  ℹ Odhlaste a přihlaste se pro docker rights bez sudo."
  else
    echo "  ❌ Automatická instalace Dockeru na $(uname -s) není podporována."
    return 1
  fi
}

install_git() {
  echo "▸ Installing Git…"
  if [[ "$OS_NAME" == "Darwin" ]]; then
    # macOS: Xcode command line tools include git
    xcode-select --install 2>/dev/null || true
    echo "  ℹ Pokud se zobrazil dialog, nainstalujte Command Line Tools."
  elif [[ "$OS_NAME" == "Linux" ]]; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get install -y git
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y git
    fi
  fi
  echo "  ✅ Git $(git --version 2>/dev/null || echo 'installed')"
}

install_vscode() {
  echo "▸ Installing VS Code CLI…"
  if [[ "$OS_NAME" == "Darwin" ]]; then
    if $HAS_BREW; then
      brew install --cask visual-studio-code
    else
      echo "  ❌ Stáhněte z https://code.visualstudio.com"
      return 1
    fi
  elif [[ "$OS_NAME" == "Linux" ]]; then
    if command -v snap &>/dev/null; then
      sudo snap install code --classic
    elif command -v apt-get &>/dev/null; then
      wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > /tmp/packages.microsoft.gpg
      sudo install -D -o root -g root -m 644 /tmp/packages.microsoft.gpg /etc/apt/keyrings/packages.microsoft.gpg
      echo "deb [arch=amd64,arm64 signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" | sudo tee /etc/apt/sources.list.d/vscode.list
      sudo apt-get update && sudo apt-get install -y code
    else
      echo "  ❌ Stáhněte z https://code.visualstudio.com"
      return 1
    fi
  fi
  echo "  ✅ code CLI ready"
}

install_ollama() {
  echo "▸ Installing Ollama…"
  if [[ "$OS_NAME" == "Darwin" ]]; then
    if $HAS_BREW; then
      brew install ollama
    else
      curl -fsSL https://ollama.com/install.sh | sh
    fi
  elif [[ "$OS_NAME" == "Linux" ]]; then
    curl -fsSL https://ollama.com/install.sh | sh
  else
    echo "  ❌ Stáhněte z https://ollama.com/download"
    return 1
  fi
  echo "  ✅ Ollama $(ollama --version 2>/dev/null || echo 'installed')"
}

# ═══════════════════════════════════════════════════════════════════════════════
# CHECK FUNCTIONS (shared between --check JSON output and --install dry check)
# ═══════════════════════════════════════════════════════════════════════════════

check_tool() {
  local name="$1"
  case "$name" in
    node)
      if command -v node &>/dev/null; then
        local ver; ver=$(node -v 2>/dev/null | sed 's/v//')
        local major; major=$(echo "$ver" | cut -d. -f1)
        echo "{ \"installed\": true, \"version\": \"$ver\", \"ok\": $([ "$major" -ge 18 ] && echo true || echo false) }"
      else
        echo '{ "installed": false, "version": null, "ok": false }'
      fi ;;
    npm)
      if command -v npm &>/dev/null; then
        echo "{ \"installed\": true, \"version\": \"$(npm -v 2>/dev/null)\", \"ok\": true }"
      else
        echo '{ "installed": false, "version": null, "ok": false }'
      fi ;;
    docker)
      if command -v docker &>/dev/null; then
        local ver; ver=$(docker --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
        local running; running=$(docker info &>/dev/null 2>&1 && echo true || echo false)
        echo "{ \"installed\": true, \"version\": \"$ver\", \"running\": $running, \"ok\": $running }"
      else
        echo '{ "installed": false, "version": null, "running": false, "ok": false }'
      fi ;;
    dockerCompose)
      if docker compose version &>/dev/null 2>&1; then
        echo "{ \"installed\": true, \"version\": \"$(docker compose version --short 2>/dev/null || echo unknown)\", \"ok\": true }"
      else
        echo '{ "installed": false, "version": null, "ok": false }'
      fi ;;
    git)
      if command -v git &>/dev/null; then
        echo "{ \"installed\": true, \"version\": \"$(git --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')\", \"ok\": true }"
      else
        echo '{ "installed": false, "version": null, "ok": false }'
      fi ;;
    vscode)
      if command -v code &>/dev/null; then
        echo "{ \"installed\": true, \"version\": \"$(code --version 2>/dev/null | head -1)\", \"ok\": true }"
      else
        echo '{ "installed": false, "version": null, "ok": false }'
      fi ;;
    ollama)
      if command -v ollama &>/dev/null; then
        local ver; ver=$(ollama --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
        local running; running=$(curl -sf http://localhost:11434/api/tags &>/dev/null && echo true || echo false)
        echo "{ \"installed\": true, \"version\": \"$ver\", \"running\": $running, \"ok\": true }"
      else
        echo '{ "installed": false, "version": null, "running": false, "ok": false }'
      fi ;;
  esac
}

# ═══════════════════════════════════════════════════════════════════════════════
# MODE: --check (JSON) or --install
# ═══════════════════════════════════════════════════════════════════════════════

TOOLS="node npm docker dockerCompose git vscode ollama"

if [[ "$MODE" == "--install" ]]; then
  # ── Install mode: check each tool, install if missing ──
  FAIL=0
  INSTALL_MAP="node:install_node npm:install_node docker:install_docker dockerCompose:install_docker git:install_git vscode:install_vscode ollama:install_ollama"

  for entry in $INSTALL_MAP; do
    tool="${entry%%:*}"
    fn="${entry##*:}"

    # Skip if user asked for a specific tool and this isn't it
    if [[ "$TARGET" != "all" ]] && [[ "$TARGET" != "$tool" ]]; then
      continue
    fi

    json=$(check_tool "$tool")
    ok=$(echo "$json" | grep -o '"ok": *[a-z]*' | head -1 | awk '{print $2}')

    if [[ "$ok" == "true" ]]; then
      ver=$(echo "$json" | grep -o '"version": *"[^"]*"' | head -1 | cut -d'"' -f4)
      echo "✓ $tool ($ver)"
    else
      echo "✗ $tool — missing or not ok"
      if ! $fn; then
        echo "  ❌ Instalace $tool selhala"
        FAIL=1
      fi
      # Re-check after install
      json_after=$(check_tool "$tool")
      ok_after=$(echo "$json_after" | grep -o '"ok": *[a-z]*' | head -1 | awk '{print $2}')
      if [[ "$ok_after" == "true" ]]; then
        echo "  ✅ $tool nyní OK"
      else
        echo "  ⚠ $tool stále není ready — možná je potřeba restart shellu nebo ruční zásah"
      fi
    fi
  done

  # Final JSON summary after all installs
  echo ""
  echo "──── výsledek ────"
  echo "{"
  first=true
  for tool in $TOOLS; do
    $first || echo ","
    first=false
    printf "  \"%s\": %s" "$tool" "$(check_tool "$tool")"
  done
  echo ","
  echo "  \"platform\": { \"os\": \"$OS_NAME\", \"arch\": \"$ARCH_NAME\", \"ramGb\": $RAM_GB, \"appleSilicon\": $IS_APPLE_SILICON, \"wsl\": $IS_WSL, \"nvidia\": $HAS_NVIDIA }"
  echo "}"
  exit $FAIL

else
  # ── Check mode: JSON output only (default, backward compat) ──
  echo "{"
  first=true
  for tool in $TOOLS; do
    $first || echo ","
    first=false
    printf "  \"%s\": %s" "$tool" "$(check_tool "$tool")"
  done
  echo ","
  echo "  \"platform\": { \"os\": \"$OS_NAME\", \"arch\": \"$ARCH_NAME\", \"ramGb\": $RAM_GB, \"appleSilicon\": $IS_APPLE_SILICON, \"wsl\": $IS_WSL, \"nvidia\": $HAS_NVIDIA }"
  echo "}"
fi

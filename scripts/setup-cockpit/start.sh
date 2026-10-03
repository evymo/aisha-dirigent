#!/usr/bin/env bash
# =============================================================================
# AISHA Setup Cockpit — Bootstrap Launcher
# =============================================================================
# One-command entry point. Checks Node.js, starts the host server, opens browser.
# Can be run from README link or VS Code task.
#
# Usage:
#   bash scripts/setup-cockpit/start.sh
#   # or: npm run cockpit
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Check Node.js ──
if ! command -v node &>/dev/null; then
  echo ""
  echo "  ❌ Node.js is not installed."
  echo ""
  echo "  Install it first:"
  echo "    macOS:   brew install node"
  echo "    Ubuntu:  sudo apt install nodejs npm"
  echo "    Windows: https://nodejs.org"
  echo ""
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo ""
  echo "  ❌ Node.js $NODE_MAJOR.x detected — version 18+ is required."
  echo "  Please upgrade: https://nodejs.org"
  echo ""
  exit 1
fi

# ── Check if already running ──
PORT="${COCKPIT_PORT:-19840}"
if curl -sf "http://127.0.0.1:${PORT}/api/detect" &>/dev/null; then
  echo ""
  echo "  ✦ Cockpit is already running at http://127.0.0.1:${PORT}"
  echo ""
  # Open browser anyway
  OPEN_CMD=""
  case "$(uname -s)" in
    Darwin)  OPEN_CMD="open" ;;
    Linux)   OPEN_CMD="xdg-open" ;;
    MINGW*|MSYS*|CYGWIN*) OPEN_CMD="start" ;;
  esac
  if [ -n "$OPEN_CMD" ]; then
    $OPEN_CMD "http://127.0.0.1:${PORT}" 2>/dev/null || true
  fi
  exit 0
fi

# ── Start cockpit host ──
echo ""
echo "  ✦ Starting AISHA Setup Cockpit…"
echo ""
exec node "$SCRIPT_DIR/host.mjs"

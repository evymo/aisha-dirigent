#!/usr/bin/env bash
# dev-build.sh — Quick local dev build for AISHA Workbench
#
# Downloads VSCodium, applies branding, then builds.
# Use for iterative development. For CI, use build.sh directly.
#
# Usage:
#   ./dev-build.sh           # Full build
#   ./dev-build.sh --quick   # Reuse vscodium/ if already cloned

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

QUICK=false
if [[ "${1:-}" == "--quick" ]]; then
  QUICK=true
fi

echo "╔═══════════════════════════════════════════════╗"
echo "║       AISHA Workbench — Dev Build             ║"
echo "╚═══════════════════════════════════════════════╝"

# Step 1: Generate icons if not present
if [[ ! -f "${SCRIPT_DIR}/src/stable/resources/darwin/code.icns" ]]; then
  echo ""
  echo "── Generating icons..."
  bash "${SCRIPT_DIR}/build/generate_icons.sh"
fi

# Step 2: Run main build
if [[ "$QUICK" == "true" ]]; then
  bash "${SCRIPT_DIR}/build.sh" --skip-clone
else
  bash "${SCRIPT_DIR}/build.sh"
fi

echo ""
echo "Dev build complete. Check artifacts/ for output."

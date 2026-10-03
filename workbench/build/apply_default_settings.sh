#!/usr/bin/env bash
# apply_default_settings.sh — Inject AISHA default settings into VS Code defaults
#
# Called from build.sh after prepare_vscode.sh.
# Merges default-settings.jsonc into vscode's default settings.
#
# Usage: ./build/apply_default_settings.sh <vscode-source-dir>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
VSCODE_DIR="${1:?Usage: $0 <vscode-source-dir>}"

AISHA_DEFAULTS="${ROOT_DIR}/default-settings.jsonc"

if [[ ! -f "$AISHA_DEFAULTS" ]]; then
  echo "   No default-settings.jsonc found, skipping."
  exit 0
fi

# VS Code stores defaults in src/vs/workbench/common/configurationRegistry.ts
# and at runtime in product.json → configurationDefaults.
# The cleanest way: add configurationDefaults to product.json.

PRODUCT_JSON="${VSCODE_DIR}/product.json"

if [[ ! -f "$PRODUCT_JSON" ]]; then
  echo "   WARNING: product.json not found at ${PRODUCT_JSON}"
  exit 0
fi

echo "   Injecting AISHA default settings into product.json..."

# Strip standalone JSONC comments and merge as configurationDefaults.
# Do not strip inline "//" because URLs such as https:// are valid JSON strings.
CLEAN_DEFAULTS=$(sed '/^[[:space:]]*\/\//d' "$AISHA_DEFAULTS" | jq '.')

jq --argjson defaults "$CLEAN_DEFAULTS" \
  '.configurationDefaults = ($defaults)' \
  "$PRODUCT_JSON" \
  > "${PRODUCT_JSON}.tmp"

mv "${PRODUCT_JSON}.tmp" "$PRODUCT_JSON"
echo "   Done: configurationDefaults injected"

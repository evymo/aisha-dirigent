#!/usr/bin/env bash
# install_bundled_extensions.sh — Pre-install AISHA extensions into the build
#
# Called by build.sh after VS Code compilation completes.
# Builds AISHA Dirigent from source and installs optional extra VSIX files.
#
# Usage: ./build/install_bundled_extensions.sh <vscodium-build-dir> <platform>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$ROOT_DIR")"
VSCODIUM_BUILD_DIR="${1:?Usage: $0 <vscodium-build-dir> <platform>}"
PLATFORM="${2:?Usage: $0 <vscodium-build-dir> <platform>}"

EXTENSIONS_DIR="${ROOT_DIR}/bundled-extensions"
DIRIGENT_BUILD_SCRIPT="${REPO_ROOT}/tests/e2e-dirigent/scripts/build-extension-vsix.mjs"
DIRIGENT_VSIX="${REPO_ROOT}/tests/e2e-dirigent/.artifacts/aisha-dirigent.vsix"

echo "── Installing bundled extensions..."

# Locate the built app's extensions directory
case "$PLATFORM" in
  linux)
    APP_EXT_DIR="${VSCODIUM_BUILD_DIR}/resources/app/extensions"
    ;;
  osx)
    # macOS .app bundle
    APP_EXT_DIR=$(find "${VSCODIUM_BUILD_DIR}" -path "*.app/Contents/Resources/app/extensions" -type d | head -1)
    if [[ -z "$APP_EXT_DIR" ]]; then
      APP_EXT_DIR="${VSCODIUM_BUILD_DIR}/resources/app/extensions"
    fi
    ;;
  win32)
    APP_EXT_DIR="${VSCODIUM_BUILD_DIR}/resources/app/extensions"
    ;;
  *)
    echo "ERROR: Unknown platform: ${PLATFORM}"
    exit 1
    ;;
esac

if [[ ! -d "$APP_EXT_DIR" ]]; then
  echo "   WARNING: Extensions directory not found at ${APP_EXT_DIR}"
  echo "   Skipping bundled extension install."
  exit 0
fi

INSTALLED=0

install_vsix() {
  local vsix="$1"
  local vsix_name
  local tmp_ext
  local package_json
  local ext_name
  local ext_id
  local target_dir

  vsix_name=$(basename "$vsix" .vsix)
  tmp_ext=$(mktemp -d)

  unzip -q "$vsix" -d "$tmp_ext"

  if [[ ! -d "${tmp_ext}/extension" ]]; then
    echo "   WARNING: ${vsix_name} has no extension/ payload; skipping."
    rm -rf "$tmp_ext"
    return 0
  fi

  package_json="${tmp_ext}/extension/package.json"
  ext_name=$(jq -r '.name // empty' "$package_json" 2>/dev/null || true)
  ext_id=$(jq -r '.publisher + "." + .name' "$package_json" 2>/dev/null || echo "$vsix_name")

  if [[ "$ext_name" == "aisha-dirigent" && "$vsix" != "$DIRIGENT_VSIX" ]]; then
    echo "   Skipping stale aisha-dirigent VSIX: ${vsix_name}"
    rm -rf "$tmp_ext"
    return 0
  fi

  echo "   Installing: ${vsix_name} (${ext_id})"
  target_dir="${APP_EXT_DIR}/${ext_id}"
  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  cp -R "${tmp_ext}/extension/." "$target_dir/"
  echo "   -> Installed to ${ext_id}/"
  INSTALLED=$((INSTALLED + 1))

  rm -rf "$tmp_ext"
}

remove_existing_dirigent() {
  local package_json
  local ext_dir
  local ext_name

  for package_json in "${APP_EXT_DIR}"/*/package.json; do
    [[ -f "$package_json" ]] || continue
    ext_name=$(jq -r '.name // empty' "$package_json" 2>/dev/null || true)
    if [[ "$ext_name" == "aisha-dirigent" ]]; then
      ext_dir=$(dirname "$package_json")
      echo "   Removing existing aisha-dirigent install: $(basename "$ext_dir")"
      rm -rf "$ext_dir"
    fi
  done
}

if [[ ! -f "$DIRIGENT_BUILD_SCRIPT" ]]; then
  echo "ERROR: AISHA Dirigent VSIX build script not found: ${DIRIGENT_BUILD_SCRIPT}"
  exit 1
fi

echo "   Building current aisha-dirigent VSIX from extensions/aisha-dirigent..."
FORCE_REBUILD=1 node "$DIRIGENT_BUILD_SCRIPT"

if [[ ! -f "$DIRIGENT_VSIX" ]]; then
  echo "ERROR: AISHA Dirigent VSIX was not produced: ${DIRIGENT_VSIX}"
  exit 1
fi

remove_existing_dirigent
install_vsix "$DIRIGENT_VSIX"

# Install optional extra .vsix files from bundled-extensions/.
# aisha-dirigent is always built from source above and skipped here if present.
if [[ -d "$EXTENSIONS_DIR" ]]; then
  for vsix in "${EXTENSIONS_DIR}"/*.vsix; do
    [[ -f "$vsix" ]] || continue
    install_vsix "$vsix"
  done
fi

echo "   Installed ${INSTALLED} bundled extensions"

# Also create a marker file so the extension knows it's in AISHA Workbench context
MARKER_FILE="${APP_EXT_DIR}/../.aisha-workbench"
echo '{"product":"aisha-workbench","bundled":true}' > "$MARKER_FILE"
echo "   Created .aisha-workbench marker"

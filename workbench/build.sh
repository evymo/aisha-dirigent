#!/usr/bin/env bash
# build.sh — AISHA Workbench build orchestrator
#
# Clones VSCodium, applies AISHA branding, bundles the dirigent extension,
# and produces platform-specific artifacts (.dmg, .deb, .tar.gz, etc.)
#
# Usage:
#   ./build.sh                 # Build for current platform
#   ./build.sh --platform linux --arch x64
#   ./build.sh --platform osx --arch arm64
#   ./build.sh --skip-clone    # Reuse already-cloned vscodium/ dir
#
# Prerequisites:
#   - Node.js 22+ (matches VSCodium .nvmrc)
#   - jq, git, python3
#   - Platform-specific: librsvg (rsvg-convert), iconutil (macOS)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/utils.sh"

# ── Defaults ──────────────────────────────────────────────
PLATFORM="${PLATFORM:-}"
ARCH="${ARCH:-}"
SKIP_CLONE=false

# ── Parse args ────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --skip-clone) SKIP_CLONE=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Auto-detect platform
if [[ -z "$PLATFORM" ]]; then
  case "$(uname -s)" in
    Linux*)  PLATFORM="linux" ;;
    Darwin*) PLATFORM="osx" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="win32" ;;
    *) echo "Unsupported OS: $(uname -s)"; exit 1 ;;
  esac
fi

# Auto-detect arch
if [[ -z "$ARCH" ]]; then
  case "$(uname -m)" in
    arm64|aarch64) ARCH="arm64" ;;
    *) ARCH="x64" ;;
  esac
fi

export OS_NAME="$PLATFORM"
export VSCODE_ARCH="$ARCH"

echo "═══════════════════════════════════════════════════"
echo "  AISHA Workbench Build"
echo "  Platform: ${PLATFORM}/${ARCH}"
echo "  VSCodium ref: ${VSCODIUM_REF}"
echo "═══════════════════════════════════════════════════"

# ── Step 1: Clone VSCodium ────────────────────────────────
VSCODIUM_DIR="${SCRIPT_DIR}/vscodium"

if [[ "$SKIP_CLONE" == "false" ]]; then
  echo ""
  echo "── Step 1: Fetching VSCodium ${VSCODIUM_REF}..."

  if [[ -d "$VSCODIUM_DIR" ]]; then
    echo "   Cleaning existing vscodium/ dir..."
    rm -rf "$VSCODIUM_DIR"
  fi

  git clone --depth 1 --branch "${VSCODIUM_REF}" "${VSCODIUM_REPO}" "$VSCODIUM_DIR"
else
  echo ""
  echo "── Step 1: Skipping VSCodium clone (--skip-clone)"
  if [[ ! -d "$VSCODIUM_DIR" ]]; then
    echo "ERROR: vscodium/ directory not found. Run without --skip-clone first."
    exit 1
  fi
fi

# ── Step 2: Apply AISHA branding ─────────────────────────
echo ""
echo "── Step 2: Applying AISHA branding..."

# 2a) Our product.json merges ON TOP of vscode's product.json
#     (VSCodium's prepare_vscode.sh does: jq -s '.[0] * .[1]' vscode/product.json ../product.json)
#     So our fields win for any conflicts.
envsubst < "${SCRIPT_DIR}/product.json" > "${VSCODIUM_DIR}/product.json"
echo "   Replaced vscodium/product.json (envsubst: FORGEJO_BASE_URL, INTERNAL_TLD, PUBLIC_TLD)"

# 2b) Patch dev/build.sh — it hard-codes APP_NAME/BINARY_NAME/ORG_NAME
#     We need our values to flow through the entire build.
DEV_BUILD="${VSCODIUM_DIR}/dev/build.sh"
if [[ -f "$DEV_BUILD" ]]; then
  sed -i.bak \
    -e "s|export APP_NAME=\"VSCodium\"|export APP_NAME=\"${APP_NAME}\"|g" \
    -e "s|export BINARY_NAME=\"codium\"|export BINARY_NAME=\"${BINARY_NAME}\"|g" \
    -e "s|export ORG_NAME=\"VSCodium\"|export ORG_NAME=\"${ORG_NAME}\"|g" \
    -e "s|export ASSETS_REPOSITORY=\"VSCodium/vscodium\"|export ASSETS_REPOSITORY=\"${ASSETS_REPOSITORY}\"|g" \
    -e "s|export GH_REPO_PATH=\"VSCodium/vscodium\"|export GH_REPO_PATH=\"${GH_REPO_PATH}\"|g" \
    "$DEV_BUILD"
  rm -f "${DEV_BUILD}.bak"
  echo "   Patched dev/build.sh with AISHA branding"
fi

# 2c) Copy icon resources → src/stable/resources/
if [[ -d "${SCRIPT_DIR}/src/stable/resources" ]]; then
  cp -rp "${SCRIPT_DIR}/src/stable/resources/"* "${VSCODIUM_DIR}/src/stable/resources/" 2>/dev/null || true
  echo "   Copied platform icon resources"
fi

# 2d) Master SVG icon (used by VSCodium's icon generation)
if [[ -f "${SCRIPT_DIR}/icons/stable/aisha_logo.svg" ]]; then
  cp "${SCRIPT_DIR}/icons/stable/aisha_logo.svg" "${VSCODIUM_DIR}/icons/stable/codium_cnl.svg"
  echo "   Replaced master SVG icon"
fi

# ── Step 3: Apply custom patches ─────────────────────────
echo ""
echo "── Step 3: Queueing custom patches..."

PATCH_COUNT=0
if [[ -d "${SCRIPT_DIR}/patches" ]]; then
  for patch_file in "${SCRIPT_DIR}"/patches/*.patch; do
    [[ -f "$patch_file" ]] || continue
    echo "   Queuing: $(basename "$patch_file")"
    cp "$patch_file" "${VSCODIUM_DIR}/patches/"
    PATCH_COUNT=$((PATCH_COUNT + 1))
  done
fi
echo "   Queued ${PATCH_COUNT} custom patches (applied by prepare_vscode.sh)"

# ── Step 4: Build via VSCodium pipeline ──────────────────
echo ""
echo "── Step 4: Building via VSCodium pipeline..."
echo "   This will take ~15-30 minutes depending on your machine."
echo ""

cd "$VSCODIUM_DIR"

# VSCodium dev/build.sh orchestrates:
#   get_repo.sh → version.sh → prepare_vscode.sh → build.sh (gulp compile)
# Flags: -p = produce assets (packages)
# npm run exports npm_command=run-script; VS Code preinstall.ts treats npm_command
# as the nested npm command for build/npm/gyp. Clear it so node-gyp is installed.
unset npm_command || true
bash ./dev/build.sh -p

# ── Step 5: Apply AISHA default settings ─────────────────
echo ""
echo "── Step 5: Applying AISHA default settings..."

if [[ -f "${SCRIPT_DIR}/build/apply_default_settings.sh" && -d "./vscode" ]]; then
  bash "${SCRIPT_DIR}/build/apply_default_settings.sh" "./vscode"
fi

# ── Step 6: Install bundled extensions ────────────────────
echo ""
echo "── Step 6: Installing bundled AISHA extensions..."

if [[ -f "${SCRIPT_DIR}/build/install_bundled_extensions.sh" ]]; then
  bash "${SCRIPT_DIR}/build/install_bundled_extensions.sh" "$VSCODIUM_DIR" "$PLATFORM"
fi

# ── Step 7: Collect artifacts ─────────────────────────────
echo ""
echo "── Step 7: Collecting build artifacts..."

ARTIFACTS_DIR="${SCRIPT_DIR}/artifacts"
mkdir -p "$ARTIFACTS_DIR"

# ⛔ `-maxdepth 1` NESTAČÍ — VSCodium ukládá zabalené artefakty do `assets/`.
# Naměřeno 2026-08-09 na prvním úspěšném macOS buildu: krok doběhl, vypsal
# „Build complete! Artifacts: …/artifacts/" a ten adresář byl PRÁZDNÝ, zatímco
# vedle leželo 213 MB hotového `.zip`.
#
#   starý vzorec (maxdepth 1)  → 0 nálezů
#   nový   (maxdepth 2)        → ./assets/AISHA Workbench-darwin-arm64-*.zip
#
# ⭐ `find`, který nic nenajde, VRACÍ ÚSPĚCH. Krok tedy nemohl selhat, jen mlčky
# nic nezkopírovat — a hláška o dokončení pak tvrdila opak toho, co se stalo.
case "$PLATFORM" in
  linux)
    find . -maxdepth 2 \( -name "*.tar.gz" -o -name "*.deb" -o -name "*.rpm" -o -name "*.AppImage" \) -exec cp {} "$ARTIFACTS_DIR/" \;
    ;;
  osx)
    find . -maxdepth 2 \( -name "*.dmg" -o -name "*.zip" \) -exec cp {} "$ARTIFACTS_DIR/" \;
    ;;
  win32)
    find . -maxdepth 2 \( -name "*.exe" -o -name "*.msi" \) -exec cp {} "$ARTIFACTS_DIR/" \;
    ;;
esac

# Prázdný výsledek NENÍ úspěch. Build, který doběhl a nic nevyrobil, se musí
# poznat tady — ne až u toho, kdo si pro artefakt přijde.
if [ -z "$(ls -A "$ARTIFACTS_DIR" 2>/dev/null)" ]; then
  echo ""
  echo "⛔ Build doběhl, ale NEVYROBIL ŽÁDNÝ ARTEFAKT pro platformu '${PLATFORM}'."
  echo "   Hledalo se do hloubky 2 od $(pwd)."
  echo "   Buď se změnilo, kam VSCodium balí výstup, nebo build tiše skončil dřív."
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Build complete!"
echo "  Artifacts: ${ARTIFACTS_DIR}/"
ls -lh "$ARTIFACTS_DIR/" 2>/dev/null || echo "  (no artifacts found — check build output)"
echo "═══════════════════════════════════════════════════"

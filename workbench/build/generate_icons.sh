#!/usr/bin/env bash
# generate_icons.sh — Generate platform icons from master SVG
#
# Prerequisites: rsvg-convert (librsvg), iconutil (macOS), icotool (icoutils)
#
# macOS: brew install librsvg icoutils
# Linux: apt install librsvg2-bin icoutils
#
# Usage: ./generate_icons.sh [path/to/logo.svg]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SVG_INPUT="${1:-${ROOT_DIR}/icons/stable/aisha_logo.svg}"
RESOURCES_DIR="${ROOT_DIR}/src/stable/resources"

if [[ ! -f "$SVG_INPUT" ]]; then
  echo "ERROR: SVG source not found: ${SVG_INPUT}"
  exit 1
fi

echo "Generating icons from: ${SVG_INPUT}"

# ── PNG generation (all sizes) ────────────────────────────
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

SIZES=(16 32 48 64 128 256 512 1024)
for size in "${SIZES[@]}"; do
  echo "  PNG ${size}x${size}..."
  rsvg-convert -w "$size" -h "$size" "$SVG_INPUT" > "${TMP_DIR}/icon_${size}x${size}.png"
done

# ── Linux resources ───────────────────────────────────────
echo ""
echo "── Linux icons..."
mkdir -p "${RESOURCES_DIR}/linux/code-icons"

for size in 16 32 48 64 128 256 512; do
  cp "${TMP_DIR}/icon_${size}x${size}.png" "${RESOURCES_DIR}/linux/code-icons/${size}x${size}.png"
done
# Codium-compatible names
cp "${TMP_DIR}/icon_128x128.png" "${RESOURCES_DIR}/linux/code.png"
echo "   Done"

# ── macOS .icns ───────────────────────────────────────────
echo ""
echo "── macOS .icns..."
mkdir -p "${RESOURCES_DIR}/darwin"

if command -v iconutil &>/dev/null; then
  # macOS native — create iconset
  ICONSET_DIR="${TMP_DIR}/icon.iconset"
  mkdir -p "$ICONSET_DIR"

  cp "${TMP_DIR}/icon_16x16.png"   "${ICONSET_DIR}/icon_16x16.png"
  cp "${TMP_DIR}/icon_32x32.png"   "${ICONSET_DIR}/icon_16x16@2x.png"
  cp "${TMP_DIR}/icon_32x32.png"   "${ICONSET_DIR}/icon_32x32.png"
  cp "${TMP_DIR}/icon_64x64.png"   "${ICONSET_DIR}/icon_32x32@2x.png"
  cp "${TMP_DIR}/icon_128x128.png" "${ICONSET_DIR}/icon_128x128.png"
  cp "${TMP_DIR}/icon_256x256.png" "${ICONSET_DIR}/icon_128x128@2x.png"
  cp "${TMP_DIR}/icon_256x256.png" "${ICONSET_DIR}/icon_256x256.png"
  cp "${TMP_DIR}/icon_512x512.png" "${ICONSET_DIR}/icon_256x256@2x.png"
  cp "${TMP_DIR}/icon_512x512.png" "${ICONSET_DIR}/icon_512x512.png"
  cp "${TMP_DIR}/icon_1024x1024.png" "${ICONSET_DIR}/icon_512x512@2x.png"

  iconutil -c icns -o "${RESOURCES_DIR}/darwin/code.icns" "$ICONSET_DIR"
  echo "   Created code.icns via iconutil"
elif command -v png2icns &>/dev/null; then
  # Linux fallback
  png2icns "${RESOURCES_DIR}/darwin/code.icns" \
    "${TMP_DIR}/icon_16x16.png" \
    "${TMP_DIR}/icon_32x32.png" \
    "${TMP_DIR}/icon_128x128.png" \
    "${TMP_DIR}/icon_256x256.png" \
    "${TMP_DIR}/icon_512x512.png"
  echo "   Created code.icns via png2icns"
else
  echo "   SKIP: iconutil/png2icns not available"
fi

# ── Windows .ico ──────────────────────────────────────────
echo ""
echo "── Windows .ico..."
mkdir -p "${RESOURCES_DIR}/win32"

if command -v icotool &>/dev/null; then
  icotool -c \
    "${TMP_DIR}/icon_16x16.png" \
    "${TMP_DIR}/icon_32x32.png" \
    "${TMP_DIR}/icon_48x48.png" \
    "${TMP_DIR}/icon_64x64.png" \
    "${TMP_DIR}/icon_128x128.png" \
    "${TMP_DIR}/icon_256x256.png" \
    -o "${RESOURCES_DIR}/win32/code.ico"
  echo "   Created code.ico"
else
  echo "   SKIP: icotool not available"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Icon generation complete"
echo "  Output: ${RESOURCES_DIR}/"
find "${RESOURCES_DIR}" -type f | sort
echo "═══════════════════════════════════════════════════"

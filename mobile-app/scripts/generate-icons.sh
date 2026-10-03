#!/bin/bash
# generate-icons.sh — Generate all mobile app icons from the BRAND LOGO.
#
# White-label: the app is re-skinned per client, so the icon set is derived from
# the client's logo + the brand background — never from baked-in art or text.
#   • Logo   : $BRAND_LOGO, else assets/brand/logo.(svg|png), else the AISHA
#              fallback (../public/aisha.svg). SVG or PNG, transparent preferred.
#   • BG     : version.json → brand.backgroundColor (override with $BG).
#   • Output : assets/ (override with $OUT_DIR to preview without touching commits).
#
# NOTE: AISHA's shipped icons are hand-curated art, NOT produced by this script —
# do not regenerate them here. This path is for a client whose logo should drive
# a generated icon set.
#
# Requires: rsvg-convert (brew install librsvg) for SVG, ImageMagick (magick).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ASSETS_DIR="${OUT_DIR:-$PROJECT_ROOT/assets}"
IMAGES_DIR="$ASSETS_DIR/images"
# Identita z profilu instance — app-profile.sh čeká PROJECT_DIR.
PROJECT_DIR="$PROJECT_ROOT"
. "$SCRIPT_DIR/app-profile.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

MAGICK="$(command -v magick || command -v convert || true)"
if [ -z "$MAGICK" ]; then
  echo "Error: ImageMagick not found. Install with: brew install imagemagick" >&2
  exit 1
fi

# --- Brand background (from version.json brand.backgroundColor; $BG overrides) ---
if [ -z "${BG:-}" ]; then
  BG="$(node -e "try{process.stdout.write(require('$VERSION_FILE').brand.backgroundColor||'')}catch(e){}" 2>/dev/null || true)"
fi
BG="${BG:-#0E0E10}"

# --- Resolve the source logo ---
resolve_logo() {
  if [ -n "${BRAND_LOGO:-}" ] && [ -f "${BRAND_LOGO}" ]; then echo "$BRAND_LOGO"; return; fi
  for cand in \
    "$ASSETS_DIR/brand/logo.svg" "$ASSETS_DIR/brand/logo.png" \
    "$PROJECT_ROOT/assets/brand/logo.svg" "$PROJECT_ROOT/assets/brand/logo.png" \
    "$(dirname "$PROJECT_ROOT")/public/aisha.svg"; do
    [ -f "$cand" ] && { echo "$cand"; return; }
  done
  echo ""
}
LOGO_SRC="$(resolve_logo)"
if [ -z "$LOGO_SRC" ]; then
  echo "Error: no brand logo found. Set \$BRAND_LOGO or place assets/brand/logo.svg" >&2
  exit 1
fi

echo "📱 Generating app icons"
echo "   Logo:   $LOGO_SRC"
echo "   BG:     $BG"
echo "   Target: $ASSETS_DIR"

mkdir -p "$ASSETS_DIR" "$IMAGES_DIR"

# --- Rasterize the logo to a high-res transparent master (1024, contained) ---
LOGO_PNG="$TMP_DIR/logo.png"
case "$LOGO_SRC" in
  *.svg)
    command -v rsvg-convert >/dev/null 2>&1 \
      || { echo "Error: rsvg-convert needed for SVG logos. brew install librsvg" >&2; exit 1; }
    rsvg-convert -w 1024 -h 1024 --keep-aspect-ratio "$LOGO_SRC" -o "$LOGO_PNG"
    ;;
  *) "$MAGICK" "$LOGO_SRC" -resize 1024x1024 -background none -gravity center "$LOGO_PNG" ;;
esac

# canvas SIZE, inner LOGO %, background (color | "none"), output
compose() {
  local size="$1" pct="$2" bg="$3" out="$4"
  local inner=$(( size * pct / 100 ))
  "$MAGICK" "$LOGO_PNG" -resize "${inner}x${inner}" -background none -gravity center \
    -extent "${size}x${size}" \( -size "${size}x${size}" xc:"$bg" \) +swap \
    -gravity center -compose over -composite "$out"
}
# white silhouette (Android notification: system re-tints, so ship white-on-transparent)
compose_white() {
  local size="$1" pct="$2" out="$3"
  local inner=$(( size * pct / 100 ))
  "$MAGICK" "$LOGO_PNG" -resize "${inner}x${inner}" \
    -channel A -threshold 1% +channel -fill white -colorize 100 \
    -background none -gravity center -extent "${size}x${size}" "$out"
}

echo "  → icon.png (1024, opaque)"                ; compose 1024 64 "$BG"  "$ASSETS_DIR/icon.png"
echo "  → adaptive-icon.png (1024, transparent fg)"; compose 1024 60 none  "$ASSETS_DIR/adaptive-icon.png"
echo "  → favicon.png (48)"                        ; compose 48   64 "$BG"  "$ASSETS_DIR/favicon.png"
echo "  → notification_icon.png (96, white)"       ; compose_white 96 72    "$ASSETS_DIR/notification_icon.png"
echo "  → splash-icon.png (200, transparent)"      ; compose 200  60 none  "$ASSETS_DIR/splash-icon.png"
echo "  → splash-icon-dark.png (200, transparent)" ; cp "$ASSETS_DIR/splash-icon.png" "$ASSETS_DIR/splash-icon-dark.png"
echo "  → splash.png (1242x2436, opaque)"          ; \
  "$MAGICK" -size 1242x2436 xc:"$BG" \
    \( "$LOGO_PNG" -resize 420x420 \) -gravity center -compose over -composite "$ASSETS_DIR/splash.png"

echo "  → Syncing to assets/images/"
for f in icon adaptive-icon favicon splash-icon splash-icon-dark; do
  cp "$ASSETS_DIR/$f.png" "$IMAGES_DIR/$f.png"
done

echo ""
echo "✅ Icons generated from $LOGO_SRC"
ls -la "$ASSETS_DIR"/*.png

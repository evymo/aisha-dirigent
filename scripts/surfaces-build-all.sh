#!/usr/bin/env bash
# =============================================================================
# Build every surface shell against every instance overlay.
# =============================================================================
# THE PROPERTY: the shells are generic and the overlay is the only thing that
# differs. That claim is only worth what a build proves — a shell can compile
# for the overlay its author had open and fail for the next one, and nothing
# else in CI would notice.
#
# The assertions after each build are the point. A shell can build "successfully"
# while silently emitting no instance assets (the vite plugin walks
# <overlay>/public and emits what it finds — an empty or misplaced directory
# produces a green build and a bundle with no branding, no theme, no manifest).
# So each build is followed by a check that the overlay actually landed.
#
# This step existed in the surfaces repo's CI and was lost when that repo was
# dissolved into this one (2026-07-27). Restored 2026-07-28 as a script rather
# than inline CI, so the same check can be run before pushing:
#
#   npm run surfaces:build:all
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# A BUILDABLE overlay is one that carries app.config.json — that is the file the
# shells' vite config opens, so it is the property that decides, not the presence
# of a directory. Since 2026-08-01 an instance's assets live in its own data repo
# and reach the image through SURFACE_OVERLAY_GIT_URL; what stays here is the
# translation file, which the i18n parity gate needs. Such a directory is a
# TRANSLATION overlay, not a build target — iterating over it built nothing and
# died on the missing config, which read as "the shells are broken" instead of
# "these assets are not in this repo".
shopt -s nullglob
overlays=()
preskocene=()
for dir in instances/*/; do
  if [ -f "${dir}app.config.json" ]; then overlays+=("$dir"); else preskocene+=("$dir"); fi
done

# Skipping is only honest if it is stated. A silent skip would make an overlay
# that quietly lost its config look like an overlay that passed.
for dir in "${preskocene[@]}"; do
  echo "— overlay '$(basename "$dir")' přeskočen: nemá app.config.json (assets jsou v instančním repu, viz SURFACE_OVERLAY_GIT_URL); zdejší soubory: $(cd "$dir" && ls | tr '\n' ' ')"
done

if [ ${#overlays[@]} -eq 0 ]; then
  echo "FAIL: no buildable overlay under instances/ — nothing to build against." >&2
  echo "      A pass here would prove nothing about instance-independence." >&2
  exit 1
fi

for dir in "${overlays[@]}"; do
  name="$(basename "$dir")"
  echo "=== overlay: $name ==="


  AISHA_INSTANCE_DIR="../../instances/$name" npm run build -w apps/workbench-shell
  for f in tokens.css index.html; do
    test -f "apps/workbench-shell/dist/$f" \
      || { echo "FAIL: workbench-shell built for '$name' without $f" >&2; exit 1; }
  done
done

echo "OK: every shell builds for every buildable overlay (${#overlays[@]} built, ${#preskocene[@]} translation-only)."

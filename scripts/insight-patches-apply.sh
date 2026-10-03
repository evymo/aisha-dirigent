#!/usr/bin/env bash
# =============================================================================
# insight-patches-apply.sh — Idempotentní applier AISHA patches na Insight submodule
# =============================================================================
#
# Pattern: vendoring-with-patches (Debian/Yocto/Buildroot style).
# Submodule packages/insight je pinný na konkrétní upstream commit; AISHA-specific
# úpravy jsou v aisha/insight-patches/ jako numbered patch soubory. Tento script
# je aplikuje v pořadí (lex sort).
#
# Použití:
#   bash scripts/insight-patches-apply.sh           # apply (default)
#   bash scripts/insight-patches-apply.sh --check   # dry-run; non-zero pokud nesedí
#   bash scripts/insight-patches-apply.sh --reset   # revert submodule + re-apply
#
# Idempotence:
#   `git apply --check` před každým patchem; pokud je už aplikovaný (revert by
#   prošel), patch se přeskočí. Pokud není ani aplikovaný ani applikovatelný
#   = konflikt (upstream se posunul) → exit 1 s instrukcí pro upgrade workflow.
#
# Volá se z:
#   • Local dev: po `git submodule update` nebo `git submodule init`
#   • Dockerfile.maestro: multi-stage `patcher` stage před COPY do runtime
#   • Cold-start.sh: před deploy buildem (preflight invariant)
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCHES_DIR="$ROOT/aisha/insight-patches"
SUBMODULE_DIR="$ROOT/packages/insight"

MODE="apply"
case "${1:-}" in
  --check) MODE="check" ;;
  --reset) MODE="reset" ;;
  --help|-h)
    sed -n '2,30p' "$0"
    exit 0
    ;;
  "") ;;
  *) echo "ERR unknown arg: $1" >&2; exit 2 ;;
esac

# ── Color/log helpers ────────────────────────────────────────────────────────
if [ -t 1 ]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; NC=""
fi
info()  { echo "${BLUE}ℹ${NC}  $*"; }
ok()    { echo "${GREEN}✓${NC} $*"; }
warn()  { echo "${YELLOW}⚠${NC}  $*" >&2; }
err()   { echo "${RED}✗${NC} $*" >&2; }

# ── Sanity checks ────────────────────────────────────────────────────────────
if [ ! -d "$SUBMODULE_DIR" ]; then
  err "submodule not found: $SUBMODULE_DIR — run \`git submodule update --init\` first"
  exit 1
fi
if [ ! -f "$SUBMODULE_DIR/.git" ] && [ ! -d "$SUBMODULE_DIR/.git" ]; then
  err "submodule not initialized: $SUBMODULE_DIR/.git missing"
  exit 1
fi
if [ ! -d "$PATCHES_DIR" ] || [ -z "$(find "$PATCHES_DIR" -maxdepth 1 -name '*.patch' -print -quit 2>/dev/null)" ]; then
  warn "no patches found in $PATCHES_DIR — nothing to apply"
  exit 0
fi

# ── Reset mode (clean submodule before re-apply) ─────────────────────────────
if [ "$MODE" = "reset" ]; then
  info "reset: cleaning submodule WD"
  cd "$SUBMODULE_DIR"
  git checkout -- .
  # Remove untracked files added by previous patch runs
  git clean -fd
  cd "$ROOT"
  ok "submodule reset to pinned commit ($(cd "$SUBMODULE_DIR" && git rev-parse HEAD | cut -c1-12))"
  MODE="apply"
fi

# ── Apply patches in order ───────────────────────────────────────────────────
PINNED=$(cd "$SUBMODULE_DIR" && git rev-parse HEAD)
info "submodule pinned at: ${PINNED:0:12}"
info "patches dir:        $PATCHES_DIR"
info "mode:               $MODE"
echo

APPLIED=0
SKIPPED=0
FAILED=0
for patch in "$PATCHES_DIR"/*.patch; do
  [ -f "$patch" ] || continue
  name=$(basename "$patch")

  # Strip our header (lines starting with `# `) — git apply needs raw diff.
  # Header is everything before first `diff --git` line.
  raw=$(awk '/^diff --git/{found=1} found' "$patch")
  if [ -z "$raw" ]; then
    err "$name: no diff content found (only header?)"
    FAILED=$((FAILED+1))
    continue
  fi

  cd "$SUBMODULE_DIR"

  # Check 1: is it already applied? (try reverse apply --check)
  if echo "$raw" | git apply --reverse --check >/dev/null 2>&1; then
    ok "$name — already applied (skipping)"
    SKIPPED=$((SKIPPED+1))
    cd "$ROOT"
    continue
  fi

  # Check 2: can it be applied cleanly?
  if ! echo "$raw" | git apply --check >/dev/null 2>&1; then
    err "$name — patch does not apply cleanly to current submodule state"
    err "  Pinned commit: $PINNED"
    err "  Upgrade workflow:"
    err "    1. cd packages/insight && pull/checkout target version"
    err "    2. Manually re-apply changes (likely small fixups)"
    err "    3. cd packages/insight && git diff > ../../$PATCHES_DIR/$name"
    err "    4. Update # Target: header in patch with new commit SHA"
    err "    5. cd .. && git add packages/insight $PATCHES_DIR/$name && commit"
    cd "$ROOT"
    FAILED=$((FAILED+1))
    continue
  fi

  if [ "$MODE" = "check" ]; then
    ok "$name — would apply cleanly"
    APPLIED=$((APPLIED+1))
    cd "$ROOT"
    continue
  fi

  # Apply
  echo "$raw" | git apply
  ok "$name — applied"
  APPLIED=$((APPLIED+1))
  cd "$ROOT"
done

echo
info "Summary: ${APPLIED} applied, ${SKIPPED} already-present, ${FAILED} failed"
[ "$FAILED" -eq 0 ]

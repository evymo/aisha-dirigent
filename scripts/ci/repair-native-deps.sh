#!/usr/bin/env bash
# =============================================================================
# repair-native-deps.sh — deterministic npm/cli#4828 repair for CI
# =============================================================================
# `npm ci` intermittently skips platform-specific OPTIONAL deps (npm/cli#4828).
# Observed live on the soren runner, layer by layer:
#   run 1832  Web: Tests   → "Cannot find module @rollup/rollup-linux-x64-gnu"
#   run 1840  Web: Tests   → vitest.config.ts → @swc/core →
#                            "Cannot find module './swc.linux-x64-gnu.node'"
#   run 1846  Web: Tests   → two-call repair undid itself: npm reconciles
#                            node_modules against the lockfile on EVERY
#                            install, so the second `npm i --no-save` evicted
#                            the first package
#   run 1850  coldstart    → same rollup failure in the coldstart job's OWN
#                            npm ci + vitest (self-eval RPC suite)
#
# Strategy: collect every missing native binding FIRST, install them in ONE
# `npm i --no-save` call, each pinned at runtime to the INSTALLED parent
# version (zero drift), then assert both bindings load. No-op on healthy
# installs. Shared by every job that runs vite/vitest after a repo-root
# `npm ci` (test-web, build-web, coldstart-db-gate).
# =============================================================================
set -euo pipefail

# Derive the native-binding suffix for THIS host instead of hardcoding linux-x64.
# On the linux-x64 CI runner this resolves to the exact same names as before
# (linux-x64-gnu) → behaviour unchanged where the repair actually matters; on a
# darwin/arm64 dev sweep it targets darwin-arm64, so the probe no longer fails
# spuriously and never emits a bogus ::warning:: + EBADPLATFORM linux-x64 install.
PLATFORM=$(node -p "process.platform")   # linux | darwin | win32
ARCH=$(node -p "process.arch")           # x64 | arm64
case "$PLATFORM" in
  linux) LIBC="-gnu" ;;
  win32) LIBC="-msvc" ;;
  *)     LIBC="" ;;   # darwin
esac
ROLLUP_BINDING="@rollup/rollup-${PLATFORM}-${ARCH}${LIBC}"
SWC_BINDING="@swc/core-${PLATFORM}-${ARCH}${LIBC}"

MISSING=""

if ! node -e "require('${ROLLUP_BINDING}')" >/dev/null 2>&1; then
  MISSING="$MISSING ${ROLLUP_BINDING}@$(node -p "require('rollup/package.json').version")"
fi
if ! node -e "require('@swc/core')" >/dev/null 2>&1; then
  MISSING="$MISSING ${SWC_BINDING}@$(node -p "require('@swc/core/package.json').version")"
fi

if [ -n "$MISSING" ]; then
  echo "::warning::native optional deps missing after npm ci (npm/cli#4828) — repairing:$MISSING"
  # shellcheck disable=SC2086
  npm i --no-save $MISSING
  node -e "require('${ROLLUP_BINDING}')"
  node -e "require('@swc/core')"
else
  echo "native optional deps OK (rollup + @swc/core bindings load)"
fi

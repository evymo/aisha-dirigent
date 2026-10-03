#!/usr/bin/env bash
# Build all @aisha workspace LIBS (packages/*) so services that import them resolve
# their dist/ entry points. `npm ci` does NOT build them (no prepare/postinstall;
# root `build` is the web app), so service vitest suites in CI otherwise fail with
# "Failed to resolve entry for package @aisha/security". Locally they pass only
# because a prior build left dist/ behind — exactly why CI needs this explicit step.
#
# Multi-pass: a package whose @aisha deps aren't built yet fails on pass N and
# succeeds on N+1 (plain `tsc`, no project-reference topo-sort). Packages without a
# build script (e.g. design-tokens, insight) are skipped. A real build error still
# fails the step after the passes — it is not masked.
set -u
cd "$(dirname "$0")/../.." || exit 1

pkgs=()
for d in packages/*/; do
  if node -e "process.exit(require('./${d}package.json').scripts && require('./${d}package.json').scripts.build ? 0 : 1)" 2>/dev/null; then
    pkgs+=("$d")
  fi
done
echo "build:packages — ${#pkgs[@]} buildable package(s)"

for pass in 1 2 3; do
  remaining=()
  for d in "${pkgs[@]}"; do
    if ! npm --prefix "$d" run build >/dev/null 2>&1; then remaining+=("$d"); fi
  done
  if [ ${#remaining[@]} -eq 0 ]; then
    echo "✓ all packages built (pass ${pass})"
    exit 0
  fi
  echo "pass ${pass}: ${#remaining[@]} still failing (${remaining[*]}) — retrying"
  pkgs=("${remaining[@]}")
done

echo "✗ packages still failing after 3 passes: ${pkgs[*]}"
# Surface the real error from the first still-failing package.
npm --prefix "${pkgs[0]}" run build
exit 1

#!/usr/bin/env bash
# Build all @aisha workspace LIBS (packages/*) so services that import them resolve
# their dist/ entry points. `npm ci` does NOT build them (no prepare/postinstall;
# root `build` is the web app), so service vitest suites in CI otherwise fail with
# "Failed to resolve entry for package @aisha/security". Locally they pass only
# because a prior build left dist/ behind — exactly why CI needs this explicit step.
#
# ORDER comes from the workspace dependency graph — scripts/lib/poradi-sestaveni-balicku.mjs,
# the same module the publish runner reads: a package is built after every repo
# package it depends on, and packages without a build script are left out. With a
# complete graph everything builds on pass 1.
#
# The passes stay as a net for a dependency the graph cannot see (an import that
# package.json does not declare): such a package fails on pass N and succeeds on
# N+1. The net must not HIDE the hole — the retries used to stand in for a missing
# build order and nobody saw it. A package that builds only on a retry is therefore
# named out loud, with what it means. A real build error still fails the step after
# the passes — it is not masked.
set -u
cd "$(dirname "$0")/../.." || exit 1

if ! order="$(node scripts/lib/poradi-sestaveni-balicku.mjs --seznam)"; then
  echo "✗ build order could not be derived (see the message above)"
  exit 1
fi
pkgs=()
while IFS= read -r d; do
  [ -n "$d" ] && pkgs+=("$d/")
done <<< "$order"
if [ ${#pkgs[@]} -eq 0 ]; then
  echo "✗ no buildable package found — the order module returned nothing"
  exit 1
fi
echo "build:packages — ${#pkgs[@]} buildable package(s), in dependency order"

late=()
for pass in 1 2 3; do
  remaining=()
  for d in "${pkgs[@]}"; do
    if npm --prefix "$d" run build >/dev/null 2>&1; then
      if [ "$pass" -gt 1 ]; then late+=("${d%/}"); fi
    else
      remaining+=("$d")
    fi
  done
  if [ ${#remaining[@]} -eq 0 ]; then
    echo "✓ all packages built (pass ${pass})"
    if [ ${#late[@]} -gt 0 ]; then
      echo "⚠ built only on a retry: ${late[*]}"
      echo "  Each of these needs another package of this repo WITHOUT declaring it in its"
      echo "  package.json, so the dependency graph has no edge for it. The retry hides that"
      echo "  here; the publish runner builds in graph order only and would fail. Declare the"
      echo "  dependency in package.json."
      echo "::warning title=build:packages::undeclared repo dependency — built only on a retry: ${late[*]}"
    fi
    exit 0
  fi
  echo "pass ${pass}: ${#remaining[@]} still failing (${remaining[*]}) — retrying"
  pkgs=("${remaining[@]}")
done

echo "✗ packages still failing after 3 passes: ${pkgs[*]}"
# Surface the real error from the first still-failing package.
npm --prefix "${pkgs[0]}" run build
exit 1

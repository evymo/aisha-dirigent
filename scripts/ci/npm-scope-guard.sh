#!/usr/bin/env bash
# =============================================================================
# npm-scope-guard.sh — cwd-INDEPENDENT pin of the private scopes to Verdaccio.
# =============================================================================
# THE CLASS (seen ≥2×): npm invoked with cwd inside a service/package dir (or
# with --no-workspaces) does NOT load the repo-root .npmrc, so the
# `@aisha:registry=${VERDACCIO_URL}` mapping vanishes and npm silently falls
# back to the PUBLIC registry:
#   - availability: `404 '@aisha/observability@*' is not in this registry`
#     (the 2026-07-14 av-integration failure),
#   - supply chain: a public package squatting the @aisha/@evymo scope would be
#     INSTALLED — dependency confusion.
# The SBOM job's per-dir `.npmrc` copy fixed one instance; this guard fixes the
# CLASS: a USER-level npmrc applies to every npm run on this runner regardless
# of cwd or workspace flags.
#
# Fail-loud (repo HARD rule — no fallbacks): if VERDACCIO_URL is empty, the
# private scopes CANNOT resolve safely → exit 1, never fall through to npmjs.
#
# Usage (CI step, before anything that may run npm outside the repo root):
#   bash scripts/ci/npm-scope-guard.sh
# =============================================================================
set -euo pipefail

if [ -z "${VERDACCIO_URL:-}" ]; then
  echo "::error title=npm-scope-guard::VERDACCIO_URL is EMPTY — @aisha/@evymo packages cannot resolve safely (public-registry fallback = dependency-confusion risk). Set the VERDACCIO_URL CI variable." >&2
  exit 1
fi

npm config set "@aisha:registry=${VERDACCIO_URL}"  --location=user
npm config set "@evymo:registry=${VERDACCIO_URL}" --location=user
echo "npm-scope-guard: @aisha + @evymo pinned to Verdaccio (user-level, cwd-independent)"

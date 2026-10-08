#!/usr/bin/env bash
# =============================================================================
# npm-scope-guard.sh — cwd-INDEPENDENT pin of the private scopes.
# =============================================================================
# THE CLASS (seen ≥2×): npm invoked with cwd inside a service/package dir (or
# with --no-workspaces) does NOT load the repo-root .npmrc, so a scope mapping
# vanishes and npm silently falls back to the PUBLIC registry:
#   - availability: `404 '@aisha/observability@*' is not in this registry`
#     (the 2026-07-14 av-integration failure),
#   - supply chain: a public package squatting the @aisha/@evymo scope would be
#     INSTALLED — dependency confusion.
# The SBOM job's per-dir `.npmrc` copy fixed one instance; this guard fixes the
# CLASS: a USER-level npmrc applies to every npm run on this runner regardless
# of cwd or workspace flags.
#
# Where the scopes point:
#   · VERDACCIO_URL set (opt-in private registry) → there;
#   · VERDACCIO_URL empty (the default — @aisha/* are npm WORKSPACES built from
#     source, nothing private is ever fetched) → to a registry that can NEVER
#     resolve (`.invalid` is reserved, RFC 2606). A stray lookup of a private
#     scope then FAILS LOUD instead of installing whatever squats the name on the
#     public registry. Never a fallback to npmjs.
#
# Usage (CI step, before anything that may run npm outside the repo root):
#   bash scripts/ci/npm-scope-guard.sh
# =============================================================================
set -euo pipefail

if [ -n "${VERDACCIO_URL:-}" ]; then
  CIL="$VERDACCIO_URL"
  POPIS="Verdaccio (${VERDACCIO_URL})"
else
  CIL="https://private-scope.invalid/"
  POPIS="nedosažitelný registr (VERDACCIO_URL nenastaven — soukromé scope jsou jen workspaces; dotaz na registr selže nahlas, nikdy nespadne na npmjs)"
fi

npm config set "@aisha:registry=${CIL}"  --location=user
npm config set "@evymo:registry=${CIL}" --location=user
echo "npm-scope-guard: @aisha + @evymo → ${POPIS} (user-level, cwd-independent)"

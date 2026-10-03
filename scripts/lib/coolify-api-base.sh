#!/usr/bin/env bash
# coolify-api-base.sh — resolve a fully-normalized Coolify API base: <host>/api/v1.
#
# Precedence: COOLIFY_API → COOLIFY_URL → COOLIFY_BASE_URL. IDEMPOTENT: appends
# /api/v1 only if missing; strips a trailing slash. Fixes the footgun where a
# non-empty COOLIFY_API lacking /api/v1 (e.g. `export COOLIFY_API=$COOLIFY_URL`,
# where COOLIFY_URL is the bare host from the token file) was used verbatim →
# `<host>/applications` → 404/HTML → the caller found zero apps and aborted with
# "Žádná aplikace nevyhovuje filtru" (incident 2026-07-05, netbird redeploy).
#
# The old per-script `if [ -z "$COOLIFY_API" ]; then derive from COOLIFY_URL`
# pattern only fixed the UNSET half — a set-but-bare COOLIFY_API still broke.
# This helper normalizes BOTH halves. Source it and call:
#   source "$ROOT/scripts/lib/coolify-api-base.sh"
#   COOLIFY_API="$(resolve_coolify_api)" || exit 1
#
# The URL falls back to the SAME canonical on-disk chain the token does
# (lib/config-env-files.mjs). Without that, every caller here resolved its token
# through the chain but its host from exported env only — so on a stack whose
# COOLIFY_URL lives in .env.coolify (i.e. any stack that has not been
# hand-exported), all six callers aborted with "COOLIFY_API or COOLIFY_URL
# required" while the value sat in the repo. That is the same split-brain
# config-env-files.mjs was written to end, reappearing one layer up.
resolve_coolify_api() {
  local base="${COOLIFY_API:-${COOLIFY_URL:-${COOLIFY_BASE_URL:-}}}"
  if [ -z "$base" ]; then
    # config_env_key comes from lib/coolify-credentials.sh when that is also
    # sourced; fall back to invoking the chain directly so this file stays
    # usable standalone. Failure is non-fatal — the [ -n ] guard below reports.
    if command -v config_env_key >/dev/null 2>&1; then
      base="$(config_env_key COOLIFY_API COOLIFY_URL COOLIFY_BASE_URL 2>/dev/null)"
    else
      local _lib_root
      _lib_root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
      base="$(node "$_lib_root/scripts/lib/config-env-files.mjs" \
        --get COOLIFY_API COOLIFY_URL COOLIFY_BASE_URL 2>/dev/null)"
    fi
  fi
  [ -n "$base" ] || {
    echo "resolve_coolify_api: COOLIFY_API or COOLIFY_URL required (e.g. COOLIFY_URL=https://your-coolify-host)" >&2
    return 1
  }
  case "$base" in
    http://*|https://*) ;;
    *) echo "resolve_coolify_api: must be an absolute http(s) URL, got: $base" >&2; return 1 ;;
  esac
  base="${base%/}"
  case "$base" in
    */api/v1) printf '%s' "$base" ;;
    *)        printf '%s/api/v1' "$base" ;;
  esac
}

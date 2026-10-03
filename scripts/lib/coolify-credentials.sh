#!/usr/bin/env bash
# coolify-credentials.sh — resolve Coolify credentials the same way every tool does.
#
# WHY: ~22 shell scripts in this directory hand-roll
#   grep -E '^COOLIFY_API_TOKEN=' "$ROOT/.env-prod-backup"
# and therefore all share one blind spot: cold-start writes credentials to
# .env.coolify and only mirrors them into .env-prod-backup when the operator
# takes a vault snapshot. On a stack that has never been snapshotted the file
# does not exist, so these scripts abort with "COOLIFY_API_TOKEN nenalezen"
# even though the token is sitting in the repo — which is what pushes operators
# into hand-exporting the value, and a Coolify Sanctum token is `id|secret`, so
# the `|` does not survive naive shell sourcing.
#
# The chain itself lives in exactly ONE place (lib/config-env-files.mjs) and is
# delegated to from here rather than re-implemented in bash — the same
# cross-language delegation lib/coolify-project-scope.mjs uses for the project
# boundary. Adding a file to the chain therefore changes every tool at once.
#
# Usage:
#   source "$ROOT/scripts/lib/coolify-credentials.sh"
#   TOKEN="$(resolve_coolify_token)" || exit 1
#
# Precedence: an exported env var always wins; the files are the fallback.

# Resolve one key from the canonical chain. Env wins, then the files.
# Prints the value; returns 1 (and prints nothing) when unresolved.
config_env_key() {
  local key
  for key in "$@"; do
    # ${!key} — indirect expansion; an exported var beats any file.
    if [ -n "${!key:-}" ]; then
      printf '%s\n' "${!key}"
      return 0
    fi
  done
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  node "$root/scripts/lib/config-env-files.mjs" --get "$@" 2>/dev/null
}

# The API token, under either of the two names this toolchain uses.
resolve_coolify_token() {
  local token
  token="$(config_env_key COOLIFY_API_TOKEN COOLIFY_API_KEY)"
  if [ -z "$token" ]; then
    # Name the chain — "not found" without the search path is unactionable.
    echo "❌ COOLIFY_API_TOKEN not found in env or any of: config/domains.env, .env.coolify, .env.local, .env-prod-backup, .env.aisha" >&2
    return 1
  fi
  printf '%s\n' "$token"
}

# The Coolify base URL, under either of the two names this toolchain uses.
resolve_coolify_url() {
  config_env_key COOLIFY_URL COOLIFY_BASE_URL
}

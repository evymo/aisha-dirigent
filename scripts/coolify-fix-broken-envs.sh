#!/usr/bin/env bash
# Credentials come from the shared canonical chain, not one hardcoded file.
# shellcheck source=scripts/lib/coolify-credentials.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/coolify-credentials.sh" 2>/dev/null || \
  . "$(cd "$(dirname "$0")" && pwd)/lib/coolify-credentials.sh"

# Patch aisha-* apps whose STACK-SHARED secret env values were truncated to a
# literal "${VAR" by Coolify's $-escaping (feedback_coolify_label_dollar_escape).
#
# The correct value is resolved DYNAMICALLY — never hardcoded in this file —
# from a HEALTHY copy: a sibling app that still holds the real value, else the
# operator's local .env.coolify (the gitignored canonical source). Scope is
# limited to the small set of KNOWN stack-shared secrets below (identical on
# every app that uses them, so a sibling's value is authoritative); anything
# else is REPORTED, never auto-patched, so an app-specific key can't be
# cross-contaminated with an unrelated sibling's value. Zero secrets live here.
#
# Deliberately bash-3.2 compatible (macOS /bin/bash): no associative arrays.
# No `set -e` — a single slow/failed Coolify call must not abandon the run.
set -o pipefail

TOKEN="${COOLIFY_API_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f .env-prod-backup ]; then
  TOKEN="$(config_env_key COOLIFY_API_TOKEN COOLIFY_API_KEY)"
fi
[ -z "$TOKEN" ] && { echo "No COOLIFY_API_TOKEN (env or .env-prod-backup)"; exit 1; }
# shellcheck source=scripts/lib/coolify-api-base.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/coolify-api-base.sh"
COOLIFY_API="$(resolve_coolify_api)" || exit 1  # normalizes to <host>/api/v1 (COOLIFY_API|COOLIFY_URL)
APPS_TSV="${APPS_TSV:-/tmp/aisha-apps.tsv}"
if [ ! -s "$APPS_TSV" ]; then
  echo "APPS_TSV missing or empty: $APPS_TSV (expected a TSV of '<name><TAB><uuid>')"; exit 1
fi

# Coolify v4 has documented 20-40s stretches (reference_coolify_api_unified_retry),
# so a 10s cap produced spurious timeouts. 40s per call.
TIMEOUT=40

# Stack-shared secrets — NAMES only (never values). Identical across every app
# that uses them, so a healthy sibling copy is authoritative. Leading/trailing
# spaces make the whole-word `case` match below exact.
KNOWN_SHARED_KEYS=" S3_ACCESS_KEY S3_SECRET_KEY BROKER_TOKEN_SECRET NOCODB_DB_PASSWORD LANGFUSE_DB_PASSWORD KEYCLOAK_DB_PASSWORD SYNAPSE_DB_PASSWORD N8N_DB_PASSWORD "
is_shared() { case "$KNOWN_SHARED_KEYS" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

fetch_envs() { # $1=uuid → JSON env array (control chars stripped); empty on failure
  curl -sS --http1.1 --max-time "$TIMEOUT" -H "Authorization: Bearer $TOKEN" \
    "${COOLIFY_API}/applications/$1/envs" 2>/dev/null | tr -d '\000-\037' || true
}

strip_quotes() { # stdin → strip trailing CR + one layer of surrounding ' or "
  local v; v=$(tr -d '\r')
  v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
  printf '%s' "$v"
}

# bash 3.2 has no associative arrays — cache one healthy value per shared KEY in
# a temp TSV (KEY<TAB>VALUE).
HEALTHY_TSV=$(mktemp "${TMPDIR:-/tmp}/aisha-healthy.XXXXXX") || exit 1
trap 'rm -f "$HEALTHY_TSV"' EXIT

# ── Pass 1 — collect one healthy (non-${) value per shared KEY from any app. ──
while IFS=$'\t' read -r NAME UUID; do
  [ -z "${UUID:-}" ] && continue
  while IFS=$'\t' read -r KEY VAL; do
    [ -z "${KEY:-}" ] && continue
    is_shared "$KEY" || continue
    case "$VAL" in *'${'*) continue ;; esac       # itself corrupted → skip
    [ -z "$VAL" ] && continue
    awk -F'\t' -v k="$KEY" 'BEGIN{f=1} $1==k{f=0} END{exit f}' "$HEALTHY_TSV" && continue  # first wins
    printf '%s\t%s\n' "$KEY" "$VAL" >> "$HEALTHY_TSV"
  done < <(fetch_envs "$UUID" | jq -r '.[] | [.key, (.value|tostring)] | @tsv' 2>/dev/null)
done < "$APPS_TSV"

resolve_value() { # $1=KEY → healthy value (sibling first, else local .env.coolify); empty if none
  local key="$1" val
  val=$(awk -F'\t' -v k="$key" '$1==k{print $2; exit}' "$HEALTHY_TSV" 2>/dev/null)
  if [ -z "$val" ] && [ -f .env.coolify ]; then
    val=$(grep "^${key}=" .env.coolify 2>/dev/null | head -1 | cut -d= -f2- | strip_quotes)
    case "$val" in *'${'*) val= ;; esac
  fi
  printf '%s' "$val"
}

# ── Pass 2 — patch corrupted shared-key entries (never echo the value). ───────
while IFS=$'\t' read -r NAME UUID; do
  [ -z "${UUID:-}" ] && continue
  echo "── $NAME ($UUID) ──"
  while IFS=$'\t' read -r KEY ENV_UUID VAL; do
    [ -z "${KEY:-}" ] && continue
    if ! is_shared "$KEY"; then
      echo "  ⚠ SKIP $KEY — app-specific corrupted value, report-only (not auto-patched)"
      continue
    fi
    NEWVAL=$(resolve_value "$KEY")
    if [ -z "$NEWVAL" ]; then
      echo "  ⚠ UNKNOWN $KEY — no healthy sibling or local .env.coolify value to restore"
      continue
    fi
    BODY=$(jq -nc --arg k "$KEY" --arg v "$NEWVAL" '{key:$k,value:$v,is_preview:false,is_literal:true}' 2>/dev/null)
    RESP=$(curl -sS --http1.1 --max-time "$TIMEOUT" -X PATCH \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "$BODY" "${COOLIFY_API}/applications/$UUID/envs" 2>/dev/null | tr -d '\000-\037' || true)
    if grep -q '"value"' <<< "$RESP"; then
      echo "  ✓ $KEY restored"
    else
      echo "  ✗ $KEY: ${RESP:-<no response / request failed>}"
    fi
  done < <(fetch_envs "$UUID" | jq -r '.[] | select(.value|tostring|test("\\$\\{")) | [.key, .uuid, (.value|tostring)] | @tsv' 2>/dev/null)
done < "$APPS_TSV"

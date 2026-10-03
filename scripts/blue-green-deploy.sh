#!/usr/bin/env bash
# Credentials come from the shared canonical chain, not one hardcoded file.
# shellcheck source=scripts/lib/coolify-credentials.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/coolify-credentials.sh" 2>/dev/null || \
  . "$(cd "$(dirname "$0")" && pwd)/lib/coolify-credentials.sh"

# =============================================================================
# blue-green-deploy.sh — B/G switch pro AISHA stack přes Coolify API
# =============================================================================
# !! ROLE: MANUAL FALLBACK / OPERATOR OVERRIDE !!
#
# Production primary path je n8n workflow `aisha-blue-green-orchestrator`,
# který je triggerován Coolify webhookem po deploy events. Tento skript se
# používá jen pro:
#   - Incident response (n8n je down nebo nedostupný)
#   - Lokální testing před deploymentem n8n workflow
#   - Hromadný switch (více apps najednou) z CLI
#   - Audit / rollback v post-mortem
#
# Implementuje "Varianta A" z docs/deploy/BLUE_GREEN_DESIGN.md:
#   - dvě Coolify apps per stack (X-blue, X-green)
#   - identical compose, BG_ACTIVE_HOST env var ovládá Traefik router rule
#   - switch = PATCH env vars + trigger redeploy obou apps
#
# Vyžaduje předem nastavený B/G pair v Coolify (přes story-init s manifest
# flagem `bluegreen=on`):
#   aisha-keycloak-blue (BG_SLOT=blue)
#   aisha-keycloak-green (BG_SLOT=green)
# Z toho jeden má BG_ACTIVE_HOST=auth.example.com, druhý prázdný.
#
# Usage:
#   bash scripts/blue-green-deploy.sh keycloak             # switch live → idle slot
#   bash scripts/blue-green-deploy.sh keycloak --rollback  # opačný směr (pokud poslední switch padl)
#   bash scripts/blue-green-deploy.sh keycloak --status    # current active slot
#   bash scripts/blue-green-deploy.sh keycloak --dry-run
#
# STATUS: STUB — implementace skeleton. Před produkčním použitím:
#   1. Validovat compose Traefik label parametrizace
#   2. Doplnit smoke endpointy v config/blue-green-smoke.mjs
#   3. Plno-testovat na staging
#   4. Deploynout n8n workflow `aisha-blue-green-orchestrator`
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export AISHA_LOG_COMPONENT="bluegreen"
# shellcheck source=lib/log.sh
. "$SCRIPT_DIR/lib/log.sh"
# shellcheck source=lib/metrics.sh
. "$SCRIPT_DIR/lib/metrics.sh"

# ── Args ────────────────────────────────────────────────────────────────────
APP=""
ROLLBACK=0
STATUS_ONLY=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rollback) ROLLBACK=1; shift ;;
    --status)   STATUS_ONLY=1; shift ;;
    --dry-run)  DRY_RUN=1; shift ;;
    -h|--help)  head -25 "$0" | tail -23; exit 0 ;;
    -*) log_error "unknown option" arg "$1"; exit 1 ;;
    *)
      if [[ -z "$APP" ]]; then APP="$1"
      else log_error "extra positional arg" arg "$1"; exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$APP" ]]; then
  log_error "missing app name" hint "usage: $0 <app> [--rollback|--status|--dry-run]"
  exit 1
fi

# ── Coolify API ─────────────────────────────────────────────────────────────
COOLIFY_URL="${COOLIFY_URL:?COOLIFY_URL must be set}"
COOLIFY_API_KEY="${COOLIFY_API_KEY:-${COOLIFY_API_TOKEN:-}}"
if [[ -z "$COOLIFY_API_KEY" ]]; then
  if [[ -f "$REPO_ROOT/.env-prod-backup" ]]; then
    COOLIFY_API_KEY="$(config_env_key COOLIFY_API_TOKEN COOLIFY_API_KEY)"
  fi
fi
if [[ -z "$COOLIFY_API_KEY" ]]; then
  log_error "no COOLIFY_API_KEY"; exit 1
fi

api() {
  local method="$1" endpoint="$2"; shift 2
  curl -sS --max-time 30 -X "$method" \
    -H "Authorization: Bearer $COOLIFY_API_KEY" \
    -H "Content-Type: application/json" \
    "${COOLIFY_URL}/api/v1${endpoint}" "$@"
}

# ── Resolve B/G pair ────────────────────────────────────────────────────────
BLUE_NAME="aisha-${APP}-blue"
GREEN_NAME="aisha-${APP}-green"

apps_json=$(api GET "/applications" 2>/dev/null)
blue_uuid=$(echo "$apps_json" | jq -r ".[] | select(.name == \"$BLUE_NAME\") | .uuid" | head -1)
green_uuid=$(echo "$apps_json" | jq -r ".[] | select(.name == \"$GREEN_NAME\") | .uuid" | head -1)

if [[ -z "$blue_uuid" ]] || [[ "$blue_uuid" == "null" ]]; then
  log_error "blue app not found" name "$BLUE_NAME" \
    hint "create B/G pair via story-init s manifest tagem 'bluegreen=$APP'"
  exit 1
fi
if [[ -z "$green_uuid" ]] || [[ "$green_uuid" == "null" ]]; then
  log_error "green app not found" name "$GREEN_NAME"; exit 1
fi

log_info "B/G pair resolved" \
  blue "$BLUE_NAME ($(echo $blue_uuid | cut -c1-12)…)" \
  green "$GREEN_NAME ($(echo $green_uuid | cut -c1-12)…)"

# ── Determine current active slot ───────────────────────────────────────────
get_env_var() {
  local uuid="$1" key="$2"
  api GET "/applications/${uuid}/environment-variables" 2>/dev/null \
    | jq -r ".[] | select(.key == \"$key\") | .value" \
    | head -1
}

blue_active=$(get_env_var "$blue_uuid" "BG_ACTIVE_HOST")
green_active=$(get_env_var "$green_uuid" "BG_ACTIVE_HOST")

ACTIVE_SLOT=""
INACTIVE_SLOT=""
ACTIVE_UUID=""
INACTIVE_UUID=""
ACTIVE_HOST=""

if [[ -n "$blue_active" ]] && [[ -z "$green_active" ]]; then
  ACTIVE_SLOT=blue; INACTIVE_SLOT=green
  ACTIVE_UUID="$blue_uuid"; INACTIVE_UUID="$green_uuid"
  ACTIVE_HOST="$blue_active"
elif [[ -z "$blue_active" ]] && [[ -n "$green_active" ]]; then
  ACTIVE_SLOT=green; INACTIVE_SLOT=blue
  ACTIVE_UUID="$green_uuid"; INACTIVE_UUID="$blue_uuid"
  ACTIVE_HOST="$green_active"
elif [[ -n "$blue_active" ]] && [[ -n "$green_active" ]]; then
  log_error "BOTH slots active — split-brain state" \
    blue_host "$blue_active" green_host "$green_active" \
    hint "manually fix one slot's BG_ACTIVE_HOST to empty before switch"
  exit 2
else
  log_error "NEITHER slot active — both BG_ACTIVE_HOST empty" \
    hint "set one slot's BG_ACTIVE_HOST to your domain initially"
  exit 2
fi

log_info "current state" \
  active_slot "$ACTIVE_SLOT" \
  active_host "$ACTIVE_HOST" \
  inactive_slot "$INACTIVE_SLOT"

if [[ "$STATUS_ONLY" -eq 1 ]]; then exit 0; fi

# ── Switch sequence ─────────────────────────────────────────────────────────
TARGET_SLOT="$INACTIVE_SLOT"
TARGET_UUID="$INACTIVE_UUID"
OLD_ACTIVE_UUID="$ACTIVE_UUID"

if [[ "$ROLLBACK" -eq 1 ]]; then
  # Rollback: skip "deploy alternate" — předpokládáme že ještě běží minulý active
  log_info "rollback mode — switching back to $TARGET_SLOT (assumed still warm)"
fi

metrics_phase_start "blue_green_switch_${APP}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  log_info "DRY RUN — would do:" \
    step1 "deploy $TARGET_SLOT (idle, BG_ACTIVE_HOST=)" \
    step2 "smoke test $TARGET_SLOT" \
    step3 "set $TARGET_SLOT BG_ACTIVE_HOST=$ACTIVE_HOST + redeploy" \
    step4 "set $ACTIVE_SLOT BG_ACTIVE_HOST= + redeploy"
  metrics_phase_end "blue_green_switch_${APP}" "dry_run"
  metrics_flush "blue-green-${APP}-$(date +%s).prom"
  exit 0
fi

# Step 1: Deploy target idle (BG_ACTIVE_HOST should already be empty)
log_info "step 1/4 — deploying $TARGET_SLOT idle"
if ! api POST "/deploy?uuid=${TARGET_UUID}&force=true" >/dev/null; then
  log_error "deploy trigger failed" slot "$TARGET_SLOT"
  metrics_phase_end "blue_green_switch_${APP}" "deploy_fail"
  metrics_flush "blue-green-${APP}-$(date +%s).prom"
  exit 1
fi
log_info "waiting up to 5min for $TARGET_SLOT healthy"
# Poll for health (best-effort — full health-wait is in aisha-redeploy.mjs, this is simplified)
for i in $(seq 1 30); do
  status=$(api GET "/applications/${TARGET_UUID}" 2>/dev/null | jq -r '.status // "unknown"')
  case "$status" in
    *"healthy"*|*"running"*) log_info "$TARGET_SLOT healthy" status "$status"; break ;;
    *exited*) log_error "$TARGET_SLOT exited" status "$status"; exit 1 ;;
  esac
  sleep 10
done

# Step 2: Smoke test idle slot (Coolify API status poll proti config/blue-green-smoke.mjs).
# Default method=api funguje z libovolného prostředí (operator laptop, n8n, CI).
# Pokud APP nemá smoke contract, runner vrací exit 2 a switch je zablokovaný — nikdy
# nepromote-ujem nezadefinovaný app (lepší fail-safe než silent pass v původním stubu).
log_info "step 2/4 — smoke testing $TARGET_SLOT (Coolify API status poll)"
SMOKE_OUT=$(node "$SCRIPT_DIR/blue-green-smoke-runner.mjs" \
  --app "$APP" --slot "$TARGET_SLOT" --uuid "$TARGET_UUID" --method api 2>&1) \
  || SMOKE_RC=$?
SMOKE_RC=${SMOKE_RC:-0}
log_info "smoke result" raw "$(echo "$SMOKE_OUT" | tail -1)"
if [[ "$SMOKE_RC" -ne 0 ]]; then
  log_error "smoke test failed for $TARGET_SLOT — aborting switch (idle slot left orphan; manually inspect or rollback via --rollback)"
  metrics_phase_end "blue_green_switch_${APP}" "smoke_fail"
  metrics_counter "aisha_blue_green_switches_total" 1 app "$APP" result "smoke_fail"
  metrics_flush "blue-green-${APP}-$(date +%s).prom"
  exit 1
fi

# Step 3: PATCH target → BG_ACTIVE_HOST (Traefik picks up router)
log_info "step 3/4 — switching traffic to $TARGET_SLOT"
patch_env() {
  local uuid="$1" key="$2" value="$3"
  api POST "/applications/${uuid}/environment-variables" \
    -d "$(jq -nc --arg k "$key" --arg v "$value" '{key: $k, value: $v, is_preview: false, is_build_time: false}')" >/dev/null
}
patch_env "$TARGET_UUID" "BG_ACTIVE_HOST" "$ACTIVE_HOST"
api POST "/deploy?uuid=${TARGET_UUID}&force=true" >/dev/null
log_info "$TARGET_SLOT now serving traffic" host "$ACTIVE_HOST"

# Step 4: PATCH old active → empty (Traefik drops router)
log_info "step 4/4 — draining $ACTIVE_SLOT"
patch_env "$OLD_ACTIVE_UUID" "BG_ACTIVE_HOST" ""
api POST "/deploy?uuid=${OLD_ACTIVE_UUID}&force=true" >/dev/null
log_info "$ACTIVE_SLOT is now warm idle (fallback for rapid rollback)"

metrics_phase_end "blue_green_switch_${APP}" "success"
metrics_counter "aisha_blue_green_switches_total" 1 app "$APP" result "success"
metrics_flush "blue-green-${APP}-$(date +%s).prom"

log_info "B/G switch complete" \
  app "$APP" \
  new_active "$TARGET_SLOT" \
  warm_idle "$ACTIVE_SLOT"

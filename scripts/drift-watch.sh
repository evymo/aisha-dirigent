#!/usr/bin/env bash
# =============================================================================
# drift-watch.sh — One-shot drift check + webhook alerting (manual fallback)
# =============================================================================
# !! ROLE: MANUAL ONE-SHOT FALLBACK !!
#
# Production primary path je n8n WF_DRIFT_OBSERVER, který je triggerovaný
# eventy (Coolify deploy, Sentry incident, post-cold-start). Tento skript
# je manual-only pro:
#   - Operator one-shot check ("ukaž mi drift teď")
#   - CI pre-deploy gate (nightly job které volá manually)
#   - Incident response (when n8n is down)
#
# **Žádný --interval mode** — periodic execution je v n8n event-driven WF.
# Pokud potřebuješ scheduled check bez n8n, pošli POST /webhook/drift-now z
# externího systému (např. Coolify webhook).
#
# Notification channels (per env var):
#   AISHA_DRIFT_WEBHOOK_URL=https://...   → POST JSON body s drift report
#   AISHA_DRIFT_WEBHOOK_FORMAT=slack|generic|mattermost  → format detail
#
# Filters:
#   AISHA_DRIFT_IGNORE=...                → comma-separated app names to ignore
#
# Usage:
#   bash scripts/drift-watch.sh                       # one-shot, no webhook
#   bash scripts/drift-watch.sh --webhook=https://... # one-shot s webhookem
#   bash scripts/drift-watch.sh --dry-run             # ukaž payload, neodesílat
#
# Pro event-driven scheduling: n8n WF_DRIFT_OBSERVER /webhook/drift-now
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

export AISHA_LOG_COMPONENT="drift-watch"
# shellcheck source=lib/log.sh
. "$SCRIPT_DIR/lib/log.sh"

DRY_RUN=0
WEBHOOK_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --webhook=*)  WEBHOOK_OVERRIDE="${1#*=}"; shift ;;
    --webhook)    WEBHOOK_OVERRIDE="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --interval|--interval=*)
      log_error "--interval no longer supported — use n8n WF_DRIFT_OBSERVER for event-driven scheduling" \
        hint "POST /webhook/drift-now from your event source (Coolify webhook, cron in external scheduler)"
      exit 2
      ;;
    -h|--help)    head -30 "$0" | tail -28; exit 0 ;;
    *) log_error "unknown option" arg "$1"; exit 1 ;;
  esac
done

WEBHOOK_URL="${WEBHOOK_OVERRIDE:-${AISHA_DRIFT_WEBHOOK_URL:-}}"
WEBHOOK_FORMAT="${AISHA_DRIFT_WEBHOOK_FORMAT:-generic}"
IGNORE_APPS="${AISHA_DRIFT_IGNORE:-}"

# ── Format webhook payload per channel ──────────────────────────────────────
format_slack() {
  local drift_json="$1"
  jq -nc --argjson drift "$drift_json" \
    --arg url "${COOLIFY_BASE_URL:?COOLIFY_BASE_URL required}" \
    '{
      text: "AISHA Coolify Drift Alert",
      blocks: [
        {type:"header", text:{type:"plain_text", text:"⚠️ AISHA Coolify Drift"}},
        {type:"section", text:{type:"mrkdwn", text:
          ("*Coolify:* " + $url + "\n" +
           "*Orphaned:* " + ($drift.orphaned | length | tostring) + "\n" +
           "*Missing:* " + ($drift.missing | length | tostring) + "\n" +
           "*Compose drift:* " + ($drift.composeDrift | length | tostring) + "\n" +
           "*Server drift:* " + ($drift.serverDrift | length | tostring) + "\n" +
           "*Server nezměřen:* " + (($drift.serverUnmeasured // []) | length | tostring))}}
      ]
    }'
}

format_mattermost() {
  # Mattermost incoming webhook accepts Slack-compatible payload — reuse
  format_slack "$1"
}

format_generic() {
  local drift_json="$1"
  jq -nc --argjson drift "$drift_json" \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    --arg url "${COOLIFY_BASE_URL:?COOLIFY_BASE_URL required}" \
    '{
      timestamp: $ts,
      coolify_url: $url,
      severity: (if ($drift.orphaned | length) > 0 or ($drift.missing | length) > 0 then "fatal" else "warning" end),
      drift: $drift
    }'
}

# ── Single check + alert pass ───────────────────────────────────────────────
run_one() {
  log_info "running drift check"

  # Spustí drift check, capture JSON + exit code
  local drift_json
  local rc
  drift_json=$(node "$SCRIPT_DIR/coolify-drift-check.mjs" --json 2>/dev/null)
  rc=$?

  if [[ -z "$drift_json" ]]; then
    log_error "drift check returned no JSON" exit_code "$rc"
    return 2
  fi

  # Filter ignored apps
  if [[ -n "$IGNORE_APPS" ]]; then
    local ignore_arr
    ignore_arr=$(echo "$IGNORE_APPS" | jq -R 'split(",")|map(ltrimstr(" ")|rtrimstr(" "))')
    drift_json=$(echo "$drift_json" | jq --argjson ig "$ignore_arr" '
      .orphaned     |= map(select(.name as $n | $ig | index($n) | not))
      | .missing    |= map(select(.name as $n | $ig | index($n) | not))
      | .composeDrift |= map(select(.name as $n | $ig | index($n) | not))
      | .serverDrift  |= map(select(.name as $n | $ig | index($n) | not))
      | .serverUnmeasured |= ((. // []) | map(select(.name as $n | $ig | index($n) | not)))
    ')
  fi

  local orphaned=$(echo "$drift_json" | jq '.orphaned | length')
  local missing=$(echo "$drift_json" | jq '.missing | length')
  local compose=$(echo "$drift_json" | jq '.composeDrift | length')
  local server=$(echo "$drift_json" | jq '.serverDrift | length')
  # Nezměřený server aplikace (slot mimo registr / nenastavené UUID) NENÍ shoda.
  # Dokud se nepočítal, zapsal drift-watch „no drift" nad stavem, který nikdo
  # neporovnal (drift-check to od 2026-10-03 hlásí i kódem 3).
  local unmeasured=$(echo "$drift_json" | jq '(.serverUnmeasured // []) | length')

  log_info "drift summary" \
    orphaned "$orphaned" \
    missing "$missing" \
    compose "$compose" \
    server "$server" \
    unmeasured "$unmeasured"

  local total=$(( orphaned + missing + compose + server + unmeasured ))
  if [[ "$total" -eq 0 ]]; then
    log_info "no drift — Coolify state matches manifest"
    return 0
  fi

  # Drift detected — alert
  if [[ -z "$WEBHOOK_URL" ]]; then
    log_warn "drift detected but no webhook configured" \
      total "$total" \
      hint "set AISHA_DRIFT_WEBHOOK_URL or pass --webhook="
    return 1
  fi

  local payload
  case "$WEBHOOK_FORMAT" in
    slack)      payload=$(format_slack "$drift_json") ;;
    mattermost) payload=$(format_mattermost "$drift_json") ;;
    generic|*)  payload=$(format_generic "$drift_json") ;;
  esac

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "DRY RUN — would POST to webhook" url "$WEBHOOK_URL" format "$WEBHOOK_FORMAT"
    echo "$payload" | jq .
    return 1
  fi

  local http_rc
  http_rc=$(curl -sS -o /tmp/drift-webhook-resp -w "%{http_code}" \
    -X POST -H "Content-Type: application/json" \
    --data "$payload" \
    --max-time 10 "$WEBHOOK_URL" 2>/dev/null || true)

  case "$http_rc" in
    200|201|204)
      log_info "webhook posted" status "$http_rc" total "$total"
      ;;
    *)
      log_error "webhook failed" \
        status "$http_rc" \
        body "$(cat /tmp/drift-webhook-resp 2>/dev/null | head -c 200)"
      return 2
      ;;
  esac

  return 1   # 1 = drift detected (alerted)
}

# ── Main: one-shot only — žádný loop. Event-driven scheduling je v n8n. ─────
run_one
exit $?

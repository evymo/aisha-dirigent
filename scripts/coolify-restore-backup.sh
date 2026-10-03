#!/usr/bin/env bash
# Credentials come from the shared canonical chain, not one hardcoded file.
# shellcheck source=scripts/lib/coolify-credentials.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/coolify-credentials.sh" 2>/dev/null || \
  . "$(cd "$(dirname "$0")" && pwd)/lib/coolify-credentials.sh"

# =============================================================================
# coolify-restore-backup.sh — Restore Coolify DB backup s safety prompt
# =============================================================================
# DESTRUKTIVNÍ — přepíše current data v target databázi obsahem backupu.
# Vyžaduje explicit user confirmation, ne auto-trigger z n8n.
#
# Use cases:
#   - Disaster recovery: korupce data, špatný migrace, ransomware
#   - Operator-initiated rollback po post-deploy incident
#
# Workflow:
#   1. List backups pro target database (přes coolify-backup-status.mjs --json)
#   2. Operator vybere backup ID (nejnovější nebo specific)
#   3. Skript vyzve: "Type RESTORE to confirm" (case-sensitive)
#   4. POST /api/v1/databases/{uuid}/backups/{backup_uuid}/restore
#   5. Wait pro completion + verify db status
#
# WARNING: Coolify v4 backup restore API endpoint shape varies. Tento skript
# zkusí 2 endpoint variants; pokud žádný nefunguje, vrátí instrukci pro
# manual restore přes Coolify UI.
#
# Usage:
#   bash scripts/coolify-restore-backup.sh aisha-db                 # interactive
#   bash scripts/coolify-restore-backup.sh aisha-db --backup-id=X   # specific
#   bash scripts/coolify-restore-backup.sh aisha-db --dry-run
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export AISHA_LOG_COMPONENT="restore-backup"
# shellcheck source=lib/log.sh
. "$SCRIPT_DIR/lib/log.sh"

DB_NAME=""
BACKUP_ID=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-id=*) BACKUP_ID="${1#*=}"; shift ;;
    --backup-id)   BACKUP_ID="$2"; shift 2 ;;
    --dry-run)     DRY_RUN=1; shift ;;
    -h|--help)     head -27 "$0" | tail -25; exit 0 ;;
    -*)            log_error "unknown option" arg "$1"; exit 1 ;;
    *)
      if [[ -z "$DB_NAME" ]]; then DB_NAME="$1"
      else log_error "extra positional arg" arg "$1"; exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$DB_NAME" ]]; then
  log_error "missing database name" usage "$0 <db-name> [--backup-id=ID] [--dry-run]"
  exit 1
fi

# ── Coolify creds ───────────────────────────────────────────────────────────
COOLIFY_URL="${COOLIFY_URL:?COOLIFY_URL must be set}"
COOLIFY_API_KEY="${COOLIFY_API_KEY:-${COOLIFY_API_TOKEN:-}}"
if [[ -z "$COOLIFY_API_KEY" ]] && [[ -f "$REPO_ROOT/.env-prod-backup" ]]; then
  COOLIFY_API_KEY="$(config_env_key COOLIFY_API_TOKEN COOLIFY_API_KEY)"
fi
if [[ -z "$COOLIFY_API_KEY" ]]; then
  log_error "no COOLIFY_API_KEY"
  exit 1
fi

api() {
  local method="$1" endpoint="$2"; shift 2
  curl -sS --max-time 30 -X "$method" \
    -H "Authorization: Bearer $COOLIFY_API_KEY" \
    -H "Content-Type: application/json" \
    "${COOLIFY_URL}/api/v1${endpoint}" "$@"
}

# ── Resolve DB UUID ─────────────────────────────────────────────────────────
log_info "resolving database" name "$DB_NAME"

dbs_json=$(api GET "/databases" 2>/dev/null)
db_uuid=$(echo "$dbs_json" | jq -r ".[] | select(.name == \"$DB_NAME\") | .uuid" | head -1)

if [[ -z "$db_uuid" ]] || [[ "$db_uuid" == "null" ]]; then
  log_error "database not found via Coolify API" name "$DB_NAME" \
    hint "list available: node scripts/coolify-backup-status.mjs"
  exit 1
fi
log_info "database resolved" name "$DB_NAME" uuid "$(echo "$db_uuid" | cut -c1-12)…"

# ── Resolve backup ──────────────────────────────────────────────────────────
backups_json=$(api GET "/databases/$db_uuid/backups" 2>/dev/null)
if [[ -z "$BACKUP_ID" ]]; then
  # Latest backup
  BACKUP_ID=$(echo "$backups_json" | jq -r 'sort_by(.created_at) | reverse | .[0].uuid // empty' 2>/dev/null)
  if [[ -z "$BACKUP_ID" ]]; then
    log_error "no backups found for $DB_NAME" \
      hint "Coolify UI → $DB_NAME → Backups (check schedule + recent runs)"
    exit 1
  fi
  log_info "selected latest backup" backup_id "$BACKUP_ID"
fi

backup_meta=$(echo "$backups_json" | jq -r ".[] | select(.uuid == \"$BACKUP_ID\")" 2>/dev/null)
backup_ts=$(echo "$backup_meta" | jq -r '.created_at // "unknown"')
backup_size=$(echo "$backup_meta" | jq -r '.size // "?"')

log_info "backup details" \
  id "$BACKUP_ID" \
  created_at "$backup_ts" \
  size_bytes "$backup_size"

# ── Safety confirmation ─────────────────────────────────────────────────────
if [[ "$DRY_RUN" -eq 1 ]]; then
  log_info "DRY RUN — would restore" db "$DB_NAME" backup "$BACKUP_ID"
  log_info "  POST $COOLIFY_URL/api/v1/databases/$db_uuid/backups/$BACKUP_ID/restore"
  exit 0
fi

echo ""
echo "  ⚠️  DESTRUCTIVE OPERATION"
echo "  Restore $DB_NAME from backup $BACKUP_ID ($backup_ts)"
echo "  This will OVERWRITE current data."
echo ""
read -rp "  Type 'RESTORE' to confirm: " confirm
if [[ "$confirm" != "RESTORE" ]]; then
  log_warn "restore NOT confirmed — aborting"
  exit 0
fi

# ── Trigger restore (best-effort across Coolify v4 endpoint shapes) ─────────
log_info "triggering restore"
http_rc=$(api POST "/databases/$db_uuid/backups/$BACKUP_ID/restore" \
  -o /tmp/coolify-restore-resp -w "%{http_code}" 2>/dev/null || true)

case "$http_rc" in
  200|201|202|204)
    log_info "restore triggered" status "$http_rc"
    log_info "monitor progress" \
      ui "$COOLIFY_URL/dashboard"
    ;;
  404)
    log_warn "endpoint /databases/{uuid}/backups/{id}/restore not found — trying alternative"
    http_rc2=$(api POST "/backups/$BACKUP_ID/restore?database_uuid=$db_uuid" \
      -o /tmp/coolify-restore-resp -w "%{http_code}" 2>/dev/null || true)
    if [[ "$http_rc2" =~ ^(200|201|202|204)$ ]]; then
      log_info "restore triggered (alt endpoint)" status "$http_rc2"
    else
      log_error "Coolify v4 restore endpoint not reachable" \
        first_attempt "/databases/{uuid}/backups/{id}/restore → $http_rc" \
        second_attempt "/backups/{id}/restore → $http_rc2"
      log_error "Manual restore: Coolify UI → $DB_NAME → Backups → $BACKUP_ID → Restore"
      exit 1
    fi
    ;;
  *)
    log_error "restore API failed" status "$http_rc" \
      response "$(cat /tmp/coolify-restore-resp 2>/dev/null | head -c 200)"
    log_error "Manual restore: Coolify UI → $DB_NAME → Backups → $BACKUP_ID → Restore"
    exit 1
    ;;
esac

log_info "✓ Restore initiated. Coolify will process async; check UI for status."

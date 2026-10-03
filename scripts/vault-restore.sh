#!/usr/bin/env bash
# =============================================================================
# vault-restore.sh — restore the credential vault from an age-encrypted snapshot
# =============================================================================
# The disaster-recovery counterpart of backup_vault_before_wipe() (aisha-cold-start.sh)
# and the sibling of coolify-restore-backup.sh (DB restore). Use it to seed
# .env-prod-backup on a FRESH operator machine BEFORE running cold-start, so a
# re-cold-start / --wipe preserves the ORIGINAL credentials (encryption keys,
# validator identity) instead of regenerating them.
#
# Source of the ciphertext (one of):
#   --from <file.age>            an explicit age file (e.g. a copy you stored)
#   --instance-data              pull vault/vault-latest.age from the private
#                                instance-data repo (AISHA_INSTANCE_DATA_GIT_URL)
#
# Decryption key (required):
#   AISHA_VAULT_BACKUP_AGE_KEY_FILE   path to your age IDENTITY (private key) file
#                                     — the one whose recipient you configured as
#                                     AISHA_VAULT_BACKUP_AGE_RECIPIENT at backup time.
#
# WARNING: overwrites the local .env-prod-backup (and .env.coolify) — requires an
# explicit "RESTORE" confirmation (bypass with --yes for automation).
#
# Usage:
#   AISHA_VAULT_BACKUP_AGE_KEY_FILE=~/.aisha-vault-age.key \
#     bash scripts/vault-restore.sh --instance-data
#   AISHA_VAULT_BACKUP_AGE_KEY_FILE=~/key.txt bash scripts/vault-restore.sh --from vault-latest.age --yes
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FROM=""
SOURCE_MODE=""
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; SOURCE_MODE="file"; shift 2 ;;
    --instance-data) SOURCE_MODE="instance-data"; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

err() { printf '\033[0;31mERR\033[0m %s\n' "$*" >&2; }
ok()  { printf '\033[0;32m✓\033[0m %s\n' "$*"; }
info(){ printf '\033[0;34mℹ\033[0m %s\n' "$*"; }

command -v age >/dev/null 2>&1 || { err "age not installed (brew install age / apk add age)"; exit 1; }
[ -n "${AISHA_VAULT_BACKUP_AGE_KEY_FILE:-}" ] || { err "AISHA_VAULT_BACKUP_AGE_KEY_FILE required (path to your age private key)"; exit 1; }
[ -f "$AISHA_VAULT_BACKUP_AGE_KEY_FILE" ] || { err "age key file not found: $AISHA_VAULT_BACKUP_AGE_KEY_FILE"; exit 1; }
[ -n "$SOURCE_MODE" ] || { err "choose a source: --instance-data or --from <file.age>"; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ENC=""

if [ "$SOURCE_MODE" = "instance-data" ]; then
  [ -n "${AISHA_INSTANCE_DATA_GIT_URL:-}" ] || { err "AISHA_INSTANCE_DATA_GIT_URL required for --instance-data"; exit 1; }
  url="$(printf '%s' "$AISHA_INSTANCE_DATA_GIT_URL" | sed 's|\\/|/|g')"
  info "Cloning instance-data to fetch vault/vault-latest.age ..."
  # ⛔ „clone failed" bez důvodu posílá operátora ladit pověření, i když jde
  # o utržený přenos. git-klon.sh opakuje a důvod VYSLOVÍ.
  . "${0%/*}/lib/git-klon.sh"
  klonuj "$url" "$TMP/instance-data" || { err "klon instance-data selhal (důvod výš)"; exit 1; }
  ENC="$TMP/instance-data/vault/vault-latest.age"
  [ -f "$ENC" ] || { err "no vault/vault-latest.age in instance-data repo"; exit 1; }
else
  ENC="$FROM"
  [ -f "$ENC" ] || { err "age file not found: $ENC"; exit 1; }
fi

info "Decrypting $ENC ..."
age -d -i "$AISHA_VAULT_BACKUP_AGE_KEY_FILE" -o "$TMP/vault.tgz" "$ENC" || { err "age decryption failed (wrong key?)"; exit 1; }

# Preview what the snapshot contains (file names only — never values).
info "Snapshot contents:"; tar -tzf "$TMP/vault.tgz" | sed 's/^/    /'

if [ "$ASSUME_YES" != "1" ]; then
  printf 'This OVERWRITES local .env-prod-backup / .env.coolify. Type RESTORE to confirm: '
  read -r reply
  [ "$reply" = "RESTORE" ] || { err "aborted (did not type RESTORE)"; exit 1; }
fi

tar -xzf "$TMP/vault.tgz" -C "$REPO_ROOT"
[ -f "$REPO_ROOT/.env-prod-backup" ] && chmod 600 "$REPO_ROOT/.env-prod-backup"
[ -f "$REPO_ROOT/.env.coolify" ] && chmod 600 "$REPO_ROOT/.env.coolify"
ok "Vault restored into $REPO_ROOT (.env-prod-backup / .env.coolify, mode 600)."
info "You can now run cold-start; generate-secrets will PRESERVE the original credentials."

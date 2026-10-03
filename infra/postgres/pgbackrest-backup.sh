#!/usr/bin/env bash
# pgBackRest scheduled-backup loop — runs in the `pgbackrest` sidecar
# (docker-compose.coolify.yml), which reuses the platform Postgres image so the postgres UID,
# the pgbackrest binary, and the stanza config (/etc/pgbackrest/pgbackrest.conf)
# all match the `db` container. DB-03 continuous WAL archiving / PITR.
#
# The db container's archive_command already streams every WAL segment to the
# repo; this loop (a) initialises the stanza once, then (b) takes periodic base
# backups (weekly full / daily incremental) and expires per retention. Archived
# WAL alone cannot restore — it needs a base backup to replay onto — so this
# sidecar is what turns the archive stream into real recoverability.
set -uo pipefail

STANZA="${PGBACKREST_STANZA:-aisha}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"   # seconds between backups (default 24h)
FULL_EVERY="${BACKUP_FULL_EVERY:-7}"           # every Nth cycle is a full backup
PGPORT="${PGPORT:-5432}"

log() { echo "[pgbackrest-backup] $(date -u +%FT%TZ) $*"; }

# Wait for the primary's socket before touching the stanza.
until pg_isready -h /var/run/postgresql -p "${PGPORT}" >/dev/null 2>&1; do
  log "waiting for postgres socket on /var/run/postgresql:${PGPORT} …"
  sleep 5
done

# stanza-create is safe to re-run; on an existing repo it is a no-op / warning.
log "ensuring stanza '${STANZA}' exists"
pgbackrest --stanza="${STANZA}" stanza-create \
  || log "stanza-create returned non-zero (repo likely already initialised)"
pgbackrest --stanza="${STANZA}" check \
  || log "check failed — WAL archiving may not be flowing yet (will retry via backups)"

cycle=0
while :; do
  if [ $((cycle % FULL_EVERY)) -eq 0 ]; then type=full; else type=incr; fi
  log "starting ${type} backup"
  if pgbackrest --stanza="${STANZA}" --type="${type}" backup; then
    log "${type} backup complete"
  else
    log "${type} backup FAILED — will retry next cycle"
  fi
  pgbackrest --stanza="${STANZA}" expire || log "expire failed"
  cycle=$((cycle + 1))
  sleep "${INTERVAL}"
done

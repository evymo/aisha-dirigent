#!/bin/bash
# pki-db-reconcile-entrypoint.sh — align MariaDB credentials to the CURRENT env
# on every start, then hand off to the stock MariaDB entrypoint.
#
# WHY (incident 2026-07-05 — pki-db password drift):
#   MariaDB only writes the root/user passwords from MYSQL_* env on the FIRST
#   init (empty data dir). When PKI_DB_PASSWORD / PKI_DB_ROOT_PASSWORD is later
#   rotated (generate-secrets / cold-start) but the pki-db VOLUME is reused, the
#   stored passwords stay OLD while pki-server's rendered database.yaml uses the
#   NEW one → "dbi_log: Database not connected" → OpenXPKI never starts → mesh
#   blocked. Nothing in the deploy re-applied the rotated secret to the DB.
#
#   This is the general "the deploy must SYSTEMICALLY write the changed/generated
#   value into the stateful backend" fix: on every boot, before the real server
#   comes up, we reconcile the stored credentials to the current env — no
#   knowledge of the OLD password needed (an --init-file runs with full
#   privileges at startup), so it also recovers an already-stranded volume.
#   Idempotent: a no-op once aligned.
#
# The applied values live in the Coolify env (MYSQL_*). We additionally drop a
# fingerprint-only marker file next to the data (NEVER the secret value) so an
# operator can see, in a separate file, which credential generation is live.

set -u
DATADIR="${MARIADB_DATA_DIR:-/var/lib/mysql}"
MARKER="${DATADIR}/.pki-db-cred-applied"

fp() { printf '%s' "${1:-}" | sha256sum 2>/dev/null | cut -c1-12; }

reconcile_existing_data() {
  # Only for an ALREADY-initialised data dir. On first init the stock entrypoint
  # sets the passwords + loads the schema; there is nothing to reconcile.
  [ -d "${DATADIR}/mysql" ] || { echo "[pki-db reconcile] fresh data dir — first init will set credentials"; return 0; }

  local sock=/tmp/pki-db-reconcile.sock
  echo "[pki-db reconcile] existing data — applying current-env credentials via --init-file…"
  local sql=/tmp/pki-db-reset.sql
  rm -f "$sock" /tmp/pki-db-reconcile.pid "$sql"

  # MariaDB's documented password-reset path: run the ALTERs from an --init-file,
  # which executes at server startup with FULL privileges BEFORE any connection
  # is accepted — no knowledge of the OLD password needed, and account-management
  # statements actually apply (a grantless FLUSH+ALTER on a live session does
  # NOT). Only ALTER what we have (ROOT may be empty on some setups).
  {
    [ -n "${MYSQL_ROOT_PASSWORD:-}" ] && {
      echo "ALTER USER 'root'@'localhost' IDENTIFIED BY '${MYSQL_ROOT_PASSWORD}';"
      echo "ALTER USER IF EXISTS 'root'@'%' IDENTIFIED BY '${MYSQL_ROOT_PASSWORD}';"
    }
    [ -n "${MYSQL_USER:-}" ] && [ -n "${MYSQL_PASSWORD:-}" ] && {
      echo "ALTER USER IF EXISTS '${MYSQL_USER}'@'%' IDENTIFIED BY '${MYSQL_PASSWORD}';"
      echo "ALTER USER IF EXISTS '${MYSQL_USER}'@'localhost' IDENTIFIED BY '${MYSQL_PASSWORD}';"
    }
    echo "FLUSH PRIVILEGES;"
  } > "$sql"

  # --user=mysql: the entrypoint runs as root, but mariadbd refuses to run as
  # root and the data dir is owned by mysql — start as root, drop to mysql (same
  # as the stock entrypoint's `gosu mysql`).
  mariadbd --user=mysql --init-file="$sql" --skip-networking \
    --socket="$sock" --datadir="$DATADIR" --pid-file=/tmp/pki-db-reconcile.pid \
    >/tmp/pki-db-reconcile.log 2>&1 &
  local rpid=$!

  local i
  for i in $(seq 1 60); do [ -S "$sock" ] && break; sleep 1; done
  if [ ! -S "$sock" ]; then
    echo "[pki-db reconcile] FATAL: reconcile server never became ready — see log:" >&2
    tail -20 /tmp/pki-db-reconcile.log >&2 2>/dev/null || true
    kill "$rpid" 2>/dev/null || true
    rm -f "$sql"
    return 1
  fi
  # Socket up ⇒ the --init-file ALTERs already applied (they run before serving).
  # Fingerprint-only marker — the "separate file" record of the live generation.
  printf '%s root=%s user=%s\n' \
    "$(date -u +%FT%TZ 2>/dev/null || echo unknown-time)" \
    "$(fp "${MYSQL_ROOT_PASSWORD:-}")" "$(fp "${MYSQL_PASSWORD:-}")" > "$MARKER" 2>/dev/null || true

  # Clean shutdown with the NOW-current root password; kill as a fallback (the
  # ALTER is already durably committed, so either way is safe).
  mariadb-admin --socket="$sock" -uroot -p"${MYSQL_ROOT_PASSWORD:-}" shutdown 2>/dev/null \
    || kill "$rpid" 2>/dev/null || true
  wait "$rpid" 2>/dev/null || true
  rm -f "$sock" "$sql"
  echo "[pki-db reconcile] credentials aligned to current env"
}

reconcile_existing_data || {
  echo "[pki-db reconcile] WARN: reconcile failed — continuing to stock entrypoint (may still be stranded)" >&2
}

# Hand off to the stock MariaDB entrypoint (first-init, schema load, then serve).
exec docker-entrypoint.sh "$@"

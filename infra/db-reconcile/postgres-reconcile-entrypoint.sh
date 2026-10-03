#!/bin/bash
# postgres-reconcile-entrypoint.sh — GENERIC, instance-agnostic credential
# reconcile for any Postgres service. Re-applies the CURRENT-env password to an
# existing data dir on every start, then hands off to the stock entrypoint.
#
# Driven ONLY by env (POSTGRES_USER / POSTGRES_PASSWORD) — it never references
# the container name (which is per-deploy) nor any service-specific role, so any
# instance / fork / database can build from this same script and image.
#
# WHY (incident 2026-07-05): Postgres writes role passwords only on the FIRST
# init. When a secret is rotated (generate-secrets / cold-start) but the named
# volume is reused, the stored password stays OLD while consumers connect with
# the NEW one → auth fails and the dependent service crash-loops (netbird-db →
# mesh down; same class as pki-db / the aisha-db pg17 wrapper). Nothing in the
# deploy re-applied the rotated secret to the DB.
#
#   A background re-applier connects over the LOCAL socket (peer/trust on the
#   POSTGRES_USER superuser via /var/run/postgresql — no password needed, so it
#   also recovers an already-stranded volume) and ALTERs the superuser to the
#   current env password. Idempotent; ON_ERROR_STOP (loud). First init is left to
#   the stock entrypoint. Drops a fingerprint-only marker (never the value).
#
#   Optional: DB_RECONCILE_EXTRA_ROLES = space/semicolon-separated `role=ENVVAR`
#   pairs, for DBs whose app role differs from the superuser — each role is
#   ALTERed to the value of the named env var (only if the role exists). netbird-db
#   needs none: its POSTGRES_USER (netbird_app) IS the app role.

set -u
SUPERUSER="${POSTGRES_USER:-postgres}"
SUPERDB="${POSTGRES_DB:-${SUPERUSER}}"
MARKER="${PGDATA:-/var/lib/postgresql/data/pgdata}/.postgres-cred-reconciled"
fp() { printf '%s' "${1:-}" | sha256sum 2>/dev/null | cut -c1-12; }

(
  for i in $(seq 1 90); do
    if pg_isready -h /var/run/postgresql -U "$SUPERUSER" -q 2>/dev/null; then
      # Build the ALTERs. Passwords are passed as psql :'vars' (server-side
      # quoted) so a secret containing quotes can never break or inject SQL.
      psql_vars=(-v ON_ERROR_STOP=1 -v su_pw="${POSTGRES_PASSWORD:-}")
      sql="ALTER ROLE \"${SUPERUSER}\" WITH PASSWORD :'su_pw';"

      idx=0
      # shellcheck disable=SC2001
      for pair in $(printf '%s' "${DB_RECONCILE_EXTRA_ROLES:-}" | tr ';' ' '); do
        role="${pair%%=*}"; envvar="${pair#*=}"
        [ -n "$role" ] && [ -n "$envvar" ] && [ "$role" != "$pair" ] || continue
        pw="${!envvar:-}"   # bash indirect expansion — no eval
        psql_vars+=(-v "xr${idx}=${pw}")
        # ALTER only if the role exists — a not-yet-created app role is not an error.
        sql="${sql}
DO \$reconcile\$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
    EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', '${role}', :'xr${idx}');
  END IF;
END \$reconcile\$;"
        idx=$((idx + 1))
      done

      if printf '%s\n' "$sql" | psql -h /var/run/postgresql -U "$SUPERUSER" -d "$SUPERDB" "${psql_vars[@]}" \
           >/tmp/postgres-reconcile.log 2>&1; then
        printf '%s superuser=%s roles=%s\n' \
          "$(date -u +%FT%TZ 2>/dev/null || echo unknown-time)" \
          "$(fp "${POSTGRES_PASSWORD:-}")" "$idx" > "$MARKER" 2>/dev/null || true
        echo "[postgres reconcile] credentials aligned to current env (superuser=${SUPERUSER}, extra_roles=${idx})"
      else
        echo "[postgres reconcile] WARN: ALTER ROLE re-apply failed — see /tmp/postgres-reconcile.log" >&2
      fi
      break
    fi
    sleep 1
  done
) &

# Hand off to the stock Postgres entrypoint (first-init, then serve as PID 1).
exec docker-entrypoint.sh "$@"

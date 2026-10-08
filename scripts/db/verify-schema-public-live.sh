#!/usr/bin/env bash
# =============================================================================
# verify-schema-public-live.sh — kdo smí vytvářet ve schématu public, ŽIVÁ databáze
# =============================================================================
# VÝCHOZÍ REŽIM JEN ČTE. Pustí scripts/db/verify-schema-public-acl.sql (ACL
# schématu, has_schema_privilege pod každou rolí, výčet vlastníků objektů)
# v transakci jen pro čtení — zápis by skončil chybou, ne zápisem. Nad produkční
# databází se používá JEN tenhle režim; volá ho doktor i ověření po nasazení.
#
# `--zkouska-chovanim` pustí scripts/db/verify-schema-public-create.sql: pod každou
# rolí zkusí CREATE TABLE (v podtransakci, vždy vrácené zpět). I vrácený pokus je
# zápisový pokus a ve stavu „díra“ uspěje — patří nad zahazovanou nebo zkušební
# databázi (brána cesty upgradu ho pouští sama), NE nad produkci.
#
#   bash scripts/db/verify-schema-public-live.sh <ssh-host>|__local__
#   bash scripts/db/verify-schema-public-live.sh --zkouska-chovanim <ssh-host>|__local__
#
# Návratový kód:
#   0 — v pořádku (vytvářet smí jen vyjmenované role); vypíše změřené řádky
#   1 — DÍRA: poslední řádek výstupu vyjmenuje, která role co smí
#   2 — NEZMĚŘENO (hostitel nebo kontejner databáze nedostupný) — to NENÍ zelená
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REZIM="cteni"
if [ "${1:-}" = "--zkouska-chovanim" ]; then REZIM="chovani"; shift; fi
CIL="${1:-}"
if [ -z "$CIL" ]; then
  echo "usage: $0 [--zkouska-chovanim] <ssh-host>|__local__" >&2; exit 2
fi

na() {
  if [ "$CIL" = "__local__" ]; then bash -c "$1"
  else ssh -o ConnectTimeout=10 -o BatchMode=yes "$CIL" "$1"; fi
}

# Řádky vstupu, které obsahují $1, bez předpony psql až po $2. Čte vstup CELÝ —
# roura do čtenáře, který skončí dřív než pisatel, pod pipefail občas vrátí 141.
radky_s() {
  local hledany="$1" predpona="$2" radek
  while IFS= read -r radek; do
    case "$radek" in
      *"$hledany"*)
        radek="${radek#*"$predpona"}"
        printf '%s\n' "${radek#"${radek%%[! ]*}"}" ;;
    esac
  done
}

DB=""
while IFS= read -r _jmeno; do
  if [ -z "$DB" ]; then case "$_jmeno" in db-*) DB="$_jmeno" ;; esac; fi
done < <(na "docker ps --format '{{.Names}}'" 2>/dev/null)
if [ -z "$DB" ]; then
  echo "NEZMĚŘENO: na cíli '$CIL' neběží kontejner databáze (db-*) nebo cíl není dosažitelný"; exit 2
fi

if [ "$REZIM" = "cteni" ]; then
  SQL="$ROOT/scripts/db/verify-schema-public-acl.sql"
  PSQL="docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' '$DB' psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f -"
else
  SQL="$ROOT/scripts/db/verify-schema-public-create.sql"
  PSQL="docker exec -i '$DB' psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f -"
fi

VYSTUP="$(na "$PSQL" < "$SQL" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then
  radky_s 'schéma public' 'NOTICE:' <<< "$VYSTUP"
  exit 0
fi
case "$VYSTUP" in
  *"kdo smí vytvářet:"*)
    radky_s 'kdo smí vytvářet:' 'ERROR:' <<< "$VYSTUP"
    exit 1 ;;
  *)
    echo "NEZMĚŘENO: kontrola nedoběhla (rc=$RC): $(printf '%s' "$VYSTUP" | tail -2 | tr '\n' ' ')"
    exit 2 ;;
esac

#!/bin/bash
# =============================================================================
# PostgreSQL password initialization — PRVNÍ initdb
# =============================================================================
# Běží v /docker-entrypoint-initdb.d/ jen při prvním initdb. Každý DALŠÍ start
# nad existujícími daty dělá totéž entrypoint-wrapper.sh — oba berou role
# a jejich hesla z JEDNOHO seznamu (hesla-roli.lib), aby se nerozešly
# (dřív wrapper roli postgres_exporter neznal a její heslo nenastavil nikdo).
# =============================================================================
set -e

# Knihovna leží vedle skriptu (repo: infra/postgres/, obraz: initdb.d i
# /usr/local/bin — viz Dockerfile). Bez ní se NEpokračuje: tichý start bez
# hesel rolí by vypadal jako zdravá DB.
HESLA_ROLI_LIB="$(dirname "$0")/hesla-roli.lib"
if [ ! -r "$HESLA_ROLI_LIB" ]; then
    echo "postgres: FATAL — chybí $HESLA_ROLI_LIB (seznam rolí a hesel)" >&2
    exit 1
fi
# shellcheck source=hesla-roli.lib
. "$HESLA_ROLI_LIB"
HESLA_SQL="$(hesla_roli_sql "$(hr_strip_outer_quotes "${POSTGRES_PASSWORD:-}")")"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
${HESLA_SQL}

    -- ⛔ Žádné ALTER DATABASE … SET s tajemstvím. Klíče trezoru a sloupců zapisuje
    -- entrypoint-wrapper.sh do /run/aisha-keys (čtou je helpery jako vlastník);
    -- jako GUC je přečetla každá role (naměřeno 2026-09-25). JWT secret databáze
    -- nikdy nečetla — ověřuje ho PostgREST z PGRST_JWT_SECRET.
EOSQL

# postgres_exporter: řeší hesla_roli_sql (DO blok s kontrolou existence —
# role vzniká až v heals, na čerstvém initdb ještě není; heslo jí pak dá
# entrypoint-wrapper.sh při dalším startu).

# ── Synapse dedicated database (CREATE DATABASE nelze v DO block / transakce) ──
# Synapse vyžaduje vlastní DB se specific COLLATE/CTYPE (C locale). Jiné služby
# (keycloak, n8n, langfuse) používají 'postgres' DB + dedicated schema.
if ! psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -tAc "SELECT 1 FROM pg_database WHERE datname='synapse'" | grep -q 1; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL2
        CREATE DATABASE synapse
          OWNER synapse_user
          ENCODING 'UTF8'
          LC_COLLATE 'C'
          LC_CTYPE 'C'
          TEMPLATE template0;
EOSQL2
    echo "postgres: Created synapse database."
fi

touch /tmp/.db-passwords-ready
echo "postgres: Passwords, GUCs and synapse DB initialized."

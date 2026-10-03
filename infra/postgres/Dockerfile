# =============================================================================
# Platform PostgreSQL — pgvector, pgcrypto, pgaudit, pgTAP, pgBackRest
# =============================================================================
# Replaces Supabase Postgres image. No pgsodium, no pg_net.
# Vault functionality provided by pgcrypto (see 001_vault_pgcrypto.sql).
#
# MAJOR VERZE JE PARAMETR INSTANCE, ne vlastnost souboru. `PG_MAJOR` přichází
# jako build-arg z `POSTGRES_MAJOR` (domov: config/image-versions.env, do
# instance ho zapíše env-doktor a instance si ho drží). BEZ výchozí hodnoty:
# chybějící arg dá `pgvector:pg` a build padne nahlas — dosazená verze by na
# existujících datech znamenala výpadek, ne upgrade.
#
# Změna major verze u běžící instance = převod dat dump/restore
# (docs/deploy/POSTGRES_UPGRADE.md). entrypoint-wrapper.sh odmítne start, když
# se verze dat a obrazu liší.
# =============================================================================
ARG REGISTRY_PROXY=
ARG PG_MAJOR
FROM ${REGISTRY_PROXY}pgvector/pgvector:pg${PG_MAJOR}
# ARG před FROM platí jen pro FROM; uvnitř stage se musí deklarovat znovu.
ARG PG_MAJOR
# PGDATA VÝSLOVNĚ. Obraz pg18 ho má jinde (/var/lib/postgresql/18/docker) než
# pg17 (/var/lib/postgresql/data) — naměřeno 2026-09-13. Náš mount (`db-data`),
# pgbackrest (`pg1-path`) i wrapper čtou /var/lib/postgresql/data; bez tohohle
# řádku by pg18 nad mountem bez chyby nastartoval PRÁZDNÝ cluster jinde.
ENV PG_MAJOR=${PG_MAJOR} \
    PGDATA=/var/lib/postgresql/data

# Install extensions required at server start (shared_preload_libraries
# in postgresql.conf references pgaudit + pg_stat_statements + auto_explain;
# pgcrypto + pg_trgm + btree_gist are needed by SoT migrations).
#
# postgresql-$PG_MAJOR-contrib ships pg_stat_statements + auto_explain + pg_trgm
# + btree_gist + pgcrypto (so pg_stat_statements/auto_explain in
# shared_preload_libraries works out of the box). postgresql-$PG_MAJOR-pgaudit
# is a separate package — without it PG fails at boot with "could not
# access file pgaudit: No such file or directory".
# postgresql-$PG_MAJOR-pgtap ships the pgTAP unit-testing extension. It is TEST-ONLY:
# the schema-contract tests (scripts/db/run-schema-tests.mjs) do `CREATE EXTENSION
# pgtap` inside a transaction they ROLL BACK, so pgTAP's ~700 functions never persist
# in the prod schema (and never trip the definer-RPC-security gate). Shipping the
# package in the image is what makes that CREATE EXTENSION resolvable.
# pgbackrest (Debian bookworm main) provides continuous WAL archiving + PITR
# (DB-03). It is invoked BOTH here (the db container's archive_command runs
# `pgbackrest archive-push`) AND by the `pgbackrest` sidecar which reuses this
# image; installing it in the base image keeps both paths on one version.
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-${PG_MAJOR}-pgaudit \
    postgresql-${PG_MAJOR}-pgtap \
    pgbackrest \
    && rm -rf /var/lib/apt/lists/*

# NOTE: build CONTEXT is this directory (infra/postgres), NOT the repo root — the
# image only needs these 7 files, so all builders (ci.yml cold-start, compose
# `db` service, scripts/db/types-refresh-throwaway.mjs) pass `infra/postgres` as the
# context. This keeps the build tar ~40 KB instead of streaming the whole 27 MB+
# repo to the remote DinD daemon (which broke the pipe → cold-start CI failure).
# COPY paths are therefore context-relative (no `infra/postgres/` prefix).

# Copy initialization SQL scripts (run in alphabetical order on first boot)
COPY 000_init_roles_schemas.sql /docker-entrypoint-initdb.d/000_init_roles_schemas.sql
COPY 001_vault_pgcrypto.sql /docker-entrypoint-initdb.d/001_vault_pgcrypto.sql

# Copy password init script (sets role passwords from env vars)
COPY set-passwords.sh /docker-entrypoint-initdb.d/002_set_passwords.sh
# JEDEN seznam rolí a hesel pro set-passwords.sh i entrypoint-wrapper.sh — oba
# ho čtou z adresáře, kde samy leží. Přípona .lib (ne .sh), aby ho
# docker-entrypoint v initdb.d nespustil jako init skript.
COPY hesla-roli.lib /docker-entrypoint-initdb.d/hesla-roli.lib
COPY hesla-roli.lib /usr/local/bin/hesla-roli.lib
RUN chmod +x /docker-entrypoint-initdb.d/002_set_passwords.sh

# Copy entrypoint wrapper that re-applies passwords on every boot
COPY entrypoint-wrapper.sh /usr/local/bin/postgres-entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/postgres-entrypoint-wrapper.sh

# Custom postgresql.conf for GUC settings
COPY postgresql.conf /etc/postgresql/postgresql.conf

# pgBackRest — continuous WAL archiving / PITR (DB-03). The stanza config + the
# scheduled-backup loop are baked (bake-not-bind) so BOTH the db container
# (archive_command → archive-push) and the pgbackrest sidecar (stanza-create +
# base backups via pgbackrest-backup.sh) read one definition and share this
# image's postgres UID. The repo + log dirs are pre-created postgres-owned so the
# named volumes mounted over them (pgbackrest-repo) inherit the right ownership.
COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY pgbackrest-backup.sh /usr/local/bin/pgbackrest-backup.sh
RUN chmod +x /usr/local/bin/pgbackrest-backup.sh \
 && install -d -o postgres -g postgres -m 0750 /var/lib/pgbackrest /var/log/pgbackrest

# Expose standard port
EXPOSE 5432

# Use wrapper entrypoint
ENTRYPOINT ["/usr/local/bin/postgres-entrypoint-wrapper.sh"]
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]

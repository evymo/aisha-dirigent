# Source-postgres readonly setup for aisha-CRM broker

> **⚠ Smíření se skutečností 2026-07-01 — přečti dřív, než podle téhle stránky
> něco spustíš.** Dva údaje níž jsou HISTORICKÉ a spustit je podle nich znamená
> chybu:
>
> 1. **`core_newfollow` a `stats_statsnapshots` byly ve zdroji ZRUŠENY.**
>    `GRANT SELECT` na ně skončí `relation does not exist` a **shodí celý
>    grant skript** — tedy i granty na tabulky, které existují. Onboarding
>    zdroje pak vypadá jako chyba oprávnění, přestože je to zastaralý návod.
>    Grantuj jen `core_appuser`, `core_profile`, `core_event`.
> 2. Jméno role v příkladech (`source_crm_readonly`) a jméno kontejneru
>    (`source-platform-postgres-1`) jsou z původního nasazení. Ověř si aktuální
>    jména proti tomu, co skutečně běží; tenhle dokument je NEZNÁ.
>
> **Kód s tím zatím počítá.** `pg-readonly-driver.ts` se na obě zrušené tabulky
> pořád dotazuje (3× `core_newfollow` v audience dotazech, 1×
> `stats_statsnapshots` v KPI snapshotu) a `source-contract.ts` deklaruje jejich
> sloupce. Není to opomenutí: kontrakt je vstup pro `drift-canary`, a právě ten
> má rozdíl mezi deklarací a skutečností **nahlásit jako drift** místo aby se
> dotaz tiše rozbil. Ty dotazy proti dnešnímu zdroji selžou — než se odstraní,
> patří k nim měření proti živému zdroji, ne odhad od stolu.

> **Kanonický seznam grantů je tracked skript**
> [`scripts/source-readonly-grants.sql`](../scripts/source-readonly-grants.sql)
> (role **`<source_readonly_role>`**, 8 tabulek). Příklady níž jsou historické —
> spouštěj ten skript, ne je.

## Design principle

The source stack stays **untouched at the application layer**. No Django app
modifications, no migrations, no SECURITY DEFINER functions. The only thing
required from the source side is **READ access to specific tables** via a
dedicated postgres role. This is delivered through one of two paths.

## Tables broker reads

The broker (`svc-source-broker`) issues SELECT queries against:

| Table | Purpose |
|---|---|
| `core_appuser` | user account state (last_activity, is_active, email) |
| `core_profile` | profile metadata (full_name, language, since, is_instructor) |
| `core_event` | events created by users (for events_created + attendance metrics) |
| `core_newfollow` | follow relationships (user↔user and user↔event) for audience computation |
| `stats_statsnapshots` | community-level KPI snapshots |

No write access. No INSERT/UPDATE/DELETE. No schema modifications.

## Path A — Streaming replica (RECOMMENDED for production)

Create a postgres physical streaming replica of the source primary DB. The
broker connects to the replica with a regular postgres role. This gives:

- **Total isolation**: broker queries cannot impact production write latency
- **Auditability**: replica is a separate server with its own connection log
- **Failure isolation**: replica issues never propagate to primary

Setup (source ops team, one-time):

```bash
# 1. On primary source-postgres: create replication slot
psql -U postgres -d source -c \
  "SELECT pg_create_physical_replication_slot('aisha_crm_replica');"

# 2. Provision new postgres server (e.g. on aisha infra) running same major
# version as primary (currently postgres 16 for source-api production).

# 3. On replica server: pg_basebackup from primary
pg_basebackup \
  -h source-primary.example.org -U replication_user \
  -D /var/lib/postgresql/data \
  -Fp -Xs -R -P --slot aisha_crm_replica

# 4. Start replica. It will follow primary via WAL streaming.

# 5. On replica: create broker's readonly role
psql -U postgres -d source -c "
  CREATE ROLE source_crm_readonly LOGIN PASSWORD '<strong-password>';
  GRANT CONNECT ON DATABASE source TO source_crm_readonly;
  GRANT USAGE ON SCHEMA public TO source_crm_readonly;
  GRANT SELECT ON core_appuser, core_profile, core_event,
                  core_newfollow, stats_statsnapshots
    TO source_crm_readonly;
"
```

Broker env var:

```bash
SOURCE_PG_URL=postgres://source_crm_readonly:<password>@source-replica.example.org:5432/source?sslmode=require
```

## Path B — Direct GRANT on primary (for dev / small ops)

For local development or small-scale ops where a replica isn't justified,
grant read access directly on the primary source-postgres. The broker runs
SELECT-only queries; primary's MVCC handles concurrency. Connection pool
should be sized small (e.g. 5 connections) to avoid impacting writes.

Setup (one-time, on source primary postgres):

```sql
-- Run as superuser (e.g. postgres) on source-postgres
CREATE ROLE source_crm_readonly LOGIN PASSWORD '<strong-password>';
GRANT CONNECT ON DATABASE source TO source_crm_readonly;
GRANT USAGE ON SCHEMA public TO source_crm_readonly;
GRANT SELECT ON core_appuser, core_profile, core_event,
                core_newfollow, stats_statsnapshots
  TO source_crm_readonly;

-- Optional: pg_hba.conf entry restricting connection origin
-- host source source_crm_readonly aisha.internal/24 scram-sha-256
```

Broker env var:

```bash
# Local dev with running source-platform-postgres-1 (port 5433 in compose)
SOURCE_PG_URL=postgres://source_crm_readonly:<password>@localhost:5433/source
```

## Local development quickstart

If you already have `source-platform-postgres-1` container running:

```bash
# One-time setup
docker exec -i source-platform-postgres-1 psql -U source -d source <<'SQL'
  CREATE ROLE source_crm_readonly LOGIN PASSWORD 'devpw';
  GRANT CONNECT ON DATABASE source TO source_crm_readonly;
  GRANT USAGE ON SCHEMA public TO source_crm_readonly;
  GRANT SELECT ON core_appuser, core_profile, core_event,
                  core_newfollow, stats_statsnapshots
    TO source_crm_readonly;
SQL

# In aisha-CRM .env.local
SOURCE_PG_URL=postgres://source_crm_readonly:devpw@localhost:5433/source
```

## Schema drift handling

If source-api schema evolves (e.g. column rename, new tables relevant to
engagement), the broker's queries in `src/clients/source-pg.ts` are the
single point of update. No coordination with source-team needed for column
additions; for breaking renames, broker queries are updated independently.

## Security notes

1. **Password rotation**: rotate `source_crm_readonly` password quarterly via
   `ALTER ROLE` + restart broker. Broker re-reads `SOURCE_PG_URL` at startup.
2. **Connection limits**: cap broker's pool at 5–10 connections; set
   `connection_limit` on the role: `ALTER ROLE source_crm_readonly CONNECTION LIMIT 10`.
3. **TLS required for production**: `sslmode=require` in connection string.
4. **No write access ever**: if broker accidentally tries INSERT/UPDATE/DELETE
   it will fail with permission error — defense in depth.

## What about API path?

For operations that should go through source-api's auth/business logic
(e.g. webhook subscription, future write-back), broker uses
`SourceApiClient` (GraphQL) with service-level JWT. Read-only aggregations
that have no source-api endpoint go through `SourcePgClient` (direct postgres).
The two clients coexist; choice is per-operation.

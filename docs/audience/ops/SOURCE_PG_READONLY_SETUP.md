# Source-postgres readonly setup for the source broker

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

The grants below are **column-scoped** (SEC-F3): the broker reads only the
columns declared in its source contract
(`services/svc-source-broker/src/contracts/source-contract.ts`). A table-wide
`GRANT SELECT ON core_appuser` would also expose the Django PBKDF2 `password`
hash, `is_superuser`, and `is_staff`, so a leaked `SOURCE_PG_URL` could
exfiltrate every member's credential hash — column scoping removes that.

## What crosses the seam (PII data-flow disclosure)

Two distinct paths cross the source→aisha boundary, with different PII posture:

1. **Bulk sync (scheduler / `/sync/run`)** — AGGREGATE-ONLY. The broker reads
   per-user rows but writes only integer engagement metrics
   (`user_engagement_metrics` has no email/name/phone column). Email +
   `full_name` are read to compute aggregates and to resolve identity, but are
   NOT persisted into the aggregate store.

2. **Federation self-login (`/auth/source/login`)** — the ONE path that durably
   copies raw PII. When a member logs in, `audience_provision_federated_member`
   writes their cleartext `email` + `display_name` into `aisha_auth.users` +
   `public.profiles`, reusing the source UUID verbatim as the aisha id. This is
   consented self-provisioning (gated by source OTP, role always
   `authenticated`), but it makes aisha a SECOND PII processor for that member.

   **Erasure path:** when a member is erased on the source side, their aisha
   federated identity (`aisha_auth.users` + `public.profiles` + derived
   `user_engagement_metrics` rows keyed on the source UUID) must be deleted too.
   There is no automatic propagation yet — track erasure as an explicit ops
   step keyed on the shared UUID until a source→aisha deletion webhook exists.

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
  -- COLUMN-SCOPED least privilege: a table-wide GRANT SELECT ON core_appuser
  -- would also expose the Django PBKDF2 password hash + is_superuser/is_staff.
  -- Grant ONLY the columns the source contract reads (source-contract.ts).
  GRANT SELECT (id, email, last_activity, is_active) ON core_appuser TO source_crm_readonly;
  GRANT SELECT (id, user_id, full_name, language, since, is_instructor) ON core_profile TO source_crm_readonly;
  GRANT SELECT (id, created_by_id, cancelled, created_at) ON core_event TO source_crm_readonly;
  GRANT SELECT (user_id, friend_id, event_id, since) ON core_newfollow TO source_crm_readonly;
  GRANT SELECT (date, users_total, users_new, users_monthly, users_weekly, users_daily, events_total, posts_total) ON stats_statsnapshots TO source_crm_readonly;
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
# COLUMN-SCOPED least privilege: a table-wide GRANT SELECT ON core_appuser
# would also expose the Django PBKDF2 password hash + is_superuser/is_staff.
# Grant ONLY the columns the source contract reads (source-contract.ts).
GRANT SELECT (id, email, last_activity, is_active) ON core_appuser TO source_crm_readonly;
GRANT SELECT (id, user_id, full_name, language, since, is_instructor) ON core_profile TO source_crm_readonly;
GRANT SELECT (id, created_by_id, cancelled, created_at) ON core_event TO source_crm_readonly;
GRANT SELECT (user_id, friend_id, event_id, since) ON core_newfollow TO source_crm_readonly;
GRANT SELECT (date, users_total, users_new, users_monthly, users_weekly, users_daily, events_total, posts_total) ON stats_statsnapshots TO source_crm_readonly;

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
  -- COLUMN-SCOPED least privilege: a table-wide GRANT SELECT ON core_appuser
  -- would also expose the Django PBKDF2 password hash + is_superuser/is_staff.
  -- Grant ONLY the columns the source contract reads (source-contract.ts).
  GRANT SELECT (id, email, last_activity, is_active) ON core_appuser TO source_crm_readonly;
  GRANT SELECT (id, user_id, full_name, language, since, is_instructor) ON core_profile TO source_crm_readonly;
  GRANT SELECT (id, created_by_id, cancelled, created_at) ON core_event TO source_crm_readonly;
  GRANT SELECT (user_id, friend_id, event_id, since) ON core_newfollow TO source_crm_readonly;
  GRANT SELECT (date, users_total, users_new, users_monthly, users_weekly, users_daily, events_total, posts_total) ON stats_statsnapshots TO source_crm_readonly;
SQL

# In the source broker .env.local
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

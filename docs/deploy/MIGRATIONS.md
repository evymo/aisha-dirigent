# Database migrations (self-hosted Supabase / Postgres)

This repo version-controls DB schema changes in `supabase/migrations/*.sql`.

## Goals

- New environments: apply all migrations in order.
- Existing environments: apply only pending migrations (do not re-run older ones).
- Deploy-safe: no sensitive data in logs; do not print DB URLs.
- **Idempotence**: All migrations must be idempotent (can be run multiple times safely).

📖 **See [MIGRATION_GUIDELINES.md](./MIGRATION_GUIDELINES.md) for best practices on writing idempotent migrations.**

## Requirements

- A Postgres connection string with privileges to apply migrations (typically the `postgres` user for self-hosted Supabase).
- Recommended: run the Node migrator (`npm run db:migrate`) which does **not** require `psql`.
- Environment variable:

  - `AISHA_DB_URL` (preferred) or `DATABASE_URL`

## Node migrator (default)

Run:

- `npm run db:migrate`

This uses a Node script (`scripts/db/migrate.mjs`) and the `pg` driver.

### TLS / self-signed certificates

If your Postgres uses a self-signed TLS certificate, Node will fail with:
`self-signed certificate in certificate chain`.

Preferred (secure) fix:

- Provide the CA PEM in env var `SUPABASE_DB_SSL_CA_PEM` and keep verification enabled.

Fallback (not recommended for internet-exposed DBs):

- Set `?sslmode=require` in `AISHA_DB_URL` (TLS without certificate verification), or
- Set `SUPABASE_DB_SSL_REJECT_UNAUTHORIZED=false` (this is the default unless you set it to `true`).

## `psql` migrator (fallback)

Run:

- `npm run db:migrate:psql`

### Installing `psql` (fallback only)

`psql` is a native Postgres client binary (not an npm package).

- Alpine:

  - `apk add --no-cache postgresql-client bash`
- Debian/Ubuntu:

  - `apt-get update && apt-get install -y postgresql-client ca-certificates`

If you cannot install OS packages, run the migration step inside a container image that already includes `psql` (e.g. `postgres:16-alpine`) as a dedicated job.

## Apply migrations

Run:

- `bash scripts/db/migrate.sh`

It will:

- ensure `supabase_migrations.schema_migrations` exists
- apply any `supabase/migrations/*.sql` files that are not recorded in that table

## Dry run (list pending)

- `bash scripts/db/migrate.sh --dry-run`

## Quick status / RPC verification

If it looks like migrations “ran” but RPC functions are missing in Supabase, run:

- `npm run db:status`

It prints:

- DB name + DB user (no connection string)
- How many migrations exist on disk vs how many are tracked as applied
- Whether key RPC functions exist (e.g. `public.get_my_assigned_clients()`)

## Baseline (dangerous)

Use only if the DB already matches the current schema and you need to initialize the migration tracker table without executing SQL:

- `bash scripts/db/migrate.sh --baseline`

## Coolify / deploy pipeline recommendation

1) Run migrations as a dedicated pre-deploy step (or init job) before starting the app.
2) Keep the DB URL in secret/env vars, never in repo.
3) If the migration step fails, fail the deploy (do not start the new app version).

## Coolify (Docker Compose)

If you deploy via Coolify, prefer `docker-compose.coolify.yml` which gates the `web` service on successful `migrate`.
See `docs/deploy/COOLIFY.md`.

## Static hosting (Pages / CDN)

If you deploy the frontend to a platform that cannot run server-side commands during deploy, run migrations in your CI/CD *before* uploading static assets.

Example pattern:

1) CI job runs `npm ci`
2) CI job runs `npm run db:migrate` with the target environment `AISHA_DB_URL`
3) CI job builds and uploads the static frontend (`npm run build`)

---

## Local development (recommended)

If you use local Supabase (`npx supabase start`), prefer the provided `:local` scripts.

### Bootstrap local DB (start + migrate + sanity check)

- `npm run supabase:start`
- `npm run db:migrate:local`
- `npm run db:status:local`

### Forensics / drift gates (optional but recommended)

These are **read-only diagnostics** that help detect non-deterministic migrations and duplicated RPCs:

- `npm run db:migration:skip-diff`
- `npm run db:functions:duplicates`

If you want DB-aware overload visibility for functions, use:

- `npm run db:functions:duplicates:local`

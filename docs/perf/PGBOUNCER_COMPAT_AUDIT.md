# pgbouncer Compatibility Audit — Phase 12 WP 1.3

> Snapshot 2026-05-20. Companion to `scripts/audit/pgbouncer-compat.mjs`
> and `wp-1-3-pgbouncer.gate.test.ts`. Documents what's safe under
> pgbouncer transaction-mode and how to route the exceptions.

## What pgbouncer transaction-mode breaks

Transaction-mode pgbouncer rebinds the server connection to a different
client between transactions. Anything that holds **cross-transaction
session state** breaks:

| Feature | Why it breaks | Detected by audit | AISHA usage |
|---|---|---|---|
| `WITH HOLD` cursors | Cursor outlives the tx; next tx may land on different server conn | ✅ regex | none |
| `pg_advisory_lock()` across tx | Lock owner is session; new owner can't release | ✅ regex | none |
| `LISTEN` / `NOTIFY` (subscribe) | Subscriber session needs continuity | ✅ regex | **event-worker only** (bypassed) |
| Session-level `SET name = value` (no LOCAL) | State leaks to next tenant on pool return | ⚠ partially — `SERVER_RESET_QUERY=DISCARD ALL` clears it | search_path in fn defs is FUNCTION-level not session-level (safe) |
| Prepared statements (cross-tx) | OLD: broken in PB <1.21. NEW: `MAX_PREPARED_STATEMENTS=100` enables server-side caching | n/a | postgres-js / pg-driver compatible |
| Temporary tables | Drop on conn return | n/a | none in AISHA |

## What's safe (verified)

- **PostgREST `SET LOCAL ROLE authenticator`** — transaction-scoped, cleared by `DISCARD ALL` on conn return.
- **`CREATE FUNCTION ... SET search_path TO 'public'`** — attached to function, not session. CLAUDE.md mandatory pattern.
- **All `_audited` SECURITY DEFINER functions** — internal `SET search_path` is function-level.
- **`UPDATE … SET column = value`** — SQL UPDATE clause, NOT a session GUC; harmless.

## Routing decision

```
┌──────────────────────────────────────────────────────────────────┐
│  All svc-* + gateway + storage-auth + PostgREST                  │
│  → connect to pgbouncer:6432 (transaction mode pool)             │
├──────────────────────────────────────────────────────────────────┤
│  event-worker (LISTEN/NOTIFY)                                    │
│  → connect to db:5432 DIRECTLY (bypass pgbouncer)                │
├──────────────────────────────────────────────────────────────────┤
│  Migration runner (scripts/db/migrate.mjs, DDL)                  │
│  → connect to db:5432 DIRECTLY (cluster-level operations)        │
└──────────────────────────────────────────────────────────────────┘
```

## Audit script

Run before any PR that introduces a new RPC or service:

```bash
node scripts/audit/pgbouncer-compat.mjs
# Exit 0 = clean
# Exit 1 = incompatible patterns; review output

# JSON for CI:
node scripts/audit/pgbouncer-compat.mjs --json | jq '.findings'
```

The audit is also enforced by the gate test
`src/tests/gates/wp-1-3-pgbouncer.gate.test.ts` — every PR must pass it.

## When to add an entry to ALLOWED in the audit script

Only when there's a documented bypass path:
1. Service connects to `db:5432` directly (not `pgbouncer:6432`)
2. PR description explains WHY the session-scoped feature is required
3. Add the file path to the `ALLOWED` set in
   `scripts/audit/pgbouncer-compat.mjs`

Today's ALLOWED list:
- `services/event-worker/src/worker.ts` — LISTEN/NOTIFY for realtime fanout
- `services/event-worker/src/config.ts` — config doc-comment mentions LISTEN

## Migration steps for existing services (when pgbouncer ships)

For each service currently pointing at `db:5432` in compose:

1. Verify the service is NOT on the ALLOWED list (i.e. NOT event-worker / migration runner)
2. Flip the env in Coolify:
   ```
   PG_HOST=pgbouncer        # was: db
   PG_PORT=6432             # was: 5432
   ```
3. Restart the service.
4. Watch Grafana "Postgres" dashboard for connection count drop (expected:
   ~10× fewer because of pooling).
5. Watch service /metrics → `aisha_rpc_duration_ms` p95 should improve
   ~5-10ms (the connect overhead we saved).

## Rollback

Per-service: flip env back to `PG_HOST=db PG_PORT=5432`, restart. pgbouncer
keeps running but receives no traffic.

Full uninstall: remove the `pgbouncer` block from `docker-compose.coolify.yml`,
redeploy. No data loss (pgbouncer is stateless).

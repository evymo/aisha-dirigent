# Postgres 17 Tuning Runbook — Phase 12 WP 1.2

> Snapshot 2026-05-20, valid against `infra/postgres/postgresql.conf` after WP 1.2.
> Companion to `aisha/db/migrations/20260521010000_pg_extensions_audit_and_perf.sql`.

## Goal

Lift the main Postgres instance from conservative defaults to AISHA
production-grade tuning. Target per Phase 12 §0.4 KPI plan:

| Metric | Baseline (2026-05-20) | After WP 1.2 | 90-day target |
|---|---|---|---|
| Postgres RPC p95 | TBD (pre-instrumentation) | < 80 ms | < 50 ms |
| `pg_stat_statements` top-10 mean | unknown | < 100 ms | < 50 ms |
| Cache hit ratio | unknown | ≥ 95 % | ≥ 99 % |

## Strategy — two-wave rollout (per §-1.2 of plan)

| Param | Old | New | Wave | Restart? |
|---|---|---|---|---|
| `shared_buffers` | 256MB | 2GB (25 % RAM) | A | YES |
| `wal_compression` | off | zstd | A | YES |
| `max_parallel_workers_per_gather` | 2 | 4 | A | YES |
| `shared_preload_libraries` | empty | `pg_stat_statements,auto_explain,pgaudit` | A | YES |
| `effective_cache_size` | 768MB | 6GB (75 % RAM) | B | NO (reload) |
| `work_mem` | 4MB | 32MB | B | NO (reload) |
| `maintenance_work_mem` | 64MB | 512MB | B | NO (reload) |
| `random_page_cost` | 4.0 | 1.1 (SSD) | B | NO (reload) |
| `effective_io_concurrency` | 1 | 200 (SSD) | B | NO (reload) |
| `auto_explain.*` | unset | enabled (>1s) | B | NO (reload) |
| `pgaudit.log` | unset | `ddl, role` | B | NO (reload) |

## Procedure

### Pre-flight (do NOT skip)

```bash
# 1. Verify last backup is < 24 h old. AISHA cold-start docs:
#    docs/deploy/COLD_START_RUNBOOK.md § Backup verification
docker exec aisha-db ls -lh /var/lib/postgresql/backups/ | tail -3

# 2. Snapshot current pg_settings (so we can diff after):
docker exec -i aisha-db psql -U postgres -At <<SQL > /tmp/pg-settings-before.txt
SELECT name || '=' || setting FROM pg_settings
WHERE name IN (
  'shared_buffers','effective_cache_size','work_mem','maintenance_work_mem',
  'random_page_cost','effective_io_concurrency','max_parallel_workers_per_gather',
  'wal_compression','shared_preload_libraries'
)
ORDER BY name;
SQL

# 3. Apply the migration FIRST (loads extensions but won't take effect until
#    Wave A restart enables shared_preload_libraries):
npm run db:migrate:local                 # local dev
# In production, the migration auto-runs via Coolify cold-start init container.
```

### Wave A — restart-required (off-peak only, ~30 s downtime)

```bash
# 1. Verify the new postgresql.conf is in place
docker exec aisha-db cat /etc/postgresql/postgresql.conf | grep -E '^shared_buffers|^wal_compression|^max_parallel|^shared_preload'

# 2. Restart Postgres
docker compose -f docker-compose.coolify.yml restart db

# 3. Wait for healthy
docker compose -f docker-compose.coolify.yml ps db   # expect "healthy"

# 4. Verify extensions loaded
docker exec aisha-db psql -U postgres -c 'SHOW shared_preload_libraries;'
# Expected output: pg_stat_statements,auto_explain,pgaudit
```

### Wave B — reload-only (zero downtime)

```bash
docker exec -i aisha-db psql -U postgres -c 'SELECT pg_reload_conf();'
# Returns: pg_reload_conf | t

# Verify reload applied:
docker exec -i aisha-db psql -U postgres -c "SHOW effective_cache_size;"
# Expected: 6GB
docker exec -i aisha-db psql -U postgres -c "SHOW work_mem;"
# Expected: 32MB
```

### Post-deploy verification (allow 5 min for traffic)

```bash
# 1. Grafana Postgres dashboard (WP 0.2) should show updated values
open https://grafana.backend.id3a.cz/d/aisha-postgres

# 2. Cache hit ratio is >95 %
docker exec aisha-db psql -U postgres -c "
  SELECT round(100.0 * sum(blks_hit) / NULLIF(sum(blks_hit + blks_read), 0), 2) AS cache_hit_pct
  FROM pg_stat_database WHERE datname = 'postgres';
"

# 3. Top queries surface in pg_stat_statements
docker exec aisha-db psql -U postgres -c "
  SELECT LEFT(query, 60) AS query, calls, ROUND(total_exec_time::numeric, 0) AS total_ms
  FROM pg_stat_statements
  ORDER BY total_exec_time DESC LIMIT 10;
"

# 4. Re-run baseline capture
node scripts/observability/capture-baseline.mjs
# Compare new docs/perf/baseline-<date>.json against the WP 0.5 placeholder.
```

## Rollback

### Wave B (instant, zero downtime)
Revert `infra/postgres/postgresql.conf` to previous values (in git) + reload:
```bash
git checkout <previous-sha> -- infra/postgres/postgresql.conf
docker cp infra/postgres/postgresql.conf aisha-db:/etc/postgresql/postgresql.conf
docker exec aisha-db psql -U postgres -c 'SELECT pg_reload_conf();'
```

### Wave A (~60 s downtime)
Same as Wave B but `docker compose restart db` instead of pg_reload_conf().
The `shared_preload_libraries` revert removes the extensions on next startup
(safe — they don't store mutable state outside their own internal data).

## Risk register (per Phase 12 §6.3 R2)

| Risk | Likelihood | Mitigation |
|---|---|---|
| `shared_buffers=2GB` exceeds host RAM | Low | Frontend host has 8GB+ confirmed via node-exporter (WP 0.2 dashboard) |
| `work_mem=32MB` × 200 connections OOM under stress | Medium | pgbouncer (WP 1.3) limits actual active sessions; per-session memory is upper bound, not always allocated |
| `max_parallel_workers_per_gather=4` causes context-switch churn | Low | Default `max_parallel_workers=8` (cluster-wide) caps total parallel slots |
| `pgaudit` log volume saturates disk | Low | Only `ddl, role` (not `read`/`write`); typical AISHA traffic is < 100 DDL/day |
| Wave A restart fails | Low | Coolify keeps prior container ready for rollback; verified via healthcheck |

## References

- Phase 12 plan WP 1.2 spec: `~/.claude/plans/chzstame-se-na-velkou-parallel-alpaca.md`
- Baseline (pre-tuning): `docs/perf/BASELINE_2026-05-20.md`
- WP 0.2 Grafana Postgres dashboard: `grafana/dashboards/aisha-postgres.json`
- pgbouncer follow-up: WP 1.3 (next in Phase 1 quick-wins sequence)
- HNSW `ef_search` tuning: per-RPC `SET LOCAL` in `mcp_search_knowledge_v*` (Phase 14 Qwen3 embedding work, NOT this WP)

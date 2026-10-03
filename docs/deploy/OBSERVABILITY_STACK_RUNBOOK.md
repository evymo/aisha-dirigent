# AISHA Observability Stack — Deploy Runbook

> Snapshot 2026-05-20, valid against `main` HEAD after PR #130 merge.
> Phase 12 WP 0.2 deliverable. Companion to `docker-compose.coolify-observability.yml`.

## Overview

The observability stack consumes the OpenTelemetry traces + Prometheus
metrics shipped from 21 services (Phase 12 WP 0.1 + WP 0.4):

```
21 svc-* services                 Coolify hosts                  Operator UI
─────────────────                 ─────────────                  ──────────
 │                                 │                              │
 │  OTel spans ────────────────────┼──→ Langfuse (already deployed)
 │                                 │                              │
 │  /metrics scraped ──────────────┼──→ Prometheus (new)         │
 │                                 │                              │
 │  stdout ────────────────────────┼──→ Loki (new, MinIO backend)─┼──→ Grafana
 │                                 │                              │    (new)
 └─ pg_stat_statements ────────────┼──→ postgres-exporter (new) ──┘
                                   │
                                   └──→ Dozzle (existing, real-time tail)
```

Per Phase 12 §-1.12 audit:
- **Tempo eliminated** (R1) — Langfuse OTLP is sole traces backend
- **Promtail eliminated** (R5) — Loki Docker driver does shipping
- **No new OAuth2 Proxy** (R6) — extends existing dozzle-auth pattern
- **MinIO reused** (R3) — Loki S3 backend, no PVC
- **No new Redis** — observability stack has no Redis dep

## Prerequisites

1. **MinIO must be running** in the `coolify-langfuse` stack on the same host
   (the observability stack joins the `coolify` external network to reach it).
2. **Postgres exporter role** must exist:
   ```sql
   CREATE ROLE postgres_exporter LOGIN PASSWORD '<POSTGRES_EXPORTER_PASSWORD>';
   GRANT pg_monitor TO postgres_exporter;
   GRANT SELECT ON pg_stat_statements TO postgres_exporter;
   ```
   (already in `aisha/db/sql/grants/`; verified by `cold-start.sh` Step 6)
3. **Keycloak studio-proxy client** redirect URIs include the Grafana
   domain. Update via Coolify env or Keycloak admin UI:
   ```
   Valid redirect URIs: https://grafana.backend.id3a.cz/oauth2/callback
   ```
4. **MinIO buckets** `aisha-loki-chunks` + `aisha-loki-ruler` are declared in
   `STORAGE_BUCKETS` of the core `minio-init` service and created by `storage-init`
   on every core deploy (idempotent). Nothing to run by hand; `minio-init` exits
   after the run, so `docker exec` into it is not possible anyway.

## Deploy

### 1. Install Loki Docker driver on each Frontend host

```bash
# Per host (Frontend, Backend, Experimental):
docker plugin install grafana/loki-docker-driver:3.0 \
    --alias loki --grant-all-permissions

# Verify:
docker plugin ls | grep loki
```

### 2. Configure compose-level logging

Add to **each Coolify stack's `docker-compose.coolify*.yml`** (per-service or
top-level x-anchor):

```yaml
x-loki-logging: &loki-logging
  logging:
    driver: loki
    options:
      loki-url: "http://aisha-loki:3100/loki/api/v1/push"
      loki-batch-size: "400"
      loki-retries: "3"
      loki-pipeline-stages: |
        - regex:
            expression: '.*"trace_id"\s*:\s*"(?P<trace_id>[a-f0-9]+)".*'
        - labels:
            trace_id:
      labels: "service,stack=aisha,environment"
      env: "NODE_ENV"
```

Then per-service: `<<: [*v2-common, *loki-logging]`.

### 3. Deploy the observability stack via Coolify

In Coolify UI:
1. New Resource → Docker Compose
2. Repository: `aisha/evymo-ai-orchestrator`
3. Compose file path: `docker-compose.coolify-observability.yml`
4. Domains: `grafana.backend.id3a.cz` → port 4181 (`grafana-auth`)
5. Env vars required:
   - `MINIO_ROOT_USER` (from langfuse stack)
   - `MINIO_ROOT_PASSWORD` (from langfuse stack)
   - `GRAFANA_ADMIN_PASSWORD` (random, store in Coolify Secrets)
   - `POSTGRES_EXPORTER_PASSWORD` (matches PG role above)
   - `STUDIO_OIDC_SECRET` (existing from dozzle-auth)
   - `STUDIO_COOKIE_SECRET` (existing from dozzle-auth)
   - `KEYCLOAK_DOMAIN` (default `auth.backend.id3a.cz`)
   - `GRAFANA_DOMAIN` (default `grafana.backend.id3a.cz`)
6. Deploy.

### 4. Verify

```bash
# 1. Loki ready
curl -fsS http://aisha-loki:3100/ready   # → "ready"

# 2. Prometheus targets all UP
curl -fsS http://aisha-prometheus:9090/api/v1/targets | jq '.data.activeTargets[].health' | sort -u
# Expected: only "up"; if any "down" → check service /metrics endpoint

# 3. Grafana login flow
# Open https://grafana.backend.id3a.cz → redirects to Keycloak → after login
# lands on AISHA Service Health dashboard

# 4. Trace correlation
# In Grafana → Explore → Loki → run query: {stack="aisha"} |= "trace_id"
# Click a log line → derivedFields shows "Open in Langfuse" link
```

### 5. Capture baseline

After 24 h of organic traffic:
```bash
node scripts/observability/capture-baseline.mjs
```
This populates `docs/perf/baseline-<date>.json` with real KPIs from
Langfuse + Prometheus (replaces placeholder values from initial WP 0.5 commit).

## Rollback

### Stop the stack only
- Coolify UI → aisha-observability → Stop. Logs continue going to stdout +
  Dozzle (real-time tail). No service impact.

### Re-attach Loki Docker driver
- If switching back to default JSON file driver per host:
  ```bash
  docker plugin disable loki
  ```
  Per compose: remove the `logging:` block; restart services.

### Full uninstall
- Coolify UI → Delete app. Volumes (`loki-wal`, `prometheus-data`,
  `grafana-data`) preserved as named volumes — clean up manually:
  ```bash
  docker volume rm aisha-observability_loki-wal \
                   aisha-observability_prometheus-data \
                   aisha-observability_grafana-data
  ```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Loki `502 Bad Gateway` from Grafana | MinIO bucket missing | Run bootstrap commands in Prerequisites §4 |
| Prometheus targets all DOWN | network resolution failure | Verify `coolify` network is external + joined |
| Grafana OAuth2 loop | Keycloak redirect URI mismatch | Add `grafana.backend.id3a.cz/oauth2/callback` to studio-proxy client |
| `aisha_request_duration_ms_count` empty | service /metrics returns 404 | Check WP 0.1/0.4 gate (`wp-0-1-otel-bootstrap.gate.test.ts`); verify `registerMetricsPlugin` called in server.ts |
| Logs not appearing in Loki | Docker driver not installed on host | `docker plugin install grafana/loki-docker-driver:3.0` |
| Trace ID link 404s in Langfuse | `trace_id` regex in derivedFields not matching | Adjust regex in `grafana/provisioning/datasources/datasources.yaml` |

## Tunable parameters

| Parameter | File | Default | Notes |
|---|---|---|---|
| Loki retention | `loki/loki-config.yaml` | 14d (336h) | Increase for compliance; MinIO storage scales |
| Prometheus retention | `docker-compose.coolify-observability.yml` | 30d | Thanos sidecar → S3 for >30d (future WP) |
| Scrape interval | `prometheus/prometheus.yml` | 30s | Decrease to 15s for finer p95 |
| Loki ingestion rate | `loki/loki-config.yaml` | 10MB/s per stream | Raise if log volume grows |

## References

- Phase 12 plan: `~/.claude/plans/chzstame-se-na-velkou-parallel-alpaca.md` §0.2
- §-1.12 Redundancy Audit (R1, R3, R5, R6 eliminations)
- Existing Dozzle deploy: `docker-compose.coolify-monitoring.yml`
- Existing Langfuse deploy: `docker-compose.coolify-langfuse.yml`

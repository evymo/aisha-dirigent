# Audience Module — Ops Runbook

Step-by-step playbook for deploying, debugging, and maintaining the audience
module in a live environment. For architectural overview see
`../ARCHITECTURE.md`.

All commands assume the working directory is the orchestration repo root
(`$(git rev-parse --show-toplevel)`).

## Prerequisites

| What | Why | Verify |
|---|---|---|
| Docker + docker-compose | Run source-platform + aisha stacks | `docker info` |
| Both stacks reachable | broker bridges them via host networking | both `docker ps` show healthy containers |
| `versions.yaml` rendered | env vars for compose | `make versions-render` |

## First-time setup (in order)

### 1. Apply audience migrations to aisha-db

```bash
make aisha-integration-apply-migrations
```

This is **idempotent**. Each migration uses defensive guards (`to_regclass IS NULL → skip`)
so a partially-set-up DB is safe. Migrations land in `aisha-db` as the
`postgres` role; broker writer role is created in step 3.

Verify:
```bash
docker exec aisha-db psql -U postgres -d postgres -c "\dv public.audience*"
# should show 14 views
docker exec aisha-db psql -U postgres -d postgres -c "\df public.audience*"
# should show 28 functions
```

### 2. Create source_crm_readonly role on source-postgres

```bash
make aisha-integration-grants
```

Or directly:
```bash
bash scripts/aisha-integration/grant-readonly.sh
```

Creates `source_crm_readonly` role on source-postgres with SELECT on the 5
tables broker needs (`core_appuser`, `core_profile`, `core_event`,
`core_newfollow`, `stats_statsnapshots`). No application-layer changes to
source-api.

Verify:
```bash
docker exec source-platform-postgres-1 psql -U postgres -d postgres \
  -c "SELECT rolname FROM pg_roles WHERE rolname='source_crm_readonly';"
```

### 3. Create svc_source_broker_writer role on aisha-db

```bash
make aisha-integration-broker-grants
```

Or directly:
```bash
bash scripts/aisha-integration/grant-broker-writer.sh [optional-password]
```

Creates `svc_source_broker_writer` on aisha-db with **least-privilege grants**:
- SELECT on `profiles`, `user_engagement_metrics`, `signal_tag_rules`,
  `integration_events` (for read-before-write decisions)
- EXECUTE on 4 audience RPCs (`audience_upsert_user_engagement`,
  `audience_process_signal_audited`, `audience_log_event`,
  `audience_tag_resource`) — SECURITY DEFINER routes writes through audited
  entry points
- INSERT-only on `integration_events` for webhook ingestion (no UPDATE/DELETE)
- Connection cap: 10 concurrent

Update broker env vars (printed at the end of the script):
```
AISHA_POSTGRES_URL=postgresql://svc_source_broker_writer:<pw>@host.docker.internal:57422/postgres
```

### 4. Bring up broker

```bash
make aisha-integration-up
```

This applies the docker-compose overlay (`docker-compose.aisha-integration.yml`)
adding `svc-source-broker` to the source network. Broker reaches aisha-db via
`host.docker.internal:57422` (extra_hosts entry).

Verify:
```bash
curl http://localhost:8090/healthz
# {"status":"ok","service":"svc-source-broker","source_token_cached":true}

curl http://localhost:8090/sync/probe
# {"probe":{"ok":true,"latencyMs":4},"kpi":null}

curl http://localhost:8090/sync/scheduler/status | jq
# .state.lastSuccessAt should populate after first scheduler tick
```

### 5. Keycloak admin recovery (if needed) + broker client registration

For Token Exchange (Path B federation) — see `KEYCLOAK_SOURCE_FEDERATION.md`.

**5a. Recover/bootstrap admin access** (skip if you already have admin creds):

```bash
# Run inside the running aisha-keycloak container — works without restart.
docker exec -e TMP_PW="$(openssl rand -hex 16)" aisha-keycloak \
  /opt/keycloak/bin/kc.sh bootstrap-admin user \
  --username=local-dev-admin --password:env=TMP_PW --no-prompt

# Persist credentials for repeatable use:
echo "KC_LOCAL_ADMIN_USER=local-dev-admin" > _platform/.env-local-keycloak
echo "KC_LOCAL_ADMIN_PW=<the-password-from-above>" >> _platform/.env-local-keycloak
chmod 600 _platform/.env-local-keycloak  # gitignored
```

**Why this exists:** `KEYCLOAK_ADMIN_PASSWORD` env var is used ONLY on
first container startup. Subsequent restarts ignore it (admin hash is
already persisted in PG). `kc.sh bootstrap-admin user` creates a temp
admin against the running instance — the documented escape hatch in KC v25+.

**5b. Register svc-source-broker client**:

```bash
cd _platform/
make keycloak-broker-client
```

This script:
- Reads `.env-local-keycloak` for admin credentials
- Creates/updates `svc-source-broker` client in realm `aisha`
- Generates client_secret + saves to `.env-local-keycloak`
- Sets `token.exchange.permission.enabled=true` attribute

**5c. Restart broker with Keycloak env loaded**:

```bash
set -a; source .env-local-keycloak; set +a
make aisha-integration-up
```

When neither the gateway intranet key nor the JWT secret is configured, the
broker returns sourceToken-only on `/auth/source/login` with a `_note`
explaining the disabled session mint (`routes/auth.ts`). The broker needs
`OIDC_APP_CLIENT_ID` (the instance web client) — without it, it refuses to start.

### 6. (Optional) Local Appsmith for marketer UI testing

For testing the audience templates end-to-end with the marketer-facing UI:

```bash
cd _platform/
make appsmith-up                 # boot Appsmith CE on http://localhost:8085 (~2 min)
make appsmith-status             # health check
```

First-time Appsmith setup:
1. Open `http://localhost:8085` in browser
2. Register the first admin user (form auth — local dev only)
3. Click **+ New app** → **Import** → **From file**
4. Pick a template from `aisha-crm-fork/appsmith-templates/audience/*.json`
5. Configure the PostgREST datasource (endpoint: `http://host.docker.internal:57421`)
6. Templates use `{{appsmith.user.jwt}}` for auth — paste a service_role JWT
   for testing (or wire OAuth2 Proxy + Keycloak for production)

Stop with `make appsmith-down`. Persistent volume `aisha-appsmith-local-stacks`
survives between restarts (apps, datasources, users preserved).

**Production setup** (Coolify with Keycloak SSO) is in
`aisha-crm-fork/docker-compose.coolify-admin.yml` — that's the canonical stack
when you have public DNS + Traefik + OIDC. The local overlay is intentionally
minimal for dev iteration.

## Day-to-day operations

### Trigger a sync manually

```bash
make aisha-integration-sync
# or:
curl -X POST http://localhost:8090/sync/scheduler/trigger | jq
```

Returns `{status, stats: {recentActiveFetched, upserted, errors, durationMs}}`.

### Check sync state

```bash
curl -s http://localhost:8090/sync/scheduler/status | jq .state
# {
#   "lastSuccessAt": "2026-05-23T16:39:12.300Z",
#   "lastErrorAt": "2026-05-23T16:38:58.527Z",
#   "consecutiveFailures": 0,
#   "totalSyncs": 9,
#   "totalFailures": 6,
#   "circuitOpen": false,
#   "effectiveIntervalMs": 600000
# }
```

`circuitOpen=true` means broker has backed off after 5+ consecutive failures.
Any single success closes it.

### Seed signal_tag_rules

```sql
INSERT INTO public.signal_tag_rules
  (event_type_pattern, source_pattern, tags, priority, description, is_active)
VALUES
  ('^event_attendance\.', 'source-api',
   ARRAY['attended_event','engaged'], 10,
   'Auto-tag attendance events', true);
```

Or via Appsmith (marketer-editable).

### Send a test webhook

```bash
USER_ID="<aisha-user-uuid>"
SECRET="$(docker exec aisha-svc-source-broker printenv SOURCE_WEBHOOK_HMAC_SECRET)"
PAYLOAD=$(printf '{"mantra":"OM A HUM VAJRA GURU PADMA SIDDHI HUM","event_source":"source-api","event_type":"event_attendance.recorded","occurred_at":"%s","metadata":{"user_id":"%s"}}' \
  "$(date -u +%FT%TZ)" "$USER_ID")
SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')
curl -X POST http://localhost:8090/webhook/source \
  -H "Content-Type: application/json" \
  -H "X-Source-Signature: $SIG" \
  -d "$PAYLOAD" | jq
# {"status":"accepted","event_id":"..."}
```

Note the mantras: **broker sends** RAM YAM KHAM OM A HUM (outgoing);
**broker expects in webhooks** OM A HUM VAJRA GURU PADMA SIDDHI HUM (incoming).

### Inspect applied tags

```sql
SELECT label, resource_type, resource_id, created_at
FROM public.story_labels
WHERE resource_type = 'actor'
ORDER BY created_at DESC LIMIT 20;
```

### View aggregated engagement

```sql
SELECT user_id, app_accesses_30d, audience_size, source_slug, computed_at
FROM public.user_engagement_metrics
ORDER BY computed_at DESC LIMIT 10;
```

## Troubleshooting

### Broker reports `(unhealthy)`

Most often: `node:22-alpine` doesn't ship `wget`. We use inline Node http check
(`docker-compose.aisha-integration.yml` healthcheck section). If you see
"command not found" in healthcheck output, the compose file is out of sync.

### "permission denied" from broker writes

Two common causes:
1. **RLS policy missing**: `20260523210000_audience_webhook_integration_grants.sql`
   creates `broker_writer_all_events` policy. If you see `permission denied
   for table integration_events`, re-run the migration.
2. **Missing column GRANT**: writer role intentionally has no UPDATE/DELETE.
   If broker code uses `ON CONFLICT DO UPDATE`, that requires UPDATE grant we
   don't give. We catch SQLSTATE 23505 and look up existing event_id instead
   (see `routes/webhook.ts`).

### Scheduler stuck "inflight"

Symptom: `/sync/scheduler/status` shows `lastResult: null` for >5 minutes
despite the broker running.

Root cause: `pg.Client` without explicit `connectionTimeoutMillis` hangs on
unreachable hosts. We added 5s timeout in both `clients/source-pg.ts` and
`scheduler.ts`. Also `Promise.race` against 120s ceiling forces an
inflight reset if anything hangs.

If you see this, check broker logs:
```bash
docker logs aisha-svc-source-broker --tail=50 | grep -i scheduler
```

### Sync returns `recentActiveFetched: 0`

Either:
- No users in source-postgres have `last_activity > since`. Verify:
  ```sql
  SELECT count(*) FROM core_appuser WHERE last_activity > now() - interval '24h';
  ```
- Cursor is too recent. If broker just restarted, cursor restores from
  `last_success_at`. To force a full backfill:
  ```sql
  UPDATE public.audience_broker_sync_state SET last_success_at = NULL
  WHERE source_slug = 'source-api';
  ```
  Then restart broker.

## Known quirks (intentional design choices)

### `FOR ALL` RLS policy on integration_events

`20260523210000_audience_webhook_integration_grants.sql` creates a
`broker_writer_all_events` policy with `FOR ALL USING (true) WITH CHECK (true)`.

A narrower `FOR INSERT WITH CHECK (true)` was tried first but produced
spurious "permission denied" errors even when GRANT INSERT was in place
— likely due to interaction with secondary SELECT/UPDATE checks triggered
by the `RETURNING` clause. The `FOR ALL` form works without compromising
least-privilege because the role's table-level GRANTs explicitly omit
UPDATE/DELETE — the policy can permit them but the GRANT denies them.

### `source_connector_slug` column name

Legacy from when the broker concept was called a "connector". Renamed to
`source_slug` in migration `20260524100000_audience_rename_connector_slug.sql`.
Older deployments may still see the old column; the rename migration
includes a defensive column-exists check.

### Broker writes through SECURITY DEFINER RPCs, not direct table writes

`audience_upsert_user_engagement`, `audience_process_signal_audited`,
`audience_broker_record_sync` are all `SECURITY DEFINER`. The broker writer
role has EXECUTE on them but no underlying table grants. This is the
intended pattern — privileged operations go through audited entry points,
and the writer role can't be repurposed to bypass them.

## Disaster recovery

### Lost broker container, need cold restart

Scheduler cursor (`audience_broker_sync_state.last_success_at`) survives
in aisha-db. On restart broker reads it and resumes — no manual intervention.

If the row is corrupted or missing, broker falls back to 24h-ago cursor on
first tick (logs `cold start (24h cursor)`).

### Need to force re-sync everything

```sql
DELETE FROM public.audience_broker_sync_state WHERE source_slug = 'source-api';
```

Then trigger:
```bash
curl -X POST http://localhost:8090/sync/scheduler/trigger
```

Broker uses 24h fallback cursor → fetches all recently-active users.

### Need to wipe + re-apply migrations

```bash
docker exec aisha-db psql -U postgres -d postgres -c \
  "DROP TABLE IF EXISTS public.audience_broker_sync_state, public.signal_tag_rules CASCADE;"
# Then re-apply
make aisha-integration-apply-migrations
```

Defensive migrations re-create everything; existing aisha tables (with
column extensions) are not touched.

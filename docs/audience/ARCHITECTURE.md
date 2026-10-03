# Audience Module — Architecture

5-minute mental model. For tier semantics see UNIVERSAL_MEMBER_MODEL.md.

## Data flow

```
┌────────────────────────────────────────────────────────────────────────┐
│  SOURCE PLATFORM STACK (untouched application layer)                   │
│                                                                        │
│    source-api (Django + GraphQL)  ◀───── caller-supplied OTP login     │
│         │                                                              │
│         │ stored in                                                    │
│         ▼                                                              │
│    source-postgres (core_appuser, core_event, core_newfollow, ...)     │
│         │                                                              │
└─────────┼──────────────────────────────────────────────────────────────┘
          │ READ-ONLY via dedicated role `source_crm_readonly`
          │ (one-time GRANT SELECT recipe, source-api unaware)
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│  svc-source-broker (Fastify on :8090)                                  │
│                                                                        │
│    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│    │ /sync/run│  │/webhook  │  │/auth/    │  │scheduler │              │
│    │ POST     │  │/source   │  │source/*  │  │(in-proc) │              │
│    │ aggregate│  │POST HMAC │  │OTP+JWT   │  │ every Nm │              │
│    │ pull     │  │signed    │  │+TokenExch│  │  cursor  │              │
│    └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│         │             │             │             │                    │
└─────────┼─────────────┼─────────────┼─────────────┼────────────────────┘
          │             │             │             │
          │             │             │             │ persists state to
          ▼             ▼             ▼             ▼
┌────────────────────────────────────────────────────────────────────────┐
│  aisha-db (separate stack; broker is multi-network attached)           │
│                                                                        │
│  Writes via least-privilege role `svc_source_broker_writer`            │
│  (SELECT on 5 tables, EXECUTE on 4 SECURITY DEFINER RPCs, INSERT       │
│   only on integration_events for webhook ingestion)                    │
│                                                                        │
│   audience_upsert_user_engagement()                                    │
│        ────► public.user_engagement_metrics                            │
│                                                                        │
│   audience_process_signal_audited()                                    │
│        ────► public.story_labels (polymorphic tags)                    │
│        ────► public.audit_journal  (signal record)                     │
│                                                                        │
│   audience_broker_record_sync()                                        │
│        ────► public.audience_broker_sync_state (persistent cursor)     │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
          │
          │ PostgREST exposes 14 audience_* views + 28 audience_* RPCs
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Appsmith intranet (marketer-facing dashboards)                        │
│                                                                        │
│    Templates: contact-directory, campaign-performance, cohort-manager, │
│               followup-queue, tier-funnel                              │
│                                                                        │
│    Marketer customizes UI in Appsmith (no React code in this repo)     │
└────────────────────────────────────────────────────────────────────────┘
```

## Layers

### L1: Data sources (read-only contracts)
The broker contains all aggregation logic in `clients/source-pg.ts`. Adding a
second source (Salesforce, HubSpot, …) means a new client file in `clients/`,
not a schema change in aisha-db. Generic interface lives in
`packages/audience-types/src/IDataSource.ts`.

### L2: Broker (svc-source-broker)
A Fastify Node.js service mirroring the existing `svc-github-app` / `svc-stripe`
microservice pattern. Three responsibilities:

| Route | Purpose | Auth |
|---|---|---|
| `POST /sync/run` | Manual or scheduler-driven aggregate pull | dev: open (env-gated); prod: admin JWT |
| `POST /webhook/source` | Receive change events from source-api | HMAC SHA-256 + mantra check |
| `POST /auth/source/*` | 3-step OTP login → Keycloak Token Exchange | none (rate-limit only) |

In-process scheduler (`scheduler.ts`) runs `/sync/run` on `SOURCE_SYNC_INTERVAL_MS`
interval with persistent cursor + circuit breaker.

### L3: Aisha-db audience surface
12 migrations under `aisha/db/migrations/20260523*` deliver:
- **2 new tables**: `signal_tag_rules`, `audience_broker_sync_state`
  (+ `user_engagement_metrics` renamed from `specialist_activity_metrics`)
- **14 views** (`audience_actor_*_v` + `audience_admin_*_v`) for read paths
- **28 RPCs** (`audience_*`) for write + read-with-logic paths
- **4 triggers** (audit→story, vectorize notes, default scope, validate scope)
- **6 context_profiles** rows (tier-gated AI capabilities)
- Schema extensions on existing tables: `notification_campaigns.channels[]`,
  `story_ai_sessions.focus_actor_id`, `story_labels.resource_type+resource_id`
  (polymorphic), `study_consultants.scope_type+scope_id` (universal scoped role)

### L4: PostgREST + Appsmith
PostgREST auto-exposes anything `authenticator` role can read. Migration
`20260523230000_audience_postgrest_grants.sql` + targeted view dep grants
make audience surface visible. Appsmith binds JWT-authenticated PostgREST
calls; 5 starter templates in `appsmith-templates/audience/`.

### L5: Keycloak federation
Path B in `ops/KEYCLOAK_SOURCE_FEDERATION.md`: broker proxies the source
3-step OTP login, then exchanges the resulting source JWT for an aisha JWT
via Keycloak `urn:ietf:params:oauth:grant-type:token-exchange` grant. One-time
realm setup via `_platform/scripts/aisha-integration/keycloak-broker-client.sh`.

## Concurrency / failure model

- **Single broker instance** per environment (no horizontal scale yet).
  In-memory `inflight` mutex prevents overlapping sync ticks.
- **Persistent cursor** in `audience_broker_sync_state.last_success_at`.
  Container restart resumes from last successful tick; no 24h backfill.
- **Circuit breaker**: 5 consecutive failures → effective interval × 4
  backoff. Any single success closes the circuit.
- **Hard timeout**: 120s per sync. `Promise.race` against timeout prevents
  blocked external calls from permanently stalling the scheduler.
- **Idempotent webhook ingestion**: `(event_source, external_id)` unique
  index dedupes; broker derives `external_id` from payload hash if source
  doesn't supply one.

## What's intentionally absent

- **No new schema namespace** — `audience_*` prefix is enough.
- **No data source registry table** — env vars + integration_events history
  cover the same need with one-third the moving parts.
- **No actor_overlay table** — story_entries (notes) + ai_tasks (follow-ups)
  + story_labels (tags) + study_consultants (assigned_to) carry the load.
- **No custom React admin** — Appsmith templates own the UI.

Only `signal_tag_rules` is a genuinely new table; every other concept rides on an existing aisha table.

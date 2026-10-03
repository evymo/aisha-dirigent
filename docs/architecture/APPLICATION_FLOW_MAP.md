# AISHA — Application Flow Map (current state, all bindings)

> Branch `feat/remediation` @ HEAD. Read-only map produced by 6 parallel flow-tracing passes
> (ingress · auth · service→DB · events · AI/model+ledger · orchestration+frontend).
> "Binding" = an edge in the running system: who calls whom, over what, and whether it's live.

## 0. Three entry planes (how anything reaches a handler)

```
PUBLIC   client → pfSense(TLS *.aisha.guru) → HAProxy → Frontend Coolify Traefik → edge-proxy(Caddy :80)
           → [MESH off ⇒ PUBLIC upstreams] → Backend Coolify Traefik → container
INTERNAL *.<server>.id3a.cz → Backend Traefik → container (cross-stack / operator LAN)
MESH     edge-proxy → mesh-router (DNAT :8080/:3001) → WireGuard wt0 → core-mesh-ingress → coolify-proxy → gateway
           [currently OFF: MESH_ENABLED=false AND CORE_MESH_IP empty]
```
oauth2-proxy fronts the *apps* (n8n, nocodb, appsmith, **intranet**, pki, grafana, dozzle). The **gateway/api is DIRECT** (does its own Keycloak JWT verify + CORS + rate-limit); so are keycloak, web SPA, ws-gateway, svc-ai-chat(`ask`).

## 1. Gateway routing (`services/gateway/src/server.ts`, :3001)

| Prefix | → target | Notes |
|---|---|---|
| `/auth/v1` | Keycloak | token/authorize proxy; returns KC token unmodified |
| `/rest/v1` | PostgREST | **verify-then-derive**: KC RS256 → HS256 mint |
| `/storage/v1` | storage-auth:3005 | |
| `/functions/v1/:fn` | edge-fn ROUTE_TABLE | fan-out to 16 svc-* (see §3); unknown → 404 |
| `/realtime/v1` | ws-gateway:3002 | ⚠ WS upgrade **not proxied** (returns `ws_direct_url`) |
| `/v1` (Omni) | svc-ai-chat:3011 | streaming; PAT passthrough (validated downstream) |
| `/internal/*` | self (deployment-executor/dev-patch/auth-email) | service-role only |
| `/intranet/*` | PostgREST + svc-mcp-knowledge | S2 verify-OIDC; gated by `INTRANET_ENABLED` (**off**) |

## 2. Identity flow

- **`/rest/v1`** (verify-then-derive): KC token → JWKS RS256 verify + `kcAllowedClients` + jti-revocation → mint HS256 (`role:authenticated`, `sub`=KC sub) → PostgREST. `auth.uid()` resolves KC sub via the **`aisha_auth.identities`** table.
- **`/intranet/*`** (S2, verify-then-derive): `X-Auth-Request-Access-Token` (oauth2-proxy) → `verifyKeycloakClaims` restricted to `kcIntranetAllowedClients` → **fail-loud on no-jti** → `lookupUserByEmail` → mint HS256 with `sub`=**DB user.id** → `auth.uid()` direct-UUID branch.
- **Service auth** (`@aisha/security`): `verifyToken` (JWKS) for users; `verifyServiceRole` (constant-time shared secret, fail-closed if unset) for internal; dual-lane per route.
- **DB**: 1407 `SECURITY DEFINER` + 1635 `REVOKE PUBLIC/anon` + 978 `GRANT service_role`; user fns rely on RLS + `is_admin_or_staff()`/`is_story_participant()`; 100% table RLS.

## 3. Service → DB & inter-service

- **Shared client** `@aisha/postgrest-client` (`rpcService`/`rpcUser`/`rpcUserClaims`): **17 adopters**. **11 non-adopters** (gateway, storage-auth, event-worker, svc-agent-runner, svc-web-artifact, svc-openclaw, svc-playwright-runner, svc-source-broker, svc-pki-bridge, svc-aitg-probes, ws-gateway) — extraction incomplete.
- **No Supabase** anywhere (clean).
- **Inter-service HTTP**: gateway fans `/functions/v1/*` → 16 svc-*; svc-ai-chat → svc-mcp-knowledge(/mcp) → svc-aitg-probes(/probes) → svc-ai-chat(/chat) [AITG loop]; svc-plugin-system → svc-agent-runner(/runs) + svc-push(/send) + gateway(ai-generate); svc-source-broker → gateway(/token-exchange); event-worker →Redis→ ws-gateway.

## 4. Event / async — **3 disjoint fabrics**

- **Lane A** `pg_notify → event-worker LISTEN → Redis → ws-gateway → browser`. DB emits **8** channels, event-worker LISTENs on **5**, intersection = **only `agent_run_queued`**.
- **Lane B** `pg_net (net.http_post) → n8n/gateway edge-fn` (bypasses event-worker) — kb_embedding_sync, kb_ragnarok_sync, blockchain-dispatch, rule-propagation, ale-feedback, compliance-gate, auth-send-email.
- **Lane C** RabbitMQ → n8n — `aisha.blockchain.sync` → WF_BLOCKCHAIN_SYNC → cosmos-ledger-sync.
- **Blockchain outbox** (only fully-wired end-to-end): `token_transactions` INSERT → `trg_queue_blockchain_sync` → book row → `retry_pending_blockchain_syncs` → RabbitMQ → cosmos.
- ~36 n8n cron workflows (WF_LEDGER_CHAIN_VERIFY 6h, WF_PKI_CERT_ROTATION daily, health probes, nightly eval).

## 5. AI/model flow

`POST /v1/*` → Omni auth (PAT) → complexity split → residency check → `derive_clow_needs` → **`aisha_resolve_clow_backend`** (DB policy `ai_resolver_policy` GLOBAL, fail-loud; ranks providers×models×benchmarks; §11 cloud_forbidden→local; serviceable_slugs) → provider → **`fn_admit_clow`** spend gate → stream → **AITG output guard (on every surface)** → SSE. Every dispatch is **journaled fail-closed** (no dispatch without a decision). **No config/env default model** — all live DB resolve.

## 6. Ledger flow

`award_tokens`/`claim_cosmos_reward` → `token_transactions` → `trg_queue_blockchain_sync` → **GDPR filter (only governance/aisha)** → **in-DB hash-chain book (ALWAYS on, chain-link + tamper-guard)** → [opt-out flag] → outbox → svc-blockchain → RabbitMQ → cosmos MsgSend/MsgVote (cosmos1). Governance: `cast_governance_vote` (custodial, weight from tokens_governance, anchored) + on-chain MsgVote.

## 7. Orchestration / deploy (Dirigent) + frontend

- Deploy: `WF_BLUE_GREEN_ORCHESTRATOR` → `blue-green-switch.mjs` (slot-lock → Coolify PATCH env → deploy → smoke → risk-eval → Traefik label swap → commit). Drift (`WF_DRIFT_OBSERVER`), Sentry rollback (request-only, human-gated), approval gate (HMAC-signed links, D2/N8N-03).
- Frontend: web + mobile → `@aisha/api-core` (`{gateway}/rest/v1/rpc` + `/functions/v1`, KC Bearer). n8n/scripts hit PostgREST **directly** (service-role `aishaRpc`), frontends hit it **through the gateway**.

---

## 🔴 BROKEN BINDINGS (integration gaps — several INSIDE the remediation; → P0)

| # | Binding | Break | Origin |
|---|---|---|---|
| **B1** | `intranet.ts:186` → RPC `get_user_by_email` | **RPC absent from SoT** (`aisha/db/sql/functions/`, baseline). D1 built 15 RPCs, missed this. ⇒ **every `/intranet` request 401s `user_not_found`**. | S2/D1 handoff |
| **B2** | `WF_APPROVAL_GATE` → `fn_create_approval_request` | WF passes `approvalId='approval_<ts>_<rand>'` (**string**) + `risk='high'` (**text**); RPC needs `uuid` + `numeric`. Cast error **swallowed by `onError:continueRegularOutput`** ⇒ **`approval_requests` ledger never written/resolved**; `request_rollback` gate depends on it. | D2↔D1 signature mismatch |
| **B3** | ledger opt-out `data.on_chain_anchor` | Written by `fn_queue_blockchain_sync:74` but **no service reads it**. Opt-out only suppresses eager `pg_notify`; the **polling** `retry_pending_blockchain_syncs` dispatches all `queued` rows anyway ⇒ **opt-out ineffective**. | D1/D2 ledger opt-out gap |
| **B4** | auto-award → cosmos `broadcastMsgSend` | `ledger-sync.ts:84` reads `action_type`, but the book row carries `transaction_type` ⇒ `isAward=false` ⇒ off-chain-confirm branch ⇒ **automatic token awards never move on-chain** (only user-driven claim does). | pre-existing field mismatch |
| **B5** | `LEDGER_ENABLED` (svc-blockchain) | Container env set (`docker-compose.coolify-cosmos.yml:133`) but **service never reads it**; the effective DB GUC `app.settings.ledger_enabled` is **never SET** ⇒ defaults `'true'`. Two surfaces disagree (container off / DB on). | D9 deploy-config gap |
| **B6** | `fn_sync_keycloak_roles` → `/functions/v1/keycloak-role-sync` | Target **not in the gateway edge-fn registry** (`functions.ts`) ⇒ likely **404**. | pre-existing |
| **B7** | svc-github-app → `raw_query_admin` (×3) | Still calls the general-purpose SQL executor for installation upsert/suspend/unsuspend (D1 made repo RPCs, not installation ones); errors swallowed in `try/catch{}`. Widest-blast-radius fn in the repo. | partial gate (no-raw-query-admin) |

## 🟡 DORMANT / OFF (wired but inactive)

- **Deploy workflows `active:false`**: WF_BLUE_GREEN_ORCHESTRATOR, WF_DRIFT_OBSERVER, WF_SENTRY_OBSERVER (not live webhooks until activated).
- **Event Lane A mostly dead**: 4 LISTEN channels never emitted (`db_changes`, `realtime_broadcast`, `storage_events`, `playwright_run_queued`) ⇒ the ws-realtime path, the `webhookRoutes` map, and n8n-forward are all disabled; only `agent_run_queued` fires. (`storage_events`-never-emitted confirms the GW-08 av-scan gap.)
- `pg_notify('blockchain_sync')` and `pg_notify('acs_message')` have **no LISTENer** (orphaned signals; the `acsInbound` hydrator is built but never wired).
- `aisha.pipeline.execute` RabbitMQ queue has a **consumer but no producer**.
- `cosmos_anchor` reflection node is wired **only into `deploy-reflect.json`** — ordinary reasoning/story reflection never anchors a cognition hash.
- **Mesh path non-functional** (`CORE_MESH_IP` empty; masked by `MESH_ENABLED=false`).
- **`/intranet` fully closed by config** (`INTRANET_ENABLED=false` + empty `KC_INTRANET_ALLOWED_CLIENTS`).
- `db.aisha.guru` (pgAdmin) has **no edge ingress** in any mode.

## ⚠ INCONSISTENCIES / RISK

- **Two divergent KC-sub→DB-user resolutions**: `/rest/v1` via the `identities` table vs `/intranet` via email→DB id. A KC user without an `identities` row works on intranet but is RLS-denied (`auth.uid()=NULL`) on `/rest/v1`.
- **Revocation asymmetry**: `/rest/v1` mints for a jti-less token (treats non-revoked); `/intranet` 401s. Both fail-open on Redis outage by design.
- **Gateway can mint `role:service_role` HS256** from `JWT_SECRET` (`intranet.ts:mintServiceJwt`) — blast radius on gateway code-exec / secret leak.
- **2 services bypass PostgREST** with a raw `pg.Client`: svc-source-broker (writes — should route via PostgREST), event-worker (LISTEN — defensible).
- **`@aisha/postgrest-client` extraction incomplete** (11 non-adopters re-implement `fetch→/rpc`).
- **MCP intranet port**: `intranet.ts:36` defaults `svc-mcp-knowledge:3010` vs catalog `:3017` (dangling if `MCP_UPSTREAM_URL` unset).

---

## Why this matters (the meta-finding)

The domain-partition executed cleanly **per domain** (gates green), but the **cross-domain bindings** (B1–B6) have real mismatches the per-domain gates couldn't catch — RPC signatures that don't match their callers, a flag written but never read, an env set but never consumed. **This flow map is the integration test the gates were not.** B1–B7 belong in P0 alongside the systemic view-layer + currency fixes; each should get a wiring gate so the binding can't silently break again.

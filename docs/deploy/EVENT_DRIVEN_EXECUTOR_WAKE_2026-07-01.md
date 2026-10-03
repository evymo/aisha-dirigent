# Event-Driven Executor Wake — Deploy Record, Runbook & Incident (2026-07-01)

> **Status:** DEPLOYED to production, **INERT** (activation deferred by operator decision).
> **Change:** PR #565 — `feat(orchestration): event-driven wake for the agent-runner (poll → NOTIFY/LISTEN)`. Merge commit `78d2d2e3`.
> **Scope:** First executor converted under the [event-driven conversion program](../../CLAUDE.md) ("nothing periodic behind the stack, only event-driven").

This document is the single source of truth for: what the wake wire is, how it was deployed and verified, the production incident found and fixed along the way, the **activation runbook** for the deferred switch-on, and the queued follow-ups.

---

## 1. Summary

`svc-agent-runner` claims queued `claude_cli_task` runs from the `agent_runs` table. Historically it did this by **polling** `claim_queued_claude_run` on an interval. Under the event-driven directive, this PR adds an **event-primary wake**: a claimable run is claimed the moment it becomes claimable, with the poll demoted to a **fire-and-forget safety net**.

The wire is **additive and env-gated**: deployed code is completely inert until two env vars are set. Production currently has the executor **dormant** (`CLAUDE_POLL_ENABLED=false`), so the wire was deployed but **not activated** — that is a deliberate operator decision pending readiness for live Claude runs (and their cost). See §6 for the activation runbook.

---

## 2. Architecture — the wire (three halves)

Reuses the **existing** `event-worker` LISTEN hub — no new per-service listeners.

### 2.1 DB (installed on `aisha-core` via `heals.sql`)
- **`fn_notify_queued_agent_run()`** + **`trg_agent_runs_notify_queued`** (`AFTER INSERT OR UPDATE ON public.agent_runs`).
- Fires `NOTIFY 'agent_run_queued'` **only on the transition INTO claimable** — an INSERT already `queued`, or an approval just granted. The claimable predicate mirrors `claim_queued_claude_run` exactly: `kind='claude_cli_task' AND status='queued' AND NOT (approval_required AND approved_at IS NULL)`. It fires on the transition (`v_new_claimable AND NOT v_old_claimable`), never on unrelated updates.
- `SECURITY DEFINER`, **service_role-only** grant (trigger fn → no client grant → stays out of the `SEC_DEF_NO_AUTH` gate class).
- Payload carries `schema='public'`, `table='agent_runs'` so `event-worker`'s existing table-keyed routing needs config only.
- Source: [`aisha/db/sql/functions/fn_notify_queued_agent_run.sql`](../../aisha/db/sql/functions/fn_notify_queued_agent_run.sql), [`aisha/db/sql/triggers/trg_agent_runs_notify_queued.sql`](../../aisha/db/sql/triggers/trg_agent_runs_notify_queued.sql).

### 2.2 event-worker (`aisha-realtime` stack)
- LISTENs `agent_run_queued` (added to `pgChannels`).
- Routes by **payload `schema.table`** (channel-agnostic): `webhookRoutes.get('public.agent_runs') → WEBHOOK_AGENT_RUNNER`, then `POST`s the raw payload.
- **Empty `WEBHOOK_AGENT_RUNNER` ⇒ the route is skipped** (the safety poll still drains). This is what makes the deploy inert until activated.
- Source: [`services/event-worker/src/config.ts`](../../services/event-worker/src/config.ts), handler [`services/event-worker/src/worker.ts`](../../services/event-worker/src/worker.ts) (`handleNotification`).

### 2.3 svc-agent-runner (`aisha-exec` stack, container `aisha-svc-agent-runner:3030`)
- `POST /wake?token=<tok>` — shared-token guard (internal-mesh only) → `wakeClaudePoller()` runs **one immediate out-of-band claim**, guarded by the same `inFlight`/caps checks as the periodic tick (no double-claim, no thundering herd).
- The **token rides in the query string** (`?token=`), because event-worker POSTs the NOTIFY payload as the body and the route ignores the body.
- Source: [`services/svc-agent-runner/src/routes/wake.ts`](../../services/svc-agent-runner/src/routes/wake.ts), [`services/svc-agent-runner/src/poller.ts`](../../services/svc-agent-runner/src/poller.ts) (`wakeClaudePoller`).

### 2.4 Design decision — event-primary + **slow backstop poll**, NOT pure-event
`NOTIFY` is fire-and-forget: a run queued **while event-worker is down** fires into the void and is **stranded forever** — no periodic sweep ever catches it. Given event-worker is a single hub with limited self-heal (see §5), the correct end-state is *event-primary with a slow backstop poll*, not pure-event. Both the wake and the periodic tick gate on the single `caps.pollEnabled` flag (semantically "executor enabled"): activation sets it `true` with a **long** interval so the periodic cost is ~one query per 5 min while the wake carries the fast path.

---

## 3. Deploy record

| Stack | UUID (prefix) | Change | Result |
|---|---|---|---|
| `aisha-core` | `frlg9x4zp2` | migrate→heals installs fn + trigger | `finished` → `running:healthy` |
| `aisha-exec` | `pl6xr8zv9t` | svc-agent-runner `/wake` | `finished` → `running:healthy` |
| `aisha-realtime` | `re1w7w3eng` | event-worker new channels/route | `finished` → `running:healthy` |

- Triggered via Coolify API: `GET /api/v1/deploy?uuid=<uuid>&force=false` (rebuilds only changed layers — including the migrate image, since `heals.sql` changed).
- **Full stack post-deploy: 21/21 `running:healthy`** — zero collateral.

---

## 4. Verification evidence

- **Trigger installed (core):** the core compose gates dependents on `depends_on: migrate: condition: service_completed_successfully`. The deployment log shows `migrate … Started → dependents Waiting → migrate … Exited → gateway/svc-plugin-system/svc-web-artifact Starting`. Since `migrate.mjs` runs heals under `ON_ERROR_STOP=1`, a SQL error would make migrate exit non-zero → dependents blocked → deploy fail. Dependents started and core is healthy ⇒ **heals (incl. the `CREATE TRIGGER`) succeeded**. This "migrate-gate" is the reliable prod-verify signal without direct DB access.
- **svc-agent-runner (exec):** logs show `Server listening at :3030`, `svc-agent-runner listening on :3030 (backend: docker)`, `claude poller started (caps resolved dynamically from system_config)`. `/wake` is registered before `listen()` (which succeeded) — its 401/202 behaviour is covered by the unit test.
- **event-worker (realtime):** deployment `finished` at `78d2d2e3` + `running:healthy` ⇒ the startup LISTEN-loop (`for (const channel of config.pgChannels) LISTEN <channel>`) executed for all channels incl. `agent_run_queued`. A `LISTEN` on any identifier always succeeds; there is no running-but-not-listening state.

### Tests shipped with the PR
- [`src/tests/db/agent-run-wake-notify.integration.test.ts`](../../src/tests/db/agent-run-wake-notify.integration.test.ts) — raw-pg LISTEN against a real pg17+heals container: fires on claimable insert with the right payload; **silent** for approval-held; **fires** when approval is granted; **silent** on unrelated updates.
- [`aisha/db/tests/schema/17_agent_run_wake_notify.sql`](../../aisha/db/tests/schema/17_agent_run_wake_notify.sql) — pgTAP: objects exist + trigger fires cleanly on claimable / held / non-claude paths.
- [`services/svc-agent-runner/src/tests/wake.unit.test.ts`](../../services/svc-agent-runner/src/tests/wake.unit.test.ts) — token guard (202 valid / 401 wrong / 401 missing) + wakes exactly once.

---

## 5. Incident — `aisha-realtime` was down (found & fixed during deploy prep)

**Symptom.** During pre-deploy topology discovery, `aisha-realtime` — the stack running **event-worker, the single LISTEN hub for the entire event plane** (db_changes→ws-gateway, broadcast, storage events, existing webhook routes) — was `exited:unhealthy`, offline since **2026-07-01 14:51** (~26h after a clean deploy of commit `286b41da`).

**Resolution.** Coolify restart → `running:healthy` in ~105s; event-worker reconnected (Redis + PostgreSQL) and re-LISTENed all channels.

**Root cause: undetermined (transient).** A restart fixing it rules out a broken image/config. But with `restart: unless-stopped`, a simple `process.exit(1)` crash should have self-healed — it didn't, which means the containers were **stopped** (a `docker stop` / `compose down` / daemon event), not crash-looping. The pre-crash `docker logs` were unrecoverable (Coolify's logs endpoint returns "Application is not running" for a stopped app; SSH to talos:22 is unreachable from a dev box).

**Latent fragility (follow-up #48).** event-worker does `pgClient.on('error', () => process.exit(1))` with **no reconnect** ([`services/event-worker/src/worker.ts`](../../services/event-worker/src/worker.ts)). It is the sole event hub yet has no self-heal beyond Docker's restart policy. This is *why* the wake design keeps the backstop poll — the event layer is best-effort. Recommended fix: PG reconnect-with-backoff + a liveness signal stronger than `pgrep node`.

---

## 6. Activation runbook (the deferred switch-on)

**Precondition acknowledged:** production has `CLAUDE_POLL_ENABLED=false` on `aisha-exec` → the claude executor is **dormant** (no poll, and the event path is not wired). Activating turns on **real `claude_cli_task` execution** (container spawn + Claude API cost). Do this only when live runs are intended.

**Steps** (all via Coolify env API — never commit these values):

1. Generate a shared token: `openssl rand -hex 32`.
2. **aisha-exec** (`/api/v1/applications/<exec-uuid>/envs/bulk` PATCH), then redeploy exec:
   - `CLAUDE_POLL_ENABLED=true`  (executor enabled: wake + backstop)
   - `CLAUDE_POLL_INTERVAL_MS=300000`  (5-min safety-net; the wake carries the fast path)
   - `AGENT_RUNNER_WAKE_TOKEN=<token>`
3. **aisha-realtime** (env PATCH), then redeploy realtime:
   - `WEBHOOK_AGENT_RUNNER=http://aisha-svc-agent-runner:3030/wake?token=<token>`  (cross-stack via the shared `coolify` network by container name)
4. **DB override check.** `runtime-config.ts` resolves `pollEnabled = bool(system_config('agent_runner').poll_enabled) ?? env`. If a `system_config('agent_runner')` row sets `poll_enabled=false`, it **overrides** the env — clear/flip it too.
5. **Live verify.** Insert a claimable `agent_run` (kind `claude_cli_task`, `status='queued'`, not approval-held) and confirm a **sub-second claim** in svc-agent-runner logs (event-worker logs the webhook delivery; svc-agent-runner logs the wake + claim). The 5-min backstop remains underneath.

To **deactivate**: set `WEBHOOK_AGENT_RUNNER=''` (event path off, poll continues) or `CLAUDE_POLL_ENABLED=false` (executor fully off).

---

## 7. Coolify deploy-verify gotchas (learned here)

- **App `status` is STALE during a deploy** (~30-60s of the *pre*-deploy `running:healthy` while the new image builds). Poll the **deployment record** instead: `GET /api/v1/deployments/applications/<uuid>?take=1 → .deployments[0].status ∈ queued|in_progress|finished|failed`. `finished` (+ matching `.commit`) is the real "done".
- **App logs endpoint returns only ONE container** for a multi-service compose app (for realtime it returns `svc-ide-context`, never `event-worker`) — can't confirm event-worker's channel LISTENs that way; use structural proof.
- **SSH to talos:22 is unreachable** from a dev box (behind mesh/pfSense), even when authorized for debug. Rely on the Coolify API + the migrate-gate + deterministic-code reasoning.

---

## 8. Follow-ups

| # | Item |
|---|---|
| #47 | **Activate** this wake in prod when live runs are OK'd (runbook §6). |
| #45 | **`playwright_runs` convert** — mirror this wake. Note: `svc-playwright-runner` is a **pure worker with no HTTP server** (needs a minimal listener or direct-LISTEN), and `get_next_playwright_run` is **missing `FOR UPDATE SKIP LOCKED`** (a real claim-race to fix). |
| #48 | **Harden event-worker** — PG reconnect-with-backoff (no `process.exit`); it is the sole event hub (§5). |
| #46 | **Event-driven sweep** — retire remaining periodic mechanisms (drop llm-quota cron, openclaw_notifications→NOTIFY, reminders→compute-on-read); document genuine time-anchored KEEPs. |
| #43 | **Test-coverage sweep** for the last ~1.5 days' work. |

## 9. References
- PR: https://repo.id3a.cz/aisha/evymo-ai-orchestrator/pulls/565 · merge `78d2d2e3`.
- Related: [`docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md`](AUTONOMOUS_DEPLOY_FLOW.md), [`docs/deploy/COOLIFY.md`](COOLIFY.md), [`docs/deploy/DATABASE_MIGRATION_SYSTEM.md`](DATABASE_MIGRATION_SYSTEM.md).

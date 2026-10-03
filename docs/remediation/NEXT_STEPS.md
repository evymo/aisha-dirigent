# AISHA Remediation — Next Steps (post systemic audit)

> Branch: `feat/remediation`. Merge only when the whole suite is green; user merges.
> This plan folds in the 6-dimension systemic audit (dynamism · SoT/generation · SQL separation · consistency · access-control · tests), adversarially re-checked.

## 1. Where we are (done + committed)

36 commits on `feat/remediation` (+ one uncommitted consultation-call/compose unit from a parallel session — see P0-D). All executed remediation domains landed:

- **Security**: PKI/SEC/S1-3/OBS-01/deploy-ssh/N8N-04 (`dde88c57`), SSRF + n8n exec-injection (`105e1355`), **S2** intranet verify-OIDC (`d8e7864f`).
- **Domains D2–D11**: n8n signed approvals, ws-gateway topic-auth, blockchain cosmos1 realign, mobile M1/M2/M4 + LiveKit, workbench rail, Zed packaging, deploy-config (PITR + svc-blockchain), Appsmith import, shared PostgREST client. + branding-ratchet source fix.
- **D1 DB-SoT** (`936635da`): 15 RPCs, constraints, anon **default-deny**, full ledger schema (opt-out, audit_journal guard, governance tables, balance SoT, `record_type` CHECK). Baseline **regenerated-from-SoT** (never hand-edited); `db:convergence:verify` + throwaway pg17/pgTAP cold-start **both pass**.

**Remediation gates (2026-07-12 census): 45/51 files, 153/163 tests green; 0 regressions, 0 collection errors.** The 6 red files are all deliberate test-first RED specs: currency, raw_query_admin (SVC-05), source-slug (ENT-01), D4 av-scan (GW-08), D5 chain-head (W4-04), D12 typecheck. D12's fix already exists on branch `feat/remediation-d12` @ `770ce535` (pushed to origin+forgejo, NOT an ancestor of this branch) — merge it, don't redo it. Real app typecheck (`tsc -p tsconfig.app.json`) currently reports **738 errors**, invisible to every gate because both `package.json` `type-check` and all 4 CI lanes run the no-op root tsconfig.

## 2. The systemic finding — a **forkability-barrier class**, not a one-off

The platform has **strong bones** (uniform RPC SECURITY DEFINER+REVOKE across 1386 files/0 misses; 100% table RLS 402/402; consolidated `@aisha/postgrest-client`; gated generation machinery; 418 gate files / 5772 offline pass; genuinely-dynamic model-selection + domain-derivation prove the team can build to the invariant). **But** currency was one member of a class of **"per-instance config baked into the DB SoT"**:

| Axis | Evidence | Config seam? |
|---|---|---|
| **Currency** | CZK numeraire (`rate_to_czk`), 11 `_czk` cols, dead `is_base` half-migration, ~30 `'CZK'` literals | `commerce_base_currency` exists (unused) |
| **Model defaults** 🔴 | `gpt-4o-mini`/`gpt-5-mini`/`text-embedding-3-small` baked in DB tables + RPC params — **violates HARD "AISHA selects"** | resolver exists (`aisha_resolve_clow_backend`), DB layer bypasses it |
| **Timezone** 🔴 | `Europe/Prague` in 11+ SoT DEFAULT/COALESCE, 114 repo hits | **none** |
| **Locale** | hardcoded 6-lang allow-list (should derive from `segments/`); `cs` vs `cs-CZ` contradiction | should enumerate segments dir |
| **Country/carrier** | `CZ` default + **Packeta first-class schema** (`packeta_*` cols) | none |
| **Payment vendor** | **Stripe first-class** across 14 SoT tables | n/a (vendor lock) |

**Plus a P0 access-control gap (independent of forkability):** the **view layer** — 36/36 views lack `security_invoker` (run with owner privileges, **bypass base-table RLS**; zero `security_barrier`/`FORCE RLS` anywhere). Adversarially re-verified 2026-07-12, the live-vs-latent split is the INVERSE of the first draft:

- **LIVE (P0):** 11 owner-rights views are `GRANT SELECT TO anon` + `authenticated` — most seriously `v_health_weekly_summary` / `v_health_monthly_summary`, which aggregate per-user `health_check_ins` **PHI** (heart rate, mood, pain, sleep, steps) keyed by `user_id`, readable **unauthenticated** via PostgREST despite base-table RLS. Also `study_cohort_{trends,lab_trends,statistics}`, `expedition/distribution/batch_inventory_overview`, `distribution_adjustments`, `shipment_statistics`, `partner_profiles_public`.
- **LATENT (defense-in-depth):** the 11 `audience_admin_*` PII views (email/phone/DOB/message bodies) have **no grants at all** to anon/authenticated → `permission denied` today; the missing guard only matters if a grant ever appears.
- **LANDMINE:** baseline sets `ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO authenticated`, so any **new** view created on a live DB auto-inherits authenticated SELECT and (owner-rights) bypasses RLS.
- **Gate gap:** no gate enforces `security_invoker`; `anon-grants-select-only` even allowlists view grants on the false assumption they are "still RLS-gated".

## 3. Prioritized plan

### P0 — Security + the clean template
- **P0-A · View-layer access (SECURITY).** Priority order per the 2026-07-12 verification: (1) **revoke/guard the 11 anon-granted owner-rights views first** (live PHI/PII bypass — `v_health_*_summary` et al.), (2) `security_invoker=on` on all 36 views so base-table RLS applies everywhere, (3) guard the 11 `audience_admin_*` views (latent) with `is_admin_or_staff()` or a guarded DEFINER RPC, (4) fix the `ALTER DEFAULT PRIVILEGES` landmine. **New gate**: `views-security-invoker-and-guarded` (must also close the `anon-grants-select-only` view-allowlist false assumption). SoT-only + baseline regen + convergence.
- **P0-B · Currency migration (the clean "finish-the-migration").** Converge on `(amount numeric, currency_code text → currencies)`; retire `_czk` column names + the `rate_to_czk`/`is_base` numeraire (rates relative to configured base); resolve base from `commerce_base_currency`; backfill `currency='CZK'` for historical rows (data, not a default); keep the `ai_*` USD provider-billing allowlist. Update ~35 readers + regen DB types. **Greens** `currency-dynamic-no-hardcode`. Phased: (a) partial tables → readers repoint, (b) fully-legacy tables, (c) `currency_rates` pivot, (d) function fallbacks.

- **P0-C · Broken cross-domain bindings (from the flow map — see `docs/architecture/APPLICATION_FLOW_MAP.md`).** Integration gaps the per-domain gates couldn't catch; each needs the fix **+ a wiring gate**:
  - **B1** create `get_user_by_email` RPC in SoT (else `/intranet` 401s everyone) — DB, baseline regen.
  - **B2** align `fn_create_approval_request`/WF: pass a real `uuid` + numeric risk (or accept text) — else the `approval_requests` ledger silently never writes.
  - **B3** make the svc-blockchain dispatcher (poller `retry_pending_blockchain_syncs`) honor `on_chain_anchor` — else the ledger opt-out is ineffective.
  - **B4** fix the `action_type` vs `transaction_type` field so auto-awards reach `broadcastMsgSend` on-chain. Verified DOUBLE mismatch: `ledger-sync.ts:69` reads `action_type` but `fn_queue_blockchain_sync` writes `transaction_type`, AND `award_tokens` stores the value `'reward'`, which is not in the `('award','token_award')` check either — fix both the key and the value set.
  - **B5** wire `LEDGER_ENABLED` (svc-blockchain reads it) or set the DB GUC — resolve the two-surfaces disagreement (svc-blockchain reads ~20 env vars, not this one; DB GUC `app.settings.ledger_enabled` defaults `'true'` and is never SET).
  - **B6** repoint the SQL caller: the capability EXISTS at gateway `/admin/kc-role-sync` (admin.ts:130) — `fn_sync_keycloak_roles.sql:55` targets the wrong path `/functions/v1/keycloak-role-sync` (absent from the edge-fn ROUTE_TABLE → 404). Either repoint the SQL to `/admin/kc-role-sync` or add the registry entry. **B7** switch svc-github-app off `raw_query_admin` to installation RPCs (closes the partial gate) — 3 calls in `webhook-bridge.ts:53/96/120`, each in an empty `catch {}`.
  - **B8 · Browser realtime rail is dead END-TO-END (new, verified 2026-07-12).** Every client `postgres_changes` subscription (web + mobile: incoming consultation call, the new caller-join fix, any other realtime UI) is inert in production, broken at 4 independent layers: (1) **no producer** — nothing in DB SoT emits `pg_notify('db_changes', …)` for ANY table (the string does not appear in `aisha/db/sql/` at all), so event-worker's `db_changes` LISTEN never fires; (2) **subscribe protocol mismatch** — `@aisha/api-core` sends `{type:'subscribe', channel}` but ws-gateway reads only `msg.topic`/`msg.topics` → silent no-op; (3) **topic-name scheme mismatch** — event-worker would publish to `ws:db:<schema>.<table>` while clients subscribe to app-named channels (e.g. `outgoing-call-<sessionId>`); (4) **frame-type mismatch** — ws-gateway emits `{type:'event'}` frames, the client dispatches only `{type:'postgres_changes'}`. (Deploy side is fine: ws-gateway + event-worker live in the `docker-compose.coolify-realtime.yml` sibling stack.) Fix = pick ONE contract (generic `db_changes` NOTIFY trigger + topic scheme + frame shape), align api-core/ws-gateway/event-worker + a wiring gate that asserts the four layers agree. Until then, the consultation-call feature cannot work live regardless of the uncommitted race fixes.

- **P0-D · SoT→deploy integrity (NEW — the convergence gate is structurally blind).** Verified 2026-07-12: `db:convergence:verify` compares `substrate+baseline` vs `substrate+baseline+heals` — **both sides read the SAME baseline**, so an SoT function whose new body is missing from the baseline AND from `heals.sql` converges green while shipping to **no database** (fresh installs get the stale baseline copy; existing DBs never re-apply the baseline and heals has no `\ir` for it). Concrete casualties today:
  - The uncommitted `update_consultation_status` race fix reaches NO database (baseline `:93762` still has the old unguarded body; heals has no entry).
  - The D7 workbench hardening (`1f167b2e`, `7cfcbc52`) is **inert on every existing DB**: none of the 4 workbench RPCs is in `heals.sql` (while ~30 other functions are `\ir`-reapplied), and `7cfcbc52` even ships the `claim_attempts` COLUMN via heals but not the function that uses it. `verify-upgrade-apply.sh`'s hand-curated list has no workbench objects either.
  - Fixes: (a) regenerate the baseline for the pending SoT edit; (b) add heals `\ir` entries for `update_consultation_status` + the 4 workbench RPCs; (c) **new gates**: `baseline-lags-sot` (diff `aisha/db/sql` function bodies vs the baseline's embedded copies) and a heals-coverage check (every SoT function changed since baseline-meta's `refreshed_at` must be `\ir`-listed in heals) so this class can never ship silently again.
- **P0-E · Finish the uncommitted consultation/compose unit (parallel-session WIP).** Direction is correct (web+mobile mirrors, sound transition guards); completion checklist before commit: baseline regen + heals entry (P0-D), pgTAP for the guards (0 of 35 schema suites touch consultation), a **fake-timer** test for the headline race (the current one uses real timers — the 60s timeout can never fire in-test, so the "no missed after answer" assertion is vacuous; only caller-join is genuinely covered), mobile test parity (0 tests for the ~97-line mobile mirror), `:?required` on the four `RABBITMQ_*` parts (the new comment's claim that empty `RABBITMQ_URL` "throws" is factually wrong — amqplib falls back to `amqp://localhost` and svc-blockchain's `mq-client` swallows the failure → silent publish drop; also kill the `?? 'amqp://rabbitmq:5672'` fallback in `svc-blockchain/src/config.ts:36`), split into 2 commits (consultation vs compose). Known residuals to note in the commit: guard refusals are silent no-ops (client can't distinguish refusal from success — consider returning rows-affected), caller channel subscribes after 3 round-trips (same lost-event class, low probability), `'ended'` is refused from `'pending'` (vestigial), and the whole caller-join runs on the dead B8 rail until B8 lands.

### P1 — Generalize the class + finish remediation
- **P1-A · Forkability config seams (generalize P0-B).** Add `instance_timezone`, `default_country`, `base_locale` `system_config` keys; replace DB `DEFAULT`/`COALESCE` literals with config-driven resolvers; **route ALL model defaults through `aisha_resolve_clow_backend`** (kill DB-baked model literals — HARD rule); derive `supportedLngs` from the `segments/` dir instead of the hand-maintained array.
- **P1-B · No-hardcode gates per axis (PREVENTION).** Mirror the currency gate for **model / locale / timezone / country** so each axis is gated and cannot regrow.
- **P1-C · Remaining remediation gates.** 2 partial gates: installation RPCs (github-app upsert/suspend/unsuspend) → replace the 3 `raw_query_admin` calls; dynamic `SOURCE_SLUG` (enumerate registered sources) in svc-source-broker. **D4** av-scan wiring (`/internal/scan-object` + `storage_events` emitter). **D5** chain-head anchor route (Path-2). **D12**: do NOT redo — the full burn-down (748→0) + wiring already exists as `770ce535` on `feat/remediation-d12` (pushed to origin AND forgejo, merge-base `882a624d`); merge/rebase it into this branch, then reconcile with post-D8 commits (25 behind). Current HEAD measures 738 app-tsc errors.
- **P1-D · D6 chat 202-deferral defects (from the `25608500` review).** The mobile hook throws an Error on HTTP 202 for a turn the server has ALREADY accepted (conversation + user message persisted, reflection run kicked off, `X-Stream-Poll-URL` ignored) → the Retry bar invites duplicate sends, duplicate reflection spend, and orphan conversations (202 bodies return no `conversation_id`). Fix: treat 202 as an in-flight state (poll or invalidate), not an error; localize the hardcoded English 202 string (i18n rule); add tests for the 202/onError/optimistic-echo branches (all currently untested).

### P2 — Debt cleanup
- **P2-A · Finish half-migrations.** Drop legacy `subscription_packages.price_czk/price_usd` after verifying no live readers; pick ONE token store (`memberships.tokens_*` int4 vs `user_wallets.*_tokens` numeric — reconcile truncation) + backfill; scrub the 297 per-object anon-`GRANT SELECT` files to the ~11-13-table public allowlist + baseline regen + an allowlist-bounding gate.
- **P2-B · Convention + instance data.** 85 `SECURITY INVOKER` RPCs → DEFINER or document as an approved second pattern; reconsider the token-revocation fail-open vs fail-loud; move `companyData.ts` legal entities to the #295 private instance-data submodule; add a generated `DO-NOT-EDIT` marker + rebuild-from-schema gate to `web types.ts`.
- **P2-C · Long-open security debt (re-confirmed 2026-07-12).** Rotate the JWT secret (3 service_role JWTs remain in git history; HEAD scrubbed in #275, secret never rotated). `health_check_ins` base table is itself anon-granted (RLS blocks it today — landmine if a policy regresses; fold into the P2-A anon-grant scrub). Cleared: the D4 balance single-source content IS on HEAD (`get_my_wallet_balance` folds `token_transactions`) even though branch `fix/d4-ledger-single-source` was never merged — the green ledger-balance gate is legitimate.

### Verification + deploy (the gate to merge/deploy)
```
AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts    # ALL gates green
npm run db:convergence:verify && node scripts/db/with-throwaway-db.mjs # baseline == SoT, cold-start clean
# + per-service builds + test:services + pre-push CI
```
Then **checkpoint → deploy → runtime test** (auth/ledger/deploy-config/currency need real-deploy validation).

## 4. Discipline (every step)
- Fix at **SoT**; baseline **regenerated** (never hand-edited) + **convergence-verified**.
- **Config seam, not a baked default**; fail-loud; no fallbacks; AISHA selects (no hardcoded models).
- **A gate per fix** (test-first) so the class cannot regress.
- Commit per coherent unit; pre-commit hooks; never `--no-verify`. Watch the shared-tree concurrency hazard.

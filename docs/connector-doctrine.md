# AISHA Connector Doctrine — external-source connectors

> **Status:** canonical decision (2026-07-05). Connectors are foundational: AISHA sits ON TOP of external
> systems and de-facto CONTROLS them bidirectionally. This doctrine is a COMMIT-NOW decision — the seam
> shapes are fixed here so we never re-litigate them per source. Grounded in the real code
> (`svc-source-broker`, a fork's commerce broker, `packages/audience-types`, the gated `hub_*` write path).

## North star

**A connector is a THIN driver over a THICK, inherited chassis.** Everything cross-cutting — auth,
per-request DB-resolved binding + credential rotation, approval/classification gate, cache, contract-drift
refusal, cursor/circuit-breaker, SSRF, federated `caller_id`, and tamper-evident v2 audit — is owned by ONE
story-indexed broker pipeline (service side) and ONE gated-proc + hashed-audit substrate (DB side), **never
re-authored per source**. Every source — read-only or bidirectional, upstream or fork-specific — plugs into the
SAME four-responsibility seam: **READ · MAP · WRITE-BACK · GOVERN**, dispatched by `storyId` through a single
registry. A new source is CONFIG on the story spine + a ~one-file driver (+ optional mapper, + a gated proc
only when it introduces a new table). Drivers emit/consume **source-native records**; aisha-shape translation
is a separate pluggable mapper — which is why nothing couples a vehicle source to the audience/event domain.
Governance is **inescapable by construction** (a table-touch CI gate + a NOT-NULL spine FK, not developer
discipline). The substrate is already near-right in the DB and in `source-read.ts`'s `serve()` flow; the
doctrine is to **codify and converge it, not redesign it.**

## Why we were tangled (the root cause)

The source-broker has **two disconnected seams and the polymorphic one drives nothing in production**:
- The `IDataSource`/`SourceRegistry` **read seam** is decorative today — `register()` is never called in
  prod, so every generic `/source/*` route resolves to `NullDataSource` (501). Its only real method,
  `getEntity`, has one caller; `fetchAggregateSnapshots` has **zero** and its `ActorAggregateSnapshot` return
  couples every driver to the audience domain (why a vehicle source can't implement it).
- The **scheduler seam** (`scheduler.ts`) does the real batch sync but is **non-polymorphic**: hardcoded
  `SOURCE_SLUG='source-api'`, concrete `SourcePgClient`, Postgres drift-canary — and it **never consults the
  registry**. So "register a source → the scheduler picks it up" is a false mental model.
- The **write/control half** (drive the external system as the federated operator) exists ONLY in the
  a fork's commerce broker and has no upstream analog — yet it is the crown of "de-facto
  control." And that broker is a **verbatim copy** of the source-broker chassis.

The fix is not "register an adapter" — it is to **fuse the two seams through one registry, add the write twin,
and make governance a DB law.**

## Architecture — three layers, fixed responsibilities

### DB-SIDE — the universal WRITE + GOVERN substrate (already near-right; codify it)
- **One story-spine registry:** `partner_stories → story_instances → instance_endpoint_bindings`, carrying
  the 4-dim classification (`source_type` / `data_sensitivity` / `retention_class` / `legal_basis`) + namespace.
  Retire the bare `hub_source.is_active` flag → resolve via the spine (NOT-NULL FK).
- **Every mutation is a gated `SECURITY DEFINER` proc from ONE template:** `SET search_path` →
  `IF NOT (is_service_role() OR is_admin_or_staff()) RAISE` → `hub_assert_source_writable(source_ref)`
  (fail-closed on `is_approved` + in-domain classification) → idempotency-guarded mutation (status transition
  OR `ON CONFLICT`) → **`connector_write_audit(...)`** (the ONE deterministic v2 `blockchain_hash` writer,
  exact inverse of `fn_verify_audit_journal_entry`) → `REVOKE ALL / GRANT`.
- **Provenance is generic:** generalize `hub_verify_reprice_provenance` → `hub_verify_provenance(entity_type,
  entity_id, action)` so ANY action is provable.
- **Federation lives here:** `federated_caller_for(provider, user)` / `federated_identity_link(provider, …)`
  over the already provider-generic `aisha_auth.identities`. A new controllable source declares only its
  provider slug and reuses this verbatim — act AS THE REAL USER, single hash-site, provable.

### SERVICE-SIDE — the chassis (`@aisha/broker-kit` + one story-indexed registry)
Owns ALL plumbing every source inherits: `createBrokerServer` (otel/Fastify/metrics/healthz/signals),
`createAuthGuard`, `createRpc` (the ONLY PostgREST path), `createSsrfClient`, the **ReadPipeline** extracted
verbatim from `source-read.ts serve()` (principal-guard → `resolveBinding` → capability check → **drift-gate**
→ cache-first → driver call → **blocking hashed audit** → optional mapper write-through), the **IngestEngine**
(tick/cursor/overlap/circuit-breaker/anomaly + one `ingest_run` ledger, refactored off the concrete
`SourcePgClient` to depend on a driver), `driveControlledWrite` (read-authoritative → external write fail-fast
→ hub record, `idempotencyKey` threaded), `runImportJob`, `federatedCaller`, and the drift/ACL toolkit. The
**registry dispatches read, control, AND the scheduler tick** — fusing the two disjoint seams. Drivers are the
ONLY per-source code and hold **zero** cross-cutting logic.

### CONFIG-SIDE — per source, no code
A `partner_story` + `story_instance` + `endpoint_binding`(s) (`endpoint_role='source-api'` for read,
`'control-api'` for write) whose config holds only endpoint/token **references**; the 4-dim classification; a
`data_sensitivity_registry` row per landing table; the provider slug + SSRF allowlist entry; cadence/enable.
Resolved at runtime by `audience_resolve_source_binding(story_id, endpoint_role)` — the ONE resolver — so
credential rotation and re-targeting need **no code change and no re-register**.

## The four universal contracts (commit NOW)

Two real instances already exist (source-broker read seam + a commerce-broker write seam) — that's the
2-instance threshold to commit; the shapes are validated by real code, not designed blind.

- **`ReadDriver<TRec>`** — `readOne(req, conn, caller)` (generalizes `getEntity`) · `readBatch(req, conn):
  AsyncIterable<TRec>` (generalizes `fetchAggregateSnapshots`, cursor/`since` in `req`) · `subscribe?(…)`
  (capability-gated) · `describeContract(): SourceContract` (feeds the UNIVERSAL drift gate) · `probe(conn)`.
  Emits **source-native** records; `capabilities[]` declares which modes are real (pipeline refuses the rest).
- **`IControlTarget`** — `execute(action: ControlAction /* with idempotencyKey */)` · `capabilities()` ·
  `probe()`. The write twin of ReadDriver, dispatched through the SAME registry. Maps each `action.kind` to
  exactly one external RPC body via the SSRF client.
- **`SourceMapper`** — `(rec: TRec) => UpsertCommand { rpc, payload }`. All aisha-shape translation lives
  here (snake_case boundary), never in the driver — this is why drivers stay domain-neutral.
- **`SourceConnection`** — the DB-resolved binding (endpoint + cred-ref resolved against the secret store +
  approval) that every method takes. Never an env-baked URL.

## Decision tree — given a new source, what do you write?

The answer is **almost always branch 3 (thin driver).**

1. **PLUGIN vs SERVICE (decided FIRST — picks the deployment shape):**
   read-only / third-party / low-trust → **`svc-plugin-system` plugin** (manifest + a ReadDriver adapter;
   sandbox capabilities only: `rpcSandboxed` + SSRF `/sandbox/fetch` default-deny allowlist + kv + llm +
   notify; NO `service_role`, NO persistent scheduler, NO new hub schema, no new Coolify app).
   first-party AND control-bearing (write-back needing `service_role` + `caller_id` federation), OR needs a
   persistent scheduler/cursor/breaker, OR direct pg to a readonly replica, OR new gated hub RPCs →
   **dedicated `svc-<src>-broker`**. *Rule: write-back ⇒ service; read-only ⇒ start as a plugin, graduate.*
2. **PURE CONFIG (no code):** reuses an existing driver kind (pg-readonly | REST-SSRF | GraphQL) + existing
   upsert RPC + existing map target. Deliverable = spine row + endpoint binding + env + SSRF host +
   classification. (Rare — realistically "config + `contract.ts` + `map.ts`, no imperative logic.")
3. **THIN DRIVER (the common case, ~one file):** known transport, own schema/verbs. Deliverable =
   `driver.ts` (readOne/readBatch/execute + probe + describeContract — the ONLY real logic), `map.ts`,
   `contract.ts`, thin routes. Everything else inherited.
4. **ENGINE / DB CHANGE (real engineering, gate):** triggered ONLY by — a NEW hub table (⇒ new gated proc
   from the template + pgTAP mirroring suites 13/14/15) · a control VERB the target doesn't yet expose (e.g.
   the commerce target's `product_collection_price_put` rule-put gap) · a NEW transport (CDC/mTLS) · the FIRST time a
   source becomes bidirectional · horizontal-scale locking. Ships via migration→regen→schema-gate→PR→operator apply.
5. **GENERALIZE trigger = the THIRD copy.** Promote a helper into `@aisha/broker-kit` on its 3rd occurrence.
   auth-guard, rpc, config, server, ssrf, import-job, drive-write-back, drift-canary, caller-federation are
   already at 2–3 today and qualify NOW.

## A new connector = these files (SERVICE; a PLUGIN = the two ★ files + a manifest)

```
src/config.ts          defineBrokerConfig({ <src>-env })                     ~10 lines
src/server.ts          createBrokerServer({ serviceName, register })         ~12 lines
★ src/contract.ts      ACL / drift contract (tables+cols | response schema) → describeContract()
★ src/driver.ts        the ONLY real code: ReadDriver (+ IControlTarget if bidirectional);
                       per-request SourceConnection; SOURCE-NATIVE records; action.kind → 1 external RPC
src/map.ts             SourceMapper: rec → named UpsertCommand; registerUpsertMapper(target, fn)
src/routes/sync.ts     one call: runImportJob(rpc, { driver, upsertFn })
src/routes/writeback.ts one call: driveControlledWrite({ readAuthoritative, target, action, recordHub })  [bidirectional only]
src/index.ts           registry.register(storyId, driver)   ← the seam line MISSING in prod today
src/__tests__/{driver.unit,contract,authz-routes}.test.ts
```
CONFIG (operator-gated): story + instance + endpoint_binding (references only) + 4-dim classification +
`data_sensitivity_registry` row per landing table + provider slug + SSRF allowlist; then an operator runs
`audience_admin_approve_source` (a service **cannot self-approve**).
DB (only if a new hub table): `hub_upsert_<src>_*.sql` from the gated-write template ending in
`connector_write_audit` (⇒ automatically provenance-verifiable) + `NN_<src>_*.sql` pgTAP.

**Inherited, never re-authored:** auth guard · gated RPC path · cache · universal drift/health refusal ·
cursor + circuit-breaker + overlap · SSRF · credential-per-request + rotation · approval/classification
enforcement · federated `caller_id` · idempotency · the two-phase saga · the one `ingest_run` ledger ·
v2-hashed audit on every state change.

## Migration path — 6 ordered steps, NO big-bang (each additive/behavior-preserving)

- **STEP 0 — dedup first:** create `packages/broker-kit`; MOVE the verbatim-shared code both brokers carry
  (auth-guard 2×, config 2×, server 2×, rpc 3×, ssrf-guard 3× in that broker alone) into it; repoint both,
  delete copies. Existing tests are the proof. A future security fix now lands in ONE place.
- **STEP 1 — lift orchestration:** move `runImportJob`, `driveControlledWrite`, `federatedCaller`,
  `registerUpsertMapper` (the snake_case boundary — kills the unmapped-camelCase-zeros-the-row class), the
  ACL drift toolkit into broker-kit. Additive.
- **STEP 2 — codify DB governance (gate):** extract `hub_write_audit → connector_write_audit(area, source_ref,
  action, entity_type, entity_id, new_data, actor)` (always v2-hashes); add `hub_assert_source_writable`;
  generalize → `hub_verify_provenance`; rename the vendor-named resolver → `federated_caller_for(provider,…)`; make
  `audience_resolve_source_binding` the ONLY resolver + NOT-NULL story_instance FK on hub_source; move
  `source-read.ts` read-audit onto the blocking hashed RPC; add the **table-touch MUST-AUDIT + MUST-APPROVE
  CI gate** (fires on DML against any hub_/connector table, filename-independent). From here governance is inescapable.
- **STEP 3 — fuse the seams:** `createScheduler(pgClient) → createIngestEngine(drivers, config)`; move
  `SOURCE_SLUG` + the audience upsert + the `ActorAggregateSnapshot` mapping OUT into a `SourceApiIngestDriver`
  wrapping today's calls verbatim; in `runOnceInternal` swap `source.X()` → `driver.X()` and route the tick
  THROUGH `registry.getForStory`. KEEP cursor/breaker/anomaly in the engine. **This is the one-file cut that
  makes batch sync polymorphic — the prerequisite for source #2.** `source-api` becomes the FIRST real
  registered adapter, proving the seam.
- **STEP 4 — control half in the contract + fix the saga:** add `IControlTarget` to audience-types; route
  writes through `registry.getControlTargetForStory`; replace `IDataSource` read surface with `ReadDriver`;
  KILL `fetchAggregateSnapshots`'s audience-coupled signature; add `idempotencyKey` to every external write;
  fold the vendor write client → a `ControlDriver` and the cube read → `CubeReadDriver`/`CubeIngestDriver`;
  collapse the commerce broker into chassis + drivers; delete the parallel `vehicles.ts`/`sync.ts` read paths
  + the duplicate `Map` cache.
- **STEP 5 — converge telemetry:** collapse `audience_broker_sync_state` + `hub_import_job` into ONE
  `ingest_run` ledger RPC that also emits a `connector_write_audit` v2 row — so "how is a source's sync health
  observed" has one answer and ingestion finally joins the provenance chain the control half already has.

## Antipatterns — the traps that tangled it (explicit DON'Ts)

1. **register ≠ scheduler** — the read registry and the batch scheduler must not be two disconnected objects;
   the tick MUST route through the registry (today the polymorphic seam drives nothing in prod).
2. **dead / domain-coupled contract method** — no core method with zero callers or a domain-coupled return
   (`fetchAggregateSnapshots`); emit source-native records or delete it.
3. **PG-drift-for-SOAP** — don't hardcode drift/health to Postgres `information_schema`; abstract to a
   `SourceHealth` result, one `healthCheck` per transport, and gate EVERY read on it (2 of 3 paths lack it today).
4. **copy-paste brokers** — a new source is a driver + config, NOT a new service chassis (the commerce broker is a
   verbatim copy; a security fix must be hand-applied N times).
5. **admin-scope bypass** — never pass a hardcoded `OPERATOR_SCOPE`/shared service identity; thread the
   federated `caller_id` so the source enforces scope AS THE REAL USER and provenance records who-acted-as-whom.
6. **two governance planes** — a source must not exist without a classified, approved story-spine row (the bare
   `is_active` flag decouples ingest from onboarding). One spine, fail-closed.
7. **ingest outside the audit chain** — every state change (incl. `hub_upsert_*`/import envelopes) hashes
   through `connector_write_audit`; provenance must not be asymmetric (control-only) as it is today.
8. **best-effort raw-INSERT audit** — never audit via a raw `INSERT INTO audit_journal … .catch(()=>undefined)`
   from the broker's own role; use the gated hashed RPC, BLOCKING.
9. **env-baked write target** — the control endpoint resolves from the DB spine, not a flat `<VENDOR>_API_URL`
   env (DB-first-config; enables multi-target + rotation).
10. **no idempotency on external writes** — thread `idempotencyKey` through the shared `driveControlledWrite`
    (today only the hub UPDATE is guarded; a step-3 failure double-writes externally).
11. **premature generalization** — don't build the mapping DSL, dynamic plugin loader, multi-source discovery,
    or scale-locking before the 3rd real source. Commit the seam SHAPE now; let drivers accrete.

## What to decide NOW vs defer

**Commit now** (the seam shapes — validated by 2 real instances):
- The four contracts: `ReadDriver`, `IControlTarget`, `SourceMapper`, `SourceConnection`-as-DB-binding.
- ONE story-indexed registry drives read + control + the scheduler tick.
- The story-spine is the SINGLE source registry (retire bare `is_active`).
- `connector_write_audit` (one v2-hash site) + `hub_assert_source_writable` + the table-touch CI gate; read-audit onto the blocking hashed RPC.
- Records source-native end-to-end; kill `fetchAggregateSnapshots`'s coupled return.
- `@aisha/broker-kit`; both brokers consume it; `idempotencyKey` on every external write.

**Defer until 2–3 real sources exist** (don't design blind):
- Multi-source auto-discovery + dynamic per-source cadence registry (keep a static registered list: source-api + cube).
- Horizontal-scale advisory locking (single-source ticking doesn't need it).
- CDC/webhook `subscribeChanges` unification + dynamic plugin driver loading (capability-gated, no consumer yet).
- A declarative field-mapping DSL (keep `map.ts` as thin TS until the pattern repeats 3×).

## First move

**STEP 0** — `packages/broker-kit` + move the verbatim-shared chassis, repoint both brokers, delete the copies.
Pure dedup, behavior-preserving, existing tests prove it, and it makes every later step land in one place.
Then STEP 2 (DB governance codify) and STEP 3 (fuse the seams) before onboarding source #2.

# AISHA Stack — Vazební analýza (Coupling Analysis), 2026-07-01

> **What this is:** not a security audit, not an ops audit — a map of *what binds the organism together*. Every edge is a coupling: a place where component A silently assumes something about component B. For each we name the **contract** (the assumption), the **mechanism**, and the **failure mode** (what breaks when the assumption is violated), and mark whether the binding is **hidden** (invisible at the interface).
>
> **Method:** 15 parallel readers mapped one plane each (evidence as `file:line`); 16 of the most load-bearing / hidden edges then went through adversarial verification (an agent trying to *refute* each claim against the code). 31 agents, 0 errors. The verify pass corrected or sharpened most claims — several "wires" turned out to be **silently dead**. Verified statements below carry `[CONFIRMED]` / `[PARTIAL]`.

---

## 0. The one-sentence spine

**AISHA is a database-centred organism whose parts are bound almost entirely by _conventions_ — names, string-keys, generated artifacts, flag-double-duties, and implicit ordering — rather than by typed interfaces.** The Postgres SoT is the heart; a handful of hubs (event-worker, the gateway/JWT secret, `derive-domains.mjs`, the `coolify` network, `migrate.mjs`) are the arteries; and the dominant risk class is **the silent skip**: when a convention drifts, the system does not error — it goes quietly inert while every healthcheck stays green.

---

## 1. The mega-hubs — single points of coupling

These are the components the largest number of edges pass through. A change to any of them ripples stack-wide.

| Hub | Binds | Blast radius if it moves/breaks |
|---|---|---|
| **`JWT_SECRET`** (one HS256 secret) | PostgREST verify + gateway user-mint + per-service mints + the generated anon key + the **15-year** `POSTGREST_SERVICE_TOKEN` + inter-service verify | One rotation 401s the *entire* data path AND all service-to-service auth simultaneously ([CONFIRMED]) |
| **`event-worker`** | the stack's **sole** PG `LISTEN` client → Redis pub/sub + table-keyed webhooks + n8n forward + ACS gate | If it's down (it was, this session), the whole event plane is dark; it is also the choke point where a topic-string becomes an authorization decision |
| **`aisha-db` + `migrate.mjs` + `aisha/db/sql/`** | every schema change flows SoT→baseline(codegen)→heals; ~20 gates freeze the "baseline-only" invariant; 217 FKs + 24 RLS files anchor on `aisha_auth.users`/`uid()` | Hand-edit the baseline → three-way drift; a non-idempotent heal bricks *every* existing-DB deploy under `ON_ERROR_STOP` |
| **`derive-domains.mjs` × `config/services.json`** | the *only* legitimate source of `*_DOMAIN`/`<ID>_URL` names; every deploy, doctor, verifier, edge label, and local preset resolves through it | Catalog↔compose container-name drift emits a `<ID>_URL` pointing at a dead host (the `AGENT_RUNNER_URL` bug class) |
| **the `coolify` external Docker network** | the *entire* inter-stack bus — ~20 sibling compose files bind by DNS string (`aisha-db`, `aisha-gateway:3001`, `aisha-shared-redis`) because Coolify strips `container_name` and `depends_on` can't cross files | `internal` is an *alias* of `coolify` — "internal" is not isolation; one flat L2 fabric for everything |
| **`coolify-sync-envs.sh` + compose `${VAR}` refs** | env delivery is **textual**: a var reaches an app *only* if that app's compose literally references `${VAR}` | Code reads `process.env.X` with no compose line → value exists in `.env.coolify` but never delivered; feature silently dormant |
| **`system_config('agent_runner')` row** | one DB row is authority for BOTH executor caps (`poll_enabled`, `max_concurrent`) AND the producer's `max_inflight` ceiling; **DB overrides env** ([CONFIRMED]) | Operator tunes a Coolify env, DB row silently wins; `is_public=false` on the row silently reverts the executor to env |
| **`.env-prod-backup`** (gitignored operator vault) | rehydrates *every* instance value at cold-start in a fixed source order; outranks every derived layer | The fork seam: a fork changes this file, not code — but a missing TLD silently falls back to `.example` reference hosts |

---

## 2. Coupling mechanism typology

The edges cluster into a small number of *kinds*. Knowing the kind tells you how it fails.

1. **Codegen / SoT→artifact** — `aisha/db/sql`→baseline; schema→`types.ts` (~41k lines, + mobile copy byte-verbatim); i18n `segments`→`locales`; content JSON→`translations` seed. *Fails by drift: edit the artifact, next regen reverts it; artifact never reaches already-initialized DBs.*
2. **Name / string convention** — `schema.table` routing keys; `ws:*` Redis topic grammar (which *is* the ws-gateway authz model); provider slugs in 3 places; model-id **prefix** = routing key; RabbitMQ queue name; n8n credential **display names**; container DNS names. *Fails by rename: one side renamed → silent miss.*
3. **Flag double-duty** — one env/flag meaning two things: `CLAUDE_POLL_ENABLED` (executor on/off *and* wake-gate); `MESH_ENABLED` (edge path *and* rewrites the whole internal namespace); `INTRANET_ENABLED` (route *and* provisioning); `N8N_WEBHOOK_URL` (complete endpoint to event-worker, base-URL to everyone else); `provision_when_env` vars. *Fails by half-application.*
4. **DB-over-env precedence** — `system_config`/GUC rows silently shadow deployed env, with TTL caches that fail back to env on RPC error. *Fails invisibly: operator edits the wrong layer.*
5. **Transactional outbox / trigger** — `token_transactions`→`user_wallets` cache; ledger INSERT→`blockchain_audit_records` hash chain; notify-on-claimable. *Fails by trigger drop → cache/book forks from SoT.*
6. **Implicit ordering** — cold-start phase order; `migrate` gate; pki-init before TLS clients; WAVES DAG replacing cross-file `depends_on`; the 10s claim grace window. *Fails by reorder/skip.*
7. **Shared-secret handshake** — `BROKER_TOKEN_SECRET`, `AGENT_RUNNER_WAKE_TOKEN`, `APPROVAL_LINK_HMAC_SECRET`, `N8N_ENCRYPTION_KEY`. *Fails by mismatch → 401 mid-flow (often swallowed).*
8. **Package / workspace positional resolution** — `"*"` versions = symlink not registry; Dockerfiles hand-mirror the dep graph twice; source-vs-dist dual artifacts; Verdaccio version-bump-gated publishes. *Fails by build-graph desync.*

---

## 3. The 15 planes — spine each

1. **Event plane.** One relay chain: PG trigger→`pg_notify`→event-worker (sole LISTEN)→3 fan-outs (Redis, table-keyed webhooks, n8n). Bound by the `schema.table` payload key (re-declared in 4 places, no shared type) and the `ws:*` topic grammar (which doubles as authz). **Today only `agent_run_queued` has a live producer.**
2. **Executor plane.** Two DB job queues (`agent_runs`, `playwright_runs`); producers only INSERT, executors claim over PostgREST with service-role JWTs. Every lever lives in DB columns / the one `system_config('agent_runner')` row; env is bootstrap only. Low latency rides the fragile NOTIFY→/wake chain over safety-net polls.
3. **Gateway & identity.** One `JWT_SECRET` + one identity anchor (`aisha_auth.users`/`uid()`). Gateway verifies KC RS256 → mints 15-min HS256 PGRST JWTs; PostgREST switches to the pg role *literally named* by the claim; 217 FKs assume a JIT-provisioned users row from an in-DB pre-request hook.
4. **DB SoT machinery.** A *compiler pipeline*, not a migration history. `aisha/db/sql`→`db:init:generate`→one wipe-first baseline; `heals.sql` (`\ir`-includes back into the SoT tree) is the **only** path a schema change takes to an existing DB, run every migrate under `ON_ERROR_STOP`.
5. **Compose/deploy topology.** One flat `coolify` network; ~20 sibling stacks bind by DNS string. Cross-file ordering lives *outside* compose (WAVES DAG + manifest). Trust replicated per-stack by pki-init sidecars into stack-local `/certs`. Compose files are simultaneously topology, contract registry, and **env allowlist**.
6. **Config resolution layers.** `services.json × profile`→`derive-domains`→cold-start emission→Coolify envs→`process.env`→`system_config` DB override. Every layer can shadow the next with no interface signal; `.env.coolify` heredoc runs under `set +u` (unbound → durable empty secret).
7. **n8n plane.** Three narrow channels: the `aishaRpc` node (→ PostgREST `/rpc/<fn>` matched by name + `rpcParams` keys), the `/webhook/<name>` path convention, and one-shot deploy provisioning that rebinds `__REMAP__` credentials **by display name**. Nearly every RPC node is `onError:continueRegularOutput` → contract violations fail **silent**.
8. **AI orchestration.** A name-algebra pipeline: purpose→`fn_admit_clow` (spend/risk)→`aisha_resolve_clow_backend` (ranks provider×model×benchmarks under the `ai_resolver_policy` GLOBAL row)→`llmRouter`→`@aisha/llm-dispatch` backends that exist only if their env key is present. The slug/prefix naming convention is the load-bearing glue.
9. **Packages & workspaces.** `"*"` specifiers = symlink resolution; `build-packages.sh` is load-bearing (npm ci never builds `dist/`); each service Dockerfile hand-mirrors the dep graph twice; frontend consumes package *source* via vite alias while services consume built `dist` — same specifier, two artifacts.
10. **Knowledge/RAG.** Three invariant chains: **model-as-index-constant** (write-side `ke.model` must byte-equal the query-side resolved model; v3 enforces it as a HARD filter), the **locale/concept** denormalization chain, and **name conventions** (`chunk_slug`, edge-fn map). All funnels through the v2/v3 SECURITY DEFINER RPCs where isolation/quarantine/tier-ACL live; **PostgREST arg-count is the security boundary** (9-arg anon vs 11-arg story-RBAC overload).
11. **Web/frontend & i18n.** Bound by three *generated/data* artifacts, not imports: compiled locales, generated `types.ts`, and DB `translations` rows. All runtime data flows through one client → gateway, whose URL is **frozen into the bundle at Docker build** via `VITE_*` args. GrapeJS pages couple DB-stored HTML to the FE purely by name.
12. **Mesh & routing.** One derived topology; `MESH_ENABLED` flips the physical edge path *and* rewrites the whole internal namespace onto `*.MESH_TLD`. Trust rides the shared `pki-certs` volume; the `.internal` zone exists only as `extra_hosts` pins (deliberate NXDOMAIN). **Keycloak stays off-mesh forever** — enrollment depends on it.
13. **Ledger & value.** `token_transactions` is the append-only SoT (D4); `user_wallets` is a trigger cache; `memberships.tokens_*` is a *third* convention-duplicated store. Same INSERT feeds the tamper-evident hash chain (which can halt token writes stack-wide if broken) and the Cosmos outbox. Spend governance binds at admission via `fn_authorize_task_spend`.
14. **Instance/fork boundary.** The repo ships **zero** instance values (empty templates, `${VAR}` placeholders, public-safe compiled seed); `.env-prod-backup` rehydrates at cold-start; private data enters only at deploy via env-pointed git URLs + profile switches. **A fork changes config, not code** — except the name conventions and inlined tenant sentinels still binding code to *this* instance.
15. **CI/CD & gates.** "**Gates are the spec**": ~2500 vitest gates read the repo's own artifacts (ci.yml text, compose files, migrations dir, generated reports) and hard-fail on drift. Routing is one grep-regex table; deploys resolve Coolify apps by **name** at runtime; everything serializes onto one memory-limited runner.

---

## 4. Verified findings — the "silently dead / degraded" wires

The adversarial pass found that several couplings the code *claims* are broken **today**, failing exactly as the silent-skip risk class predicts. These are the highest-value results.

- **The browser realtime plane is dead end-to-end** `[CONFIRMED, 3-layer break]`. (1) Path: clients hit `/realtime/v1`, ws-gateway serves only `/ws`, the core gateway answers WS upgrades with HTTP 426. (2) Subscribe dialect: client sends `{type:'subscribe', channel}`, gateway reads `msg.topic` → silent no-op. (3) Event dialect: gateway emits `{type:'event'}`, client dispatches only `{type:'postgres_changes'}` — a frame type **no code produces**. No translator exists.
- **4 of event-worker's 5 LISTEN channels have no producer** `[CONFIRMED]`. Only `agent_run_queued` is live; `db_changes`, `realtime_broadcast`, `storage_events`, `playwright_run_queued` are **dead air** in the DB SoT — so all chat/presence/nudge/storage realtime receives nothing.
- **svc-ide-context IDE live-updates are dead-on-arrival** `[CONFIRMED]`. It exact-match SUBSCRIBEs `ws:db_changes`; event-worker only ever publishes `ws:db:{schema}.{table}`. Worse: a gate *codifies* the wrong channel name, so CI enforces the break instead of catching it.
- **The DB→n8n `pg_net` bridge is structurally dead** `[CONFIRMED]`. `fn_notify_rule_change` / `_knowledge_change` / `_ai_feedback_ready` (+ `fn_dispatch_proactive_triggers`, `publish_expert_rule`, `publish_agent`) rely on `net.http_post(GUC + /webhook/…)` — but **pg_net is not installed** (`infra/postgres/Dockerfile`: "No pgsodium, no pg_net") *and* the `n8n_webhook_base_url` GUC is never set outside a test. Their `pg_notify` halves have no listener. The whole bridge is a decoy; events vanish silently.
- **`N8N_WEBHOOK_URL` base-URL misdelivery is silent** `[CONFIRMED]`. `undici request()` never rejects on 4xx and event-worker checks no `statusCode` → a 404 is logged as "Webhook delivered." (And the event-worker leg is inert anyway — no workflow ingests `db_changes`.)
- **The agent-runner wake is doubly gated & mask-on-failure** `[PARTIAL→worse]`. The `?token=` check is *conditional* (fail-open when the runner token is empty); a token *mismatch* returns 401 that event-worker logs as "delivered"; and `wakeClaudePoller()` itself re-checks `caps.pollEnabled`, so with the poll disabled the wake is a no-op too — **the wake never operates independently of the poll flag**, and with polling off there is no safety net to degrade to (queue accumulates by design). This is exactly the prod-INERT state.
- **ws-gateway topic authz can fail *open*** `[PARTIAL]`. The `ownerOf()` `user:` regex matches in **any** namespace (not just `ws:broadcast:`), and any non-user `ws:broadcast:*` topic is open to **every** authenticated client — and `channel_topic` is producer-controlled. A producer forgetting the `user:` convention silently fan-outs private data.
- **POST /runs vs poller = unguarded double-execution race** `[CONFIRMED]`. Row *age* (10s grace) is the sole ownership discriminator; `update_agent_run_status` is an unconditional UPDATE with no status precondition, and neither executor re-checks status before spawning. Single host → worktree collision + double-finalize of a shared row; separate hosts → genuine double execution. (`playwright_runs` has the analogous missing-`SKIP LOCKED` race — task #45.)
- **Refuted / de-risked:** the "event-worker must bypass pgbouncer or go silently dark" `[PARTIAL]` — pgbouncer was **removed 2026-07-06** and a gate forbids its reintroduction; today a mispointed `DATABASE_URL` fails **loud** (`process.exit(1)` after bounded reconnect), not silent. And the claimable-predicate duplication `[CONFIRMED, 3 copies]` degrades only to poll latency, never wrong execution, because `/wake` funnels into the same `FOR UPDATE SKIP LOCKED` claim RPC.

---

## 5. Hidden-coupling inventory (grouped)

**Flags doing double duty:** `MESH_ENABLED`, `INTRANET_ENABLED`, `CLAUDE_POLL_ENABLED`, `N8N_WEBHOOK_URL`, `OLLAMA_URL`/`VLLM_GENERATION_URL` (config *and* router switch), `provision_when_env`, `LEDGER_ENABLED` (has **no reader**; the real gate is a GUC that defaults true).

**One value, two meanings across boundaries:** `POSTGREST_SERVICE_TOKEN` (not a secret — a 15-yr JWT), `NULL checksum` (baseline "never re-apply" vs delta "adopt-current"), `pending_migrations` (means **already-absorbed**, the opposite of its name), `translated:false` (anon key vs foreign issuer), `AISHA_POSTGREST_URL` (points at the *gateway* for n8n).

**Duplicated logic that must stay byte-identical (no shared unit):** the claimable predicate (×3), `buildPostgrestClaims` (×2, already drifted on roles), the quarantine filter (in every retrieval overload), provider-slug spelling (×3), the `web` namespace string, the six-locale set, every `WF_*.json` (n8n dir + package dir), the SBOM/signing matrices.

**Name-as-contract:** container DNS names (Coolify strips `container_name` → aliases load-bearing; `aisha-keycloak` has *no* alias yet 10 cross-stack refs), `public.profiles` = the "DB initialized" marker, `KEYCLOAK_REALM` (realm name = filename = Vite constant), `docker_compose_domains` keys must be dash not underscore (`n8n-auth` vs `n8n_auth`), server IDs → `COOLIFY_SERVER_UUID_<ID>` env names, relative submodule URLs → fork's git host must serve `insight.git`/`tenant-*.git`.

**Implicit ordering / "healthy but wrong":** pki-init failures **exit 0** → self-signed served, stack "healthy" but mesh unenrollable; `set +u` heredoc → empty secrets; instance-data operator roster travels by a `/tmp` file convention that holds only because two steps share one container; `reconcileOrphans` reaps *any* runner-labeled container at boot → implicit one-runner-per-host.

---

## 6. Where coupling is healthy vs. where it's debt

**Deliberate, healthy coupling (leave it):**
- **Gates-as-spec** — CI failing on drift of its own artifacts is the mechanism that keeps 15 planes honest. This is the immune system.
- **DB-as-SoT + heals** — the compiler pipeline gives fresh-install ≡ upgrade convergence, proven in CI.
- **Fail-closed governance** — AI dispatch is *deliberately* coupled to the spend ledger (`fn_admit_clow`); a governance outage halting AI is a feature.
- **The fork seam** — zero instance values in the repo, rehydrated from one vault, is a clean boundary.

**Coupling debt (the silent-skip class is the theme):**
- **The event plane's silent-death surface** — §4's dead wires all share one root: fan-out with no delivery check + healthchecks that only prove a process is alive, not that it's *connected to the right thing*. The single highest-leverage systemic fix is **making the event plane fail loud** (delivery assertions, a producer↔listener channel-census gate, a shared `schema.table` payload type + `ws:*` topic constant).
- **Convention duplication without a shared unit** — every ×2/×3 copy above is a drift bomb; extract shared SQL functions / TS constants and let a gate assert single-definition.
- **Flag double-duty** — split the conflated flags (executor-enabled vs poll-enabled; mesh-path vs namespace-rewrite) so one toggle can't half-deploy.
- **`deploy.yml` map lags real topology** — matrix/livekit/monitoring/playwright/cosmos/webdispecink have compose files but no deploy option and **no gate** enforcing the map covers topology.

---

## 7. How to use this map

- Before touching a **name/string/generated artifact**, grep for its other declaration sites (§5) — the interface won't warn you.
- Before changing an **env/flag**, check whether it's DB-overridden (`system_config`/GUC) and whether it's double-duty (§2.3/2.4).
- Before trusting a **"healthy" stack**, remember the event plane can be green-and-deaf (§4) — assert *delivery*, not liveness.
- The **mega-hubs (§1)** are where a one-line change becomes a stack-wide incident — review those diffs hardest.

---

### Provenance
Generated by a 31-agent coupling-analysis workflow (15 mappers + 16 adversarial verifiers), 2026-07-01, against the repo at merge `c79c5029`. Full per-plane edge lists + verifier transcripts: workflow `wf_e69a9c29-92f`. This document is the synthesis; the raw edges (≈180 mapped couplings with `file:line` evidence) live in the run journal.

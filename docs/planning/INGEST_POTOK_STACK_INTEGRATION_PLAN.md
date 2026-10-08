# AISHA Stack Integration Plan — `local-ingest` + `potok`

> **Status:** plan to execute in one pass ("na jeden zátah"). Grounded against live code (main @ `86b9839f`) + full reads of both app repos. File:line-verified.
> **Decisions locked (owner, 2026‑07‑14):** (1) **potok = verification layer over AISHA models** — a generation-backend adapter replaces MLX with a call to the governed Omni `/v1` (CLOW model routing); LoRA continual-learning stays Apple-only on Mac stations. (2) **Both repos = git submodules under `packages/`** (the `insight` pattern), built into root `Dockerfile.<svc>`, deployed as stacks. (3) **Instance = aisha.guru** → instance-specific data lives in per-app instance-data repos, never in the OSS core.

---

## 1. Context — why, and what these two apps are

Two new apps completed another phase. They are **not two independent services — they are two halves of one verified-extraction + continual-learning loop** (the "Seam C" flywheel that both repos' docs already describe):

- **`local-ingest`** — a *generic, offline, deterministic* document/contract **ingestion engine** (Python stdlib core, port **8765**, token-auth web cockpit). It runs a **3‑gate validator** (schema · source-span · confidence) so an authoritative value exists *iff* `(schema PASS ∧ span PASS ∧ conf≥threshold) ∨ human-confirmed`. It **writes files only — never touches the DB** — emitting verify-gated **export bundles** (`export/<id>/manifest.json` = the idempotent cursor unit) for a platform-side driver. All instance-specific behaviour comes from an external **data bundle** (`impl.json`), CI-enforced to keep the engine literal-free.
- **`potok`** — a Python prototype of a **flow-definition runtime** (FDL parser → flow runtime with **verification gates + hard USD/wall budgets + append-only provenance ledger** → ensemble sampling `P=1−(1−p)^k` → trajectory harvest → LoRA continual-learning). It exposes one protocol-independent core (`PotokService`) through an **MCP stdio server** and a **stdlib HTTP cockpit** (port 8080). It declares work as **capability manifests** (`why / reacts_to / how / consumes / provides`) — a capability registry with routing metadata that maps directly onto AISHA's capability/flowboard model.

**The loop:** documents → local-ingest (3‑gate) → export bundle → source-broker `li-driver` → `li_*` KB tables → potok `train-export` (spans → SFT pairs) → potok LoRA fine-tune (Mac) → improved model pinned back into local-ingest's advisory lane. local-ingest is the *verified-truth producer*; potok is the *verification-governed reasoning + learning* half.

**Goal of this plan:** adapt both for the AISHA stack — deployed as **mesh services with public admin UIs behind edge+auth on proper domains**, wired into **`aisha cold-start`** (so `--wipe` brings them up), with the **generic engines upstream** and all **instance-specific data in overlay repos**; then update stack docs + README.

---

## 2. Target end-state (the two services on the stack)

| | `local-ingest` → **`svc-local-ingest`** | `potok` → **`svc-potok`** |
|---|---|---|
| Coolify app | `local-ingest` | `aisha-potok` |
| container / alias | `local-ingest` / `svc-local-ingest` | `aisha-potok` / `svc-potok` |
| internal port | 8765 | 8080 |
| placement | **experimental** (isolated AI/staging plane, 2 CPU/2 GB caps — already in its compose) | **backend** (generation is remote now → light) |
| internal mesh face | `local-ingest.mesh.<MESH_TLD>` | `potok.mesh.<MESH_TLD>` |
| public admin UI | `ingest.<PUBLIC_TLD>` behind oauth2 | `potok.<PUBLIC_TLD>` behind oauth2 |
| tier | `optional` (+ `SOFT_DEPLOY_APPS`) | `optional` (+ `SOFT_DEPLOY_APPS`) |
| DB writes | **no** (emits export bundles) | **no** (harvest is local files/volume) |
| generation | n/a (deterministic; MLX advisory only, Apple-only) | **pluggable** — see §2.5 (mesh default = Omni `/v1`) |
| learning (LoRA) | n/a | **pluggable** — see §2.5 (mlx / cuda / rocm / xpu / delegated) |
| platform-side glue | `li_*` SoT tables + RPCs, `li-driver` in `svc-source-broker`, `WF_LOCAL_INGEST_SYNC` | capability registration + backend registry (§2.5) |

Both follow the **`insight` → `ragnarok`/`maestro`** build model exactly: submodule under `packages/`, single-stage root `Dockerfile.<svc>` (Coolify ARG_MAX), `context: .`, healthcheck on `127.0.0.1:<port>/health`.

---

## 2.5. potok backend variants — all sensible options, availability-selected

potok's one protocol-independent core (`PotokService`) gets **two pluggable backend seams**, each a small adapter registry with an **availability probe**. Selection mirrors `aisha_resolve_clow_backend`: an explicit `POTOK_GEN_BACKEND` / `POTOK_LEARN_BACKEND` may pin a backend, otherwise the registry probes what is actually serviceable and picks the best fit; **0 serviceable → fail-loud `resolved:false`, never a silent fallback or a hardcoded default** (repo HARD rule). A `GET /capabilities` (already present) reports which backends are live so the cockpit shows degradation honestly.

### A) Generation backend (`/solve` inference) — interface = `build_handlers()` (same shape as `demo/mlx_gen.py`)
| id | Makes sense when | Implementation | Notes |
|---|---|---|---|
| `aisha_gateway` | **mesh/Linux default** — governed | `POST ${AISHA_OMNI_URL}/v1/chat/completions` (`http://gateway:3001`, PAT) | double governance (AISHA `fn_admit_clow` + potok gate); token/cost from usage. **Already covers "local generation"**: the gateway routes to a local backend when `aisha_resolve_clow_backend` selects it — governed-local, no bypass. |
| `local` (Mac host) | Apple-Silicon Mac Mini / dev host | **Docker Model Runner `--backend vllm`** (vLLM-Metal, OpenAI+Anthropic API, MLX-format models — the existing `docker:ai` tooling) **or** native `mlx:serve` (`:8100`) | The **container-managed** Mac lane: `docker model` CLI manages lifecycle, but Metal runs **host-side** (Docker: *"no GPU passthrough for Metal in containers"*, Docker Desktop 4.62+, M-series). Serves the **same MLX-format Qwen-Coder family** potok uses. Point potok at it directly, or register it as a gateway local backend (governed). |
| `mock` | CI / showcase / no model present | `demo/patches.py` | exercises the full flow/gate/provenance machinery deps-free. |

### B) Learning — **converge on the stack's EXISTING fine-tune lane, don't build a new one** (applied-not-new)
The stack **already ships the whole learning lane** — this is the biggest reuse in the plan:
- `n8n/workflows/WF_TRAINING_EXPORT.json` + `WF_FINE_TUNE_JOB.json` — the orchestrated export→train→evaluate workflow.
- `training_jobs` SoT table (`base_model`, `status: pending→exporting→training→evaluating→completed→failed→cancelled`, `adapter_model_id → ai_model_registry`) + `training_datasets` / `training_examples`.
- `scripts/ai/train-lora.sh` — the **native MLX LoRA trainer** (Apple-Silicon check, `mlx_lm`, `--data JSONL --output adapter/`, updates `training_jobs` via `TRAINING_JOB_ID` + the PostgREST service key).
- Setup/serve tooling: `mlx:setup` / `mlx:serve` (native MLX serving, `:8100` OpenAI /v1), `docker:ai` (Docker **Model Runner** — container-managed, Metal-on-host GPU inference, `:12434`), `ollama:*`, `ai:mode:local|hybrid|cloud`.

**So potok does NOT get its own learning kernels.** potok's `continual.py` folds into this lane: harvest → training data (`training_datasets`) → `WF_FINE_TUNE_JOB` → `train-lora.sh` → adapter in `ai_model_registry` → re-pin into local-ingest's advisory lane. potok's monotonic-promote/eval gate maps onto the `training_jobs` `evaluating` state. The **hardware backend lives in `train-lora.sh`** (MLX today; a `cuda`/`rocm`/`xpu` branch is an addition *there*, not in potok).

### C) Deployment topologies (where it runs — chosen per host)
1. **Mesh `svc-potok` (Linux, no GPU, containerized):** `gen=aisha_gateway`; **`/learn/*` = trigger `WF_FINE_TUNE_JOB` via aishaRpc** (never trains in-process). Always-on, orchestration-reachable verification service.
2. **Mac Mini fine-tune worker (Apple Silicon, NATIVE — installed via the existing `mlx:setup`, NOT a Linux container):** runs `train-lora.sh` (MLX) as dispatched by `WF_FINE_TUNE_JOB` + tracked in `training_jobs`. Installed and managed **exactly the stack way** (the `mlx:*` / `ai:mode` scripts + the `local-only` service tier — same class as `vllm`/`ollama`, which are also native local runtimes, never Coolify containers). MLX training is inherently native because **no runtime exposes Apple Metal to a Linux container** — but the *install/ops model is identical to the stack's*.
3. **NVIDIA GPU host (Jetson AGX Orin / x86 + RTX A4000/4000 Ada) — the FULLY-containerized GPU lane:** unlike Apple Metal, CUDA **does** pass into a container (`nvidia-container-toolkit`). So on a Linux+NVIDIA box **both** lanes are plain `--gpus` containers, managed exactly like the rest of the stack (compose + cold-start + mesh): generation = vLLM-CUDA container (OpenAI /v1); learning = a `cuda` branch of `train-lora.sh` (PyTorch+PEFT) in a container, same `WF_FINE_TUNE_JOB` + `training_jobs` lane. **This is the option that satisfies "everything a clean container like the whole stack, incl. the GPU part."** Jetson = ARM64 edge (64 GB unified, low-power, always-on; ARM64+CUDA `l4t` base images; fine for 0.5B–7B LoRA + small-model serving). x86+RTX = more headroom.
4. **Apple-Silicon Mac host — container-managed *inference*, native *training*:** `docker:ai` = Docker Model Runner with **`docker model install-runner --backend vllm`** serves **vLLM-Metal** (Metal-accelerated, OpenAI+Anthropic API, **MLX-format** `mlx-community` Qwen-Coder models); or the standalone `vllm-metal` install (`curl install.sh` → `~/.venv-vllm-metal`, native `vllm serve`). **Both run the engine host-side** — Docker + vLLM both confirm *"no GPU passthrough for Metal in containers."* Training stays native `train-lora.sh` (mlx-lm). So the Mac gives the "container feel" for generation but the GPU/training lane is never truly in-container — the Apple-ecosystem tradeoff.
5. **CI smoke:** `gen=mock` — deps-free flow/gate tests.

**Net — the GPU-host choice (see §6):** if **full container uniformity incl. the GPU lane** is the priority, use a **Jetson / x86-NVIDIA** host — generation *and* LoRA both run as `--gpus` containers, Coolify/compose/cold-start-managed, no Metal exception. If the **Apple/MLX ecosystem** is preferred, the **Mac Mini** gives container-managed *inference* (Docker Model Runner vLLM-Metal) + native mlx-lm *training* (host-side Metal by physics). Either way: potok stays unchanged (backends are availability-selected); learning is a wire-up of the existing `WF_FINE_TUNE_JOB` + `train-lora.sh` + `training_jobs` lane; the mesh default is governed `aisha_gateway`.

---

## 3. Workstreams (execution "na jeden zátah")

Ordered by dependency. Each is independently gate-verifiable.

### W1 — Vendoring + build + compose (both services)
- **Submodules (relative URL, `insight` pattern):** add `packages/local-ingest` → `../aisha-local-ingest.git` and `packages/potok` → `../potok.git` in `.gitmodules` (relative so Coolify's tokened build clone + CI + forks inherit creds; see `.gitmodules:2‑16`). **Scrub any embedded token** from submodule URLs (a plaintext OAuth token was found baked into a fresh clone's `.git/config` — never COPY `.git` into an image; add `.git` to `.dockerignore`).
- **`Dockerfile.local-ingest`** (root): model the app's own `Dockerfile` (python:3.12-slim, tesseract-ocr-ces, deterministic-lane pip set, non-root uid 10001, `EXPOSE 8765`, `HEALTHCHECK GET /api/health` w/ token, `entrypoint.sh` GitOps bundle-seed). Copy from `packages/local-ingest/`. The app already ships this Dockerfile — vendor it.
- **`Dockerfile.potok`** (root, **new — potok has none**): single-stage python:3.12-slim, `pip install PyYAML numpy safetensors` (mock/gateway lane, **no MLX**), non-root, `EXPOSE 8080`, `HEALTHCHECK GET /health`, `CMD python potok_http.py`. `context: .`.
- **`docker-compose.coolify-local-ingest.yml`** — vendor the app's compose (already stack-shaped: `expose 8765`, `ingest-bundle`/`ingest-input`/`ingest-out` volumes, token+allowed-hosts, resource caps, healthcheck). Add: `pki-init` dep + `pki-certs:/certs/pki:ro` + `NODE_EXTRA_CA_CERTS`… (**N/A — Python; use `REQUESTS_CA_BUNDLE`/`SSL_CERT_FILE=/certs/pki/aisha-ca-bundle.pem`** if it ever calls the mesh), `internal`+`coolify` networks with alias `svc-local-ingest`.
- **`docker-compose.coolify-potok.yml`** (new) — model `docker-compose.coolify-openclaw.yml` (internal + public-behind-auth): `expose 8080`, `potok-data:/app/data` + `potok-out:/app/out` volumes (harvest/provenance persistence), env (below), healthcheck, `svc-potok` alias, `coolify.managed=true`.

### W2 — potok packaging hardening + generation-backend registry (§2.5‑A)
The app-read flagged these as **blockers**; all are in-scope here:
- **Generation backend registry (§2.5‑A):** refactor the current MLX-only path into `potok/backends/generation/` with a registry + availability probe and the four adapters — `aisha_gateway` (mesh default; `POST ${AISHA_OMNI_URL}/v1/chat/completions`, `http://gateway:3001`, PAT in `AISHA_OMNI_KEY`), `local_openai` (`${POTOK_LOCAL_LLM_URL}/v1`), `mlx` (existing `demo/mlx_gen.py`), `mock`. `POTOK_GEN_BACKEND` pins; unset → probe+select; **0 serviceable → fail-loud**. potok's gates/budgets/provenance run **over** the selected model; token/cost map from the backend's usage response.
- **Auth + fail-closed bind** (`INTEGRACE.md:22‑23` prerequisite): bearer-token check + non-loopback fail-closed guard in `potok_http.py` (mirror local-ingest's `_validate_network_mode` + `X-…-Token`/cookie/`?token=`). `POTOK_TOKEN` (≥16) + `POTOK_ALLOWED_HOSTS`; without them the container refuses `0.0.0.0`.
- **Error hygiene:** stop returning `repr(exception)` on 500 — generic message + server-side log.
- **`swe_fix` code-exec sandbox:** the network-deny sandbox is macOS-only (`sandbox.py` silently skips on Linux). **Default: disable `swe_fix` on the mesh deployment** (capability allow-list env), keep document-verification capabilities; optional nsjail/bubblewrap for a Linux code lane later.
- **Unified pinned deps:** `requirements-service.txt` (PyYAML + numpy + safetensors + http client) for the mesh container; the GPU learn-worker gets its own `requirements-<backend>.txt` (W2b).

### W2b — wire potok learning onto the stack's existing fine-tune lane (§2.5‑B/C, applied-not-new)
- **Converge, don't rebuild:** map potok's harvest → the stack's `training_datasets`/`training_examples` (via `WF_TRAINING_EXPORT`); potok's `/learn/*` on the mesh = **trigger `WF_FINE_TUNE_JOB` via aishaRpc** (writes a `training_jobs` row), never trains in-process. The fine-tune executes through the existing `scripts/ai/train-lora.sh` (MLX) → adapter → `ai_model_registry`; potok's monotonic-promote/eval maps onto the `training_jobs` `evaluating`→`completed` states. Reconcile potok's `continual.py` schema (rank/alpha/epochs/held-out metric) with `train-lora.sh` flags + `training_jobs` columns.
- **Mac Mini fine-tune worker install = the stack way:** set it up with the existing `mlx:setup` (native venv + Metal deps), register it as the `WF_FINE_TUNE_JOB` execution host (a labelled `macos`/`mlx` CI runner matching the existing self-hosted setup, or an n8n-reachable native worker). MLX training stays native (no Metal in a Linux container) — but installed/managed identically to the stack's other local runtimes (`vllm`/`ollama`, `local-only` tier).
- **Optional non-Apple branch:** add a `cuda`/`rocm`/`xpu` code path to `train-lora.sh` (PyTorch+PEFT) if a Linux GPU box joins — same `WF_FINE_TUNE_JOB`/`training_jobs` lane, no potok change.
- **Re-pin loop:** the promoted adapter (40-hex) flows back into local-ingest's advisory lane through its 3 gates (bundle-variant rollback preserved) — closing Seam‑C through the stack's own registry.

### W3 — local-ingest platform side (the KB writer half, 0% today)
All **upstream** in the orchestrator (the app deliberately ships none of this):
- **SoT tables** `aisha/db/sql/tables/li_*.sql` (registry / findings / links / obligations / entity_suggestions) + RLS + grants, per the `aisha-migration` skill; baseline regen.
- **SECURITY DEFINER RPCs** `aisha/db/sql/functions/li_upsert_*.sql` (audited, `REVOKE/GRANT`, provenance) — the *only* writers, called service-role. KB items reuse the existing `upsert_story_knowledge_item_audited` + `insert_knowledge_chunk` (the export artifact's fields are already named 1:1 as those RPC params).
- **`li-driver`** in `services/svc-source-broker` (`sourceSlug='local-ingest'`) — a new adapter alongside `clients/graphql-driver.ts` / `pg-readonly-driver.ts` (the PR‑#601 `adapters/plugin-host.ts` seam). It reads the export `manifest.json` cursor from the transport, verifies sha256/verify-result, and upserts idempotently via the `li_*` RPCs. Register in `adapters/source-registry.ts`; schedule via `scheduler.ts` (`endpoint_url` = the drop location / pull URL, `auth_secret_ref`).
- **Transport (recommended: pull, no egress):** the broker ticks a shared drop location (the `ingest-out` volume surfaced read-only to the broker, or an object drop). `AISHA_EXPORT_PUSH_URL` stays **unset** (no egress from the ingest container). Push mode is the fallback.
- **`WF_LOCAL_INGEST_SYNC`** n8n workflow (aishaRpc + approval gate) for the review-manifest → `knowledge_moderation_queue` hand-off, per the `aisha-n8n-workflow` skill.

### W4 — Topology · domain · mesh · edge · cold-start (both services)
Per the verified 13‑step "add a service" reference:
- **`config/services.json`** — two entries (`local-ingest`, `potok`): `role`, `tier:"optional"`, `subdomain` (`ingest` / `potok`), `public:true`, `canonical_scope:"internal"`, `compose`, `placement` (`experimental` / `backend`), `depends_on`, `internal_url:{container:"svc-…",port,env_aliases}`, `provision_when_env` (opt-in gate, e.g. `INGEST_BUNDLE_GIT_URL` / `POTOK_ENABLED`), `capabilities.requires_*` (potok requires the gateway/omni surface).
- **`config/profiles/*.json`** — `service_overrides.<id>.placement`.
- **`scripts/lib/derive-domains.mjs`** — the two public-behind-edge faces need an emit block + sentinel each (model the `COMPANION_UPSTREAM_PUBLIC/_MESH` blocks); mesh overlay gives `<role>.mesh.<MESH_TLD>` automatically.
- **`coolify/manifests/aisha.manifest`** — `app: local-ingest:experimental:docker-compose.coolify-local-ingest.yml` and `app: potok:backend:docker-compose.coolify-potok.yml` (+ header comment).
- **Cold-start reach:** add stack keywords to `scripts/aisha-cold-start.sh` (`STACKS=`, ~:891), `scripts/coolify-deploy-init.sh` (`ALL_STACKS=`, :90); add a **WAVES** entry (wave 4/6) in `scripts/aisha-redeploy.mjs` (:244) and mark both in **`SOFT_DEPLOY_APPS`** (:560) so a failure never aborts a `--wipe` wave; add the `provision_when_env` opt-in gate in `scripts/coolify-story-init.sh`.
- **Mesh:** both stacks join via a `netbird-agent` + `<…>-mesh-ingress` Caddy sidecar (model `docker-compose.coolify.yml:692‑853`), `NETBIRD_STACK_KEY_<SERVER>`.
- **Edge public face + auth:** for each, add the edge-proxy env passthrough + Caddyfile `@ingest`/`@potok` block + static Traefik labels in `docker-compose.coolify-prebuilt.yml`, gated by an **oauth2-proxy sidecar** (Pattern A, `keycloak-oidc`, `OAUTH2_PROXY_ALLOWED_GROUPS`) — the least-code path since neither app speaks OIDC. local-ingest keeps its own bearer token as defense-in-depth behind oauth2.

### W5 — Instance-specific data (generic core stays literal-free)
- **local-ingest bundle** → a private **`aisha-local-ingest-instance-data`** repo (impl.json + classification signals + field schemas + thresholds + namespaces + `story_id`). Seeded at container start via `BUNDLE_GIT_URL/PATH/REF` (already built into the entrypoint). For aisha.guru this is the aisha.guru document taxonomy.
- **potok capabilities/clients** → per-client models + client-specific capability manifests live **outside** the repo (`POTOK_CLIENTS_ROOT`); the aisha.guru capability set + any tuned adapters ship via the instance overlay, not the generic engine.
- Wire via `AISHA_INSTANCE_DATA_GIT_URL` + `scripts/deploy/instance-data-hook.sh` where SQL overlay is needed; keep the OSS boundary gate green (`public-oss-boundary.gate.test.ts`).

### W6 — Capability / flowboard wiring for potok
- Map potok's `capabilities/*.yaml` manifests onto the AISHA capability registry so the orchestrator can route a task to `svc-potok` (`solve(capability, task)` → gate-verified result + `provenance_mermaid`). Surface potok's `potok_mcp_server.py` as an MCP tool (the extension-unification spine: manifest capability → registry → resolver). This is where potok stops being a standalone cockpit and becomes an orchestration-reachable **verification-governed reasoning** capability.

### W7 — Gates + docs + README
- Satisfy: `redeploy-wave-coverage`, `topology-derivation`, `domain-coverage`, `traefik-host-coverage`, `internal-url-topology`, `topology-domains-parity`, `capability-gates`; refresh `ci-service-compose-deployability.baseline.json`; run `scripts/cold-start-verify.mjs`, `coolify-domain-doctor.mjs`, `verify-topology-deployed.mjs`.
- **Docs:** new `docs/stack/local-ingest.md` + `docs/stack/potok.md`; update `docs/architecture/stack-topology.md`, `docs/PLATFORM_README.md`, `docs/ARCHITECTURE.md`, and the **README.md** service list to current state (both new services + the ingestion→learning loop). Add a `docs/integrations/LOCAL_INGEST_POTOK_LOOP.md` describing Seam C.

---

## 4. Risks & mitigations

| Risk | Mitigation (in-plan) |
|---|---|
| **potok real inference is Apple-only (MLX)** | §2.5 pluggable backends: generation → `aisha_gateway`/`local_openai`/`mlx`/`mock` by availability; learning → `mlx`/`cuda`/`rocm`/`xpu`/`delegated`. No Apple lock-in; the mesh service needs no GPU; a `cuda` GPU-worker is the recommended learning lane. |
| **Non-NVIDIA GPU tooling maturity** (AMD ROCm / Intel XPU rougher) | Shared learning interface; build `cuda` first, `rocm`/`xpu` as availability-gated adapters — an unconfirmed backend simply isn't selected (fail-loud, never silent). Confirm the card before building the second kernel. |
| **Token baked into a git clone** (found in a fresh clone's `.git/config`) | Relative submodule URLs; `.git` in `.dockerignore`; never COPY `.git`; scrub before vendoring. |
| **potok has no auth, loopback-only, 500 leaks internals** | W2: bearer token + fail-closed non-loopback bind + generic 500 + behind oauth2 at the edge. |
| **`swe_fix` runs model-gen code without network-deny on Linux** | W2: disable `swe_fix` on the mesh deployment (capability allow-list); document Mac-only for that capability, or add nsjail. |
| **`--wipe` blast radius** — a new stack failing could abort waves | `tier:"optional"` + `SOFT_DEPLOY_APPS` + `provision_when_env` opt-in; both are non-load-bearing for the core. |
| **Coolify ARG_MAX** on a big new compose | Single-stage Dockerfiles + `context:.`; consider co-locating potok on an existing backend stack (the `domain-services` model) if it stays small. |
| **Instance leakage into the generic engine** | Keep the CI split-rule (local-ingest already enforces it); instance data only in overlay repos; OSS-boundary gate. |
| **KB corruption from bad extractions** | The `li-driver` upserts **only** verify-gated export bundles (sha256 + verify-result checked); obligations/legal always land as `NEEDS_REVIEW`; `p_visibility` fail-closed to `private`. |
| **potok generation cost runaway** | potok's own hard USD/wall budget gate (`precheck_dispatch`) sits in front of every ensemble batch — AISHA admit is a second gate. |
| **Two-way version coupling (model pin ↔ engine)** | Model returns as a bundle pin (40-hex) through local-ingest's 3 gates; monotonic-promote law + bundle-variant rollback (already in both designs). |

---

## 5. Verification / Definition of Done

1. **Build:** `docker build -f Dockerfile.local-ingest .` and `-f Dockerfile.potok .` succeed registry-free; `.dockerignore` excludes `.git`.
2. **Gates green:** the topology/domain/wave/capability gate set + `ci-service-compose-deployability.baseline.json` updated; `test:gates` clean.
3. **Cold-start:** `cold-start-verify.mjs` + `coolify-domain-doctor.mjs` show both apps in the manifest↔WAVES parity and both faces resolvable; a `--wipe` (with the opt-in envs set) brings both up and health-gates them.
4. **Functional local-ingest:** cockpit reachable at `ingest.<PUBLIC_TLD>` behind oauth2; a sample bundle run emits a verify-gated export; the `li-driver` upserts `li_*` rows + KB items; review items reach `knowledge_moderation_queue`.
5. **Functional potok (mesh):** cockpit at `potok.<PUBLIC_TLD>` behind oauth2; `/solve` with `gen=aisha_gateway` returns a gate-verified result + provenance, generation routed through Omni `/v1` (visible in `audit_journal`/decision provenance); budgets enforced; `GET /capabilities` reports the live backend set; `/learn/*` returns 202 (delegated) — no in-process GPU training on the GPU-less mesh host.
6. **Backend matrix proof:** `mock` gen passes the deps-free flow/gate suite (CI); `aisha_gateway` gen works on the mesh; the confirmed GPU learn-worker (`cuda`, or `rocm`/`xpu`) runs one LoRA fine-tune → eval → monotonic promote; `mlx` gen+learn still work on a Mac. Selecting an unavailable backend **fails loud** (no silent fallback).
7. **Loop:** local-ingest `train-export` → potok `potok_ingest --kind spans` → SFT pairs → the GPU learn-worker fine-tunes → promoted model re-pins into local-ingest's advisory lane.
8. **Docs:** README + stack-topology + two per-service docs + the Seam‑C loop doc updated.

---

## 6. Hardware support — ALL THREE paths are build targets (owner directive)

Support **Jetson + NVIDIA + Mac**, all installable & controllable within the stack — not "pick one". The pluggable backends (§2.5) make each a first-class adapter; enable whichever host you have, availability-selects the rest.
- **Jetson (ARM64+CUDA) — first-class, we want it**: generation *and* LoRA both `--gpus` containers (`l4t` base), cold-start-managed. Fully containerized GPU lane.
- **x86 + NVIDIA (RTX A4000/4000 Ada)**: same containerized CUDA lane, more headroom.
- **Mac (Apple Silicon)**: **build the stack-controlled MLX support** so it installs & runs *within the stack*, not ad-hoc — a `local-only`-tier entry + reuse of `mlx:setup`/`mlx:serve`/`train-lora.sh`/`WF_FINE_TUNE_JOB`, generation via Docker Model Runner (vLLM-Metal) or native vllm-metal. **CPU-only is out** (pointless); the Mac lane always uses Metal (host-side by physics, stack-managed by tooling).

**Open (small):**
- **Which hosts exist now** → build/test those adapters first (Jetson? Mac Mini spec? NVIDIA box?). The others ship as availability-gated adapters.
- **Worker wiring**: fine-tune host as a labelled CI runner (`macos`/`mlx`, `linux`/`cuda`, `jetson`/`cuda`) vs an n8n-reachable native/container worker.
- **potok ↔ train-lora reconciliation**: confirm potok's `continual.py` defers to `train-lora.sh` + `training_jobs` (recommended convergence).
- **vllm-metal LoRA-serving**: verify vllm-metal/Model Runner can serve a fine-tuned adapter (for hot re-pinning); vLLM core supports it, Metal variant TBD.
- Export **transport**: pull-from-drop (recommended, no egress) vs push. Default: pull.
- **Domains**: `ingest.<tld>` / `potok.<tld>` prefixes OK? (or `ingestion`/`flow`).

# Stack smoke runner (`npm run test:stack`)

Single command that any operator (us for the upstream Aisha stack, a partner tenant for theirs, a
law firm for theirs, an accounting office for theirs, …) can run to
validate their stack — from "I just cloned the repo" through "the
backend is warm and talking to a real LLM provider".

## What it does

Three phases, each independent, each skip-able:

| Phase | What runs | Needs |
|---|---|---|
| **1 — preflight** | `git submodule update --init`, `npm run db-mgr:source` if the source-of-truth report is missing | git, repo write access |
| **2 — offline (no keys, no stack)** | tsc + lint + test:gates + validate:static + i18n:check + test:run (5400+ unit tests) + test:services + build. **Mirrors what pre-push runs** — green here means push is green. | node deps installed (`npm install`) |
| **3 — warmup smoke** | Detects which LLM backend the operator wired into env. If postgrest + svc-ai-chat + svc-web-artifact are reachable, exercises `/functions/v1/ai-generate` (echo prompt) and `/functions/v1/web-artifact-seed-default` (idempotent — proves whole pipeline) | running stack + service-role token |

### Three npm scripts

| Script | What runs | When to use |
|---|---|---|
| `npm run test:stack` | All three phases | Operator validating a warm stack |
| `npm run test:stack:full` | Phase 1 + full Phase 2 (incl. build + services) | Pre-push hook; pre-merge gate |
| `npm run test:stack:ci` | Phase 1 + Phase 2 minus build + services (≈ 1 min) | CI fast lane; quick local sanity |

`test:stack:ci` and `test:stack:full` differ only in the optional Phase 2
steps (build, test:services) that take a couple of minutes each. CI
typically runs build in a separate job, so the fast lane skips both.

Exit codes:
- **0** — all green
- **1** — preflight or offline failed (real regression — must fix)
- **2** — warmup couldn't run (stack not up, no backend, no token) — not fatal

## Backend detection

Phase 3 reads env at runtime and reports every backend it sees. Operator
configures **only what they have or paid for**; Aisha picks the model
through `route_task` + `agent_catalog` (platform-level), so changing
backend ≠ changing code.

| Env var | Backend |
|---|---|
| `AISHA_LLM_MOCK=1` | Deterministic fixture (CI / first-boot validation) |
| `OLLAMA_URL=http://...` | Ollama (any host, incl. Apple Silicon / Metal) |
| `VLLM_GENERATION_URL=http://...` | vLLM (self-hosted; common Apple Silicon target) |
| `DOCKER_MODEL_RUNNER_URL=http://...` | Docker Model Runner (OpenAI-compatible) |
| `LLM_GATEWAY_URL=http://...` | AISHA LLM Gateway (theopenco/llmgateway) |
| `MAESTRO_URL=http://...` | Maestro (multi-turn coherence layer) |
| `ANTHROPIC_API_KEY=...` | Anthropic (cloud — Batch + standard) |
| `OPENAI_API_KEY=...` | OpenAI (cloud — Batch + standard) |
| `GOOGLE_API_KEY=...` | Google AI (Gemini) |

Multiple may be configured; `agent_catalog.default_model` +
`model_overrides` per risk pick which one Aisha actually calls.
`resolveProvider(model)` from `services/svc-ai-chat/src/lib/llmRouter.ts`
dispatches.

## Override switches

| Env | Effect |
|---|---|
| `AISHA_SMOKE_SKIP_PREFLIGHT=1` | Skip phase 1 (faster re-runs) |
| `AISHA_SMOKE_SKIP_OFFLINE=1` | Skip phase 2 entirely |
| `AISHA_SMOKE_SKIP_BUILD=1` | Skip the slow `npm run build` step inside phase 2 (CI fast lane) |
| `AISHA_SMOKE_SKIP_SERVICES=1` | Skip the `npm run test:services` step inside phase 2 |
| `AISHA_SMOKE_SKIP_WARMUP=1` | Skip phase 3 (`test:stack:ci` + `test:stack:full` set this) |
| `AISHA_SMOKE_GATEWAY_URL=...` | Override gateway URL (default `http://localhost:3001`) |
| `AISHA_SMOKE_SERVICE_TOKEN=...` | Override service-role JWT (default `$POSTGREST_SERVICE_TOKEN`) |
| `AISHA_SMOKE_TIMEOUT_MS=...` | Per-step timeout (default 30 000) |

## Typical operator flows

### Fresh clone, no backend yet

```bash
git clone https://repo.id3a.cz/aisha/evymo-ai-orchestrator.git
cd evymo-ai-orchestrator
npm install
AISHA_SMOKE_SKIP_WARMUP=1 npm run test:stack
# → exit 0, lint/types/gates green, warmup intentionally skipped
```

### CI

```yaml
- run: npm run test:stack:ci
```

Same as fresh-clone — only phases 1 + 2.

### Local dev on Apple Silicon with vLLM

```bash
export VLLM_GENERATION_URL=http://localhost:8000
export POSTGREST_SERVICE_TOKEN=...
npm run test:stack
# → detects vllm, exercises router → resolveProvider → unifiedChat through vllm
```

### Local dev with Ollama

```bash
export OLLAMA_URL=http://localhost:11434
export POSTGREST_SERVICE_TOKEN=...
npm run test:stack
```

### Production-like with AISHA LLM Gateway

```bash
export LLM_GATEWAY_URL=http://llm-gateway:4000   # internal driver (container is public:false)
export POSTGREST_SERVICE_TOKEN=$(vault kv get -field=token aisha/postgrest)
AISHA_SMOKE_GATEWAY_URL=https://api.aisha.guru npm run test:stack
```

### Quick mock-only sanity check

```bash
AISHA_LLM_MOCK=1 POSTGREST_SERVICE_TOKEN=dev-mock npm run test:stack
```

## Customizing

Drop a `.env.aisha-smoke` (gitignored) at repo root with whatever
backend env you want; the runner inherits the shell environment, so
`source .env.aisha-smoke && npm run test:stack` works.

Every operator instance keeps the same single command — different env
flips different paths through identical code. That's the whole point.

## Adding a new check

`scripts/test/stack-smoke.mjs` is a single file. Each phase is a
named function (`phasePreflight`, `phaseOffline`, `phaseWarmup`) that
returns `{ ok, skipped, reason? }`. Add new helpers; keep them
idempotent and skip-friendly.

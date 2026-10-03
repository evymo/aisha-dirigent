# docker-compose.coolify-llm-gateway.yml — notes

Prose extracted from `docker-compose.coolify-llm-gateway.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `services:`

==============================================================================
Coolify story: aisha-llm-gateway (Backend — transparent IDE proxy + batch endpoint)
==============================================================================
Self-hosted LLM Gateway (github.com/theopenco/llmgateway) serves two roles:

  1. TRANSPARENT proxy for IDE dev traffic (Claude Code / Cursor / Codex /
     Antigravity / Copilot / Windsurf / Zed). Devs set
     ANTHROPIC_BASE_URL / OPENAI_BASE_URL to ${GATEWAY_DOMAIN}, requests
     pass through to providers + traces are forwarded to existing Langfuse.

  2. /v1/batches endpoint passthrough for Anthropic Message Batches /
     OpenAI Batch (50% off). AISHA backend's batchSubmitter.ts can call
     direct provider endpoints OR route through this gateway for
     unified observability.

What the gateway DOES NOT do (intentional source-of-truth boundary):
  - No routing logic (llmRouter.ts in svc-ai-chat remains authoritative)
  - No cost dashboard (Langfuse remains primary observability)
  - No audit log (decisionProvenance + audit_journal remain authoritative)
  - Backend (svc-ai-chat) calls providers DIRECTLY — no gateway hop

AGPLv3 invariant: self-hosted as a network service (not statically linked).
==============================================================================

## `llm-gateway-db-init:`

─────────────────────────────────────────────────────────────────────────
llm-gateway-db-init — idempotently provisions llm_gateway schema + user
on the shared aisha-db cluster (mirrors langfuse-db-init pattern).
─────────────────────────────────────────────────────────────────────────

## `llm-gw-redis:`

─────────────────────────────────────────────────────────────────────────
llm-gw-redis — DEDICATED Redis instance for the split llmgateway-gateway
image. Upstream theopenco/llmgateway-gateway uses ioredis with default
localhost:6379 unless REDIS_URL is set; the -gateway split image expects
external Redis (the -unified monolith bundles its own).

Why DEDICATED (not piggyback on aisha-redis):
  (1) Container name `aisha-redis` is globally unique on the host, so
      cross-stack discovery requires the shared `coolify` network.
  (2) Mixing job queues from two different stacks in one Redis is fragile
      — BullMQ uses key prefixes but a poorly-namespaced upstream change
      could clash with langfuse's queue keys.
Lightweight (~30MB RSS at idle); the overhead is worth the isolation.

Why NO PASSWORD:
  - Exposed ONLY on `internal` Docker network (no host port, no `coolify`
    net attachment) — only sibling containers in this compose can reach
    port 6379.
  - Per WP 3.7 plaintext-env baseline ratchet (gated by
    wp-3-7-secrets-no-plaintext.gate.test.ts): MUST NOT add new ${VAR}
    plaintext-secret references to compose; file-mount migration is the
    forward path (task #29 — pending). Internal-only Redis with no auth
    matches the threat model exactly: only containers in the same stack
    (already trusted enough to share the DB password) can reach it.
─────────────────────────────────────────────────────────────────────────

## `llm-gateway:`

─────────────────────────────────────────────────────────────────────────
llm-gateway — main daemon. Provider keys + Langfuse credentials passed
through. Schema-isolated on shared aisha-db.

Image: ghcr.io/theopenco/llmgateway-unified (AGPLv3, published on GHCR
by upstream — Docker Hub mirror at theopenco/llmgateway:v0.5.0 was
never published; upstream renamed to *-unified and uses latest/sha tags.
2026-05-23: corrected from ${REGISTRY_DOMAIN}/theopenco/llmgateway:v0.5.0
which 404'd because the Docker Hub source doesn't exist).
─────────────────────────────────────────────────────────────────────────

## `image: ${IMAGE_LLM_GATEWAY}`

Split image (gateway daemon only) — pairs with externally-managed
aisha-db Postgres + Redis. The `-unified` image is a self-contained
monolith with bundled postgres/redis, incompatible with our compose
architecture (PR #181 → #186, 2026-05-23).

## `- PORT=4000`

Image baked-in default is PORT=80; override to 4000 to match our
compose expose. Upstream serve.ts default = 4001.

## `- DATABASE_URL=postgresql://llm_gateway_app:${LLM_GATEWAY_DB_PASSWORD}@aisha-db:5432/postgres?schema=llm_gateway`

DB

## `- ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}`

Provider keys (BYOK — reused from AISHA's existing env)

## `- LLM_GW_API_KEY=${LLM_GW_API_KEY:-}`

llmgateway.io managed upstream — single pooled key giving access to
xAI / DeepSeek / Mistral / Cohere / Together / OpenRouter at typically
20-40% lower per-token cost than direct provider APIs. Our self-hosted
gateway forwards requests for these providers via the managed service
when a model is configured (in DB or gateway-side config) to use it.
See ai_provider_registry slug='llmgateway-io' (backend_kind='llm_gateway').

## `- LLM_GATEWAY_API_KEY=${AISHA_LLM_GATEWAY_KEY}`

Service-side bearer token (devs set ANTHROPIC_API_KEY=this in IDE)

## `- LLM_GATEWAY_DOMAIN=${LLM_GATEWAY_DOMAIN}`

Public hostname (used in callback URLs + dashboard links)

## `- LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY:-}`

Langfuse forwarder — every gateway call exports a trace into existing
Langfuse stack. NOT a parallel dashboard, just an exporter.
Reuse main Langfuse credentials (set by deploy-init from /envs/bulk).

## `- AUTH_OIDC_CLIENT_ID=${LLM_GATEWAY_OIDC_CLIENT_ID:-llm-gateway}`

OIDC SSO via Keycloak for the management dashboard

## `- NODE_EXTRA_CA_CERTS=/certs/pki/aisha-ca-bundle.pem`

PKI trust bundle (internal CA → KC + others)

## `- REDIS_HOST=llm-gw-redis`

Redis — dedicated stack-local instance (NOT shared with langfuse).
Upstream theopenco/llmgateway-gateway image reads Redis via three
separate env vars in packages/cache/src/redis.ts:
  host:     process.env.REDIS_HOST     ?? "localhost"
  port:     Number(process.env.REDIS_PORT ?? 6379)
  password: process.env.REDIS_PASSWORD          (no default)
NOT a single REDIS_URL — that's a common pitfall (most cloud platforms
use REDIS_URL, but upstream picked the split-component form). Verified
against infra/docker-compose.split.local.yml in the upstream repo.
Setting REDIS_HOST silences the ECONNREFUSED 127.0.0.1:6379 log loop
and lets BullMQ job queue + caching features come online.
No password — llm-gw-redis runs --protected-mode no on internal network
only (no host port, no coolify net). See llm-gw-redis service docs above.

## `test:`

llmgateway-gateway exposes health on ROOT path `/` (per apps/gateway/src/app.ts);
NOT `/health` (that was old v0.5.0 image). The `?skip=` query param
bypasses redis/database dependency checks for boot-time liveness.

Probe via Node's built-in `http` module — the upstream image ships
ONLY node (no wget, no curl). Using wget here was a copy-paste from
other Alpine-based stacks; in this image it gave 230 consecutive
"wget: not found" failures keeping the container marked unhealthy
even though /?skip=... was responding 200 the whole time.

## `- "coolify.managed=true"`

─────────────────────────────────────────────────────────────────
Traefik labels — same pattern as langfuse / KC / n8n.
Memory feedback_coolify_label_dollar_escape.md: literal hostname,
NEVER ${GATEWAY_DOMAIN}. Default placement backend; profiles
override via service_overrides.
─────────────────────────────────────────────────────────────────

## `pki-init:`

─────────────────────────────────────────────────────────────────────────
pki-init — populates named volume with CA bundle (langfuse-style pattern).
─────────────────────────────────────────────────────────────────────────

## `internal:`

Both `internal` and `coolify` alias the external coolify network — avoid
per-stack bridges (Docker default address pool exhaustion).

## `environment:`

Živý fetch místo kopie zapečeného bundle: měřeno 2026-07-28 nese
config/pki/aisha-ca-bundle.pem "CN=AISHA Root CA, O=Evymo", zatímco
bridge servíruje "CN=<instance> Root CA" — JINÁ autorita, takže
kontejner hlásil healthy a nevěřil ničemu, co instance podepisuje.
Realmová CA vzniká při 1. bootu z náhodného klíče ⇒ zapečená kopie
nemůže sedět na žádné živé instanci. assemble-ca-bundle.sh ten fallback
2026-07-19 zrušil; tenhle `cp` ho obcházel. Parametrizace je ve skriptu:
PKI_BRIDGE_URL prázdné ⇒ veřejné kořeny + exit 0 (fork bez mesh).

## `external: true`

EXTERNAL: síť zakládá warmup aplikace (docker-compose.coolify-netinit.yml)
na každém hostu PŘED vlnami a cold-start ji po rolloutu smaže. Kdyby ji
compose VLASTNIL, pokusil by se ji při teardownu smazat — a když na ní visí
kontejner jiného projektu, spadne celé nasazení (naměřeno 2026-08-11 na
aisha-clamav: "network ... has active endpoints").

## `external: true`

EXTERNAL — zakládá ji táž warmup aplikace, se subnetem z MESH_DNS_SUBNET
(mesh-router si na téhle síti pinuje ipv4_address, takže rozsah musí být
náš, ne náhodný z Dockeru).

### Pojistka na prázdné tajemství stojí ve startovacím skriptu

`${SECRET:?}` v `environment:` je požadavek na PARSOVÁNÍ, a Coolify parsuje
compose dvakrát — při buildu (jen s `build-time.env`) a při spuštění. Aby
build neumřel, musí takové tajemství nést `is_buildtime=true`, což znamená
`--build-arg` a zápis do `docker history` napořád. Pojistka se tak platila
trvale vystaveným heslem.

Otázku „dorazila hodnota?" dnes zodpovídá `scripts/coolify-sync-envs.sh`
zpětným čtením po zápisu. Zbylé riziko — kontejner dostane prázdno odjinud —
řeší test na začátku startovacího skriptu, tedy u SPOTŘEBY, kde se z hodnoty
stává účet. Podrobné odůvodnění: `docker-compose.coolify-shared-redis.yml.md`.

Hlídá to brána `src/tests/gates/tajemstvi-ma-pojistku-u-spotreby.gate.test.ts`
— odebrat `${VAR:?}` bez přidání pojistky u spotřeby neprojde.

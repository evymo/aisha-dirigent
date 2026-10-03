# docker-compose.coolify-ai-chat.yml — notes

Prose extracted from `docker-compose.coolify-ai-chat.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-svc-common: &svc-common`

==============================================================================
Coolify story: aisha-ai-chat (Backend — main AI orchestration service)
==============================================================================
svc-ai-chat is the AI conversation/orchestration backend. The core-stack
gateway routes /functions/v1/ai-chat (+ ai-context-composer, ai-router,
ai-generate, ai-story-consult) to http://svc-ai-chat:3011
(services/gateway/src/routes/functions.ts). Pipeline: Keycloak JWT → tier
guardrails → audited RPC conversation store → llmRouter
(OpenAI / Anthropic / Gemini / vLLM / Maestro) → Langfuse trace.

WHY A SIBLING STACK (not the core compose):
  The core docker-compose.coolify.yml is at the ARG_MAX ceiling the
  coolify-compose-compliance gate enforces (≈35 KB / 9 build blocks — both
  maxed on main). The canonical fix for a new service is to extract it to a
  sibling compose (precedent: coolify-exec.yml svc-agent-runner,
  coolify-openclaw.yml), NOT to grow core. svc-ai-chat lives next to the
  core stack on the same host and reaches it over the shared `coolify`
  network by container name (aisha-db / aisha-redis / aisha-postgrest).

The `svc-ai-chat` network alias makes the gateway's existing
http://svc-ai-chat:3011 resolve cross-stack with no gateway change.
Internal-only: NO public domain, NO Traefik labels — only the in-cluster core
gateway (@aisha/gateway) calls it.

The PUBLIC "AISHA as a model" face (ask.<public_tld>/v1 — the IDE
ANTHROPIC_BASE_URL surface) is NOT served here: svc-ai-chat is an internal
service and must NOT carry its own public Traefik router / Let's-Encrypt cert
(public TLS terminates upstream at pfSense/HAProxy; the internal-TLD backend
cert is per-host). Per docs/planning/AISHA_OMNI_GATEWAY.md §3, the public /v1
edge is @aisha/gateway (services/gateway) via a STREAMING /v1 proxy
(routes/v1.ts, @fastify/http-proxy — never the buffering functions.ts pattern),
which reaches this service at svc-ai-chat:3011/v1/* over the shared network —
exactly like /functions/v1/ai-chat. PAT auth (Bearer mcp_<token>) is validated
by the Omni facade itself (validate_mcp_token); the gateway does not re-gate /v1.
==============================================================================

## `pki-init:`

─────────────────────────────────────────────────────────────────────────
pki-init — populates the per-stack volume with the internal CA bundle
(mirrors the openclaw / source-broker opt-in stack pattern).
─────────────────────────────────────────────────────────────────────────

## `svc-ai-chat:`

─────────────────────────────────────────────────────────────────────────
svc-ai-chat — Fastify orchestration service. @aisha/* deps resolve from
monorepo workspaces during build, matching svc-mcp-knowledge.
No private DB schema: reads/writes the public schema through PostgREST with
the service-role token (audited RPCs), like svc-mcp-knowledge.
─────────────────────────────────────────────────────────────────────────

## `POSTGREST_URL: ${POSTGREST_URL:-http://aisha-postgrest:3000}`

── Core data plane (cross-stack via container_name on shared network) ──

## `SVC_MCP_KNOWLEDGE_URL: ${SVC_MCP_KNOWLEDGE_URL:-http://aisha-svc-mcp-knowledge:3017}`

── MCP tool execution (PR-B — RFC 8693 token mediation) ────────────────
svc-mcp-knowledge (core stack) reached cross-stack by container_name on the
shared `coolify` network — same convention as POSTGREST_URL → aisha-postgrest.

## `JWT_SECRET: ${JWT_SECRET:?required — generate-secrets.mjs emits it + coolify-sync-envs.sh bulk-pushes (mandatory cold-start step); mints the PR-B MCP user-scoped token}`

Mints the short-lived USER-scoped token forwarded to the MCP server (sub=user_id,
role=authenticated — NEVER service_role); MUST equal the secret PostgREST +
svc-mcp-knowledge validate with. generate-secrets.mjs emits it + coolify-sync-envs.sh
bulk-pushes it — same mandatory cold-start path as POSTGREST_SERVICE_TOKEN above
(required, never silently-empty: a missing signing secret must fail the deploy loudly).

## `KEYCLOAK_URL: http://aisha-keycloak:80`

── Identity (Keycloak) ─────────────────────────────────────────────────

## `OPENAI_API_KEY: ${OPENAI_API_KEY:-}`

── LLM providers (BYO external keys; empty = provider not in rotation) ──

## `VLLM_GENERATION_URL: ${VLLM_GENERATION_URL:-}`

── Local LLM backends (experimental Qwen node) — parametric, no rebuild ─

Adresu vydává resolver jen instanci, která má svc-model provisionovaný
(`config/services.json` → `model.provision_when_env: CHAT_GGUF_URL`). Prázdná
hodnota tedy znamená „tahle instance lokální model nemá", ne chybu doručení.

## `INTERNAL_TLD: ${INTERNAL_TLD:?zóna instance — bez ní vLLM backend odmítne odvozenou http adresu modelu}`

⛔ NAMĚŘENO 2026-09-13: OpenAI-kompat backend (`@aisha/llm-dispatch`,
`assertSafeUrl`) pouštěl `http://` jen na localhost, takže odvozená adresa
`http://<prefix>-model.<zóna>:8000/v1` spadla na SSRF výjimce DŘÍV, než odešel
jediný požadavek — discovery lokální model nikdy neviděl. Guard teď pouští
`http://` jen do zón, které instance VLASTNÍ (INTERNAL_TLD, MESH_TLD). Obě
proměnné se DORUČUJÍ (`:?`) a nedosazují: u allowlistu by dosazená hodnota
rozšířila důvěru o cizí zónu, chybějící nepovolí nic navíc (fail-closed).

## `LANGFUSE_HOST: ${LANGFUSE_HOST:-}`

── Langfuse trace dual-write (empty = ai_trace_events only, no Langfuse) ─
The tracer (chat route) dual-writes spans here; svc-ai-chat lacked these so
even traced calls never reached Langfuse. Reflection's runtime traces land in
ai_trace_events; their Langfuse mirror needs the orchestrator-tracer follow-up.

## `RAGNAROK_URL: ${RAGNAROK_URL:-}`

── Insight stack (optional retrieval/dialog) — URLs only; add the API
   keys via Coolify env when wiring Ragnarok/Maestro to this tenant.

## `N8N_BASE_URL: ${N8N_BASE_URL:-}`

── n8n (Dirigent) + RabbitMQ pipeline queue — lazy/optional ────────────

## `FLOWBOARD_CALLBACK_BASE_URL: ${FLOWBOARD_CALLBACK_BASE_URL:-}`

Flowboard n8n per-node provenance: the URL n8n POSTs the finished execution
back to (/flowboard-n8n-callback → automation_step entries). Derived from the
topology (derive-domains FLOWBOARD_CALLBACK_BASE_URL=http://svc-ai-chat:3011 via
the ai-chat internal_url alias) — NOT a hardcoded passthrough, which is what
drifted in the AGENT_RUNNER_URL bug. Empty ⇒ n8n runs record the flow_run
umbrella but NO per-node provenance; flowboard-run logs that loudly.

## `OPENCLAW_URL: ${OPENCLAW_URL:-}`

── OpenClaw (agent-mesh executor) — internal cross-stack URL from the topology
   (derive-domains OPENCLAW_URL=http://aisha-openclaw:5210), the shared service
   bearer (same OPENCLAW_API_KEY both sides), and the enable flag. The openclaw
   adapter self-registers is_enabled when all three resolve (adapters.ts
   isAvailable + selfRegister — DERIVED from real reachability, not a seed flip).

## `OPENCLAW_API_KEY: ${OPENCLAW_API_KEY:?minted by generate-secrets and pushed by coolify-sync; empty is a delivery bug}`

:? fail-fast (like sibling OPENCLAW_DB_PASSWORD/OIDC_SECRET): generate-secrets
mints this and coolify-sync pushes every compose-referenced key, so an empty
value is a DELIVERY bug to surface — not an optional state. OpenClaw's
optionality is carried by OPENCLAW_URL (empty when undeployed → adapter self-disables).

## `CORS_ALLOWLIST: ${CORS_ALLOWLIST:-}`

── OWASP guardrails (A05 CORS, A10 SSRF allowlist, A04 rate limit) ─────

## `SSRF_HOST_ALLOWLIST: ${SSRF_HOST_ALLOWLIST:-api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,aisha-openclaw}`

aisha-openclaw added: the agent-mesh executor is an INTERNAL cross-stack callee
(http://aisha-openclaw:5210); the SSRF guard must allow it like the LLM gateway.

## `aliases:`

Gateway (core stack) reaches us at http://svc-ai-chat:3011 unchanged.

## `labels:`

Internal-only: NO Traefik labels. The public "AISHA as a model" face
(ask.<public_tld>/v1) is served by @aisha/gateway's streaming /v1 proxy
(services/gateway/src/routes/v1.ts) which reaches us at svc-ai-chat:3011
over the shared network — svc-ai-chat carries no public router/cert.

## `svc-aitg-probes:`

==============================================================================
AITG runtime probe plane (svc-aitg-probes, :3041)
==============================================================================
Nine OWASP AI Testing Guide runtime probes (prompt-injection,
indirect-injection, data-leak, hallucinations, toxic-output, unsafe-output,
model-extraction, embedding-manipulation, content-bias).

WHY IT WAS MISSING: the service, its routes, its callers and its docs all
landed — but no compose file ever referenced it and it had no Dockerfile, so
nothing built or ran it. Three n8n loops (WF_AITG_CONTINUOUS,
WF_AITG_NIGHTLY_FULL, WF_AITG_RUNTIME_SENTINEL), the MCP tool `aitg_run_test`
(svc-mcp-knowledge/src/config.ts:52) and docs/catalog/index.md all pointed at
http://svc-aitg-probes:3041 — into the void. The
service-deployment-coverage gate now makes that state impossible to re-enter.

WHY THIS STACK (not core, not its own): probes dispatch EVERY LLM call through
svc-ai-chat (services/svc-aitg-probes/src/lib/llmDispatch.ts) so the router /
cost ledger / Langfuse trace path is shared with production traffic — that is
the probes' only hard runtime dependency besides PostgREST. Core compose is at
the ARG_MAX ceiling the coolify-compose-compliance gate enforces, so growing it
is not an option; a sibling stack of its own would need a new Coolify app plus
a coolify/manifests/aisha.manifest entry. Living here costs zero registration:
`app: ai-chat:backend:docker-compose.coolify-ai-chat.yml` already exists and
scripts/aisha-changed-apps.mjs rule 1 maps any change in this file onto it.

TRADE-OFF WORTH KNOWING: probes and the service they probe now share a deploy
unit, so a redeploy restarts both. Acceptable while the probes are pull-driven
(n8n / MCP call them); if they ever become the health oracle FOR svc-ai-chat,
split them into their own stack — the alias below is the only coupling that
would need to move.

## `AI_CHAT_SERVICE_TOKEN: ${POSTGREST_SERVICE_TOKEN:?same service-role secret svc-ai-chat compares against — see compose notes}`

Deliberately the SAME secret, not a new one. svc-ai-chat's service-plane guard
is `verifyServiceRole(authHeader, config.postgrestServiceToken)`
(services/svc-ai-chat/src/auth.ts) — a constant-time compare against
POSTGREST_SERVICE_TOKEN. Minting a separate AITG token would authenticate
against nothing. The service reads it under its own name
(AI_CHAT_SERVICE_TOKEN, services/svc-aitg-probes/src/config.ts:12), so the
mapping happens here rather than in code.

KNOWN GAP, NOT FIXED BY THIS ENTRY: llmDispatch.ts POSTs to svc-ai-chat
`/chat`, which authenticates via createJwtVerifier — Keycloak RS256 only,
`sub` required. A shared-secret token cannot verify there, so probe dispatch
401s regardless of what this variable holds. The service-plane door is
`POST /generate` (services/svc-ai-chat/src/routes/generate.ts:134,
verifyServiceRole). Switching planes also changes model selection — /generate
routes through the `route_task` RPC rather than honouring the caller's model —
so it is a probe-semantics decision, tracked separately from deployment.

## `aliases:`

n8n workflows and svc-mcp-knowledge hardcode http://svc-aitg-probes:3041.
Container name is aisha-svc-aitg-probes, so without this explicit alias the
cross-stack DNS name those callers use would not resolve. Same mechanism the
`svc-ai-chat` alias above provides for the gateway.

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

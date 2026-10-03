# docker-compose.coolify-openclaw.yml — notes

Prose extracted from `docker-compose.coolify-openclaw.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `services:`

==============================================================================
Coolify story: aisha-openclaw (Backend — advisory orchestration companion)
==============================================================================
OpenClaw is AISHA's *advisory* layer: planning + sandbox + multi-channel
notify. It does NOT execute side-effects. AISHA receives plans/sandboxes
from OpenClaw and decides whether to act via n8n workflows or reflection
orchestrator. Source-of-truth invariant: ai_runs + audit_journal remain
authoritative (every OpenClaw call is audited via aisha_*_openclaw RPCs).

AGPLv3 — self-hosted as network service. Image pinned to <REGISTRY_DOMAIN>.
==============================================================================

## `openclaw-db-init:`

─────────────────────────────────────────────────────────────────────────
openclaw-db-init — provisions openclaw schema + user on shared aisha-db
─────────────────────────────────────────────────────────────────────────

## `pki-init:`

─────────────────────────────────────────────────────────────────────────
pki-init — populates volume with internal CA bundle
─────────────────────────────────────────────────────────────────────────

## `openclaw:`

─────────────────────────────────────────────────────────────────────────
openclaw — advisory daemon. Pinned image; AGPLv3 network use.
─────────────────────────────────────────────────────────────────────────

## `build:`

Build the AISHA-native advisory daemon from services/svc-openclaw.
Standalone Fastify service that orchestrates via existing AISHA
capabilities:
  /api/plan    → AISHA llm-gateway (chat completions, JSON-mode)
  /api/sandbox → JSON workflow validator (no execution)
  /api/notify  → aisha_notify_via_openclaw RPC (n8n WF_OPENCLAW_NOTIFY
                 picks from outbox every 30s for actual dispatch)
Replaces the prior placeholder image
`<REGISTRY_DOMAIN>/openclaw/openclaw:v0.3.0` which never existed on
Docker Hub (PR #196 reverted PR #192's attempt). Removed from
scripts/aisha-redeploy.mjs::KNOWN_BROKEN concurrently.

## `context: .`

Repo-root context (registry-free workspace build): the Dockerfile does
`COPY . .` + `npm run build --workspace=@aisha/svc-openclaw`, which runs
tsc inside services/svc-openclaw/ using the SERVICE's own tsconfig — the
old TS6053 (repo-root tsconfig.app.json) does not apply to the workspace
build. No VERDACCIO_TOKEN: @aisha/* resolve via npm workspace symlinks.

## `- DATABASE_URL=postgresql://openclaw_app:${OPENCLAW_DB_PASSWORD}@aisha-db:5432/postgres?schema=openclaw`

DB (schema-isolated on shared aisha-db)

## `- OPENCLAW_API_KEY=${OPENCLAW_API_KEY}`

Authn: bearer key for AISHA service-to-service calls

## `- OPENCLAW_DOMAIN=${OPENCLAW_DOMAIN}`

Public hostname

## `- AISHA_MCP_URL=https://${API_DOMAIN}/mcp`

AISHA backend ingress (numbered dependency openclaw → core). Knowledge
MCP endpoint is the core stack's RPC face; if a dedicated mcp-knowledge
service is ever added, declare it in config/services.json and let the
resolver own its domain. No MCP_KNOWLEDGE_DOMAIN override here.

## `- AISHA_LLM_GATEWAY_URL=${AISHA_LLM_GATEWAY_URL:-}`

llm-gateway — required by /api/plan (planner returns manual_review
fallback if either var is empty; degradation-safe).

## `- POSTGREST_URL=${POSTGREST_URL:-http://postgrest:3000}`

PostgREST — required by /api/notify to enqueue via
aisha_notify_via_openclaw RPC. Cross-stack reachability: aisha-core
exposes postgrest at http://postgrest:3000 inside the shared coolify
network. JWT is the service-role bearer used by all internal AISHA
services calling PostgREST.

## `- AUTH_OIDC_CLIENT_ID=${OPENCLAW_OIDC_CLIENT_ID:-openclaw}`

OIDC SSO via Keycloak

## `- OPENCLAW_TELEGRAM_TOKEN=${OPENCLAW_TELEGRAM_TOKEN:-}`

Channel tokens (opt-in; missing token = channel disabled)

## `- OPENCLAW_MAX_PARALLEL_AGENTS=${OPENCLAW_MAX_PARALLEL_AGENTS:-3}`

Safety limits

## `- NODE_EXTRA_CA_CERTS=/certs/pki/aisha-ca-bundle.pem`

PKI trust bundle (internal CA → KC + aisha-* endpoints)

## `test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:5210/health || exit 1"]`

127.0.0.1, NOT localhost: in the alpine container localhost resolves
to ::1 first while the Fastify server listens on IPv4 only — wget got
"Connection refused" on every probe and Coolify reported the service
unhealthy for weeks (FailingStreak 8000+) although /health returned ok.

## `- "coolify.managed=true"`

openclaw's PUBLIC face (COMPANION_DOMAIN) is fronted by the openclaw-auth
OAuth2 proxy (below): the companion route is AISHA's operator/testing tool and
must sit behind a Keycloak login, not just the shared OPENCLAW_API_KEY. So this
service carries NO Traefik router of its own — the proxy owns the public route.
Service-to-service callers reach it on the internal network at aisha-openclaw:5210
(OPENCLAW_URL), BYPASSING the proxy with the shared bearer — so a leaked bearer is
not usable from the internet, where the only path in is through the proxy's OAuth.

## `- "traefik.docker.network=coolify"`

openclaw sits on both `internal` and `coolify`, so it still needs the network
disambiguation label even though it exposes NO Traefik router of its own.

## `openclaw-auth:`

---------------------------------------------------------------------------
OAuth2 Proxy — OIDC auth gateway for the PUBLIC openclaw companion route.
Authenticates via Keycloak, proxies to openclaw on the internal network.
Access controlled by the 'openclaw_access' realm role (mirrors n8n-auth).
---------------------------------------------------------------------------

## `extra_hosts:`

Resolve KC public hostnames internally via the host bridge → Coolify Traefik → KC.

## `OAUTH2_PROXY_OIDC_ISSUER_URL: https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}`

OIDC split-URL: issuer for token matching, skip auto-discovery.

## `OAUTH2_PROXY_SKIP_AUTH_ROUTES: "^/health,^/\\.well-known/.*"`

Service-to-service callers reach openclaw on the INTERNAL network (bypassing this
proxy), so — unlike n8n — the public face has no API paths that need to skip OAuth.
Only the unauthenticated liveness probe + OIDC discovery are skipped; every /api/*
path on the PUBLIC route requires a Keycloak login. Kept deliberately narrow (NOT a
blanket ^/api/.*) — see the oauth2-proxy-config.gate skip-auth hygiene check.

## `- "caddy_0.handle_path.0_reverse_proxy=aisha-openclaw-auth:4180"`

Coolify also emits Caddy labels with a broken {{upstreams 4180}} template when
Caddy is the active proxy; override with a literal container DNS name + port.

## `- "traefik.http.routers.openclaw-https.rule=Host(`${COMPANION_DOMAIN}`)"`

The proxy owns COMPANION_DOMAIN at priority 99999 — outranks any Coolify
auto-generated router so the public route can never bypass the OAuth gate.

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

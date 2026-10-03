# docker-compose.coolify-realtime.yml — notes

Prose extracted from `docker-compose.coolify-realtime.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-svc-common: &svc-common`

==============================================================================
Coolify story: aisha-realtime (Backend — realtime fabric: PG LISTEN → WS)
==============================================================================
The realtime fabric powers live UI: kanban refresh, chat streams,
AgentActivityStream, and the aisha-dirigent IDE extension context feed.
  event-worker   PG NOTIFY (db_changes, realtime_broadcast, storage_events)
                 → Redis publish (+ optional webhook/n8n routing). Pure worker.
  ws-gateway     Redis subscribe → JWT-verified browser WebSockets (:3002).
  svc-ide-context  story/run/approval/audit/deploy envelopes for the IDE (:3050).

WHY A SIBLING STACK: event-worker + ws-gateway were trimmed from the core
compose in the early-Coolify argv-limit era (240488b2, c2ac47f5) and never
restored; core is now at the ARG_MAX ceiling the coolify-compose-compliance
gate enforces. Extracting to a sibling is the canonical fix (precedent:
coolify-exec.yml). Reaches the core stack by container name over the shared
`coolify` network (aisha-db / aisha-redis).

Network aliases keep the core gateway's existing in-cluster names working
(the gateway's /realtime/v1 proxy targets ws-gateway:3002 — realtime.ts).
Public WS routing, if wanted, is a Coolify SERVICE_FQDN mapping on
ws-gateway — never hand-rolled Traefik labels.
==============================================================================

## `pki-init:`

─────────────────────────────────────────────────────────────────────────
pki-init — internal CA bundle for the per-stack volume.
─────────────────────────────────────────────────────────────────────────

## `event-worker:`

─────────────────────────────────────────────────────────────────────────
event-worker — PG LISTEN → Redis publish. No HTTP port (pure worker).
DATABASE_URL is the DIRECT connection (LISTEN/NOTIFY is session-scoped, so
it must NOT go through pgbouncer's transaction pool).
─────────────────────────────────────────────────────────────────────────

## `REDIS_URL: redis://core:${REDIS_PASSWORD_CORE}@aisha-shared-redis:6379`

WS db_changes fabric — PUBLISH side. Must be the SAME instance ws-gateway
+ svc-ide-context subscribe on (Phase 1: ACL shared-redis as user `core`).
Redis pub/sub ignores the db index — instance coherence is what matters.

## `WEBHOOK_AGENT_RUNNER: ${WEBHOOK_AGENT_RUNNER:-}`

Event-wake targets for the executor axes (services/event-worker/src/config.ts
maps public.agent_runs → WEBHOOK_AGENT_RUNNER, public.playwright_runs →
WEBHOOK_PLAYWRIGHT_RUNNER). Empty-safe: an unset value leaves the route
skipped, so the executor axes stay DORMANT by default. Plumbing them here is
what makes the documented activation a pure Coolify-env change (set the URL,
e.g. http://aisha-svc-agent-runner:3030/wake?token=..., + redeploy) instead of
a compose edit — without these lines a Coolify env var can never reach the
container, so the event-primary wake half was previously unactivatable.

## `ws-gateway:`

─────────────────────────────────────────────────────────────────────────
ws-gateway — Redis subscribe → JWT-verified WebSocket fan-out (:3002).
─────────────────────────────────────────────────────────────────────────

## `REDIS_URL: redis://core:${REDIS_PASSWORD_CORE}@aisha-shared-redis:6379`

WS db_changes fabric — SUBSCRIBE side. Same instance as event-worker's
PUBLISH (Phase 1: ACL shared-redis as user `core`).

## `- "traefik.http.services.ws-gateway-svc.loadbalancer.server.port=3002"`

ws-gateway serves WebSocket on :3002. Backend Traefik routes the
canonical internal host ${LIVE_DOMAIN} (live.${INTERNAL_TLD}) here; the
frontend edge-proxy fronts the public live.${PUBLIC_TLD} (@live block).
WS upgrade is native in Traefik. Manual router (priority 200 + explicit
loadbalancer.server.port=3002) per the caddy-template-upstreams
convention for non-standard ports — same shape as n8n-auth.

## `svc-ide-context:`

─────────────────────────────────────────────────────────────────────────
svc-ide-context — IDE context envelopes for the aisha-dirigent extension.
─────────────────────────────────────────────────────────────────────────

## `AISHA_SHARED_REDIS_URL: redis://core:${REDIS_PASSWORD_CORE}@aisha-shared-redis:6379`

@aisha/cache-redis contract — ACL shared-redis as user `core` (Phase 1).
Same INSTANCE as the WS db_changes fabric (event-worker PUBLISH /
ws-gateway SUBSCRIBE) so the DB-3 subscriber here sees those events
(Redis pub/sub is instance-scoped, db-index-agnostic). The package
parses the inline userinfo (user `core` + password) — see client.ts.

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

## `cap_add:`

⛔ ROUTA DO MESH — BEZ NÍ JE PŘELOŽENÉ JMÉNO K NIČEMU (naměřeno 2026-09-06).
`dns:` výš dá kontejneru resolver, ten vrátí adresu peeru ze 100.64.0.0/10 —
jenže výchozí brána kontejneru ten rozsah nezná, takže spojení jde do prázdna.
Změřeno na Talosu na kontejneru `web`, který resolver má a routu ne:
    getent hosts <prefix>-postgrest.mesh.<mesh_tld> → <mesh IP peeru>   (přeloží)
    nc -z <mesh IP peeru> 3000       → NEDOSAZITELNE     (nespojí)
Resolver bez routy je proto HORŠÍ než nic: EAI_AGAIN selže hned, kdežto
nedosažitelná adresa visí na timeoutu. Obě půlky musí přijít naráz.

⛔ VLOŽENO DOSLOVA z infra/mesh/mesh-client-route.sh — NEUPRAVUJ TADY.
Bind mount z repa nefunguje: Coolify staví na build serveru a na cílovém
uzlu repo není, takže Docker místo souboru vyrobí ADRESÁŘ (exit 126).
Shodu kopií s kanonickým souborem hlídá brána `mesh-lane-miri-jmenem-ne-hopem`.

## `MESH_ENABLED: ${MESH_ENABLED:?vydává topologický resolver}`

Routa do mesh potřebuje OBOJE; `:?` proto, že prázdná hodnota by znamenala
tichý start bez routy — tedy službu, která jméno přeloží a nespojí se.

## `cap_add:`

⛔ ROUTA DO MESH — BEZ NÍ JE PŘELOŽENÉ JMÉNO K NIČEMU (naměřeno 2026-09-06).
`dns:` výš dá kontejneru resolver, ten vrátí adresu peeru ze 100.64.0.0/10 —
jenže výchozí brána kontejneru ten rozsah nezná, takže spojení jde do prázdna.
Změřeno na Talosu na kontejneru `web`, který resolver má a routu ne:
    getent hosts <prefix>-postgrest.mesh.<mesh_tld> → <mesh IP peeru>   (přeloží)
    nc -z <mesh IP peeru> 3000       → NEDOSAZITELNE     (nespojí)
Resolver bez routy je proto HORŠÍ než nic: EAI_AGAIN selže hned, kdežto
nedosažitelná adresa visí na timeoutu. Obě půlky musí přijít naráz.

⛔ VLOŽENO DOSLOVA z infra/mesh/mesh-client-route.sh — NEUPRAVUJ TADY.
Bind mount z repa nefunguje: Coolify staví na build serveru a na cílovém
uzlu repo není, takže Docker místo souboru vyrobí ADRESÁŘ (exit 126).
Shodu kopií s kanonickým souborem hlídá brána `mesh-lane-miri-jmenem-ne-hopem`.

## `MESH_ENABLED: ${MESH_ENABLED:?vydává topologický resolver}`

Routa do mesh potřebuje OBOJE; `:?` proto, že prázdná hodnota by znamenala
tichý start bez routy — tedy službu, která jméno přeloží a nespojí se.

## `cap_add:`

⛔ ROUTA DO MESH — BEZ NÍ JE PŘELOŽENÉ JMÉNO K NIČEMU (naměřeno 2026-09-06).
`dns:` výš dá kontejneru resolver, ten vrátí adresu peeru ze 100.64.0.0/10 —
jenže výchozí brána kontejneru ten rozsah nezná, takže spojení jde do prázdna.
Změřeno na Talosu na kontejneru `web`, který resolver má a routu ne:
    getent hosts <prefix>-postgrest.mesh.<mesh_tld> → <mesh IP peeru>   (přeloží)
    nc -z <mesh IP peeru> 3000       → NEDOSAZITELNE     (nespojí)
Resolver bez routy je proto HORŠÍ než nic: EAI_AGAIN selže hned, kdežto
nedosažitelná adresa visí na timeoutu. Obě půlky musí přijít naráz.

⛔ VLOŽENO DOSLOVA z infra/mesh/mesh-client-route.sh — NEUPRAVUJ TADY.
Bind mount z repa nefunguje: Coolify staví na build serveru a na cílovém
uzlu repo není, takže Docker místo souboru vyrobí ADRESÁŘ (exit 126).
Shodu kopií s kanonickým souborem hlídá brána `mesh-lane-miri-jmenem-ne-hopem`.

## `MESH_ENABLED: ${MESH_ENABLED:?vydává topologický resolver}`

Routa do mesh potřebuje OBOJE; `:?` proto, že prázdná hodnota by znamenala
tichý start bez routy — tedy službu, která jméno přeloží a nespojí se.

## `GATEWAY_TRUSTED_PROXIES: ${GATEWAY_TRUSTED_PROXIES:-}`

TÝŽ seznam, jaký dostává gateway — jeden zdroj (`lib/derive-subnets.mjs`).
Bez něj Caddy `x-forwarded-for` přepíše a klientská adresa se ztratí.

## event-worker: `STORAGE_AUTH_URL` + `POSTGREST_SERVICE_TOKEN` (2026-09-21)

`worker.ts` přeposílá kanál `storage_events` na interní routu skenu pod podmínkou
`if (channel === 'storage_events' && config.storageAuthUrl)` a k té routě se
prokazuje `POSTGREST_SERVICE_TOKEN`. Ani jedno tu do 2026-09-21 nebylo.

**Naměřeno na instanci `<fork>`:** event-worker měl v prostředí jen
`DATABASE_URL`, `REDIS_URL` a `POSTGREST_URL`; kanál `storage_events` poslouchal
(„Listening on PG channel"), ale přeposlání na sken nemohlo vystřelit ani kdyby
událost přišla. Kód, který vypadá zapojeně a není, je horší než chybějící kód:
nikdo ho nehledá.

Obě hodnoty jsou proto **fail-loud** (`:?`), ne fallbacky — `STORAGE_AUTH_URL`
vydává `derive-domains` z katalogu (`internal_endpoints.env_aliases`),
`POSTGREST_SERVICE_TOKEN` vydává `generate-secrets` a doručuje `coolify-sync-envs`.

Pozn.: hlavní spouštěč skenu je dnes **ohlášení klienta** (`POST /upload-complete`
ve storage-authu), které objekt z karantény oskenuje a promuje. Tahle cesta je
druhá, pro objekty, které by do karantény dopadly jinudy (např. kdyby se někdy
zapnuly notifikace MinIO). Co sken skutečně spouští, hlídá brána
`nahravka-se-opravdu-oskenuje`.

# docker-compose.coolify-playwright.yml — notes

Prose extracted from `docker-compose.coolify-playwright.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-pw-healthcheck: &pw-healthcheck`

============================================================================
Sibling compose: Playwright runner (E2E against deployed environments)
============================================================================
Lives outside docker-compose.coolify.yml to keep the core compose under the
Coolify ARG_MAX safe limit (same precedent as coolify-monitoring.yml /
coolify-netbird.yml / coolify-exec.yml).

Bring up: docker compose -f docker-compose.coolify.yml \
                           -f docker-compose.coolify-playwright.yml up -d

Pulls work from playwright_runs via get_next_playwright_run RPC, runs the
spec suite with Chromium (bundled in the upstream Microsoft image) against
the row's target_base_url, uploads HTML + JSON report to `e2e-reports`
bucket, then records counts via record_playwright_result RPC.

No HTTP listener — pure polling worker (same OWASP shape as event-worker).
Pre-built upstream image (no build: block); runner.js + e2e/ bind-mounted
so updates ship with `git push` rather than image rebuild. Pin must match
the @playwright/test version in services/svc-playwright-runner/package.json.
============================================================================

## `environment:`

NOTE: no depends_on — db, postgrest, migrate live in
docker-compose.coolify.yml (aisha-core stack), not this compose.
Docker Compose's depends_on only resolves within the SAME compose
file; cross-compose ordering is handled by Coolify wave deploys
(manifest puts svc-playwright-runner in Wave 6+, after aisha-core
in Wave 2). Runtime retry-on-connect handles transient unreadiness.

## `test:`

Pure worker — health = heartbeat file last touched < 2× poll interval.

## `internal:`

`external: true` with no `name` makes compose look for a network literally called
`internal`, which exists on no server (verified giah/talos/varra: 0). Alias the coolify
network like the other 21 stacks — a docker network is per-HOST, and coolify is the one
Coolify itself guarantees everywhere.

## `AISHA_GATEWAY_URL: ${AISHA_GATEWAY_URL:?vydává derive-domains z config/services.json (internal_url služby gateway) — nehádat hostname}`

Bere se TOPOLOGICKÝ primitiv, ne vlastní jméno.

⛔ NAMĚŘENO 2026-08-12 doktorem (fáze D): tady stál tvrdý požadavek na
AISHA_GATEWAY_INTERNAL_URL — klíč, který měl JEDINÉHO výrobce
(jméno se tu schválně píše BEZ dolaru a složených závorek: brána
 env-doctor-contract-coverage čte compose jako text, takže by odkaz
 v komentáři počítala jako živý a žádala jeho registraci)
(řádek heredocu v aisha-cold-start.sh) a JEDINÉHO spotřebitele (tenhle
soubor), a nebyl v kontraktu env-doktora. Důsledky dva:
  • preflight compose padal nad každým čerstvě vygenerovaným .env.coolify,
    takže cold-start by spadl ve Step 2b — NOT READY;
  • klíč doručovaný jen heredocem cold-startu je pro UŽ ZALOŽENOU
    instalaci nedoručitelný (coolify-sync-envs posílá průnik
    .env.coolify ∩ compose) — táž třída jako AISHA_DB_IMAGE.
Navíc to byl TŘETÍ domov téže hodnoty s JINÝM obsahem: heredoc hádal
http://${APP_NAME_PREFIX}-gateway:3001, kdežto topologie vydává
skutečné interní URL z config/services.json.

AISHA_GATEWAY_URL (i jeho alias GATEWAY_URL) emituje derive-domains
jako `<ID>_URL` primitiv a v .env.coolify JE. Jeden domov, žádné hádání.

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

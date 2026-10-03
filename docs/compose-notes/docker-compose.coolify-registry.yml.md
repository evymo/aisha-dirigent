# docker-compose.coolify-registry.yml — notes

Prose extracted from `docker-compose.coolify-registry.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `services:`

=============================================================================
docker-compose.coolify-registry.yml — Pull-through Docker registry cache
=============================================================================

Účel: vyhnout se Docker Hub anonymous rate-limitu (100 pull / 6h / IP).
Fallback ke všem Docker Hub imagům proxujeme přes lokální registry:2
v `proxy` módu — první pull jde z hub.docker.io, další z cache (TTL = forever).

Adresa: https://${REGISTRY_DOMAIN}

Použití v compose souborech:
  image: <REGISTRY_DOMAIN>/library/alpine:3.20      (místo docker.io/library/alpine)
  image: ${IMAGE_N8N}          (místo n8nio/n8n)

Mazání jednotlivých tagů: scripts/registry-cache.mjs rm <repo>:<tag>
Garbage collect (free space):  scripts/registry-cache.mjs gc

CHICKEN-EGG NOTE: registry:2 image SAMOTNÝ se pulluje přímo z Docker Huba
(1 pull při prvním cold-startu). Po tom všechno ostatní jde přes tento cache.
=============================================================================

## `REGISTRY_PROXY_REMOTEURL: "https://registry-1.docker.io"`

Pull-through cache mode → forwards unknown manifests/blobs to Docker Hub.

## `REGISTRY_PROXY_USERNAME: ${REGISTRY_PROXY_USERNAME:-}`

Anonymní pull (auth = ${REGISTRY_PROXY_USERNAME:-}/${REGISTRY_PROXY_PASSWORD:-})
Pokud máš PAT na Docker Hub, vyplň → projde se autentizovaný limit (200/6h).

## `REGISTRY_STORAGE_DELETE_ENABLED: "true"`

Povolíme DELETE manifest API (potřebné pro registry-cache rm).

## `REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY: /var/lib/registry`

Storage on-disk pod /var/lib/registry (mapováno níže).

## `REGISTRY_HTTP_ADDR: "0.0.0.0:5000"`

Health: HTTP 200 na /

## `REGISTRY_HTTP_HEADERS_X-Content-Type-Options: "[nosniff]"`

CORS pro debugging UI (žádný frontend zatím nepoužíváme).

## `internal:`

Both `internal` and `coolify` alias the external coolify network — avoid
per-stack bridges (Docker default address pool exhaustion).

## `external: true`

EXTERNAL: síť zakládá warmup aplikace (docker-compose.coolify-netinit.yml)
na každém hostu PŘED vlnami a cold-start ji po rolloutu smaže. Kdyby ji
compose VLASTNIL, pokusil by se ji při teardownu smazat — a když na ní visí
kontejner jiného projektu, spadne celé nasazení (naměřeno 2026-08-11 na
aisha-clamav: "network ... has active endpoints").

# docker-compose.coolify-pgadmin.yml — notes

Prose extracted from `docker-compose.coolify-pgadmin.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-v2-common: &v2-common`

=============================================================================
AISHA pgAdmin Stack — DB admin UI (pgadmin) + Keycloak OIDC proxy (pgadmin-auth)
=============================================================================
Deployed as a SEPARATE Coolify application (extracted VERBATIM from
docker-compose.coolify.yml 2026-07-15 to keep the core compose under the Coolify
ARG_MAX safe limit — the coolify-compose-compliance gate; the intended fix is
"move a service to a sibling compose rather than bump the cap"). Same separate-
stack pattern as the monitoring (Dozzle) sibling.

Routing is UNCHANGED from core: reachable via BOTH ${STUDIO_DOMAIN} (canonical
public, via the Frontend mesh-proxy, priority 10000) and ${STUDIO_DOMAIN_DIRECT}
(admin-only DIRECT face on the Backend Traefik, priority 200) — see
coolify-domain-doctor.mjs (pgadmin-auth → STUDIO_DOMAIN_DIRECT). Auth is Keycloak
OIDC via the studio-proxy client; only the `studio_access` group may enter.

pgadmin connects to the core `db` over the shared external `internal` network
(db:5432) — NO cross-stack depends_on (db lives in the core stack); servers.json
only pre-registers the connection, pgadmin does not need db healthy at boot.

Required Coolify env vars:
  IMAGE_PGADMIN, PGADMIN_EMAIL, PGADMIN_PASSWORD  — pgadmin bootstrap
  STUDIO_OIDC_SECRET, STUDIO_COOKIE_SECRET        — oauth2-proxy studio client
  STUDIO_DOMAIN, STUDIO_DOMAIN_DIRECT             — public + direct admin hostnames
  KEYCLOAK_DOMAIN / KEYCLOAK_DOMAIN_PUBLIC / KEYCLOAK_REALM
  OAUTH2_COOKIE_DOMAINS, OAUTH2_WHITELIST_DOMAINS

Coolify docker_compose_domains:
  ${STUDIO_DOMAIN} → pgadmin-auth:4180
=============================================================================

## `pgadmin:`

── pgAdmin — PostgreSQL admin UI (behind the pgadmin-auth OIDC proxy) ─────

## `OAUTH2_PROXY_COOKIE_DOMAINS: ${OAUTH2_COOKIE_DOMAINS}`

Multi-zone cookie support: service is reachable via both
<STUDIO_DOMAIN> (canonical public, via Frontend mesh-proxy) and
<STUDIO_DOMAIN_DIRECT> (direct on Backend Traefik). OAuth2 Proxy v7 picks the
longest-suffix-matching cookie domain per request host.

## `OAUTH2_PROXY_REDIRECT_URL: https://${STUDIO_DOMAIN}/oauth2/callback`

Canonical OAuth callback = public db.aisha.guru.

## `- "caddy_0.handle_path.0_reverse_proxy=pgadmin-auth:4180"`

Frontend proxy = Traefik (Coolify auto-gen Caddy `{{upstreams 4180}}` doesn't
resolve for non-primary services with explicit ports). Explicit high-priority
Traefik routers + Caddy-override fallback in case the proxy type ever changes.

## `internal:`

`internal` and `coolify` both alias the external coolify network — services
avoid creating per-stack bridges (Docker default address pool exhaustion).
NAME MUST BE `coolify`: a docker network is per-HOST. `aisha_internal` was never
created by anything, on any server (verified: giah/talos/varra all report 0), so
`external: true` on it made every `docker compose up` fail with
  Error: network aisha_internal declared as external, but could not be found
21 of 23 stacks already alias `coolify`; this is the convention, not a preference.

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

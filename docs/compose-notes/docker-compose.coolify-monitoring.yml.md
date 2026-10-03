# docker-compose.coolify-monitoring.yml — notes

Prose extracted from `docker-compose.coolify-monitoring.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-v2-common: &v2-common`

=============================================================================
AISHA Monitoring Stack — Dozzle log viewer
=============================================================================
Deployed as a SEPARATE Coolify application on Frontend.
Must be on the same host as the main aisha-core stack to access Docker socket.

Why separate from docker-compose.coolify.yml:
  Dozzle requires /var/run/docker.sock with read permissions.
  If Docker socket is not accessible (permissions, path), Dozzle crashes.
  Keeping it separate prevents monitoring from blocking core stack deploys.

Required Coolify env vars:
  STUDIO_OIDC_SECRET     — Keycloak client secret for studio-proxy client
  STUDIO_COOKIE_SECRET   — 32-byte random cookie secret for oauth2-proxy
  DOZZLE_DOMAIN          — public hostname for the dozzle UI (required)
  KEYCLOAK_DOMAIN        — public hostname for Keycloak (required)

Coolify docker_compose_domains:
  ${DOZZLE_DOMAIN} → dozzle-auth:4181
=============================================================================

## `dozzle:`

── Dozzle — real-time Docker log viewer ────────────────────────────────
Accessible at https://${DOZZLE_DOMAIN} (via Traefik + dozzle-auth below).
Protected by Keycloak OIDC through dozzle-auth proxy.
Shows logs for ALL containers on this host — filter in UI by service name.

## `test: ["CMD", "/dozzle", "healthcheck"]`

CMD, not CMD-SHELL: dozzle ships as a distroless image with NO /bin/sh, so a
CMD-SHELL probe can never run — it fails with
  OCI runtime exec failed: exec: "/bin/sh": stat /bin/sh: no such file or directory
(observed in prod: FailingStreak 14 while dozzle was serving happily on :8080).
The container was healthy the whole time; only its probe was impossible, so the
deploy wave reported "aisha-monitoring exited:unhealthy" and gated later waves on it.
dozzle ships its own probe binary — verified in prod: `/dozzle healthcheck` logs
"performing healthcheck" against http://0.0.0.0:8080/healthcheck.

## `extra_hosts:`

Resolve KC public hostnames internally via host bridge → Coolify
Traefik → KC. Stays on host, no pfSense round-trip.

## `- "coolify.managed=true"`

Memory: feedback_coolify_label_dollar_escape.md — Coolify always
escapes $ → $$ in label values. DOZZLE_DOMAIN is set as a constant
in config/domains.env.

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

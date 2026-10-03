# docker-compose.coolify.netseg.yml — notes

Prose extracted from `docker-compose.coolify.netseg.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `services:`

=============================================================================
docker-compose.coolify.netseg.yml — Phase 12 WP 3.4
=============================================================================

Docker network segmentation overlay for defense-in-depth.

Threat model (per `docs/security/DOCKER_NETSEG_RUNBOOK.md`):
  - Current AISHA topology is a single flat `coolify` network. Any
    compromised microservice (e.g. svc-plugin-system running untrusted
    plugin code in a kata-isolated container) can theoretically reach
    Postgres directly via TCP.
  - WP 3.3 ships mTLS for the gateway↔backend hop, but lateral movement
    between services on the same Docker network is NOT covered by mTLS
    (each pair would need its own mTLS cert exchange).
  - Network segmentation provides the missing defense-in-depth: even
    with mTLS bypassed or misconfigured, a compromised service in
    `backend-net` cannot reach Postgres directly because Postgres is
    only reachable on `data-net`.

Three zones (matching plan §-1.12 §3.4):
  1. `aisha-frontend-net` — gateway, oauth2-proxy, public-facing edge
  2. `aisha-backend-net`  — svc-* microservices, internal APIs
  3. `aisha-data-net`     — Postgres, pgbouncer, Redis, langfuse-db

Rollout strategy (additive, NOT destructive):
  - This file is an OVERLAY. The existing `coolify` flat network stays
    intact so all current stacks keep working.
  - The 3 segmented networks are pre-created by
    `scripts/infra/create-netseg.sh` (idempotent — safe to re-run).
  - High-risk services migrate to the segmented zones one at a time.
    WP 3.4 starts with svc-plugin-system (highest blast radius if
    compromised). Subsequent WPs migrate the rest.

To deploy:
  1. SSH ops account to Coolify host: `bash scripts/infra/create-netseg.sh`
  2. Coolify dashboard → svc-plugin-system stack → set "Compose Files"
     to include both docker-compose.coolify.yml AND THIS file.
     Coolify v4 supports multi-file compose via `-f` chaining.
  3. Redeploy svc-plugin-system stack.
  4. Verify: `docker inspect aisha-svc-plugin-system | jq
     '.[0].NetworkSettings.Networks | keys'` should include
     `aisha-backend-net` and `coolify` but NOT `aisha-data-net`.

Per `feedback_no_workarounds_rewrite_dont_remove`:
  svc-plugin-system stays on the original `coolify` network too —
  removing that membership would break it from reaching the rest of
  the stack mid-migration. The win is that it ALSO joins
  `aisha-backend-net`, which means future zone-aware services
  (e.g. Postgres exposed ONLY on aisha-data-net) become unreachable
  to it. This is the "additive defense" pattern.

## `svc-plugin-system:`

---------------------------------------------------------------------------
Phase 12 WP 3.4 — restrict svc-plugin-system to backend-net (additive).

svc-plugin-system is the HIGHEST-RISK service in the stack because it
executes plugin code (Kata-isolated VM-grade containers, but still
the largest blast radius if escape is achieved). Restricting its
network reachability is the maximum-value first migration.

The merge with docker-compose.coolify.yml preserves the original
`coolify` membership; this overlay ADDS aisha-backend-net so future
data-net-only services are reachable only via the existing
`coolify` network's IP routing — providing a clear migration path
to eventually drop the `coolify` membership once all dependencies
are migrated.
---------------------------------------------------------------------------

## `- "traefik.docker.network=coolify"`

Service is on 2 networks (internal + aisha-backend-net). Traefik
needs an explicit hint about which network to use for upstream
routing — without it the auto-discovery picks the wrong network
and routing 503s (per coolify-compose-compliance gate).

## `test:`

Re-declared from docker-compose.coolify.yml so this overlay is
self-contained when consumed in isolation (gate scans each compose
file separately and can't see the compose-chain inheritance).
MUST stay in sync with the parent file's healthcheck.

## `internal:`

`internal` aliases the external `coolify` network — same convention
as docker-compose.coolify.yml top-level. Declared here too so this
overlay is self-contained when consumed with -f chaining (the
silent-drop detector inspects each compose file in isolation).

## `aisha-frontend-net:`

Pre-created via `scripts/infra/create-netseg.sh` — external: true so
the lifecycle is operator-owned, not per-deployment. This keeps the
network alive across stack redeploys and shared with other stacks
that opt into segmentation.

## `external: true`

EXTERNAL: síť zakládá warmup aplikace (docker-compose.coolify-netinit.yml)
na každém hostu PŘED vlnami a cold-start ji po rolloutu smaže. Kdyby ji
compose VLASTNIL, pokusil by se ji při teardownu smazat — a když na ní visí
kontejner jiného projektu, spadne celé nasazení (naměřeno 2026-08-11 na
aisha-clamav: "network ... has active endpoints").

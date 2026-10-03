# docker-compose.coolify-shared.yml — notes

Prose extracted from `docker-compose.coolify-shared.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-shared-common: &shared-common`

=============================================================================
docker-compose.coolify-shared.yml — Sdílená infrastruktura (MinIO)
=============================================================================

Multi-tenant MinIO (S3) pro celou platformu. Per-app izolace přes
MinIO IAM users + bucket-scoped policies.

Container aliasy (aisha-network):
  - aisha-shared-minio:9000  (S3 API)
  - aisha-shared-minio:9001  (Console — internal only)

Konzumenti (aisha-core, aisha-langfuse) připojují přes `aisha-network`
a používají vlastní IAM credentials.

IaC: bucket/IAM definice se konfigurují přes ENV proměnné, ne ručně v UI.

── Phase 1 (2026-06-13) ─────────────────────────────────────────────────────
Shared Redis se PŘESUNUL do docker-compose.coolify-shared-redis.yml a je
zapojen do manifestu (wave 1) + na sdílené `coolify` síti s aliasem
`aisha-shared-redis`. Tento soubor (MinIO) je BUDOUCÍ fáze: stále NENÍ
v coolify/manifests/aisha.manifest, takže se nenasazuje. Síť `aisha-shared-net`
níže je proto izolovaný bridge — pro skutečné nasazení MinIO bude potřeba
stejná oprava jako u Redisu (external `coolify` síť + alias).
=============================================================================

## `shared-minio:`

===========================================================================
Shared MinIO — multi-tenant S3 s IAM users per app
===========================================================================

## `shared-minio-init:`

===========================================================================
Shared MinIO init — vytváří buckets + IAM users s bucket-scoped policies
Idempotentní: opakované spuštění nic nezmění.
===========================================================================

## `MC_HOST_local: http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@shared-minio:9000`

MC_HOST_<alias> — defense vůči passwords s leading `-` (mc by je
parsoval jako flag). Žádné CLI argument parsing pro credentials.

## `internal:`

Per-host bridge — služby na stejném hostu sdílejí síť přes konzistentní `name`.
Cross-host komunikace jde přes Netbird mesh DNS (<svc>.aisha.netbird).

## `external: true`

EXTERNAL: síť zakládá warmup aplikace (docker-compose.coolify-netinit.yml)
na každém hostu PŘED vlnami a cold-start ji po rolloutu smaže. Kdyby ji
compose VLASTNIL, pokusil by se ji při teardownu smazat — a když na ní visí
kontejner jiného projektu, spadne celé nasazení (naměřeno 2026-08-11 na
aisha-clamav: "network ... has active endpoints").

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

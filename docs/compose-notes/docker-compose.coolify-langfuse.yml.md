# docker-compose.coolify-langfuse.yml — notes

Prose extracted from `docker-compose.coolify-langfuse.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `pki-init:`

── PKI init: populates named volume with CA bundle from env var ──

## `test: ["CMD-SHELL", "wget --quiet --tries=1 --spider http://localhost:8123/ping || exit 1"]`

ClickHouse default user is disabled when CLICKHOUSE_USER/PASSWORD
are set (image creates the configured user, no password user is
rejected). `clickhouse-client -q 'SELECT 1'` without --user/--password
therefore fails silently → ClickHouse never reports healthy →
Langfuse depends_on never satisfied → Langfuse stays exited.
The HTTP /ping endpoint is auth-free and the recommended health
probe per ClickHouse docs.

## `container_name: aisha-langfuse-redis`

Distinct from aisha-core's redis (docker-compose.coolify.yml) which also
claims `aisha-redis` — two stacks setting the same container_name is a
latent collision (unique-per-daemon). langfuse's own services reach this
redis by the in-stack SERVICE name `redis` (REDIS_HOST=redis below), not
by container_name, so this rename is wiring-neutral.

## `test: ["CMD", "redis-cli", "ping"]`

Auth-less liveness: redis-cli ping exits 0 on ANY server reply (incl.
NOAUTH — verified) and 1 only when the server is unreachable. NEVER
interpolate the password here: parse-time ${VAR} bakes it into
Healthcheck.Test (docker inspect / Coolify UI leak) and the $$-form
breaks under Coolify (COOLIFY_COMPOSE_RULES.md §3).

## `langfuse-db-init:`

---------------------------------------------------------------------------
MinIO removed — consolidated to the single shared MinIO in aisha-core.
This stack used to ship its own `minio` service that ALSO aliased `minio`
on the shared `coolify` network, colliding with aisha-core's MinIO. Docker
DNS round-robin then routed `minio:9000` non-deterministically: loki's
compactor sometimes hit the bucket-less core MinIO → NoSuchBucket crash →
observability deploy failure. One MinIO per tenant (in aisha-core) removes
the collision and centralises object storage for maintainability.
langfuse + loki buckets (langfuse, langfuse-media, aisha-loki-chunks,
aisha-loki-ruler) are now created by aisha-core's minio-init. langfuse and
loki reach them via the same shared `coolify` network at `minio:9000`,
which now resolves deterministically to the single core MinIO.
---------------------------------------------------------------------------
langfuse-db-init — idempotently creates langfuse_app user + langfuse schema
Langfuse connects to shared aisha-db as langfuse_app with ?schema=langfuse.
Prisma needs ownership of the schema to run DDL migrations.
---------------------------------------------------------------------------

## `extra_hosts:`

Resolve KC public hostnames to host-gateway → frontend:443 → Coolify
Traefik → KC. Stays on host, no pfSense round-trip.

## `- ENCRYPTION_KEY=${LANGFUSE_ENCRYPTION_KEY}`

No fallback: empty LANGFUSE_ENCRYPTION_KEY makes langfuse fail-fast on
startup rather than silently running with all-zero encryption.

## `- AUTH_KEYCLOAK_CLIENT_ID=langfuse`

── SSO: Keycloak OIDC federation (native Keycloak provider) ──

## `- AUTH_IGNORE_ACCOUNT_FIELDS=refresh_expires_in`

Fix: KC returns refresh_expires_in which Prisma schema doesn't have

## `- NODE_EXTRA_CA_CERTS=/certs/pki/aisha-ca-bundle.pem`

── PKI trust bundle: verify Keycloak OIDC TLS via AISHA CA chain ──

## `langfuse-gateway:`

---------------------------------------------------------------------------
Caddy Gateway — CSP header rewrite for iframe embedding
Langfuse hardcodes frame-ancestors 'none' + X-Frame-Options: SAMEORIGIN.
This gateway overrides those headers to allow embedding in <APP_DOMAIN>.
Also preserves native Langfuse OIDC auth (KC SSO via AUTH_CUSTOM_* env vars).
---------------------------------------------------------------------------

## `- "coolify.managed=true"`

─────────────────────────────────────────────────────────────────
Explicit Traefik labels — same integral-design pattern as the
other public routes (KC, n8n, pgadmin, dozzle). Eliminates the
Coolify v4 silent-drop PATCH dependency for routing.

Memory: feedback_coolify_label_dollar_escape.md — Coolify always
escapes $ → $$ in label values, so use literal hostname here, never
${LANGFUSE_DOMAIN}. LANGFUSE_DOMAIN is set as a constant in config/domains.env.
─────────────────────────────────────────────────────────────────

## `- "traefik.http.services.langfuse-gateway-svc.loadbalancer.server.port=8080"`

Service: route matched traffic to langfuse-gateway's port 8080

## `- "traefik.http.routers.langfuse-gateway-https.rule=Host(`${LANGFUSE_DOMAIN}`)"`

HTTPS router: terminate TLS at Traefik, forward to gateway

## `- "traefik.http.routers.langfuse-gateway-http.rule=Host(`${LANGFUSE_DOMAIN}`)"`

HTTP→HTTPS redirect router (uses redirect-to-https middleware
defined in coolify-prebuilt.yml)

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

## `langfuse-redis:`

NENÍ to `redis` — to jméno drží core (docker-compose.coolify.yml), které si
na něj adresuje REDIS_URL. `internal` je JEDNA sdílená síť clusteru a docker
vystavuje compose service name jako alias na každou připojenou síť, takže
`redis` mělo dva vlastníky a DNS odpovídalo střídavě. Obě instance přitom
berou TOTÉŽ heslo (${REDIS_PASSWORD}), takže spojení projde bez chyby a jen
se čte cizí úložiště — vada, která se nijak neohlásí.

Svazky se neperou (aisha_redis-data × aisha_v2_redis-data), kolidovalo jen jméno.

## `test: ["CMD-SHELL", "redis-cli --no-auth-warning -a \"$$REDIS_PASSWORD\" ping | grep -q PONG"]`

redis-cli exits 0 even when the reply is an ERROR, so an unauthenticated
`ping` against a --requirepass server answers NOAUTH and the probe still
PASSES — the opposite failure to shared-redis, and worse: it reports a
server nobody can use as healthy. Authenticate and match PONG.

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

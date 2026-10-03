# docker-compose.coolify-observability.yml — notes

Prose extracted from `docker-compose.coolify-observability.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-v2-common: &v2-common`

=============================================================================
AISHA Observability Stack — Loki + Prometheus + Grafana
=============================================================================
Phase 12 WP 0.2 deliverable. Consumer side of the OTel instrumentation
shipped in WP 0.1 + WP 0.4 (21 services emit traces to Langfuse OTLP and
/metrics to Prometheus).

Architecture (rationalized per Phase 12 §-1.12):

  Loki         → stdout log aggregation from all coolify_* containers
                 Backend: existing MinIO at minio:9000 (R3 — no PVC)
                 Shipping: Loki Docker driver (R5 — no promtail container)
  Prometheus   → scrapes /metrics from 20 HTTP services + node-exporter
                 + cadvisor + postgres-exporter. Optional Thanos sidecar
                 for long-term retention → MinIO (future).
  Grafana      → unified UI over Loki + Prometheus + Langfuse trace API
                 Auth: extends existing dozzle-auth OAuth2 Proxy
                 (R6 — no new OAuth2 Proxy container).
  Dozzle       → unchanged, lives in docker-compose.coolify-monitoring.yml
                 for real-time log tail. Loki = retention + search;
                 Dozzle = live tail. Both reachable from Grafana UI.

NOT IN STACK (per Phase 12 §-1.12):
  ❌ Tempo     → Langfuse OTLP is sole traces backend (R1)
  ❌ Promtail  → Loki Docker driver does the shipping (R5)
  ❌ New OAuth2 Proxy → dozzle-auth pattern reused (R6)

Deploy: `aisha-observability` Coolify application, same host as
aisha-monitoring (Dozzle) so Docker socket access + Loki Docker driver
work. Required Coolify env vars:
  MINIO_ROOT_USER / MINIO_ROOT_PASSWORD    — for Loki S3 backend
  GRAFANA_OIDC_SECRET                       — Keycloak studio-proxy client
  GRAFANA_ADMIN_PASSWORD                    — fallback admin password
  GRAFANA_DOMAIN                            — default grafana.backend.id3a.cz

Coolify docker_compose_domains:
  grafana.backend.id3a.cz → grafana-auth:4181  (OAuth2 Proxy on port 4181)
=============================================================================

## `pki-init:`

─────────────────────────────────────────────────────────────────────────
pki-init — populate stack-local pki-certs volume with AISHA CA bundle.

CRITICAL note: Coolify scopes "external" named volumes PER-APPLICATION,
not globally. So our `pki-certs: external: true` becomes
`<obs_stack_uuid>_pki-certs` — a fresh empty volume, NOT the shared one
populated by aisha-core's pki-init. Every stack that needs the bundle
must populate ITS OWN pki-certs (langfuse, netbird, llm-gateway all do
this; obs-stack was the only stack missing it → grafana-auth crash loop
with "open /certs/pki/aisha-ca-bundle.pem: no such file or directory").

Pattern mirrors aisha-langfuse's pki-init: build with Dockerfile.pki-init
which COPYs config/pki/aisha-ca-bundle.pem from the repo at build time
(Coolify build context IS the cloned repo, unlike the runtime `configs:`
block), then cp it into the pki-certs volume mounted at /certs/pki/.
─────────────────────────────────────────────────────────────────────────

## `command: ["sh", "-c", "mkdir -p /certs/pki && cat /staging/aisha-ca-bundle.pem /etc/ssl/certs/ca-certificates.crt > /certs/pki/aisha-ca-bundle.pem && echo '[pki-init] obs-stack combined CA bundle staged' && ls -la /certs/pki/"]`

Merge AISHA root CAs with Alpine system CAs (includes LE/Mozilla roots).
Required because OAUTH2_PROXY_PROVIDER_CA_FILES replaces the system CA
pool entirely; without LE roots the TLS handshake to auth.aisha.guru
(LE wildcard cert) fails → oauth2-proxy crashloops at startup.

## `obs-config-init:`

─────────────────────────────────────────────────────────────────────────
obs-config-init — stage 3 small config files into a shared named volume.
Replaces the top-level `configs:` directive (PR #187) which Coolify v4
resolves to `/artifacts/{deploy_uuid}/` (build context staging area), not
the cloned repo path — so the file: references end up as empty paths and
loki/prometheus/postgres-exporter crashloop with
`failed parsing config: ... is a directory` / `not a directory`.

Same pattern as matrix-config-init in docker-compose.coolify-matrix.yml:
an init build pulls the repo into its image via COPY (which DOES work in
Coolify v4 because the build context is the cloned repo), then `cp`s the
files into a named volume that the consumers mount read-only. No host
bind mount at all → the v4 trap is bypassed entirely.
─────────────────────────────────────────────────────────────────────────

## `command:`

One named volume PER config file (rather than one shared volume with
subdirs) — matches the matrix-config-init shape and means each consumer
mounts the volume at its expected config directory directly. Mode 0644
is wide enough for loki (uid 10001), prometheus (nobody=65534), and
postgres-exporter (default uid 65534) to read across user IDs without
extra chown gymnastics.

## `loki:`

─────────────────────────────────────────────────────────────────────────
Loki — log aggregation, MinIO S3 backend (per §-1.12 R3)
─────────────────────────────────────────────────────────────────────────

## `volumes:`

Config arrives via obs-config-init → obs-loki-config volume mounted
read-only at /etc/loki (where -config.file=/etc/loki/loki-config.yaml
looks for it). loki-wal is a separate writable volume for the WAL.

## `- coolify`

Must reach MinIO in coolify-langfuse stack via shared coolify net

## `test: ["CMD-SHELL", "wget -q -O /dev/null http://localhost:3100/metrics || exit 1"]`

Liveness probe on /metrics, which the Loki HTTP server serves as soon
as it boots (~1s, log: "Loki started startup_time=233ms"). We
deliberately do NOT probe /ready: that endpoint returns 503 for the
first ~15-20s while the ingester observes its min_ready_duration, and
that variable warm-up raced Coolify's deploy-time wait window for
`depends_on: condition: service_healthy`, intermittently failing the
whole deploy with "container loki is unhealthy" (dependents stuck in
Created). /metrics returns 200 immediately and independently of
ingester warm-up, so Loki reports healthy deterministically inside the
wait window. Grafana (the only dependent) tolerates an ingester that is
still warming up — it just returns empty query results briefly.

## `prometheus:`

─────────────────────────────────────────────────────────────────────────
Prometheus — scrape /metrics from all services + exporters
─────────────────────────────────────────────────────────────────────────

## `volumes:`

Config arrives via obs-config-init → obs-prometheus-config volume
mounted read-only at /etc/prometheus (where --config.file expects
prometheus.yml). prometheus-data is the writable TSDB volume.

## `node-exporter:`

─────────────────────────────────────────────────────────────────────────
node-exporter — host CPU / RAM / disk / network
─────────────────────────────────────────────────────────────────────────

## `cadvisor:`

─────────────────────────────────────────────────────────────────────────
cAdvisor — container CPU / RAM / disk / network
─────────────────────────────────────────────────────────────────────────

## `image: ${IMAGE_CADVISOR}`

NOTE: cadvisor v0.40+ lives ONLY on gcr.io/cadvisor — Docker Hub's
google/cadvisor mirror was deprecated at v0.33.0. Our aisha-registry
pull-through proxy is configured for Docker Hub only, so this image
is pulled directly from gcr.io (bypasses the cache).

## `postgres-exporter:`

─────────────────────────────────────────────────────────────────────────
postgres-exporter — pg_stat_statements + pg_stat_database surfaced as
Prometheus metrics. Scrapes the main `db` Postgres in the aisha-core stack.
─────────────────────────────────────────────────────────────────────────

## `volumes:`

Config arrives via obs-config-init → obs-pg-exporter-config volume
mounted read-only at /etc/postgres-exporter (where
PG_EXPORTER_EXTEND_QUERY_PATH points). Single-file dir, no other content.

## `grafana:`

─────────────────────────────────────────────────────────────────────────
Grafana — unified UI. Auth: extends existing dozzle-auth OAuth2 Proxy
(per §-1.12 R6) by adding grafana to WHITELIST_DOMAINS env there.
─────────────────────────────────────────────────────────────────────────

## `GF_SECURITY_ALLOW_EMBEDDING: "true"`

Allow embedding in iframe (workbench Diagnostics page in future)

## `GF_AUTH_PROXY_ENABLED: "true"`

Trust X-Forwarded-* from OAuth2 Proxy (sets header → automatic login)

## `GF_AUTH_DISABLE_LOGIN_FORM: "false"  # admin/admin fallback if proxy fails`

Default org: AISHA

## `RUNBOOK_BASE_URL: ${RUNBOOK_BASE_URL:-}`

Runbook base URL for alert annotations — env-driven (no hardcoded forge
host in the provisioning YAML). Grafana expands $__env{RUNBOOK_BASE_URL}
in provisioning at load. Empty → annotation just omits the host prefix.

## `grafana-auth:`

─────────────────────────────────────────────────────────────────────────
Grafana OAuth2 Proxy — reuses pattern from dozzle-auth (per §-1.12 R6).
Same Keycloak client (`studio-proxy`), just adds grafana to
WHITELIST_DOMAINS. UI redirects through here.
─────────────────────────────────────────────────────────────────────────

## `environment:`

NO extra_hosts for auth.{aisha.guru,backend.id3a.cz}. Identical bug to
PR #206 (netbird-management): `host-gateway` resolves the Keycloak
hostname to the Docker host's IP (Backend local), which lands on Backend's
Coolify Traefik. Traefik's internal listener does NOT have an
`auth.backend.id3a.cz` router (those routes live on the public/WAN
listener path) → Traefik returns its default self-signed cert
(`CN=TRAEFIK DEFAULT CERT`), TLS verification fails, OIDC discovery
aborts at boot, container crashloops with:
  x509: certificate is valid for [hash].traefik.default, not auth.backend.id3a.cz
Letting public DNS resolve auth.backend.id3a.cz to the WAN IP (NAT
hairpin via pfSense → Backend edge listener → real LE wildcard cert)
gives a valid `*.id3a.cz` chain. Verified live via
`docker run --rm alpine openssl s_client` from a sibling container.

## `OAUTH2_PROXY_ALLOWED_GROUPS: studio_access`

AuthZ gate: restrict to the observability-tools role, exactly like the sibling
tools on the same studio-proxy client (pgadmin :94-95, dozzle). Without this
grafana was authN-only — ANY authenticated realm user could reach it on the
public GRAFANA_DOMAIN. roles claim comes from the studio-proxy realm-role mapper.

## `obs-loki-config:`

3 small named volumes — one per config file — populated by obs-config-init
before any consumer starts. Replaces the prior `configs:` block (PR #187),
which Coolify v4 silently resolved to `/artifacts/{deploy_uuid}/` (build
context staging area) instead of the cloned repo path, so the loki +
prometheus + postgres-exporter compose-up resolved to non-existent files
and the containers crashlooped with "is a directory" / "not a directory".

## `pki-certs:`

pki-certs is stack-local — populated by THIS stack's pki-init service
(see top of file). Coolify scopes named volumes per-application-uuid, so
marking `external: true` on the prior version yielded a fresh empty
volume rather than sharing aisha-core's. grafana-auth needs the bundle
to verify the Keycloak OIDC issuer TLS chain.

## `coolify:`

External coolify network — joins all other AISHA stacks (MinIO, db, services).
Created by the first stack to bring it up; subsequent stacks attach.

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

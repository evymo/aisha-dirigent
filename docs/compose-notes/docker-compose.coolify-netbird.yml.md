# docker-compose.coolify-netbird.yml — notes

Prose extracted from `docker-compose.coolify-netbird.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-netbird-common: &netbird-common`

=============================================================================
NetBird Control Plane — Zero-Trust WireGuard Mesh (Frontend, self-hosted)
=============================================================================
Components: Management (API + gRPC), Signal (P2P coordination), Dashboard (UI), Relay (TURN)

Coolify UI setup:
  - Docker Compose source: docker-compose.coolify-netbird.yml
  - docker_compose_domains: netbird-proxy → https://${NETBIRD_DOMAIN}
    (Caddy path demux owns the whole HTTP surface; gRPC rides the
    host-less PathPrefix h2c routers — see netbird-proxy service docs)
  - Environment Variables: see "Required env vars" below

Required env vars (set in Coolify):
  NETBIRD_DOMAIN          = <NETBIRD_DOMAIN>
  NETBIRD_OIDC_CLIENT_ID  = netbird
  NETBIRD_OIDC_SECRET     = <keycloak client secret for 'netbird' client>
  NETBIRD_MGMT_SECRET     = <netbird-backend client secret for user sync>
  NETBIRD_RELAY_SECRET    = <random secret shared between relay + management>
  NETBIRD_DB_PASSWORD     = <password for netbird-db postgres user>
  NETBIRD_TURN_USERNAME   = <TURN username — also set in coolify/coturn.conf>
  NETBIRD_TURN_PASSWORD   = <TURN password — also set in coolify/coturn.conf>
  TURN_REALM              = <coturn realm — same as LiveKit coturn>

Storage: self-contained postgres `netbird-db` (mini-instance v této compose).
Důvod: cross-host (frontend → backend:5432 aisha-db) nešel bez NetBird mesh, což je
chicken-and-egg na první cold-start. Vlastní DB = self-contained, malý footprint.

Mesh DNS domain: mesh.aisha.internal
After deploying, set NETBIRD_DNS_IP in Coolify to the Frontend WG interface IP
(shown in `netbird status` on the host agent).
=============================================================================

## `pki-init:`

---------------------------------------------------------------------------
pki-init — bakes AISHA CA bundle into the pki-certs volume.
---------------------------------------------------------------------------
Same pattern as docker-compose.coolify.yml#pki-init. Each Coolify stack
has its own copy of the CA bundle via a per-stack named volume.
The CA bundle is baked into Dockerfile.pki-init at /staging/ from
config/pki/aisha-ca-bundle.pem. Caddy sidecar uses it for trust chain.
---------------------------------------------------------------------------

## `command: ["/usr/local/bin/issue-netbird-mesh-cert.sh"]`

Auto-issue path (replaces 1-line CA-bundle copy):
/usr/local/bin/issue-netbird-mesh-cert.sh (baked into image) does:
  1. Copies aisha-ca-bundle.pem (existing behavior preserved)
  2. Acquires ROPC token from Keycloak via PKI_BOOTSTRAP_* creds
  3. POSTs to pki-bridge:3040/v1/issue to get AISHA-PKI-signed cert
     for $${NETBIRD_MESH_HOST} (default: netbird.mesh.aisha.internal)
  4. Writes /certs/pki/netbird-mesh/{cert,key}.pem to shared volume
  5. netbird-internal-tls reads from volume (preferred) or env (legacy)
Idempotent: skip issuance if existing cert valid for >RENEW_THRESHOLD_DAYS.
Graceful: on any failure logs warn + exits 0 → internal-tls falls back
to self-signed bootstrap (mesh agents will fail TLS verify, but stack
comes up so we can inspect logs).
Cross-server cert acquisition: frontend--netbird--pki-init runs on Frontend
but pki-bridge runs on Backend. Docker DNS doesn't resolve cross-server,
so we use pki-bridge's PUBLIC Traefik route (https://<PKI_BRIDGE_DOMAIN>).
JWT auth on /v1/issue gates access (only valid aisha-pki-bootstrap
ROPC tokens accepted). Mesh isn't an option here — NetBird's whole
purpose IS the mesh, and we're trying to issue its cert.

## `PKI_BRIDGE_URL: ${PKI_BRIDGE_URL}`

PKI_BRIDGE_URL is topology-aware (derive-domains.mjs): co-located →
http://pki-bridge:3040, split fleet → https://${PKI_BRIDGE_DOMAIN} on the
Backend Traefik. Either way it is mesh-INDEPENDENT — correct here.

## `KEYCLOAK_URL: https://${KEYCLOAK_DOMAIN_PUBLIC}`

ROPC MUST be mesh-INDEPENDENT: the global ${KEYCLOAK_URL} is the mesh-overlay
host (auth.mesh.<tld>) under MESH_ENABLED=true, which does not exist until the
mesh is up — but this very issuance is what mints the mesh cert (bootstrap
deadlock; on aisha it also DNS-search-leaks to the wrong wildcard cert → ROPC
SAN fail). Use the PUBLIC front host: valid LE cert, and KC's FIXED frontend
issuer already stamps iss=https://${KEYCLOAK_DOMAIN_PUBLIC}, so the token pki-bridge
validates matches regardless. Mirrors pki-bridge / pki-renewer (both KEYCLOAK_URL
= ${KEYCLOAK_DOMAIN_PUBLIC}); this init container was the one ROPC consumer left on mesh.

## `PKI_BOOTSTRAP_CLIENT_SECRET: ${AISHA_PKI_BOOTSTRAP_CLIENT_SECRET:-}`

AISHA_PKI_BOOTSTRAP_* is the canonical name (set by aisha-bootstrap-user-init.sh
in cold-start); script also reads PKI_BOOTSTRAP_CLIENT_SECRET as legacy
fallback. Use prefixed name here — Coolify build-time parser doesn't
support nested A-or-B default fallback expressions.

## `- "traefik.enable=false"`

No public listener — gate test enforces traefik.docker.network on
multi-network services to disambiguate Traefik routing target IF
labels are ever added (defensive). traefik.enable=false makes intent
explicit: this is a one-shot init container, not a routable service.

## `netbird-db:`

---------------------------------------------------------------------------
netbird-db — self-contained PostgreSQL pro netbird control plane state
---------------------------------------------------------------------------
Pozn.: oddělené od shared aisha-db (backend). Důvod: cross-host (frontend→backend)
vyžadovalo NetBird mesh, ale mesh není dostupný do prvního deploy mgmt =
chicken-and-egg. Self-contained postgres tady běží jen pro netbird state
(peers, groups, policies, routes); footprint je minimální (<200MB working set).
User-facing přístup k netbird je přes mgmt API (port 443) na frontend Traefik.
---------------------------------------------------------------------------

## `build:`

postgres:17-alpine + a credential-reconcile entrypoint (Dockerfile.netbird-db):
re-applies the current NETBIRD_DB_PASSWORD to an existing volume on every
start, so a rotated secret never strands the DB (mesh-down incident
2026-07-05, same class as pki-db).

## `netbird-init:`

---------------------------------------------------------------------------
netbird-init — render management.json from template via envsubst
NetBird image >= 0.30 vyžaduje /etc/netbird/management.json (CLI flags + env vars
samy nestačí). Init container vyrenderuje template do shared volume před startem.
---------------------------------------------------------------------------

## `NETBIRD_MESH_PORT: ${NETBIRD_MESH_PORT:-33073}`

Per-instance mesh host PORT — the management.json template renders Signal +
Relay as ${NETBIRD_MESH_HOST}:${NETBIRD_MESH_PORT}; envsubst has no `:-`
fallback, so this MUST be present or the port renders empty. Default 33073
(primary aisha); cold-start pushes the derived per-namespace value.

## `netbird-management:`

---------------------------------------------------------------------------
Management — gRPC + HTTP API, policy engine, peer registry
---------------------------------------------------------------------------

## `depends_on:`

OIDC discovery + IDP user sync calls go to Keycloak via the canonical
public domain (${KEYCLOAK_DOMAIN_PUBLIC} by default; tenant override via
KEYCLOAK_DOMAIN).

NOTE: ${KEYCLOAK_DOMAIN_PUBLIC} is intentionally NOT pinned in extra_hosts. The
Frontend edge Traefik (host-gateway) has NO router for ${KEYCLOAK_DOMAIN_PUBLIC}
and would serve its default self-signed cert (*.traefik.default),
breaking OIDC TLS verification (verified: GET .../.well-known returns
x509 "valid for *.traefik.default, not ${KEYCLOAK_DOMAIN_PUBLIC}"). Public DNS
resolves ${KEYCLOAK_DOMAIN_PUBLIC} to the owning peer's public IP whose Traefik
serves the real Let's Encrypt *.${PUBLIC_TLD} cert — the SAME path a user's
browser takes for OIDC login. This also covers fork-specific
${KEYCLOAK_DOMAIN} values (e.g. ${KEYCLOAK_DOMAIN}): they likewise
resolve via public DNS to the correct peer with a valid LE cert.
Management bootstraps OIDC before the mesh is up, so it cannot rely on
mesh routing anyway — public DNS is the only correct path here.

## `AUTH_CLIENT_ID: ${NETBIRD_OIDC_CLIENT_ID:-netbird}`

── OIDC (Keycloak realm 'aisha', client 'netbird') ──

## `NETBIRD_IDP_MANAGER_TYPE: keycloak`

── IDP user sync (service account 'netbird-backend') ──

## `NB_STORE_ENGINE: postgres`

── PostgreSQL backend (self-contained netbird-db, viz výše) ──
Pozn.: management binárka v netbirdio/management:0.30.x očekává `NB_*` prefix
(sjednoceno s relay/signal). Staré `NETBIRD_STORE_*` jména jsou ignorovaná.
Před bumpem na 0.31.x ověř, jestli env-var schema neopustilo NB_* (changelog).

## `NETBIRD_TURN_DOMAIN: ${NETBIRD_DOMAIN}`

Signal + Relay URIs are advertised from coolify/netbird-management.json.template.
They point at the INTERNAL mesh endpoint ($NETBIRD_MESH_HOST:33073, AISHA
cert) — the same netbird-internal-tls Caddy that already fronts Management
(it also routes /signalexchange.SignalExchange/* → netbird-signal and /relay).
This works pre-mesh-join because agents resolve $NETBIRD_MESH_HOST via a
STATIC extra_hosts entry (not mesh DNS), exactly as they already do for
Management — so the old "Signal must stay public so peers can resolve it"
premise does not apply. Keeps all mesh control-plane traffic on our own PKI
instead of the public pfSense/LE path (which mangled the Signal gRPC stream).
── TURN (reuse existing coturn) ──

## `NETBIRD_RELAY_AUTH_SECRET: ${NETBIRD_RELAY_SECRET}`

── Relay ──

## `- "traefik.http.routers.netbird-grpc.rule=PathPrefix(`/management.ManagementService`)"`

── gRPC router: HOST-LESS PathPrefix on the protobuf service FQN ──
Coolify ALWAYS escapes `$` → `$$` in label values, so Host(`${VAR}`)
renders as a literal that never matches (feedback_coolify_label_dollar_escape;
the pre-2026-06-07 literal hostnames were removed by the template-only
directive, which broke this stack's routing at the 2026-06-29 wipe).
The fix that satisfies BOTH constraints (no $-interpolation in labels,
no deployment hostnames in git): match by PathPrefix ONLY. The gRPC
path `/management.ManagementService` is the protobuf service FQN —
globally unique on this Traefik (nothing else serves it), so a
host-less high-priority router is safe and deployment-agnostic.
gRPC needs end-to-end HTTP/2, which ONLY this manual router can
express (scheme=h2c); Coolify auto-gen upstreams are HTTP/1.1.
HTTP surface (/api, /relay, dashboard) routes via the netbird-proxy
Caddy demux below (registered through docker_compose_domains).

## `- "traefik.http.routers.netbird-grpc.priority=99999"`

priority=99999 to outrank every Host()-based router (Coolify auto-gen
and the netbird-proxy catch-all) for this unique gRPC path.

## `netbird-signal:`

---------------------------------------------------------------------------
Signal — gRPC WebRTC signaling for peer-to-peer coordination
---------------------------------------------------------------------------

## `- "traefik.http.routers.netbird-signal.rule=PathPrefix(`/signalexchange.SignalExchange`)"`

Host-less PathPrefix on the protobuf FQN — same rationale as
netbird-grpc above (gRPC h2c cannot ride Coolify auto-gen, and
${VAR} in label values is dead on Coolify). Path is unique.

## `netbird-dashboard:`

---------------------------------------------------------------------------
Dashboard — NetBird Web UI (React SPA served by Nginx)
---------------------------------------------------------------------------

## `AUTH_SUPPORTED_SCOPES: "openid profile email offline_access api"`

AUTH_SUPPORTED_SCOPES — required by netbirdio/dashboard:v2.37.1+
(container exits at startup with "AUTH_SUPPORTED_SCOPES environment
variable must be set"). Standard NetBird OIDC scopes.

## `- "coolify.managed=true"`

No Traefik router here: Host(`${NETBIRD_DOMAIN}`) labels are dead on
Coolify ($ → $$ escape). Dashboard traffic reaches this container via
netbird-proxy (Caddy path demux, registered through
docker_compose_domains — see coolify-domain-doctor.mjs aisha-netbird).

## `netbird-relay:`

---------------------------------------------------------------------------
Relay — NetBird relay (WebSocket, fallback when direct P2P fails)
Routed through Traefik on HTTPS (port 443) so it works behind NAT/firewalls.
Previous direct port 33080 was blocked by firewall/Cloudflare.
Clients connect via rels://${NETBIRD_DOMAIN}:443/relay (WebSocket upgrade).
---------------------------------------------------------------------------

## `- "coolify.managed=true"`

No Traefik router here: Host(`${NETBIRD_DOMAIN}`) labels are dead on
Coolify ($ → $$ escape). The /relay WebSocket path is demuxed by
netbird-proxy (Caddy upgrades WS natively over HTTP/1.1).

## `netbird-proxy:`

---------------------------------------------------------------------------
netbird-proxy — Caddy path demux for the HTTP surface of ${NETBIRD_DOMAIN}
---------------------------------------------------------------------------
WHY: Coolify escapes `$` → `$$` in compose label values, so the former
Host(`${NETBIRD_DOMAIN}`) routers never matched on Coolify, and the
template-only directive forbids literal deployment hostnames in git.
The netbird host needs PATH demux across three upstreams, which Coolify's
docker_compose_domains auto-gen cannot express — so we register ONE
Host router for the whole domain on THIS container (via
docker_compose_domains, the production routing SoT — same pattern as
edge-proxy in docker-compose.coolify-prebuilt.yml) and demux paths here.
gRPC (management/signal FQN paths) bypasses this proxy entirely via the
host-less h2c Traefik routers above (Traefik→Caddy would downgrade to
HTTP/1.1 and kill gRPC).
No env vars needed: Traefik's Host router already scoped traffic to the
netbird domain, so the Caddyfile is purely path-based (template-only ✓).

## `entrypoint:`

No depends_on: Caddy starts independently (same-project Docker DNS is
available as soon as the peer containers exist); a not-yet-healthy
upstream just 502s until it comes up — the proxy must not be held
hostage by a single upstream's health (management/relay still work
while the dashboard is starting).

## `test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:80/__netbird_health"]`

exec-form (no shell wrapper) — keeps the netbird stack's healthcheck
convention (coolify-env-contract gate); busybox wget ships in
caddy:alpine.

## `netbird-internal-tls:`

---------------------------------------------------------------------------
Internal TLS sidecar — Caddy with AISHA PKI cert
---------------------------------------------------------------------------
Provides MESH-INTERNAL access path to all NetBird control-plane services
using a cert issued by our own AISHA PKI (Evymo Root CA → realm CA).

WHY this exists:
  The external path (Coolify Traefik on ${NETBIRD_DOMAIN}:443 with LE
  wildcard cert) works for browsers and external clients, but for
  internal mesh agents it has issues:
    - Long-lived gRPC streams die on Traefik HTTP/2 idle timeout
    - NAT hairpin (Backend → public IP → router → back to Frontend LAN) drops
      conntrack mappings, killing streams
    - Cross-domain LAN traffic forced through public-facing proxy

The internal path:
    agent on Backend/Experimental
      ↓ extra_hosts: netbird.mesh.aisha.internal → <frontend-lan-ip>
      ↓ TCP to Frontend eth0:33073 (host port mapped from this caddy)
      ↓ caddy terminates AISHA PKI TLS (cert: netbird.mesh.aisha.internal)
      ↓ forwards h2c to netbird-management:443 (internal coolify network)

CERT delivery:
  1. Issued via OpenXPKI WebUI (https://${PKI_DOMAIN}/openxpki/webui/)
     Subject: CN=netbird.mesh.aisha.internal, O=AISHA, OU=Mesh
     SAN: DNS:netbird.mesh.aisha.internal
     Profile: server-tls (90d validity recommended, EC P-384)
  2. Cert + key base64-encoded into Coolify env:
       NETBIRD_INTERNAL_CERT_B64=<base64 of cert.pem>
       NETBIRD_INTERNAL_KEY_B64=<base64 of key.pem>
  3. Auto-renewal: scripts/pki-renew-internal-certs.sh (cron, 30d
     before expiry) → updates Coolify env → caddy reload (SIGHUP).

GRACEFUL DEGRADATION:
  If env vars not set, caddy generates self-signed bootstrap cert and
  logs LOUD warning. Allows initial deploy to succeed before cert is
  issued; agents will fail with x509 error until proper cert deployed
  (clear error indicating next step).
---------------------------------------------------------------------------

## `init: true`

PID-1 zombie reaper (same class as mesh-router, incident 2026-06-13). caddy
runs as PID 1 and never wait()s, so the busybox healthcheck below
(`wget --no-check-certificate https://127.0.0.1:33073/api`) leaks its
`ssl_client` TLS-helper children as defunct zombies (~2.8k observed),
adding to the host-wide process exhaustion. tini as PID 1 reaps them.

## `- "${NETBIRD_MESH_PORT:-33073}:33073"`

Host port 33073 mapped from container 33073 — internal mesh agents
connect here directly via LAN (<frontend-lan-ip>:33073), bypassing
Coolify Traefik entirely.

## `test: ["CMD-SHELL", "[ ! -f /data/.tls-selfsigned-fallback ] && wget -q -O /dev/null --no-check-certificate https://127.0.0.1:33073/api"]`

Fail-loud: UNHEALTHY while serving the self-signed bootstrap cert (sentinel
present) — a real AISHA PKI cert clears the sentinel at start — and the
endpoint must actually answer. Was `... | grep -q . || exit 0` = always
green, which hid a broken mesh TLS terminator (every diagnosis needed SSH).

## `netbird-mgmt-v5:`

Volume KEYS (not just `name:` fields) bumped from v4 → v5 to
force Coolify/Docker to create new empty volumes. Earlier attempt with
`name: aisha_v3_*` was insufficient — Coolify deploys reused old volumes
by the volume KEY in the compose file (the `name:` field was ignored or
mapped post-hoc). Renaming the keys themselves means the previous
volume mapping cannot apply.

WHY this matters: old `netbird-db-data` contains a NetBird account
owned by service-account-netbird-backend (Keycloak service account user)
whose UUID NetBird's IDP user-sync cannot resolve → setup-key-bound
peers fail authorization → gRPC heartbeats die → mesh stays broken.
Fresh DB ensures the FIRST authenticated request comes from aisha-
bootstrap (real Keycloak user) via ROPC in scripts/netbird-bootstrap.sh
→ that user becomes account owner → IDP sync succeeds → mesh works.

Old volumes orphan automatically; clean up manually if needed.

## `netbird-internal-tls-data:`

Caddy state for internal TLS sidecar (cert cache, ACME state if used).
Must NOT contain the AISHA PKI cert itself — that's loaded from env at
entrypoint time so cert rotation requires no volume manipulation.

## `pki-certs:`

Per-stack pki-certs volume — populated by pki-init service from baked
/staging/aisha-ca-bundle.pem. Same pattern as core compose.

## `internal:`

Both `internal` and `coolify` alias the external coolify network — avoid
per-stack bridges (Docker default address pool exhaustion).
Coolify creates this network at install; we only attach.

## `KEYCLOAK_URL: https://${KEYCLOAK_DOMAIN_DIRECT:?pki-init běží uvnitř clusteru před vznikem mesh — potřebuje PŘÍMOU tvář Keycloaku (auth.backend.<internal-tld>), ne veřejnou přes edge}`

STANOVIŠTĚ: tenhle kontejner běží UVNITŘ clusteru a běží ZA BOOTSTRAPU,
tedy dřív, než existuje mesh. Ze tří tváří Keycloaku mu smí sloužit jen
jedna:
  MESH   (aisha-auth.mesh.<tld>)  — vzniká až tím, co tenhle krok vydává
  PUBLIC (auth.<public-tld>)      — obsluhuje ji edge, a ten potřebuje
                                    mesh IP, kterou zase drží tenhle cert
  DIRECT (auth.backend.<int-tld>) — routuje Coolify proxy na backendu;
                                    nepotřebuje ani mesh, ani edge

Do 2026-08-14 tu stála PUBLIC, a byl to KRUH: pki-init → edge → mesh →
pki-init. Naměřeno na aishe v ostrém běhu:
  Acquiring ROPC token from Keycloak (https://auth.aisha.guru realm=aisha)...
  ❌ Keycloak ROPC request failed: curl: (22) … error: 404
Edge v tu chvíli veřejnou tvář ještě neobsluhoval. Cert se nevydal,
caddy spadl na self-signed a všechny netbird-agenty skončily na
„tls: internal error" — mesh nevstal vůbec.

DIRECT tvář topologie emituje sama (KEYCLOAK_DOMAIN_DIRECT) a týž
bootstrap ji už používá jinde (configure-realms.sh). `:?` proto, že
dosadit sem prázdno by kruh jen vrátilo jinou cestou.

## `KEYCLOAK_DOMAIN_PUBLIC: ${KEYCLOAK_DOMAIN_PUBLIC}`

DVĚ TVÁŘE, DVA ÚČELY — management.json je JSON, takže vysvětlení patří sem.

KEYCLOAK_DOMAIN_PUBLIC  → adresy, které dostane PROHLÍŽEČ (AuthIssuer,
  OIDC discovery, device/PKCE flow). Issuer musí navíc doslova sedět
  s claimem `iss` v tokenu, jinak management token odmítne.
KEYCLOAK_DOMAIN_FROM_CLUSTER → adresy, na které volá SÁM MANAGEMENT
  (JWKS, token endpoint IdP manažera, admin endpoint).

⛔ NAMĚŘENO 2026-08-14 na aishe: obojí mířilo na veřejnou tvář, a ta je
ZEVNITŘ clusteru neviditelná — z talosu vrací
    404 „edge-proxy: unknown host (no rule matched)"
(zvenčí přitom 200). Management proto nestáhl JWKS a KAŽDÝ platný token
odmítl hláškou, která ukazuje úplně jinam:
    getPublicKey error: unable to find appropriate key
    HTTP response …: GET /api/groups status 401
Bez API se nedaly vyrobit setup keys → agenti hlásili „setup key is
invalid" → mesh zůstala prázdná → edge neměl kam routovat → veřejná
tvář 404. Kruh se uzavřel sám na sobě.

Přímá tvář (`auth.backend.<internal-tld>`) je z clusteru dosažitelná
(ověřeno: 200 z talosu) a Keycloak má pevný hostname, takže token
vydaný přes ni nese TÝŽ `iss` — claim se tedy nerozejde.
Bez fallbacku ZÁMĚRNĚ, dvakrát:
 · vnořená interpolace `${A:-${B}}` rozbíjí build-time parser Coolify
   (naměřeno 2026-07-20, hlídá brána coolify-compose-compliance),
 · a hlavně: přímou tvář emituje topologie pro KAŽDÝ profil — ověřeno
   na cloud-multi, cloud-single i local-dev. Tam, kde je přímá tvář
   totožná s veřejnou, se prostě obě rovnají. Fallback by tedy jen
   zakrýval stav, kdy se hodnota nedoručila.

## `NETBIRD_IDP_MANAGER_KEYCLOAK_BASE_URL: https://${KEYCLOAK_DOMAIN_DIRECT:?topologie ji emituje pro KAŽDÝ profil (cloud-multi/cloud-single/local-dev) — bez ní management nestáhne JWKS a odmítne každý token}`

Server-to-server (viz vysvětlení u netbird-init) — ne veřejná tvář.

## `- "traefik.http.services.${APP_NAME_PREFIX:?APP_NAME_PREFIX required}-netbird-proxy.loadbalancer.server.port=80"`

The Coolify-generated Host router has no explicit service. These are
the only custom Traefik labels left: one prefix-scoped h2c service on
this same container, selected automatically by that Host router.

## `test: ["CMD-SHELL", "if [ -f /data/.tls-selfsigned-fallback ]; then echo 'DEGRADOVÁNO: běží self-signed cert, PKI cert pro mesh se nevydal — agenti selžou na TLS verify (viz pki-init diagnostiku výše v logu)'; exit 1; fi; wget -S -q -O /dev/null --no-check-certificate https://127.0.0.1:33073/api/users 2>&1 | grep -qE 'HTTP/1\\.[01] (200|401|403)' || { echo 'upstream neodpověděl 200/401/403 na /api/users — TLS terminovalo, ale routa nebo netbird-management neodpovídá'; exit 1; }"]`

/api NENÍ endpoint — netbird-management na něm nic neobsluhuje, takže
sonda na něj dostane 404 i při dokonale funkčním řetězu. Měřeno
2026-07-29 po opravě matcheru: /api → 404, /api/ → 404,
/api/users → 401. To 401 je plný důkaz: TLS terminovalo, routa vedla
a upstream žije a autentizuje. wget končí nenulově na 404 i 401, proto
se čte STAVOVÝ ŘÁDEK, ne návratový kód — sonda musí umět zezelenat.
Sonda, která jen skončí nenulově, nechá v `docker inspect` PRÁZDNÝ
výstup — naměřeno 2026-08-14: FailingStreak 44, Output "" u všech.
Operátor pak vidí „unhealthy" a nemá jedinou stopu proč. Proto se důvod
VYSLOVÍ; degradovaný stav je nález, ne ticho.

## `external: true`

EXTERNAL: síť zakládá warmup aplikace (docker-compose.coolify-netinit.yml)
na každém hostu PŘED vlnami a cold-start ji po rolloutu smaže. Kdyby ji
compose VLASTNIL, pokusil by se ji při teardownu smazat — a když na ní visí
kontejner jiného projektu, spadne celé nasazení (naměřeno 2026-08-11 na
aisha-clamav: "network ... has active endpoints").

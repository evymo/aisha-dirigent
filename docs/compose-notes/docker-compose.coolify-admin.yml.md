# docker-compose.coolify-admin.yml — notes

Prose extracted from `docker-compose.coolify-admin.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `services:`

=============================================================================
AISHA Admin Stack — NocoDB + Appsmith + Intranet + OAuth2 Proxy
=============================================================================
SSO Architecture (zero separate login):
  Both Appsmith CE and NocoDB OSS lack native OIDC support.
  → appsmith-auth (OAuth2 Proxy) → appsmith-gateway (Caddy) → Appsmith CE
  → nocodb-auth   (OAuth2 Proxy) → NocoDB OSS
  OAuth2 Proxy authenticates via Keycloak SSO. Users already logged into the
  React app share a Keycloak session → seamless pass-through, no second login.
  Appsmith Gateway redirects root/login/signup URLs to the public StoryLoop app.
  Self-registration disabled everywhere: APPSMITH_SIGNUP_DISABLED, NC_INVITE_ONLY_SIGNUP.
  → Coolify docker_compose_domains:
      <APPSMITH_DOMAIN>  → appsmith-auth:4180   (admin/staff only)
      <INTRANET_DOMAIN>  → intranet-auth:4180   (all authenticated users)
      <NOCODB_DOMAIN>    → nocodb-auth:4180

Required Coolify env vars:
  NOCODB_DB_PASSWORD, NOCODB_JWT_SECRET, NOCODB_DOMAIN, NOCODB_OIDC_SECRET,
  APPSMITH_OIDC_SECRET, OAUTH2_PROXY_COOKIE_SECRET, APPSMITH_DOMAIN,
  KEYCLOAK_DOMAIN, APPSMITH_ENCRYPTION_PASSWORD, APPSMITH_ENCRYPTION_SALT
=============================================================================

## `- NC_ADMIN_EMAIL=${NOCODB_ADMIN_EMAIL}`

Pre-create super admin so first OIDC-authenticated visitor doesn't see
the public "create super admin" page. NocoDB OSS doesn't have native
OIDC — OAuth2 Proxy in front authenticates the user, but NocoDB uses
its own user store. Without a pre-existing admin, ANY admin/staff
Keycloak user reaching this page becomes super admin (security risk).

## `test: ["CMD-SHELL", "wget -q --spider --tries=1 --timeout=3 http://127.0.0.1:8080/api/v1/health || exit 1"]`

HTTP-level liveness via wget --spider against /api/v1/health.
Earlier attempts used `nc -z 127.0.0.1 8080`, but
the nocodb:0.260.0 image does NOT ship `nc` — runtime fails with
`/bin/sh: 1: nc: not found` and the healthcheck stays unhealthy
forever. Direct probe on the running container (2026-05-23) confirms
/api/v1/health returns HTTP 200, so wget --spider (HEAD; only checks
status code) exits 0 cleanly. Single-attempt + short timeout to keep
the probe cheap; daemon will retry per `retries:` below.

## `- "coolify.managed=true"`

Explicit Traefik labels — direct route to NocoDB on internal port 8080.
Per commit 89899084 intent + admin-routing-integral.gate.test.ts spec:
NocoDB OSS doesn't have native OIDC, so the public route bypasses
OAuth (mitigated via NC_ADMIN_EMAIL pre-create + NC_INVITE_ONLY_SIGNUP
which defend against the "first visitor becomes super admin" race).

Earlier the labels were attached to the `nocodb-auth` service (sitting
next-to NocoDB) — that produced 502 Bad Gateway because Traefik
connected to nocodb-auth:8080 but nocodb-auth listens on 4180.
Moving the labels here (and adding `coolify` to networks) makes the
route resolve to the NocoDB container directly on port 8080 as
intended (caught 2026-05-25 smoke-routing regression).

## `nocodb-auth:`

---------------------------------------------------------------------------
OAuth2 Proxy — OIDC auth gateway for NocoDB OSS (no native OIDC in OSS)
Same pattern as appsmith-auth — authenticates via Keycloak, proxies to NocoDB.
NOTE: nocodb-auth is kept around for callers that explicitly want to go
through OAuth (e.g. internal scripts hitting http://nocodb-auth:4180).
The public route (nocodb.backend.id3a.cz) bypasses OAuth on purpose — see
nocodb service labels above.
---------------------------------------------------------------------------

## `extra_hosts:`

Resolve KC public hostnames internally via host bridge → Coolify
Traefik → KC. Stays on host, no pfSense round-trip.

## `OAUTH2_PROXY_OIDC_ISSUER_URL: https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}`

── OIDC split-URL pattern: issuer for token matching, skip auto-discovery ──
Discovery over https via host-gateway hits Traefik default cert (wrong CN).
Instead: browser redirects → public HTTPS, backchannel → Docker internal HTTP.

## `condition: service_started`

service_started — NocoDB's healthcheck path drifts between versions;
OAuth2 Proxy can start before NocoDB is "healthy".

## `- "coolify.managed=true"`

No public Traefik routing labels here — the <NOCODB_DOMAIN> route
is owned by the `nocodb` service above (direct route, per commit
89899084 intent + gate spec). Only Coolify management metadata
remains so the container is still recognised as Coolify-managed.

## `appsmith-auth:`

---------------------------------------------------------------------------
OAuth2 Proxy — OIDC auth gateway for Appsmith CE (no native OIDC in CE)
Authenticates via Keycloak, proxies to Appsmith on internal network.
Users with existing Keycloak session (from React app login) get seamless SSO.
---------------------------------------------------------------------------

## `OAUTH2_PROXY_OIDC_ISSUER_URL: https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}`

── OIDC split-URL pattern: issuer for token matching, skip auto-discovery ──

## `OAUTH2_PROXY_SKIP_AUTH_ROUTES: "^/api/v1/health$,^/app/,^/\\.well-known/.*"`

/api/v1/health: healthcheck bypass
/app/: Appsmith published app view — bypasses OAuth2 Proxy so iframe embed
  works (KC blocks iframe login via X-Frame-Options: SAMEORIGIN).
  Appsmith's own permission model controls app-level access.

## `condition: service_started`

service_started: gateway healthy once Caddy starts (PR #80).

## `- "coolify.managed=true"`

Explicit Traefik labels — same integral pattern as KC + langfuse.
appsmith-auth = OAuth2 Proxy on port 4180; HTTPS terminates here,
forwards authenticated traffic to appsmith-gateway → appsmith.

## `appsmith-gateway:`

---------------------------------------------------------------------------
Appsmith Gateway (Caddy) — redirects root/login/signup to public StoryLoop app.
Ensures SSO users land on the dashboard, not on Appsmith's own login page.
Caddy chosen because its config syntax has no $ variables (avoids Coolify
double-quote escaping issues that break nginx $host/$remote_addr).
Flow: OAuth2 Proxy → Caddy (redirect root, proxy rest) → Appsmith CE
---------------------------------------------------------------------------

## `test: ["CMD-SHELL", "wget -q -O /dev/null http://localhost:80/__gateway_health || exit 1"]`

Probe Caddy's own health — immune to Appsmith upstream state.
Staging production fix for the gateway healthcheck.

## `condition: service_started`

service_started: Appsmith CE takes 5–13 min on fresh volume;
gateway is healthy once Caddy starts (PR #80).

## `test: ["CMD-SHELL", "curl -s --max-time 5 -o /dev/null http://localhost:80/ || exit 1"]`

TCP-style: curl without -f accepts 4xx → healthy once Nginx is up.
/api/v1/health requires Spring Boot + MongoDB (slow); Nginx starts
first. Same philosophy as NocoDB nc -z probe (PR #79/#80).

## `intranet-auth:`

NOTE: Appsmith CE all-in-one (includes embedded MongoDB + Nginx + Java).
Internal-only — accessed through appsmith-auth (OAuth2 Proxy).
No coolify network or Traefik labels — not directly exposed to the internet.

---------------------------------------------------------------------------
OAuth2 Proxy — OIDC auth gateway for Appsmith CE INTRANET access.
Same Appsmith instance as appsmith-auth, but DIFFERENT allowed groups:
- appsmith-auth: admin + staff only (ops dashboards)
- intranet-auth: ALL authenticated roles (intranet platform for all users)
Dual-gateway pattern: two proxies → two Caddy gateways → one Appsmith CE.
Users with existing Keycloak session get seamless SSO (no second login).
---------------------------------------------------------------------------

## `OAUTH2_PROXY_OIDC_ISSUER_URL: https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}`

── OIDC split-URL pattern: browser → public HTTPS, backchannel → internal HTTP ──

## `OAUTH2_PROXY_ALLOWED_GROUPS: admin,staff,practitioner,member,evaluator,partner,consultant,production_operator,production_supervisor,quality_manager,researcher`

ALL app_role enum values — intranet is open to every authenticated user

## `OAUTH2_PROXY_SKIP_AUTH_ROUTES: "^/api/v1/health$,^/app/,^/\\.well-known/.*"`

/api/v1/health: healthcheck bypass
/app/: Appsmith published app view — bypasses OAuth2 Proxy for iframe embed
/.well-known/*: ACME challenges + OIDC discovery

## `condition: service_started`

service_started: mirrors appsmith-auth (PR #80).

## `- "coolify.managed=true"`

Explicit Traefik labels — same integral pattern. intranet-auth =
OAuth2 Proxy on port 4180 for ALL authenticated users (vs.
appsmith-auth which is admin/staff only).

## `intranet-gateway:`

---------------------------------------------------------------------------
Intranet Gateway (Caddy) — redirects root/login/signup to the Intranet Hub app.
Ensures SSO users land on the intranet portal, not Appsmith's native login page.
Same upstream Appsmith instance as appsmith-gateway — different landing page.
Flow: intranet-auth (OAuth2 Proxy) → Caddy (redirect root, proxy rest) → Appsmith CE
---------------------------------------------------------------------------

## `test: ["CMD-SHELL", "wget -q -O /dev/null http://localhost:80/__gateway_health || exit 1"]`

Probe Caddy's own health — immune to Appsmith state (PR #80).

## `condition: service_started`

service_started: same as appsmith-gateway (PR #80).

## `appsmith-provision:`

One-shot importer for the Story-Intra (extranet) cockpit — replaces the old
"SSH into the host and run `provision-intranet.sh` by hand" step, which was
impossible without host access because the Appsmith API sits behind an
oauth2-proxy that 302s every path except `/api/v1/health`.

Built from `Dockerfile.appsmith-provision`; runs `scripts/provision-intranet.sh
--prod` at deploy time. Key wiring:

- `APPSMITH_URL: http://appsmith:80` — the raw container alias, *inside* the
  oauth2-proxy. The import (login → workspace → datasources → import template →
  publish) talks straight to Appsmith with no Keycloak wall.
- `AISHA_API_URL: http://aisha-gateway:3001` — the core gateway, reached
  container-direct because admin + core share the same Coolify server and the
  external `coolify` network. Backs the "AISHA Public Data" datasource
  (`/rest/v1`, anon-key auth — no oauth2-proxy needed).
- `INTRANET_PROXY_URL: https://${INTRANET_DOMAIN}/intranet` — the "AISHA
  Intranet API"/"AISHA Knowledge" datasources go through the intranet
  oauth2-proxy vhost, not container-direct: the gateway `/intranet/*` routes
  require a *verified Keycloak token* that only the proxy injects
  (`X-Auth-Request-Access-Token`); `X-Intranet-Api-Key` alone never authorizes.
- `ANON_KEY` / `INTRANET_API_KEY` / `INTERNAL_TLD` are now referenced here, so
  `coolify-sync-envs.sh`'s per-app intersection filter pushes them to the admin
  app automatically (previously admin never needed them).

`restart: "no"` = deploy-time one-shot. The container CMD wraps the script in
`|| exit 0`, so a provisioning hiccup logs a warning and the admin deploy still
goes green — the cockpit simply re-imports (idempotent) on the next deploy.

## `condition: service_healthy`

The provisioner waits for Appsmith to pass its healthcheck before importing —
the CE bootstrap (~5 min `start_period`) must finish or the API 503s.

## `volumes:`

NOTE: Keycloak (`aisha-keycloak`) je nasazen samostatně jako aisha-keycloak app
přes docker-compose.coolify-keycloak.yml. NE-deklarovat zde — kolidoval by
container_name `aisha-keycloak`/`aisha-keycloak-db` a Traefik routing.
Admin proxies (nocodb-auth, appsmith-auth) přistupují ke keycloaku
přes sdílenou aisha-network (host: aisha-keycloak:80).

## `internal:`

Both `internal` and `coolify` alias the external coolify network — avoid
per-stack bridges (Docker default address pool exhaustion).

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

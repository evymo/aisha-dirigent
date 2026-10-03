# Tenant template — deploying the AISHA stack as a new fork

This document lists every env variable a NEW tenant fork needs to set in order
to deploy the full AISHA stack with their own Keycloak realm, client IDs,
domains, and brand. The upstream defaults all point to `auth.backend.id3a.cz`
(evymo / Backend deployment) — overriding them via Coolify env (or a tenant
overlay `.env` file) repoints the entire stack to the new tenant's
infrastructure without forking a single compose file.

## Quick reference — minimum required env

| Variable | Example | Purpose |
|---|---|---|
| `PUBLIC_TLD` | `foo.example.com` | Client-facing zone — web/api/auth routes (edge Traefik + TLS). Read by the variant-aware CI gates |
| `INTERNAL_TLD` | `foo.example.com` | Admin/ops zone — `<svc>.<server>.<INTERNAL_TLD>`. Single-server fork: same as `PUBLIC_TLD` |
| `MESH_TLD` | `mesh.foo.example.com` | NetBird peer-to-peer mesh DNS zone |
| `KEYCLOAK_DOMAIN` | `auth.foo.example.com` | Keycloak FQDN (issuer, JWKS, login redirects) |
| `KEYCLOAK_REALM` | `foo-realm` | Keycloak realm segment in URL paths |
| `OIDC_APP_CLIENT_ID` | `foo-app` | Browser SPA + mobile OIDC client ID |
| `OIDC_CLIENT_PREFIX` | `foo-` | Prefix appended to per-service OAuth2 Proxy clients |
| `OAUTH2_COOKIE_DOMAINS` | `.foo.example.com` | OAuth2 Proxy cookie scope |
| `OAUTH2_WHITELIST_DOMAINS` | `.foo.example.com` | OAuth2 Proxy redirect whitelist |
| `APP_NAME_PREFIX` | `foo` | Coolify app-name prefix (cold-start scripts iterate `<prefix>-*`) |
| `AISHA_TENANT_HOOK` | `foo/deploy/migrate-hook.sh` | Per-tenant post-migrate seed hook (optional) |

## Derived URLs (no override needed — set automatically from above)

Once `KEYCLOAK_DOMAIN` and `KEYCLOAK_REALM` are set, the following all resolve
automatically across all 7 compose files:

```
KC_JWKS_URL               https://${KEYCLOAK_DOMAIN}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs
KC_ISSUER                 https://${KEYCLOAK_DOMAIN}/realms/${KEYCLOAK_REALM}
KC_TOKEN_URL              https://${KEYCLOAK_DOMAIN}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token
OAUTH2_PROXY_OIDC_*       https://${KEYCLOAK_DOMAIN}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/{auth,token,certs,userinfo}
```

Per-service OAuth2 Proxy client IDs resolve via `OIDC_CLIENT_PREFIX`:

```
OAUTH2_PROXY_CLIENT_ID    ${OIDC_CLIENT_PREFIX}nocodb-proxy
                          ${OIDC_CLIENT_PREFIX}appsmith-proxy
                          ${OIDC_CLIENT_PREFIX}appsmith-intranet-proxy
                          ${OIDC_CLIENT_PREFIX}studio-proxy
                          ${OIDC_CLIENT_PREFIX}n8n-proxy
                          ${OIDC_CLIENT_PREFIX}pki-proxy
```

If `OIDC_CLIENT_PREFIX` is unset/empty, services use the bare names
(`nocodb-proxy`, etc.) — matches evymo upstream realm conventions.

## Bootstrap a new tenant — step-by-step

### 1. Pick names

| | Example (acme) | Example (globex) |
|---|---|---|
| Instance name | `acme` | `globex` |
| Base domain | `acme.example.com` | `globex.example.com` |
| Keycloak domain | `auth.acme.example.com` | `auth.globex.example.com` |
| Keycloak realm | `acme-realm` | `globex-realm` |
| Cookie scope | `.acme.example.com` | `.globex.example.com` |
| OIDC prefix | `acme-` | `globex-` |

### 2. Create the Keycloak realm

Either:
- **Import a realm JSON** at Keycloak startup (mount as `/opt/keycloak/data/import/<realm>.json`)
- **Or use Keycloak Admin API** post-bootstrap: `POST /admin/realms` with the realm representation

The realm must contain:
- Clients: `<prefix>app` (public, PKCE) + per-service confidential clients
  (`<prefix>nocodb-proxy`, `<prefix>appsmith-proxy`, …)
- Realm roles: `admin`, `member`, `staff`, `practitioner`, plus any service-access
  roles (`n8n_access`, `studio_access`, …)
- Token mapper: include `roles` claim in JWT (used by gateway → PostgREST translation)

See `keycloak/acme-realm.json` for a worked example.

### 3. Write tenant overlay env

Create `config/domains-<tenant>.env`:

```bash
# config/domains-foo.env — example tenant overlay
# (generate this file with: scripts/init-new-tenant.sh --instance=foo …)

# Three-zone domain contract — read by the variant-aware CI gates so this
# fork's domains validate as a configured zone (see section below). A new
# single-server fork starts with PUBLIC == INTERNAL; split INTERNAL onto a
# per-server TLD (<svc>.<server>.<INTERNAL_TLD>) when the cluster grows.
PUBLIC_TLD=foo.example.com
INTERNAL_TLD=foo.example.com
MESH_TLD=mesh.foo.example.com

KEYCLOAK_DOMAIN=auth.foo.example.com
KEYCLOAK_REALM=foo-realm

OIDC_APP_CLIENT_ID=foo-app
OIDC_CLIENT_PREFIX=foo-

OAUTH2_COOKIE_DOMAINS=.foo.example.com
OAUTH2_WHITELIST_DOMAINS=.foo.example.com

APP_NAME_PREFIX=foo
AISHA_TENANT_HOOK=foo/deploy/migrate-hook.sh

# Per-service public domains (optional — defaults to evymo if unset)
VITE_PUBLIC_DOMAIN=app.foo.example.com
N8N_DOMAIN=n8n.foo.example.com
STUDIO_DOMAIN=db.foo.example.com
GRAFANA_DOMAIN=grafana.foo.example.com
```

### 4. Apply via Coolify

Either:
- Manually create the apps in Coolify with the env vars set on each
- Or use `scripts/aisha-cold-start.sh` with `AISHA_ENV=foo` to bootstrap
  the full set of Coolify resources from manifest + overlay

### 5. Per-tenant data hook (optional)

If your tenant has fork-specific seed data (branding profiles, content,
domain-specific RPCs), create `<tenant>/deploy/migrate-hook.sh` (POSIX sh,
runs inside `node:22-alpine` migrate container with psql available).

The hook fires after every successful `npm run db:migrate` + seed.compile.sql
apply. Use it for:
- Tenant-specific branding_profiles + branding_hostname_mapping inserts
- Domain-specific expert_rules
- Per-tenant project_preset
- Content seeds (web_pages, news_articles, etc.)

Reference impl: `<your-tenant>/deploy/migrate-hook.sh` (5 foundation + 21 content seeds).

## What evymo (upstream) leaves as default

These values stay evymo-specific in compose:

```yaml
KEYCLOAK_DOMAIN: ${KEYCLOAK_DOMAIN:-auth.backend.id3a.cz}
KEYCLOAK_REALM: ${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}
OIDC_APP_CLIENT_ID: ${OIDC_APP_CLIENT_ID:-aisha-app}
OIDC_CLIENT_PREFIX: ${OIDC_CLIENT_PREFIX:-}        # empty → bare client names
OAUTH2_COOKIE_DOMAINS: ${OAUTH2_COOKIE_DOMAINS:-.backend.id3a.cz,.aisha.guru}
APP_NAME_PREFIX: aisha                              # cold-start scripts
```

Any non-evymo deployment overrides them via env. No compose file changes
needed.

## Passing upstream CI as a fork (variant-aware gates)

A full tenant fork has *different-but-equivalent* infrastructure: its own public
TLD, its own server roles, possibly a registry mirror or a pgbouncer wrapper
image. Historically the domain CI gates hardcoded the evymo reference
(`aisha.guru` + a fixed server list + the direct pgbouncer image), so a fork
that deployed correctly still failed the gate suite. Since **#261** those gates
are **variant-aware** — they read the deployment's own source of truth instead
of one hardcoded variant:

| Gate | What it now reads from the SoT |
|---|---|
| `legacy-domains.gate.test.ts` | The three zones from `config/domains.env` + every `config/domains-*.env` overlay + `domains.env.example`. Any host under your `PUBLIC_TLD`/`MESH_TLD`, or `<svc>.<server>.<INTERNAL_TLD>` for a server in `coolify/servers.json`, is accepted |
| `domain-zoning.gate.test.ts` | Server roles dynamically from `coolify/servers.json` (`servers` keys) via `lib/domain-topology.ts` — not a hardcoded list |
| `dockerfile-cache-prefix.gate.test.ts` | Accepts `mcr.microsoft.com` (and other non-Docker-Hub registries) so a fork's registry choices don't trip the anon-rate-limit guard |
| `wp-1-3-pgbouncer.gate.test.ts` | Accepts the pinned pgbouncer image **or** a wrapper built `FROM ${BASE_IMAGE}` |

**What this means for you:** declare your three zones in
`config/domains-<tenant>.env` (the `init-new-tenant.sh` generator does this) and
keep `coolify/servers.json` accurate for your cluster. With those two SoT files
correct, your fork passes the upstream gate suite **unchanged** — running a
complete fork is a first-class launch variant, not a CI exception. A
single-domain fork (`PUBLIC_TLD == INTERNAL_TLD`) is the simplest case; the
evymo reference splits them (`PUBLIC_TLD=aisha.guru`, `INTERNAL_TLD=id3a.cz`),
and a production tenant fork already exercises this path end-to-end.

## History

| Date | Commit | Change |
|---|---|---|
| 2026-05-24 | #199 (upstream) | Parametrize `/realms/aisha` → `/realms/${KEYCLOAK_REALM:-aisha}` in 14 lines |
| 2026-05-24 | #199 (upstream) | Parametrize OAUTH2_PROXY_CLIENT_ID via `OIDC_CLIENT_PREFIX`; OIDC_CLIENT_ID + KC_CLIENT_ID via `OIDC_APP_CLIENT_ID`; cookie domains via `OAUTH2_*_DOMAINS` overrides |
| 2026-06-02 | (this PR) | Three-zone domain contract (`PUBLIC_TLD`/`INTERNAL_TLD`/`MESH_TLD`) emitted by `init-new-tenant.sh`; "passing upstream CI as a fork" section (builds on the #261 variant-aware gates) |

The one-shot bootstrap generator (`scripts/init-new-tenant.sh`) and realm-JSON
template now exist — run it to scaffold `config/domains-<tenant>.env`,
`keycloak/<tenant>-realm.json`, and the migrate-hook stub in one command.

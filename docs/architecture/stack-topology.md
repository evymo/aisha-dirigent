# AISHA v2 — Stack Topology (Coolify Production)

> Status: Cutover in progress (2026-04-21). Source of truth: `docker-compose.coolify.yml` + Coolify app `js80o0ccc0888o0wwkc80ss8` on server `frontend.id3a.cz`.

## Public Domains

| FQDN | Service (compose) | Internal Port | Auth | Purpose |
|---|---|---|---|---|
| `https://web.aisha.guru` | `web` | 80 | Keycloak (front-end) | AISHA web UI |
| `https://web.aisha.guru` | `web` | 80 | Keycloak | Internal Dirigent alias |
| `https://api.aisha.guru` | `gateway` | 3001 | Keycloak JWT (Bearer) | Orchestration API — auth, RPC proxy, MCP, webhook routing |
| `https://db.aisha.guru` | `pgadmin-auth` | 4180 | OAuth2 Proxy → Keycloak | pgAdmin (PostgreSQL management) |
| `https://kc.aisha.guru` | `aisha-keycloak` (in `docker-compose.coolify-keycloak.yml`) | 8080 | Keycloak admin | Identity Provider |
| `https://n8n.aisha.guru` | `n8n-auth` (in `docker-compose.coolify-n8n.yml`) | 4180 | OAuth2 Proxy → Keycloak | n8n workflows |
| `https://pki.aisha.guru` | `pki-auth` (in `docker-compose.coolify-pki.yml`) | 4180 | OAuth2 Proxy → Keycloak | OpenXPKI CA |
| `https://langfuse.aisha.guru` | `langfuse-web` | 3000 | Keycloak OIDC | LLM observability |
| `https://matrix.aisha.guru` | `synapse` | 8008 | Keycloak SAML/OIDC | Communications |
| `https://livekit.aisha.guru` | `livekit` | 7880 | API key | Real-time media |

## Keycloak Realm `aisha`

### Roles (realm-level, mapped to JWT claim `roles`)

| Role | Purpose |
|---|---|
| `admin` | Full admin dashboard (Appsmith, NocoDB) |
| `staff` | Dirigent console (admin dashboard read+limited write) |
| `member` | End-user (Client) |
| `practitioner` | Specialist |
| `evaluator` | Evaluator |
| `studio_access` | pgAdmin / Supabase Studio |
| `n8n_access` | n8n editor |
| `pki_admin` | OpenXPKI CA Officer |
| `pki_operator` | OpenXPKI RA Operator |

### Bootstrap admin user (rendered into `keycloak/aisha-realm.json` from env)

One platform admin is seeded on first boot. Its identity comes from the
environment (no personal account in git) — `render-realm-and-start.sh`
substitutes the realm template placeholders before Keycloak imports:

| User | Email | Realm Roles |
|---|---|---|
| `$PLATFORM_ADMIN_USERNAME` (default: email local-part) | `$PLATFORM_ADMIN_EMAIL` (default: `admin@aisha.guru`) | admin, staff, member, studio_access, n8n_access, pki_admin, pki_operator |

Set `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` to make it your own account
(generate-secrets.mjs emits a temporary password if unset). Additional operators
are provisioned post-import from `config/operators.json` (gitignored) via
`provision-operators.mjs`. The admin can access every subdomain through SSO.

### OAuth2-Proxy → Service access matrix

| Service | Proxy client (Keycloak) | `ALLOWED_GROUPS` (actually roles via group-mapper) |
|---|---|---|
| pgAdmin (db.aisha.guru) | `studio-proxy` | `studio_access` |
| n8n | `n8n-proxy` | `n8n_access` |
| OpenXPKI | `pki-proxy` | `pki_admin,pki_operator` |
| Appsmith / NocoDB | `appsmith-proxy` / `nocodb-proxy` | `admin,staff` |
| Langfuse | `langfuse` | (role-gated in app) |

## Stack Services (core compose — `docker-compose.coolify.yml`)

```
db (PG17 + pgvector + pgcrypto)
 ├─ migrate (one-shot)
 ├─ postgrest (internal :3000)
 ├─ pgadmin ──► pgadmin-auth (oauth2-proxy) ──► db.aisha.guru
 ├─ gateway (orchestrator :3001) ──► api.aisha.guru
 │    └─ depends on: redis, minio, postgrest, keycloak
 ├─ web (React SPA :80) ──► web.aisha.guru
 ├─ redis (cache)
 ├─ minio (S3 object store)
 └─ imgproxy
```

Secondary stacks (separate Coolify apps):
- `docker-compose.coolify-keycloak.yml` — Keycloak + themes
- `docker-compose.coolify-pki.yml` — OpenXPKI CA + RA
- `docker-compose.coolify-n8n.yml` — n8n + oauth2-proxy
- `docker-compose.coolify-langfuse.yml` — Langfuse + ClickHouse
- `docker-compose.coolify-matrix.yml` — Synapse + Coturn
- `docker-compose.coolify-livekit.yml` — LiveKit + Redis

## DB Roles

| Role | Purpose | Notes |
|---|---|---|
| `supabase_admin` | Superuser — migrations, DDL, baseline | Password reapplied on every boot by entrypoint wrapper |
| `postgres` | Initial bootstrap user (demoted to non-superuser after migrations) | Entrypoint wrapper uses `postgres --single` single-user mode to re-apply passwords |
| `authenticator` | PostgREST JWT role (switches to `anon` / `authenticated` / `admin` per JWT claim) | Password reapplied |
| `anon` | Unauthenticated requests | |
| `authenticated` | JWT-bearing requests | |

## Startup sentinel

- `docker-entrypoint-initdb.d/set-passwords.sh` creates `/tmp/.db-passwords-ready` after first-boot password seeding.
- `infra/postgres/entrypoint-wrapper.sh` re-applies passwords on every boot (uses `postgres --single` mode to bypass role-privilege demotion) and touches the sentinel.
- DB healthcheck requires both `pg_isready` **and** the sentinel file.

## Open items (post-cutover)

- [ ] Add `svc-*` microservices block (`svc-stripe`, `svc-ai-chat`, `svc-push`, `svc-mcp-knowledge`, etc.) — currently referenced by `gateway` but not yet deployed.
- [ ] Add `rabbitmq`, `mcp-knowledge-server`, `nocodb`, `appsmith`, `ragnarok` + `elasticsearch` (planned in commit 1.c).
- [ ] Backend stack on Backend `<backend-lan-ip>` — `docker-compose.coolify-backend.yml`.
- [ ] Rename all container prefixes to `aisha-*` + align domains to `*.aisha.guru` across secondary stacks.

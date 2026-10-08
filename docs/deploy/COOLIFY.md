# Coolify deployment (Docker Compose)

> **Multi-server stories (nové aplikace)?** Viz [MULTI_SERVER_COOLIFY.md](MULTI_SERVER_COOLIFY.md).
> Tento dokument pokrývá core evymo stack na Frontend.

## Dva compose soubory — dvě Coolify aplikace

| Compose | Účel | Velikost | Deploy frekvence |
|---------|------|----------|------------------|
| `docker-compose.coolify.yml` | Supabase stack + Ragnarok + KeyCloak (~22 služeb) | ~40KB | Zřídka (manuálně) |
| `docker-compose.coolify-prebuilt.yml` | Web app (migrate + web) | ~2KB | Při každém push na main |

**DŮLEŽITÉ:** Pro web deploy používejte `docker-compose.coolify-prebuilt.yml`.
Hlavní compose (~40KB) způsobuje `Argument list too long` při častém deploymentu.

Hlavní compose nyní zahrnuje i **Ragnarok RAG stack** (Elasticsearch + Ragnarok API) a **KeyCloak OIDC Bridge** (keycloak-db + keycloak).

### Web deploy (docker-compose.coolify-prebuilt.yml)

- `migrate` service — spustí DB migrace jednou per deploy (pak se ukončí)
- `web` service — builduje frontend přes `Dockerfile.web`, startuje po úspěšné migraci
- Obě služby na `aisha-network` (přístup k DB), web navíc na `coolify` (Traefik)

### Supabase stack (docker-compose.coolify.yml)

Kompletní Supabase self-hosted stack: PostgreSQL, Kong, GoTrue, PostgREST, Realtime,
Storage, Edge Runtime, Studio, Analytics, Vector. Deployuje se jednou při setup a
aktualizuje se zřídka (upgrade verze, přidání služeb).

## Ragnarok RAG Stack (Alquist Insight)

Ragnarok je RAG engine založený na Elasticsearch hybrid search (BM25 + KNN). Deployuje se jako součást hlavního compose.

### Služby

| Služba | Port | Popis |
|--------|------|-------|
| `elasticsearch` | 9200 | Elasticsearch 8.x (single-node, security disabled for internal) |
| `ragnarok` | 9696 | Ragnarok FastAPI server (search + upload API) |

### Docker build

```bash
docker build -f Dockerfile.ragnarok -t aisha-ragnarok packages/insight/
```

### Environment variables

| Proměnná | Hodnota | Popis |
|----------|---------|-------|
| `RAGNAROK_URL` | `http://ragnarok:9696` | Interní URL pro edge functions |
| `RAGNAROK_API_KEY` | `<secret>` | API klíč pro autentizaci |
| `ES_HOST` | `http://elasticsearch:9200` | Elasticsearch endpoint |
| `ES_JAVA_OPTS` | `-Xms512m -Xmx512m` | Java heap pro Elasticsearch |

### Edge Function proxies

- `ragnarok-search` — proxy pro vyhledávání v Ragnarok KB (volá `RAGNAROK_URL/search`)
- `ragnarok-upload` — proxy pro upload/delete dokumentů + audit journal logging

### MCP integrace

MCP tool `search_ragnarok` volá edge function `ragnarok-search`, která proxyuje požadavek na Ragnarok API. Výsledky se vrací jako chunks s metadaty (document_id, score, text).

## KeyCloak OIDC Bridge

KeyCloak funguje jako enterprise OIDC provider napojený na GoTrue (Supabase Auth). Strategy: BRIDGE — KeyCloak je OIDC provider pro GoTrue, nenahrazuje jej.

### Služby

| Služba | Port | Popis |
|--------|------|-------|
| `keycloak-db` | 5433 | PostgreSQL databáze pro KeyCloak |
| `keycloak` | 8080 | KeyCloak server s admin konzolí |

### GoTrue konfigurace

```env
GOTRUE_EXTERNAL_KEYCLOAK_ENABLED=true
GOTRUE_EXTERNAL_KEYCLOAK_CLIENT_ID=evymo-app
GOTRUE_EXTERNAL_KEYCLOAK_SECRET=<secret>
GOTRUE_EXTERNAL_KEYCLOAK_URL=https://keycloak.example.com/realms/aisha
GOTRUE_EXTERNAL_KEYCLOAK_REDIRECT_URI=https://app.example.com/auth/callback
```

### Realm

Realm konfigurace: `keycloak/aisha-realm.json` (auto-import při prvním startu s prázdnou DB).

**Klíčové nastavení v realm JSON (SoT):**
- Client `aisha-app`: confidential, standardFlowEnabled
- PKCE: **vypnuté** (`pkce.code.challenge.method: ""`) — GoTrue nepodporuje PKCE pro external providers
- Email mapper: `oidc-usermodel-property-mapper` (NE attribute-mapper!) — vrací `email` + `email_verified` z built-in user properties
- loginTheme / accountTheme: `aisha` (AISHA branded theme)

**Import behavior (`--import-realm`):**
- KC 26.x importuje realm **pouze při prvním startu** (prázdná keycloak-db).
- Při restartu s existující DB se realm JSON **ignoruje** — změny musí jít přes KC Admin API.
- Po smazání `keycloak-db-data` volume se realm znovu importuje z JSON.

**Startup ordering (cross-stack):**
- GoTrue se na KC napojuje přes veřejnou doménu (`https://kc.aisha.guru/realms/aisha`), ne interní síť.
- KC nemusí běžet aby GoTrue nastartoval — GoTrue jen zaregistruje provider.
- KC **musí běžet** v okamžiku kdy uživatel klikne "Přihlásit přes AISHA ID" (OAuth flow).
- Integration stack (`docker-compose.coolify-integration.yml`) se deployuje **před nebo současně** s core stackem.
- KC start_period: 180s (Java cold start) — Coolify Sentinel musí tolerovat tuto dobu.

**Identity linking:**
- GoTrue automaticky linkuje OAuth identity na existující uživatele se stejným **potvrzeným** emailem.
- Pokud uživatel nemá `email_confirmed_at`, GoTrue vytvoří nového uživatele místo linkingu.
- KC musí vracet `email_verified: true` v tokenech (zajišťuje `oidc-usermodel-property-mapper`).

## Coolify configuration

### Web app (doporučený setup)

1. Vytvořit nový projekt → **Docker Compose**
2. Source: git repo (`GIT_BASE_URL/<owner>/<repo>.git`)
3. Docker Compose file: `docker-compose.coolify-prebuilt.yml`
4. Set environment variables (viz níže)
5. Nastavit webhook pro auto-deploy

### Supabase stack (separátní projekt)

1. Vytvořit nový projekt → **Docker Compose**
2. Source: git repo (`GIT_BASE_URL/<owner>/<repo>.git`) nebo ruční paste
3. Docker Compose file: `docker-compose.coolify.yml`
4. Set ALL environment variables (175+ vars)
5. Deploy manuálně

### Troubleshooting: `proc_open(): posix_spawn() failed: Argument list too long`

If a deployment fails with an error like:

```text
Error: proc_open(): posix_spawn() failed: Argument list too long
```

This is almost always an **OS/kernel limit** (E2BIG/ARG_MAX): Coolify (or the remote runner) is trying to execute a command where a single argument becomes huge (commonly a generated `bash -c "..."` script or a base64-inlined artifact).

Most common root cause: **one (or more) very large or multi-line environment variables** are being treated as **build-time** inputs, so they get inlined into the generated build script / Dockerfile.

Fixes (in order):

1) **Move big secrets out of build-time**
   - In Coolify, ensure large values (PEM keys, cert chains, JSON blobs, etc.) are **not** marked as build-time vars / build args.
   - Keep them as runtime-only environment variables for the running container.

2) **Prefer file-based secrets over raw env values**
   - Store TLS keys/certs, SSH keys, service account JSON, etc. as mounted files/volumes.
   - In env, keep only a *path* or reference, not the entire content.

3) **Avoid passing secrets via `docker build --build-arg`**
   - Build args often end up in the build command line (argv) and can trigger this limit.

4) **Ensure the app is actually configured as “Docker Compose from repo”**
   - If you paste Compose/YAML content into Coolify UI, it may get inlined into the runner script.
   - Prefer selecting a Compose file path from the repository instead.

## CI (deploy webhook)

CI/CD pipeline běží jako CI workflow (`.github/workflows/`). Deploy se triggeruje přes Coolify webhook.

Nastavit v repu na GitHubu → Settings → Secrets and variables → Actions (nebo `npm run deploy:init` s `GITHUB_REPOSITORY` + `GITHUB_TOKEN`):

- `COOLIFY_WEBHOOK_URL` — Webhook URL z Coolify projektu

Pipeline: `.github/workflows/ci.yml`
Detaily: [CICD.md](CICD.md) a [COOLIFY_SETUP.md](COOLIFY_SETUP.md)


If you want Coolify to deploy **AISHA Edge Functions** as part of the pipeline, also set:

- `DEPLOY_EDGE_FUNCTIONS=true`

Edge Functions runtime secrets (CORS, service role, AI keys, limits):
- See `docs/deploy/EDGE_FUNCTION_SECRETS.md`

Deploy targets (set one of):
- `SELF_HOSTED_REMOTE_HOST` — rsync over SSH to remote server
- `SELF_HOSTED_FUNCTIONS_DIR` — copy into a local Docker volume
- `COMPOSE_PROJECT_DIR` — rebuild + restart via docker compose

Optional:

- `FUNCTIONS` (space-separated subset, e.g. `"analyze-health-document download-health-document"`)

## Notes

- Deploy fails if migrations fail (by design).
- Frontend is served as an SPA; nginx is configured to route unknown paths to `index.html` for React Router.

## Validate the Compose file (recommended)

To catch YAML/Compose issues early (locally or in CI), run:

- `npm run validate:coolify:compose`

This will prefer `docker compose` when available. If the plugin is missing, it will try the official `docker/compose` container (requires the Docker daemon to be running).

If you see exit code `125` with an error like "unknown shorthand flag: 'f' in -f", it usually means Docker Compose v2 is not available in the environment.

## Important: DB migrations do NOT deploy Edge Functions

Running `npm run db:migrate` only applies SQL in `supabase/migrations/*.sql` (tables, views, RPC, policies).

**Edge Functions** (e.g. `analyze-health-document`, `download-health-document`, `upload-health-document-preflight`, `record-blockchain-audit`) live in `supabase/functions/` and must be deployed separately by `scripts/deploy-edge-functions.sh` (SSH / local docker / compose).

Optional (deploy only a subset):

- `FUNCTIONS="analyze-health-document download-health-document" DEPLOY_EDGE_FUNCTIONS=true scripts/deploy-edge-functions.sh`


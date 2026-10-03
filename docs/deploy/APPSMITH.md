# Appsmith Deploy Guide

## Architektura

Appsmith CE je **frontend dashboard vrstva** AISHA platformy. Zde běží:
- **StoryLoop Admin** — hlavní admin dashboard
- Operační a finanční dashboardy (postupně migrované)
- Canvas pro Aishiny autonomní UI modifikace (přes Appsmith API)

## Lokální vývoj

```bash
# Start Appsmith + MongoDB (vyžaduje Docker)
docker compose -f docker-compose.local.yml --profile admin up -d appsmith appsmith-mongo

# Ověření zdraví
curl http://localhost:8090/api/v1/health

# Automatický setup (workspace, datasource, app)
# Creds z env: APPSMITH_ADMIN_EMAIL + APPSMITH_ADMIN_PASSWORD (generate-secrets.mjs)
APPSMITH_ADMIN_EMAIL="${ADMIN_EMAIL:-admin@aisha.guru}" \
  APPSMITH_ADMIN_PASSWORD="$APPSMITH_ADMIN_PASSWORD" \
  python3 scripts/appsmith-api-setup.py

# UI: http://localhost:8090
# Admin: $APPSMITH_ADMIN_EMAIL / $APPSMITH_ADMIN_PASSWORD  (z .env.coolify — necommitovat)
```

### Lokální endpointy

| Služba | URL |
|--------|-----|
| Appsmith UI | http://localhost:8090 |
| Supabase Studio | http://localhost:57423 |
| Supabase API | http://localhost:57421 |
| Supabase DB | localhost:57422 |

### Datasource konfigurace (lokálně)

- **Host:** `host.docker.internal` (z kontejneru → host)
- **Port:** `57422`
- **Database:** `postgres`
- **Username:** `postgres`
- **Password:** `postgres`

## Coolify Deploy (Produkce)

### Předpoklady

1. Coolify instance s Traefik proxy
2. DNS A záznam: `appsmith.aisha.guru` → Coolify server IP

### Postup

1. **Appsmith je součástí hlavního stacku** v `docker-compose.coolify.yml` (řádek 664-720)
   - NENÍ potřeba separátní compose — běží spolu se Supabase, NocoDB, Langfuse
2. **Environment Variables** (v Coolify UI → environment):

```env
# POVINNÉ - vygeneruj unikátní hodnoty!
APPSMITH_ENCRYPTION_PASSWORD=<openssl rand -hex 32>
APPSMITH_ENCRYPTION_SALT=<openssl rand -hex 16>
APPSMITH_DOMAIN=appsmith.aisha.guru
```

3. **Domain** v Coolify: `appsmith.aisha.guru` → service `appsmith`, port 80 (Traefik labels v compose)
4. **Deploy** celý stack z Coolify UI

### Produkční datasource

- **Host:** `api.aisha.guru` (nebo interní Docker hostname pokud ve stejné síti)
- **Port:** `5432`
- **Database:** `postgres`
- **Username/Password:** viz Coolify env vars hlavního Supabase stacku

### MongoDB

MongoDB běží jako sidecar kontejner s replica set `rs0`.
Data persistují v Docker volume `appsmith_mongo_data`.

**DŮLEŽITÉ:** MongoDB replica set se automaticky inicializuje přes healthcheck.
Pokud Appsmith nenaběhne, zkontroluj `appsmith-mongo` logy:

```bash
docker logs aisha-appsmith-mongo
```

## Appsmith API

### Autentizace

Appsmith CE používá CSRF token + session cookie:

```python
# 1. Získej XSRF token
GET /api/v1/users/me → XSRF-TOKEN cookie

# 2. Login
POST /api/v1/login (form-encoded)
  username=$APPSMITH_ADMIN_EMAIL&password=$APPSMITH_ADMIN_PASSWORD
  → SESSION cookie + 302 redirect

# 3. API volání s oběma cookies + header
GET /api/v1/...
  Cookie: SESSION=...; XSRF-TOKEN=...
  X-XSRF-TOKEN: ...
```

### Klíčové endpointy

| Endpoint | Metoda | Popis |
|----------|--------|-------|
| `/api/v1/health` | GET | Health check |
| `/api/v1/workspaces` | POST | Vytvořit workspace |
| `/api/v1/datasources` | POST | Vytvořit datasource |
| `/api/v1/datasources/{id}/test` | POST | Test connection |
| `/api/v1/applications` | POST | Vytvořit app |
| `/api/v1/plugins?workspaceId=...` | GET | Seznam pluginů |

### Appsmith CE specifika

- **Environment ID:** vždy `"unused_env"` (CE nemá multi-environment)
- **Datasource format:** používej `datasourceStorages` s klíčem `"unused_env"`
- **Workspace:** musí se vytvořit manuálně (POST), první user nedostane automaticky

## Aisha integrace

Aisha (AishaAdminBridge) bude přes Appsmith API:
1. Číst stav dashboardů a queries
2. Modifikovat existující stránky
3. Vytvářet nové views a dashboardy
4. Deploye změn přes Git sync

Požadavky:
- [ ] Appsmith API token/session pro AishaAdminBridge
- [ ] Git sync repository pro version control
- [ ] n8n workflow pro Aisha → Appsmith operace

# Coolify Deployment Setup

Tento dokument popisuje jak nastavit Coolify pro deployment web aplikace (single-server).
CI běží jako CI workflow (`.github/workflows/`), deploy se triggeruje přes Coolify webhook.

> **Multi-server deployment?** Viz [MULTI_SERVER_COOLIFY.md](MULTI_SERVER_COOLIFY.md) — architektura,
> placement, init skripty a runbook pro stories rozprostřené přes Frontend/Backend/Experimental/Build.

Toto je deployment část primary A-Z cesty. Celá canonical cesta je zde:
[PRIMARY_AZ_FLOW.md](PRIMARY_AZ_FLOW.md).

## Architektura

```
CI workflow (.github/workflows)
┌────────────────────────────────────────────────────────┐
│ 1. Smart change detection                              │
│ 2. TypeScript + Lint + i18n check                      │
│ 3. Unit tests + Gate tests                             │
│ 4. Production build verification                       │
│ 5. curl Coolify webhook (on success)                   │
└────────────────────────────────────────────────────────┘
                         │
                         ▼ webhook
┌────────────────────────────────────────────────────────┐
│                    Coolify                              │
│ 6. Pull kód z git repa (GIT_BASE_URL)                  │
│ 7. Build: docker-compose.coolify-prebuilt.yml          │
│    a) migrate service → DB migrace                     │
│    b) web service → Dockerfile.web → nginx SPA         │
│ 8. Health check → switch traffic (zero-downtime)       │
└────────────────────────────────────────────────────────┘
```

## Proč prebuilt compose?

| Aspekt      | docker-compose.coolify.yml (35KB)           | docker-compose.coolify-prebuilt.yml (~2KB) |
| ----------- | ------------------------------------------- | ------------------------------------------ |
| ARG limit   | ❌ 175+ env vars = "Argument list too long" | ✅ Jen 6 proměnných                        |
| Služby      | 18 (celý Supabase stack + web)              | 2 (migrate + web)                          |
| Deploy time | Pomalé (builduje vše)                       | ✅ Rychlé (jen web + migrate)              |
| Debugging   | Komplikované (18 služeb)                    | ✅ Jednoduché (2 služby)                   |

Supabase stack (`docker-compose.coolify.yml`) je deploynutý **separátně** a mění se zřídka.

## Nastavení

### Automatický setup (doporučeno)

```bash
# Všechny 4 stacky (interaktivně se zeptá na API tokeny):
npm run deploy:init

# S tokeny jako env vars (GitHub část je volitelná):
COOLIFY_API_TOKEN=xxx GITHUB_REPOSITORY=org/repo GITHUB_TOKEN=xxx npm run deploy:init

# Konkrétní stack(y):
bash scripts/coolify-deploy-init.sh --stack web
bash scripts/coolify-deploy-init.sh --stack core,langfuse

# Dry run (jen ukáže co by udělal):
npm run deploy:init:dry
```

Skript `scripts/coolify-deploy-init.sh` automaticky pro **každý stack**:

1. Najde existující Coolify aplikaci (nebo řekne jak ji vytvořit)
2. Nastaví per-stack env vars v Coolify (build + runtime)
3. Pro Web stack: nastaví CI secrets `COOLIFY_WEBHOOK_URL` + `COOLIFY_TOKEN` v repu na GitHubu
   (`gh secret set`; jen s `GITHUB_REPOSITORY` + `GITHUB_TOKEN`, jinak vypíše, co nastavit ručně)

**4 stacky:**

| Stack      | Compose file                          | Popis                                       |
| ---------- | ------------------------------------- | ------------------------------------------- |
| `core`     | `docker-compose.coolify.yml`          | Supabase (DB, Auth, API, Studio, KeyCloak…) |
| `web`      | `docker-compose.coolify-prebuilt.yml` | Frontend + DB migrace                       |
| `langfuse` | `docker-compose.coolify-langfuse.yml` | AI Observability (ClickHouse, Redis, MinIO) |
| `admin`    | `docker-compose.coolify-admin.yml`    | NocoDB + Appsmith                           |

Všechny hodnoty zná z `.env` / `.env.coolify` / self-hosted defaults.

**Prerekvizity:**

- `jq` nainstalován (`brew install jq`)
- Coolify API token: `https://<coolify-host>` → Settings → API Tokens
- volitelně GitHub: `GITHUB_REPOSITORY` + fine-grained `GITHUB_TOKEN` (Actions secrets write) + `gh` CLI

---

### Manuální setup (alternativa)

#### 1. Vytvořit Coolify projekt

1. V Coolify vytvoř nový projekt → **Docker Compose**
2. Source: Git repository (`GIT_BASE_URL/<owner>/<repo>.git`)
3. Docker Compose file: `docker-compose.coolify-prebuilt.yml`
4. Branch: `main`
5. Nastav webhook (viz níže)

#### 2. Git source v Coolify

1. Veřejné repo: stačí URL (`GIT_BASE_URL/<owner>/<repo>.git`)
2. Soukromé repo: token s read přístupem (`GIT_TOKEN`) — `coolify-story-init.sh` ho vloží do URL
   (`https://aisha:<token>@…`), do logu jde jen maskovaná podoba

#### 3. Nastavit Deploy Webhook

1. V Coolify projektu jdi do **Webhooks / Settings → Deploy**
2. Vytvoř nový deploy webhook → zkopíruj URL
3. V repu na GitHubu nastav CI secret (Settings → Secrets and variables → Actions):
   ```
   COOLIFY_WEBHOOK_URL=https://<coolify-host>/api/v1/deploy?uuid=<APP_UUID>&force=false
   ```

#### 4. Environment Variables v Coolify

V Coolify UI nastav tyto proměnné pro compose:

**Build-time (baked do frontend bundle):**

| Proměnná                 | Typ   | Popis                                       |
| ------------------------ | ----- | ------------------------------------------- |
| `VITE_AISHA_POSTGREST_URL`      | Build | Supabase API URL (`https://api.aisha.guru`) |
| `VITE_AISHA_POSTGREST_ANON_KEY` | Build | Supabase anon/public key                    |
| `VITE_PUBLIC_SITE_URL`   | Build | Veřejná web URL pro auth redirecty          |
| `PUBLIC_SITE_URL`        | Build | SEO generator (sitemap/robots)              |
| `VITE_SENTRY_DSN`        | Build | Sentry DSN (volitelné)                      |

**Runtime (pro migrate service):**

| Proměnná          | Typ     | Popis                            |
| ----------------- | ------- | -------------------------------- |
| `AISHA_DB_URL` | Runtime | DB connection string pro migrace |

**DŮLEŽITÉ:** V Coolify UI označujte proměnné správně jako "Build" nebo "Runtime".
Build proměnné se injektují do `docker build --build-arg`. Runtime se předají do kontejneru.

## CI Secrets

Nastavit v repu na GitHubu: **Settings → Secrets and variables → Actions** (nebo automaticky přes `deploy:init`)

| Secret                | Popis                      |
| --------------------- | -------------------------- |
| `COOLIFY_WEBHOOK_URL` | Coolify deploy webhook URL |

Volitelné:
| Secret | Popis |
|--------|-------|
| `VERDACCIO_TOKEN` | NPM auth token pro privátní registr (`VERDACCIO_URL`) |
| `N8N_API_KEY` | n8n API klíč (pro workflow triggery) |

## Soubory

| Soubor                                | Účel                                       |
| ------------------------------------- | ------------------------------------------ |
| `.github/workflows/ci.yml`            | CI/CD pipeline                             |
| `docker-compose.coolify-prebuilt.yml` | Web deploy compose (migrate + web)         |
| `docker-compose.coolify.yml`          | Supabase stack (separátní Coolify projekt) |
| `Dockerfile.web`                      | Standalone web build (3-stage)             |
| `Dockerfile.migrate`                  | Standalone DB migrace (2-stage)            |

## Deploy Flow

```
push to main
     │
     ▼
┌─────────────────────────────────────────┐
│ CI (.github/workflows/ci.yml)           │
│ 1. Detect changes (smart routing)       │
│ 2. TypeScript + Lint + i18n             │
│ 3. Unit tests + Gate tests              │
│ 4. Production build check               │
│ 5. curl COOLIFY_WEBHOOK_URL             │
└────────┬────────────────────────────────┘
         │
         ▼ webhook
┌─────────────────────────────────────────┐
│ Coolify                                 │
│ 1. Pull kód z git.id3a.cz              │
│ 2. docker compose build (prebuilt.yml)  │
│ 3. migrate → DB migrace                │
│ 4. web → Dockerfile.web → nginx        │
│ 5. Health check → switch traffic        │
└─────────────────────────────────────────┘
```

## Manuální Deployment

```bash
# Přímý webhook trigger:
curl -X POST "$COOLIFY_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"ref": "refs/heads/main"}'

# Nebo v Coolify UI: projekt → Deployments → Deploy
```

## Troubleshooting

### "Argument list too long"

Coolify builduje z `docker-compose.coolify.yml` (35KB) místo prebuilt compose.
**Řešení:** V Coolify UI změnit Docker Compose file na `docker-compose.coolify-prebuilt.yml`.

### Image not found / Build fails

```bash
# Lokální test web build:
docker build -f Dockerfile.web -t test-web .

# Lokální test migrate build:
docker build -f Dockerfile.migrate -t test-migrate .
```

### Migrate selhává

```bash
# Check migrate logs v Coolify UI (container logs)
# Nebo lokálně:
docker logs <migrate-container> --tail 100

# Ověř DB konektivitu:
PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A -c "SELECT 1"
```

### Webhook nefunguje

1. Ověř `COOLIFY_WEBHOOK_URL` v CI secrets repa
2. Test manuálně: `curl -v -X POST "$COOLIFY_WEBHOOK_URL"`
3. Zkontroluj Coolify deployment logs
   ```

   ```

### Starý image

Coolify může cachovat. Zkus:

1. `docker rmi platform-web:latest` na serveru
2. Re-run GitHub Actions workflow
3. Nebo Coolify → **Redeploy**

### DB migrace selhávají

Zkontroluj `AISHA_DB_URL` secret v GitHub a network connectivity ze self-hosted runneru.

### Keycloak restart loop: `FATAL: password authentication failed for user "keycloak"`

Symptom:

- `aisha-keycloak` je ve stavu `restarting:unknown`
- v logu Keycloak je `Failed to obtain JDBC connection`
- v `keycloak-db`/Postgres logu je `scram-sha-256` + auth failure pro user `keycloak`

Typická příčina:

- změna `KEYCLOAK_DB_PASSWORD` v Coolify při zachovaném volume `evymo_keycloak-db-data`
- role `keycloak` v DB má staré heslo, ale Keycloak container používá nové

Mitigace v repu (2026-04-22):

- `docker-compose.coolify-keycloak.yml` synchronizuje při startu `keycloak-db` heslo role `keycloak` na aktuální `POSTGRES_PASSWORD`
- `scripts/aisha-cold-start.sh` defaultně zachovává stateful DB hesla z existující `.env.coolify` (`PRESERVE_STATEFUL_SECRETS=1`)

Recovery postup:

1. Nasadit aktuální `docker-compose.coolify-keycloak.yml`.
2. Spustit redeploy stacku `aisha-keycloak`.
3. Ověřit health endpoint: `https://auth.aisha.guru/realms/aisha/.well-known/openid-configuration`.

---

## Coolify Domains — docker_compose_domains

### Jak Coolify routuje multi-service compose stacks

Coolify používá `docker_compose_domains` k automatickému generování Traefik labelů.
Nepoužíváme vlastní `traefik.*` labels — vše generuje Coolify z `docker_compose_domains`.

**DŮLEŽITÉ pravidlo — port v doméně:**

| expose port | doména                         | proč                                       |
| ----------- | ------------------------------ | ------------------------------------------ |
| `80`        | `https://web.aisha.guru`       | Port 80 je default, Coolify ho nepotřebuje |
| `8000`      | `https://api.aisha.guru:8000`  | Port ≠ 80 → **MUSÍ** být v URL             |
| `8080`      | `https://auth.aisha.guru:8080` | Port ≠ 80 → **MUSÍ** být v URL             |
| `3000`      | `https://db.aisha.guru:3000`   | Port ≠ 80 → **MUSÍ** být v URL             |

Coolify z portu v URL generuje Traefik label `loadbalancer.server.port`.
Bez portu Traefik neví kam směrovat → **503 Service Unavailable**.

### Aktuální konfigurace domén

#### Core stack (js80o0ccc0888o0wwkc80ss8)

```
web      → https://web.aisha.guru           (expose: 80)
kong     → https://api.aisha.guru:8000   (expose: 8000)
keycloak → https://kc.aisha.guru:8080             (expose: 8080)
studio   → https://db.aisha.guru:3000 (expose: 3000)
```

#### Admin stack (vkg8gw4ggkc88wo84og4o8kc)

```
nocodb   → https://nocodb.aisha.guru:8080         (expose: 8080)
appsmith → https://appsmith.aisha.guru             (expose: 80)
```

#### Langfuse stack (i8gkg8c4k4gkgwc444s8cww0)

```
langfuse-web → https://langfuse.aisha.guru:3000   (expose: 3000)
```

### Co se nesmí dělat

- **❌ Vlastní `traefik.*` labels v compose** — Coolify je generuje sám, vlastní labels se s nimi bijí (dva routery na stejnou doménu, chybějící `.service=` reference)
- **❌ Doména bez portu pro expose ≠ 80** — Coolify vygeneruje label bez `loadbalancer.server.port` → Traefik neví kam → 503
- **❌ Manuální editace domén v Coolify UI bez aktualizace deploy skriptu** — Při dalším `deploy:init` se přepíšou zpět

### Setup přes deploy skript

```bash
# Automaticky nastaví domény se správnými porty:
bash scripts/coolify-deploy-init.sh --stack core
bash scripts/coolify-deploy-init.sh --stack admin
bash scripts/coolify-deploy-init.sh --stack langfuse
```

### Manuální nastavení přes Coolify API

```bash
# Formát: pole objektů s name + domain (včetně portu!)
curl -X PATCH "https://frontend.id3a.cz/api/v1/applications/${APP_UUID}" \
  -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "docker_compose_domains": [
      {"name": "web",      "domain": "https://web.aisha.guru"},
      {"name": "kong",     "domain": "https://api.aisha.guru:8000"},
      {"name": "keycloak", "domain": "https://kc.aisha.guru:8080"},
      {"name": "studio",   "domain": "https://db.aisha.guru:3000"}
    ]
  }'
```

### Compose pravidla pro routované služby

Každá služba routovaná přes Coolify domény musí mít:

```yaml
service_name:
  expose:
    - "PORT" # Port který Coolify routuje
  networks:
    - internal # Interní komunikace mezi službami
    - coolify # POVINNÉ — Traefik proxy tuto síť vidí
  labels:
    - "coolify.managed=true" # POVINNÉ — Coolify label
```

**Bez `networks: [coolify]`** Traefik kontejner nevidí → 503.

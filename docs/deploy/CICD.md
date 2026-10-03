# CI/CD Pipeline

## Architektura

```
┌─────────────────────────────────────────────────────────────────┐
│               Forgejo Actions (git.id3a.cz)                     │
│               Runner: DinD (coolify/apps/forgejo)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  🔍 detect  ──┬──► 🧪 check (TypeScript, Lint, i18n)            │
│  (changes)   │                                                   │
│              ├──► 🧪 test (Unit, Gates)                         │
│              │                                                   │
│              ├──► 🏗️ build (Vite production build)              │
│              │                                                   │
│              └──► 🚀 deploy (Coolify webhook)                   │
│                       └─► Coolify builds + deploys              │
│                           (docker-compose.coolify-prebuilt.yml) │
│                           migrate → web                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Smart Routing

Pipeline automaticky detekuje co se změnilo a přeskočí irelevantní joby:

| Změna | check | test | build | deploy |
|-------|-------|------|-------|--------|
| Jen docs | skip | skip | skip | skip |
| Jen migrations | ✅ | ✅ | skip | ✅ (migrate service) |
| Jen code | ✅ | ✅ | ✅ | ✅ |
| code + migrations | ✅ | ✅ | ✅ | ✅ |

## Infrastruktura

| Komponenta | Služba | URL |
|------------|--------|-----|
| **Git server** | Forgejo | `git.id3a.cz` |
| **CI/CD Runner** | Forgejo Actions (DinD) | Součást Forgejo stacku |
| **NPM proxy** | Verdaccio | `npm.id3a.cz` |
| **Deployment** | Coolify | Traefik reverse proxy |
| **Web app** | nginx SPA | `web.aisha.guru` |
| **API** | Kong/Supabase | `api.aisha.guru` |

### Forgejo Runner

Runner je **součástí Forgejo stacku** (`coolify/apps/forgejo/docker-compose.yml`):
- Image: `code.forgejo.org/forgejo/runner:6.2.2`
- Izolace: DinD (Docker-in-Docker) — nepřipojuje se na host Docker socket
- Labels: `ubuntu-latest:docker://node:20-bookworm`, `self-hosted:host`
- **Runner NENÍ v tomto repozitáři** — žije v `coolify/apps/forgejo/`

### Proč DinD?

Runner nemůže přímo deployovat na host Docker daemon. Proto:
1. CI testuje kód (uvnitř DinD kontejneru)
2. CI triggeruje Coolify webhook po úspěšných testech
3. **Coolify** builduje a deployuje z `docker-compose.coolify-prebuilt.yml`

## Deploy strategie

### Web deploy (Coolify webhook)

```
push to main → Forgejo CI → testy projdou → curl webhook → Coolify builds + deploys
```

Coolify používá `docker-compose.coolify-prebuilt.yml` (~2KB):
- `migrate` service — spustí DB migrace (Dockerfile.migrate)
- `web` service — builduje frontend (Dockerfile.web), startuje po úspěšné migraci

**Proč prebuilt compose?** Hlavní `docker-compose.coolify.yml` (35KB, 18 služeb) způsoboval
`proc_open(): posix_spawn() failed: Argument list too long` — Coolify base64-encoduje
celý compose do SSH argumentu, 47KB přesahuje OS ARG_MAX limit.

### Supabase stack

Supabase backend (`docker-compose.coolify.yml`) je deploynutý **separátně** a mění se zřídka.
Web deploys jdou přes lehký prebuilt compose, ne přes 35KB all-in-one soubor.

### DB Migrace

Migrace běží jako `migrate` service v `docker-compose.coolify-prebuilt.yml`:
- Používá `Dockerfile.migrate` (Node 22 + postgresql-client)
- Připojeno na `aisha-network` → přístup k `aisha-db:5432`
- `restart: "no"` — spustí se jednou a ukončí se
- Web service startuje až po `service_completed_successfully`

## Pipeline Stages

### 1. 🔍 Detect Changes
- Porovná HEAD~1 vs HEAD
- Nastaví output flagy: `code`, `migrations`, `docs_only`, `functions`
- Docs-only změny přeskočí celý pipeline

### 2. 🧪 Check
- TypeScript: `npx tsc --noEmit`
- ESLint: `npm run lint`
- i18n: `npm run i18n:check`

### 3. 🧪 Test
- Unit testy: `npm run test:run`
- Gate testy: `npm run test:gates`

### 4. 🏗️ Build
- Production build: `npm run build`
- Ověření, že build projde (Coolify pak builduje znovu z Dockerfile.web)

### 5. 🚀 Deploy
- `curl -X POST "$COOLIFY_WEBHOOK_URL"` s ref + sha
- Coolify obdrží webhook → pulls kód → builds compose → deploys

## Setup (Forgejo Secrets + Coolify env vars)

**Automatický setup (doporučeno):**
```bash
npm run deploy:init        # interaktivně
npm run deploy:init:dry    # dry run
```

Viz [COOLIFY_SETUP.md](COOLIFY_SETUP.md) pro detaily.

### Forgejo Secrets

Nastavit v Forgejo UI: **Settings → Secrets** (nebo automaticky přes `deploy:init`)

| Secret | Popis | Required |
|--------|-------|----------|
| `COOLIFY_WEBHOOK_URL` | Coolify deploy webhook URL | ✅ |
| `VERDACCIO_TOKEN` | NPM auth token pro npm.id3a.cz | ❌ (pro publish) |
| `N8N_API_KEY` | n8n API klíč (pro workflow triggery) | ❌ |

### Coolify env vars (v Coolify UI pro prebuilt compose, nebo přes `deploy:init`)

| Proměnná | Typ | Popis |
|----------|-----|-------|
| `VITE_AISHA_POSTGREST_URL` | Build | Supabase API URL |
| `VITE_AISHA_POSTGREST_ANON_KEY` | Build | Supabase anon key |
| `VITE_PUBLIC_SITE_URL` | Build | Veřejná URL pro auth redirecty |
| `PUBLIC_SITE_URL` | Build | URL pro sitemap/robots (SEO) |
| `VITE_SENTRY_DSN` | Build | Sentry error monitoring |
| `AISHA_DB_URL` | Runtime | DB connection string (pro migrate) |

## Soubory

| Soubor | Účel |
|--------|------|
| `.forgejo/workflows/ci.yml` | CI/CD pipeline (Forgejo Actions) |
| `.forgejo/workflows/test-community-nodes.yml` | n8n community nodes testy |
| `docker-compose.coolify-prebuilt.yml` | Coolify deploy compose (web + migrate) |
| `docker-compose.coolify.yml` | Supabase stack (separátní deploy) |
| `Dockerfile.web` | Standalone web build (3-stage: deps→builder→nginx) |
| `Dockerfile.migrate` | Standalone migrace (2-stage: deps→migrator) |
| `docker/nginx.conf` | Nginx SPA konfigurace |

## Manuální operace

### Trigger deploy

```bash
# Deploy se spouští automaticky při push na main.
# Manuální trigger: Forgejo UI → Actions → Run workflow

# Nebo přímý webhook:
curl -X POST "$COOLIFY_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"ref": "refs/heads/main"}'
```

### Check container status

```bash
docker ps --filter "name=platform-web"
docker logs platform-web --tail 100
```

### Rollback

```bash
# Coolify UI: vybrat předchozí deployment a kliknout "Redeploy"
# Nebo revert commit a push → CI spustí nový deploy
```

## Troubleshooting

### "Argument list too long"

Coolify builduje z `docker-compose.coolify.yml` (35KB) místo prebuilt compose.
**Řešení:** V Coolify UI změnit Docker Compose file na `docker-compose.coolify-prebuilt.yml`.

### Migrace selhávají

```bash
# Check migrate container logs
docker logs <migrate-container-name> --tail 100

# Verify DB connectivity
PGPASSWORD=postgres psql -h 127.0.0.1 -p 57422 -U postgres -d postgres -t -A -c "SELECT 1"
```

### CI joby selhávají

1. Zkontroluj Forgejo Actions log: `git.id3a.cz` → repo → Actions
2. Ověř, že runner běží: Forgejo admin → Runners
3. Ověř npm.id3a.cz dostupnost (Verdaccio)

### Webhook nefunguje

```bash
# Test webhook manuálně
curl -v -X POST "$COOLIFY_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"ref": "refs/heads/main"}'

# Check Coolify deployment logs v Coolify UI
```


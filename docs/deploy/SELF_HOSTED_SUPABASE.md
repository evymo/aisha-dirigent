# Self-Hosted Supabase — Deployment Guide

> **Verze:** 1.0 | **Datum:** 2025

## Přehled

AISHA Platform zahrnuje kompletní self-hosted Supabase stack řízený z repozitáře.
Všechny služby jsou definovány v `docker/docker-compose.supabase.yml` a nasazeny přes Coolify (Traefik).

## Architektura

```
┌─────────────────── Coolify (Traefik) ────────────────────┐
│                                                           │
│  api.evymo.com  ──► kong:8000 (API Gateway)              │
│  studio.evymo.com ──► studio:3000 (Dashboard)            │
│                                                           │
└───────────────────────────────────────────────────────────┘
        │                    │
        ▼                    ▼
┌─────────── aisha-network (internal) ─────────────────────┐
│                                                           │
│  kong ──► auth (GoTrue)      :9999                       │
│       ──► rest (PostgREST)   :3000                       │
│       ──► realtime           :4000                       │
│       ──► storage            :5000                       │
│       ──► edge-functions     :5001                       │
│       ──► meta               :8080                       │
│                                                           │
│  db (PostgreSQL 17)          :5432                        │
│  imgproxy                    :8080                        │
│  analytics (Logflare)        :4000  [optional]           │
│  vector                      :9001  [optional]           │
│                                                           │
│  ─── n8n (separate Coolify resource, joins network) ───  │
│  n8n.aisha.guru ──► n8n      :5678                       │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## Soubory

| Soubor | Účel |
|--------|------|
| `docker/docker-compose.supabase.yml` | Hlavní compose — všechny Supabase služby |
| `docker/.env.supabase.example` | Referenční .env s komentáři |
| `docker/volumes/kong/kong.yml` | Kong deklarativní routing config |
| `docker/volumes/vector/vector.yml` | Vector log collector config |
| `Dockerfile` | Multi-target: `migrator`, `functions-init`, `functions`, `web` |
| `scripts/aisha-provision.ts` | n8n auto-provisioning (workflows + credentials) |
| `scripts/deploy-edge-functions.sh` | 4-mode deploy: compose, SSH, local, cloud |

## Nasazení na Coolify

### 1. Nový projekt

```
Coolify UI → Projects → New → Docker Compose
  Repository: github.com/evymo/aisha-dirigent
  Branch: main
  Docker Compose: docker/docker-compose.supabase.yml
```

### 2. Environment Variables

Zkopíruj `docker/.env.supabase.example` do Coolify Environment a nastav:

**Povinné:**
- `POSTGRES_PASSWORD` — databázové heslo
- `JWT_SECRET` — min 32 znaků, HS256
- `ANON_KEY` — Supabase anon JWT
- `SERVICE_ROLE_KEY` — Supabase service role JWT
- `API_DOMAIN` — doména pro API Gateway (např. `api.evymo.com`)

**Doporučené:**
- `OPENAI_API_KEY` — pro AI funkce
- `SITE_URL` — URL webové aplikace
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` — emailové notifikace

**Volitelné:**
- `STUDIO_DOMAIN` — doména pro Supabase Studio
- `MCP_TOKEN` — statický token pro MCP auth
- `MCP_REQUIRE_AUTH` — `true` pro produkci

### 3. Deploy

Coolify automaticky:
1. Buildne `functions-init` a `migrate` images z Dockerfile
2. Spustí `migrate` (DB migrace)
3. Spustí `functions-init` (kopíruje Edge Functions do volume)
4. Nastartuje všechny služby
5. Kong routuje traffic přes Traefik labels

### 4. n8n jako separátní resource

n8n běží jako samostatný Coolify resource ale sdílí `aisha-network`:

```yaml
# V Coolify n8n compose přidej:
networks:
  aisha-network:
    external: true
    name: aisha-network
```

n8n pak přistupuje k Supabase přes `http://evymo-kong:8000`.

## Edge Functions Deploy (po změně kódu)

### Compose mode (doporučeno pro self-hosted)

```bash
DEPLOY_EDGE_FUNCTIONS=true \
COMPOSE_PROJECT_DIR=/path/to/aisha-dirigent \
bash scripts/deploy-edge-functions.sh
```

### SSH remote mode

```bash
DEPLOY_EDGE_FUNCTIONS=true \
SELF_HOSTED_REMOTE_HOST=server.evymo.com \
SELF_HOSTED_REMOTE_USER=deploy \
bash scripts/deploy-edge-functions.sh
```

## n8n Auto-Provisioning

Po nasazení n8n, importuj workflow a vytvroř credentials automaticky:

```bash
N8N_API_URL=https://n8n.aisha.guru \
N8N_API_KEY=xxx \
AISHA_POSTGREST_URL=https://api.evymo.com \
AISHA_POSTGREST_SERVICE_KEY=xxx \
OPENAI_API_KEY=xxx \
deno run --allow-net --allow-read --allow-env scripts/aisha-provision.ts
```

Dry run (pouze zobrazí co by se stalo):
```bash
DRY_RUN=true N8N_API_URL=... N8N_API_KEY=... deno run --allow-net --allow-read --allow-env scripts/aisha-provision.ts
```

## MCP Authentication

MCP Knowledge Server podporuje dva auth módy:

| Mód | Hlavička | Použití |
|-----|----------|---------|
| MCP_TOKEN | `Authorization: Bearer <MCP_TOKEN>` | n8n, CI/CD, service-to-service |
| Supabase JWT | `Authorization: Bearer <jwt>` | VS Code extension, authenticated users |

**Aktivace:** Nastav `MCP_REQUIRE_AUTH=true` v env variables.

V dev režimu (default) je auth vypnutý pro snadný vývoj.

## Profily (optional services)

Analytics stack (Logflare + Vector) se aktivují profilem:

```bash
# Pouze core služby
docker compose -f docker/docker-compose.supabase.yml up -d

# S analytics
docker compose -f docker/docker-compose.supabase.yml --profile analytics up -d

# Vše
docker compose -f docker/docker-compose.supabase.yml --profile full up -d
```

## Troubleshooting

### Edge Functions nefungují

```bash
# Zkontroluj že functions-init doběhl
docker logs aisha-functions-init

# Zkontroluj volume
docker exec aisha-edge-functions ls -la /home/deno/functions/

# Zkontroluj edge-runtime logy
docker logs aisha-edge-functions --tail 50
```

### DB migrace selhává

```bash
# Zkontroluj migrate container
docker logs aisha-migrate

# Manuální migrace
docker compose -f docker/docker-compose.supabase.yml run --rm migrate
```

### Kong vrací 502

Služba za Kong není ready. Zkontroluj healthchecky:

```bash
docker compose -f docker/docker-compose.supabase.yml ps
```

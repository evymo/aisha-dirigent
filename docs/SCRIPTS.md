# Scripts — Kompletní přehled

Tato stránka shrnuje **všechny npm příkazy** pro workflow vývoje AISHA Platform.

Pro nejjednodušší end-to-end cestu od local setupu po web deploy nejdřív použij
[deploy/PRIMARY_AZ_FLOW.md](deploy/PRIMARY_AZ_FLOW.md).
Tento dokument je referenční katalog všech scriptů včetně advanced workflow.

---

## 📋 Obsah

1. [Nejvíc používané](#-nejvíc-používané)
2. [Development](#-development)
3. [Build & Deploy](#-build--deploy)
4. [Infrastruktura (Docker)](#-infrastruktura-docker)
5. [Lokální Supabase](#-lokální-supabase)
6. [Databáze — Lokální](#-databáze--lokální)
7. [Databáze — Produkce](#-databáze--produkce)
8. [Migrace & Funkce](#-migrace--funkce)
9. [Testování](#-testování)
10. [i18n](#-i18n-internacionalizace)
11. [AI / Local LLM](#-ai--local-llm)
12. [AISHA Orchestrace](#-aisha-orchestrace)

---

## 🚀 Nejvíc používané

| Příkaz | Popis |
|--------|-------|
| `npm run dev` | Lokální dev server (Vite) |
| `npm run build` | Produkční build |
| `npm run lint` | ESLint kontrola |
| `npm run test:run` | Spustit všechny unit testy |
| `npm run test:run -- <cesta>` | Spustit jen relevantní testy |
| `npm run debug:verify` | Kompletní ověření: i18n + testy + build |
| **`npm run warmup`** | **Kompletní warmup workflow (stages 1-5)** |
| **`npm run warmup:quick`** | **Rychlý warmup: infra + db + verify** |

**⚠️ Před každým push na main:**
```bash
npm run test:run && npm run build
```

---

## 🔥 Warmup Workflow

Unified workflow pro inicializaci celého dev prostředí. Skript `scripts/warmup.sh` orchestruje 7 stages v logickém pořadí:

```
Stage 1: INFRA    ─ npm install, local AISHA stack (warmup:local / setup), Docker services (Keycloak + Postgres17 + PostgREST + Gateway)
Stage 2: LLM      ─ Auto-detect & setup local LLM backend (MLX/Ollama/Docker)
Stage 3: DB       ─ Migration register, migrate, types gen
Stage 4: VERIFY   ─ TypeScript check, ESLint, i18n
Stage 5: TEST     ─ Gate testy + unit testy
Stage 6: BUILD    ─ Production build + TypeDoc
Stage 7: AISHA    ─ n8n sync, tools deploy, watchdogs (optional)
```

### Příkazy

| Příkaz | Popis |
|--------|-------|
| `npm run warmup` | Kompletní warmup — stages 1-5 |
| `npm run warmup:quick` | Rychlý warmup — stages 1-3 (infra + db + verify) |
| `npm run warmup:all` | Vše včetně Aisha orchestrace (stages 1-6) |
| `npm run warmup:status` | Stav prostředí (co běží, co chybí) |
| `npm run warmup:dry` | Dry-run — ukáže co by se spustilo |

### Pokročilé použití

```bash
# Jen konkrétní stage
./scripts/warmup.sh --stage db        # Jen migrace + typy
./scripts/warmup.sh --stage verify     # Jen kontroly kvality
./scripts/warmup.sh --stage aisha      # Jen Aisha orchestrace

# Od konkrétní stage dál
./scripts/warmup.sh --from verify      # Stages 3-5
./scripts/warmup.sh --from test        # Stages 4-5

# Kombinace
./scripts/warmup.sh --all --dry        # Dry-run celého warmup včetně Aisha
```

### Kdy co použít

| Situace | Příkaz |
|---------|--------|
| Ráno po zapnutí | `npm run warmup:quick` |
| Před PR / push | `npm run warmup` |
| Po git pull s DB změnami | `./scripts/warmup.sh --from db` |
| Jen LLM setup | `./scripts/warmup.sh --stage llm` |
| Kompletní setup (i n8n) | `npm run warmup:all` |
| Co vlastně běží? | `npm run warmup:status` |

---

## 💻 Development

| Příkaz | Popis |
|--------|-------|
| `npm run dev` | Lokální Vite dev server |
| `npm run preview` | Preview produkčního buildu lokálně |
| `npm run lint` | ESLint kontrola |
| `npm run lint:console` | Kontrola console.log statements |
| `npm run debug:verify` | Sekvenční i18n check + testy + build |

---

## 📦 Build & Deploy

| Příkaz | Popis |
|--------|-------|
| `npm run build` | Produkční build |
| `npm run build:dev` | Development build |
| `npm run docs:build` | Generovat TypeDoc dokumentaci |

### Coolify Deploy

Produkce běží na **Coolify** s multi-target Dockerfile.

| Soubor | Účel |
|--------|------|
| `Dockerfile` | Multi-target: `migrator` → `functions` → `web` |
| `Dockerfile.web` | Zjednodušený web-only build |
| `docker-compose.coolify.yml` | Kompletní pipeline (migrate + functions + web) |
| `docker-compose.coolify-prebuilt.yml` | Minimal web-only deploy |
| `.env.docker.example` | Template env vars pro Docker/Coolify |

### Multi-Server Stories

Pro stories rozprostřené přes více serverů viz **[deploy/MULTI_SERVER_COOLIFY.md](deploy/MULTI_SERVER_COOLIFY.md)**.

| Soubor | Účel |
|--------|------|
| `coolify/servers.json` | Server registry (kapacity, role, stacks) |
| `coolify/servers.schema.json` | JSON Schema pro validaci servers.json |
| `coolify/manifests/*.manifest` | Placement manifesty pro stories |
| `scripts/coolify-story-init.sh` | Provisionuje Coolify apps pro story (multi-server) |
| `scripts/check-infra.mjs` | Health check všech stacků across servers |

**Pipeline:**
```
migrate (DB migrations) → deploy-functions (Edge Functions) → web (nginx SPA)
```

Obě kroky (migrate, deploy-functions) mají **gate switches** — defaultně `false`:
- `RUN_DB_MIGRATIONS=true` — zapne migraci
- `DEPLOY_EDGE_FUNCTIONS=true` — zapne deploy edge functions

---

## 🏗️ Infrastruktura (Docker)

### Lokální stack

```
┌─────────────────────────────────────────────────────┐
│  npm run infra:up                                   │
├──────────────────────┬──────────────────────────────┤
│  Supabase CLI        │  docker-compose.local.yml    │
│  (npx supabase start)│  (docker compose up -d)      │
├──────────────────────┼──────────────────────────────┤
│  PostgreSQL    :57422│  Redis          :6379         │
│  PostgREST     :57421│  Mailpit (SMTP) :1025         │
│  GoTrue (Auth)       │  Mailpit (UI)   :8025         │
│  Studio        :57423│                               │
│  Inbucket      :57424│  -- profily --                │
│  Edge Runtime        │  n8n            :5678  [full] │
│  Analytics     :57427│  n8n-worker            [full] │
│                      │  pgAdmin        :5050  [db]   │
└──────────────────────┴──────────────────────────────┘
```

### Příkazy

| Příkaz | Popis |
|--------|-------|
| `npm run infra:up` | Start Supabase + Redis + Mailpit |
| `npm run infra:up:full` | Start vše včetně n8n + pgAdmin |
| `npm run infra:up:n8n` | Start jen n8n + worker (+ Redis) |
| `npm run infra:down` | Stop vše |
| `npm run infra:status` | Stav všech služeb |
| `npm run infra:logs` | Živé logy z Docker služeb |

### Docker Compose profily

`docker-compose.local.yml` používá **profily** pro volitelné služby:

| Služba | Profil | Port | Popis |
|--------|--------|------|-------|
| Redis | *(vždy)* | 6379 | Queue + cache |
| Mailpit | *(vždy)* | 8025/1025 | Email catch-all + web UI |
| n8n | `full`, `n8n` | 5678 | Workflow engine |
| n8n-worker | `full`, `n8n` | — | Queue worker |
| pgAdmin | `full`, `db` | 5050 | DB admin UI |

```bash
# Jen Redis + Mailpit (default)
docker compose -f docker-compose.local.yml up -d

# Jen n8n stack
docker compose -f docker-compose.local.yml --profile n8n up -d

# Kompletní stack
docker compose -f docker-compose.local.yml --profile full up -d

# Jen vybrané služby
docker compose -f docker-compose.local.yml up -d redis mailpit
```

### Soubory

| Soubor | Účel |
|--------|------|
| `supabase/config.toml` | Konfigurace lokální Supabase (porty 574xx) |
| `docker-compose.local.yml` | Lokální dev služby (n8n, Redis, Mailpit, pgAdmin) |
| `docker-compose.coolify.yml` | Produkční deploy pipeline |
| `docker-compose.coolify-prebuilt.yml` | Web-only deploy |
| `Dockerfile` | Multi-target build |
| `docker/nginx.conf` | SPA nginx konfigurace |
| `scripts/deploy-edge-functions.sh` | Edge Functions deploy (SSH/Docker/Cloud) |
| `.env.docker.example` | Template env vars pro Docker deploy |

---

## ⚡ Lokální Supabase

| Příkaz | Popis |
|--------|-------|
| `npm run supabase:start` | Spustit lokální Supabase stack |
| `npm run supabase:stop` | Zastavit lokální Supabase stack |
| `npm run supabase:status` | Stav lokálního Supabase |
| `npm run supabase:reset` | Reset lokální DB (supabase db reset) |
| `npm run supabase:functions:serve` | Lokální Edge Functions server |

**Lokální endpointy (config.toml):**
- API URL: `http://localhost:57421`
- DB: `postgresql://postgres:postgres@localhost:57422/postgres`
- Studio: `http://localhost:57423`
- Inbucket: `http://localhost:57424`

---

## 🗃️ Databáze — Lokální

### Kompletní workflow

| Příkaz | Popis |
|--------|-------|
| `npm run db:local:setup` | Start + migrace + seed + status (komplet) |
| `npm run db:local:reset` | Reset + migrace + seed |
| `npm run db:migrate:local` | Aplikovat migrace |
| `npm run db:migrate:dry` | Dry-run migrací (nevykoná) |
| `npm run db:seed:local` | Seed data |
| `npm run db:types:gen:local` | Generovat TypeScript typy |
| `npm run db:types:preview` | Preview typů (bez zápisu) |
| `npm run db:types:refresh:local` | Migrace + generovat typy |
| `npm run db:status:local` | Stav lokální DB |

### Typický workflow po změně DB funkce

```bash
# 1. Vytvoř migraci
supabase/migrations/YYYYMMDDHHMMSS_popis.sql

# 2. Zaregistruj migraci
npm run db:migration:register

# 3. Aplikuj migraci na lokální DB
npm run db:migrate:local

# 4. Vygeneruj typy z lokální DB
npm run db:types:gen:local

# 5. Ověř TypeScript
npx tsc --noEmit

# 6. Spusť relevantní testy
npm run test:run -- src/tests/hooks/useMyHook.test.ts

# 7. Ověř build
npm run build
```

---

## 🌐 Databáze — Produkce

| Příkaz | Popis |
|--------|-------|
| `npm run db:migrate` | Aplikovat migrace na remote DB |
| `npm run db:types:gen` | Generovat typy z remote DB |
| `npm run db:seed` | Seed remote DB |
| `npm run db:status` | Stav remote DB |

**Vyžaďduje env proměnné:**
- `AISHA_DB_URL` nebo `DATABASE_URL`

---

## 🔧 Migrace & Funkce

### Migrace

| Příkaz | Popis |
|--------|-------|
| `npm run db:migration:register` | Zaregistrovat nové migrace do registru |

**Pravidla:**
- Soubory v `supabase/migrations/YYYYMMDDHHMMSS_popis.sql`
- Registr v `supabase/migration-registry.json`
- **NIKDY nearchivuj migrace** a **NIKDY ručně needituj registr**

### SQL Funkce

| Příkaz | Popis |
|--------|-------|
| `npm run func:validate` | Validace SQL funkcí (SECURITY DEFINER, GRANTs) |
| `npm run func:list` | Seznam všech SQL funkcí ze source of truth |
| `npm run func:list:live` | Porovnání source vs. živá lokální DB |

---

## 🧪 Testování

### Unit testy (Vitest)

| Příkaz | Popis |
|--------|-------|
| `npm run test` | Spustit všechny testy |
| `npm run test:run` | Spustit všechny testy (alias) |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Testy s coverage reportem |
| `npm run test:ui` | Vitest UI mód |

**KRITICKÉ:**
```bash
# ✅ SPRÁVNĚ — Pouze relevantní testy
npm run test:run -- src/tests/hooks/useMyHook.test.ts

# ❌ ŠPATNĚ — Všechny testy (plýtvání)
npm run test:run
```

---

## 🌍 i18n (Internacionalizace)

| Příkaz | Popis |
|--------|-------|
| `npm run i18n:check` | Kompletní i18n gate (povinné před PR) |
| `npm run i18n:segments:build` | Sestavit locales ze segmentů |
| `npm run i18n:segments:check` | Parity report segmentů |
| `npm run i18n:bracket-check` | Detekce `[...]` placeholder chyb |
| `npm run i18n:bracket-check:strict` | Striktní kontrola (fail CI) |

Zdroj pravdy: `src/i18n/segments/{lang}/*.json`
Generované: `src/i18n/locales/{cs,en,de,fr,ru,th}.json`

---

## 🔗 Edge Functions Deploy

Skript `scripts/deploy-edge-functions.sh` podporuje 3 self-hosted režimy:

| Režim | Trigger env var | Popis |
|-------|----------------|-------|
| Self-hosted remote (SSH) | `SELF_HOSTED_REMOTE_HOST` | Rsync přes SSH na vzdálený server |
| Self-hosted local (Docker) | `SELF_HOSTED_FUNCTIONS_DIR` | Kopíruje do lokálního Docker volume |
| Docker Compose | `COMPOSE_FILE` | Rebuild functions-init + restart edge-functions |

Gate: `DEPLOY_EDGE_FUNCTIONS=true` musí být nastaveno.

Viz `.env.docker.example` pro kompletní seznam env vars.

---

## � AI / Local LLM

AISHA podporuje 3 lokální LLM backendy. Priorita: **MLX → Ollama → Docker Model Runner**.

### Porty & Prefix konvence

| Backend | Port | URL suffix | Prefix pro `--model` | GPU |
|---------|------|------------|----------------------|-----|
| MLX | 8100 | `/v1` | `local-*` | Metal (native) |
| Ollama | 11434 | `/v1` | `ollama-*` | Metal/CUDA |
| Docker Model Runner | 12434 | `/engines/v1` | `docker-*` | CPU only |

### Auto-detect & Setup

| Příkaz | Popis |
|--------|-------|
| `npm run ai:auto` | Auto-detect HW + best backend (JSON) |
| `npm run ai:status` | Unified health check všech backendů |

### MLX (Apple Silicon, Metal native)

| Příkaz | Popis |
|--------|-------|
| `npm run mlx:setup` | Instalace MLX + stažení modelu |
| `npm run mlx:serve` | Start MLX serveru (foreground) |
| `npm run mlx:serve:bg` | Start MLX serveru (background) |
| `npm run mlx:stop` | Zastavení MLX serveru |
| `npm run mlx:status` | Stav MLX serveru |
| `npm run mlx:test` | Test inference |

### Ollama (Metal/CUDA via llama.cpp)

| Příkaz | Popis |
|--------|-------|
| `npm run ollama:setup` | Instalace Ollama + stažení modelu |
| `npm run ollama:setup:check` | Jen kontrola (bez instalace) |
| `npm run ollama:serve` | Start Ollama (foreground) |
| `npm run ollama:serve:bg` | Start Ollama (background) |
| `npm run ollama:stop` | Zastavení Ollama |
| `npm run ollama:status` | Stav Ollama |
| `npm run ollama:test` | Test inference |

### Docker Model Runner (CPU, zero setup)

| Příkaz | Popis |
|--------|-------|
| `npm run docker:ai:setup` | Setup Docker Model Runner |
| `npm run docker:ai:serve` | Start (foreground) |
| `npm run docker:ai:stop` | Zastavení |
| `npm run docker:ai:status` | Stav |
| `npm run docker:ai:test` | Test inference |

### RAM Tiers (auto-select)

| RAM | Tier | Ollama model | Docker model |
|-----|------|--------------|--------------|
| 8 GB | small | qwen2.5-coder:3b | ai/qwen2.5-coder:3b |
| 16 GB | medium | mistral-nemo | ai/mistral-nemo |
| 24 GB | large | phi4 | ai/phi4 |
| 48 GB+ | xlarge | qwen3-coder:30b | ai/qwen3-coder:30b |

### Test s lokálním modelem

```bash
# Docker Model Runner
npm run aisha:chat:test -- --model docker-ai/mistral-nemo

# Ollama
npm run aisha:chat:test -- --model ollama-mistral-nemo

# MLX (auto-detect model)
npm run aisha:chat:test -- --model local-mlx
```

---

## �🤖 AISHA Orchestrace

| Příkaz | Popis |
|--------|-------|
| `npm run aisha:provision` | Auto-provisioning n8n (workflows, credentials, variables) |
| `npm run aisha:provision:dry` | Dry-run provisioning (jen výpis co by se udělalo) |

**Předpoklady:**
- n8n běží na `N8N_URL` (default: `http://localhost:5678`)
- `N8N_API_KEY` pro API přístup
- Workflow JSON soubory v `n8n/workflows/`

---

## 🏗️ Self-hosted Supabase

Produkční AISHA stack (Supabase data plane) je orchestrován přes Coolify — viz:

| Soubor | Popis |
|--------|-------|
| `docker-compose.coolify.yml` | Kanonický Coolify stack (web + auth + data plane) |
| `.env-prod-backup` | Backup šablona produkčních env (nepushovat) |
| `docs/deploy/SELF_HOSTED_SUPABASE.md` | Historický deployment guide (archiv) |

> Legacy `docker/docker-compose.supabase.yml` a `.env.supabase.example` byly přesunuty do `trash/cleanup-2026-04-22-rebrand/` — nahrazeny Coolify flow.

---

## 📝 Pro AI asistenty

- **Preferuj jen relevantní testy**: `npm run test:run -- src/tests/hooks/useMyHook.test.ts`
- **Po změně DB funkce**: `npm run db:migrate:local && npm run db:types:gen:local`
- **Před PR**: `npm run test:run && npm run build`
- **i18n kontrola**: `npm run i18n:check`
- **Lokální setup**: `npm run db:local:setup`
- **Kompletní infra**: `npm run infra:up`
- **psql heredoc**: Viz AGENTS.md pro správnou syntax

### Zkrácený workflow

```bash
# Setup (jednorázově)
npm run infra:up

# Po změně DB
npm run db:migration:register
npm run db:migrate:local
npm run db:types:gen:local

# Kontrola
npx tsc --noEmit
npm run test:run -- src/tests/hooks/relevantni.test.ts
npm run build
```

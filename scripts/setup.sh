#!/usr/bin/env bash
# =============================================================================
# setup.sh — One-Command Local Development Setup
# =============================================================================
#
# Kompletní lokální setup platformy Evymo z nuly. Uživatel si naklonuje repo
# a spustí JEDEN příkaz — vše se nainstaluje, nakonfiguruje a nastartuje.
#
# Co skript dělá:
#   1. Ověří prerequisites (Node.js >=22, Docker, Docker Compose)
#   2. npm install
#   3. Nastartuje lokální DB stack přes local-warmup.sh (PostgreSQL 17 +
#      PostgREST + AISHA Gateway + Redis; aisha-db na 127.0.0.1:54322)
#   4. Vygeneruje .env s lokálními vývojovými hodnotami
#   5. Nastaví lokální .env pro vývoj
#   6. Ověří Redis (součást core stacku z local-warmup)
#   7. Spustí migrace + seed + generování typů (přímo proti warmup DB)
#   8. (Volitelně) Nastartuje n8n, Ragnarok, Langfuse, Edge Functions, vLLM
#   9. Spustí dev server
#
# Usage:
#   npm run setup                       # Frontend + core local stack (minimum)
#   npm run setup -- --with-n8n         # + n8n workflow engine
#   npm run setup -- --with-backend     # + Edge Functions + Ragnarok + Langfuse
#   npm run setup -- --with-admin       # + NocoDB + Appsmith + pgAdmin + KeyCloak
#   npm run setup -- --with-vllm        # + Self-hosted vLLM (GPU required)
#   npm run setup -- --with-aisha       # Komplet: n8n + backend + admin + Aisha
#   npm run setup -- --full             # Absolutně vše včetně vLLM
#   npm run allinone                    # Alias pro --full (vše z jednoho příkazu)
#   npm run setup -- --skip-dev         # Setup bez spuštění dev serveru
#   npm run setup -- --reset            # Smaže .env a začne znovu
#   npm run setup -- --status           # Jen zobrazí stav
#
# Local seed profile (content/demo data for dev):
#   export AISHA_SEED_PROFILE=dev       # default: active development content (lively/editable)
#   export AISHA_SEED_PROFILE=demo      # classic test/demo data
#   export AISHA_SEED_PROFILE=template  # clean "sablona"/template (minimal content)
# Web sablona (public site design from domains/templates/): set AISHA_SEED_DOMAIN=cafe-shop
#   (or company-wiki etc.). With --seed-profile template the local generator auto-picks one.
#   (local-warmup supports --seed-profile and --seed-domain; profile is used for DB seeding)

# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

ok()     { echo -e "  ${GREEN}✓${NC} $*"; }
fail()   { echo -e "  ${RED}✗${NC} $*"; }
warn()   { echo -e "  ${YELLOW}⚠${NC} $*"; }
info()   { echo -e "  ${BLUE}ℹ${NC} $*"; }
step()   { echo -e "\n${MAGENTA}${BOLD}━━━ $* ━━━${NC}"; }
banner() {
  echo ""
  echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}${BOLD}║  $1${NC}"
  echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
}

# ── Flags ────────────────────────────────────────────────────────────────────
WITH_N8N=false
WITH_BACKEND=false
WITH_ADMIN=false
WITH_VLLM=false
WITH_AISHA=false
SKIP_DEV=false
RESET=false
STATUS_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-n8n)      WITH_N8N=true; shift ;;
    --with-backend)  WITH_BACKEND=true; shift ;;
    --with-insight)  WITH_BACKEND=true; shift ;;  # alias --with-backend (Insight = Ragnarok + Maestro + Elasticsearch)
    --with-admin)    WITH_ADMIN=true; shift ;;
    --with-vllm)     WITH_VLLM=true; WITH_BACKEND=true; shift ;;
    --with-aisha)    WITH_AISHA=true; WITH_N8N=true; WITH_BACKEND=true; WITH_ADMIN=true; shift ;;
    --full)          WITH_AISHA=true; WITH_N8N=true; WITH_BACKEND=true; WITH_ADMIN=true; WITH_VLLM=true; shift ;;
    --skip-dev)      SKIP_DEV=true; shift ;;
    --reset)         RESET=true; shift ;;
    --status)        STATUS_ONLY=true; shift ;;
    -h|--help)       sed -n '5,33p' "$0"; exit 0 ;;
    *)               echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Status mode ──────────────────────────────────────────────────────────────
if $STATUS_ONLY; then
  bash "$SCRIPT_DIR/warmup.sh" --status
  exit 0
fi

TOTAL_START=$SECONDS

# Calculate total steps
TOTAL_STEPS=8
$WITH_BACKEND && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))
$WITH_ADMIN && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))
$WITH_N8N && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))
$WITH_AISHA && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))
$WITH_VLLM && TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))

banner "Evymo Platform — Local Setup (local deploy using production manifests + local-presets config)"
echo -e "  ${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "  ${DIM}Profil:${NC} ${BOLD}$(
  PARTS=("core")
  $WITH_N8N && PARTS+=("n8n")
  $WITH_BACKEND && PARTS+=("backend")
  $WITH_ADMIN && PARTS+=("admin")
  $WITH_VLLM && PARTS+=("vLLM")
  $WITH_AISHA && PARTS+=("aisha")
  IFS='+'; echo "${PARTS[*]}"
)${NC}"
echo -e "  ${DIM}Local deploy analogy: same manifest/composes as prod; config from config/local-presets.mjs (devEnvDefaults = local .env source); infra via direct compose up.${NC}"
echo ""

# =============================================================================
# Step 1: Prerequisites
# =============================================================================
CURRENT_STEP=0
next_step() { CURRENT_STEP=$(( CURRENT_STEP + 1 )); step "Step ${CURRENT_STEP}/${TOTAL_STEPS} — $1"; }

next_step "Prerequisites"

MISSING=()

# Node.js >= 22 (matches "engines" in package.json)
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VER" -ge 22 ]]; then
    ok "Node.js $(node -v)"
  else
    fail "Node.js $(node -v) — vyžadována verze >= 22"
    MISSING+=("node")
  fi
else
  fail "Node.js — není nainstalován"
  MISSING+=("node")
fi

# npm
if command -v npm &>/dev/null; then
  ok "npm $(npm -v)"
else
  fail "npm — není nainstalován"
  MISSING+=("npm")
fi

# Docker
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  ok "Docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
else
  fail "Docker — není nainstalován nebo neběží"
  MISSING+=("docker")
fi

# Docker Compose
if docker compose version &>/dev/null 2>&1; then
  ok "Docker Compose $(docker compose version --short 2>/dev/null || echo 'OK')"
else
  fail "Docker Compose — není dostupný"
  MISSING+=("docker-compose")
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo ""
  fail "Chybí prerequisites: ${MISSING[*]}"
  echo ""
  echo -e "  Instalace:"
  echo -e "    ${DIM}Node.js:  brew install node${NC}"
  echo -e "    ${DIM}Docker:   https://docs.docker.com/get-docker/${NC}"
  echo ""
  exit 1
fi

# =============================================================================
# Step 2: Install dependencies
# =============================================================================
next_step "Dependencies"

if [[ ! -d "node_modules" ]] || $RESET; then
  info "Instaluji npm dependencies..."
  npm install --no-fund --no-audit 2>&1 | tail -3
  ok "npm install dokončen"
else
  ok "node_modules již existuje"
fi

# Initialize git submodules (packages/insight is pinned upstream code that
# insight-patches.gate + insight-usp-integrity.gate require). CI does this
# via `submodules: recursive` in .github/workflows/ci.yml; local devs
# need it once after a fresh checkout. Idempotent — git submodule update
# is a no-op when already initialized.
if [[ -f .gitmodules ]]; then
  info "Initializing git submodules..."
  git submodule update --init --recursive 2>&1 | tail -3
  ok "Submodules ready"
fi

# =============================================================================
# Step 3: Start local DB stack (scripts/local-warmup.sh)
# =============================================================================
next_step "Local DB stack (local-warmup.sh)"

# Local DB coordinates published by local-warmup.sh (config/local-presets.mjs):
#   container  aisha-db (Postgres 17 from infra/postgres)
#   host port  54322 → 5432  (POSTGRES_USER=postgres, POSTGRES_PASSWORD=dev_postgres_password)
# These are the canonical local-warmup values; the npm db:* helpers below are
# pointed at them via AISHA_DB_URL so the migrate/seed sequence stays coherent.
#
# config/local-presets.mjs (devEnvDefaults + hostPorts + presets) is the
# "local deployment configuration" — the direct analog of production's
# config/domains.env + coolify-environments + .env-prod-backup.
# local-warmup + local-compose-gen is the local "deploy" (compose generation +
# env application) using the same production manifests/composes.
# This setup therefore runs the *real* self-hosted AISHA stack locally
# (PostgREST + Keycloak + Gateway etc.), not any legacy Supabase local.
# All local coordinates come from the central local deploy config (config/local-presets.mjs).
# Scripts must NEVER hardcode ports, hosts or domains — load/derive from env or presets.
LOCAL_DB_HOST=$(node --input-type=module -e '
  import { hostPorts } from "./config/local-presets.mjs";
  const p = hostPorts["aisha-db"] || {};
  console.log(process.env.LOCAL_DB_HOST || Object.keys(p)[0] || "127.0.0.1");
' )
LOCAL_DB_PORT=$(node --input-type=module -e '
  import { hostPorts } from "./config/local-presets.mjs";
  const p = hostPorts["aisha-db"] || {};
  const port = Object.keys(p)[0];
  console.log(process.env.LOCAL_DB_PORT || p[port]);
' )
LOCAL_DB_USER="postgres"
LOCAL_DB_PASSWORD="dev_postgres_password"

# Check if DB is already running
if docker ps --format '{{.Names}}' 2>/dev/null | grep 'aisha-db' >/dev/null; then
  ok "aisha-db již běží"
else
  info "Startuji lokální DB stack přes local-warmup (preset minimum)..."
  bash "$SCRIPT_DIR/local-warmup.sh" --preset minimum 2>&1 | tail -8
  # Wait for DB to be healthy
  for i in $(seq 1 60); do
    if docker exec aisha-db pg_isready -U "$LOCAL_DB_USER" &>/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if docker exec aisha-db pg_isready -U "$LOCAL_DB_USER" &>/dev/null 2>&1; then
    ok "aisha-db nastartován (psql: 127.0.0.1:${LOCAL_DB_PORT})"
  else
    fail "aisha-db se nepodařilo nastartovat"
    echo -e "  ${DIM}Zkus: npm run warmup:local -- --preset minimum${NC}"
    echo -e "  ${DIM}Logy:  npm run warmup:local:status${NC}"
    exit 1
  fi
fi

# Load the local deploy env produced by local-warmup (the "deploy" step that writes .env.local.dev from presets + overrides).
# All values for services are in this env file (or can be overridden).
# Scripts donacitate (load) from env; no hardcoded values in script source.
if [ -f .env.local.dev ]; then
  set -a
  source .env.local.dev 2>/dev/null || true
  set +a
fi
LOCAL_AISHA_POSTGREST_URL=${VITE_AISHA_GATEWAY_URL:-${AISHA_POSTGREST_URL}}
LOCAL_DB_URL="${AISHA_DB_URL:-postgresql://${LOCAL_DB_USER}:${LOCAL_DB_PASSWORD}@${LOCAL_DB_HOST}:${LOCAL_DB_PORT}/postgres}"
# JWT keys must be pre-set in .env for local docker-compose
ANON_KEY="${ANON_KEY:-$(grep '^ANON_KEY=' .env 2>/dev/null | cut -d= -f2-)}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-$(grep '^SERVICE_ROLE_KEY=' .env 2>/dev/null | cut -d= -f2-)}"

# Pre-compute other local service URLs from central presets (so the entire deploy
# flow — generated .env, status messages, etc. — is fully parameterized, no
# scattered magic strings). This is the "vsude naparametrovane" requirement for
# deploy scripts.
LOCAL_N8N_URL=$(node --input-type=module -e '
  import { getLocalN8nUrl } from "./config/local-presets.mjs";
  console.log(process.env.N8N_WEBHOOK_URL || getLocalN8nUrl());
' )
LOCAL_LANGFUSE_URL=$(node --input-type=module -e '
  import { getLocalLangfuseUrl } from "./config/local-presets.mjs";
  console.log(process.env.LANGFUSE_BASEURL || getLocalLangfuseUrl());
' )
LOCAL_RAGNAROK_URL=$(node --input-type=module -e '
  import { getLocalRagnarokUrl } from "./config/local-presets.mjs";
  console.log(process.env.RAGNAROK_URL || getLocalRagnarokUrl());
' )
LOCAL_MAESTRO_URL=$(node --input-type=module -e '
  import { getLocalMaestroUrl } from "./config/local-presets.mjs";
  console.log(process.env.MAESTRO_URL || getLocalMaestroUrl());
' )

# Local seed profile: "dev" (default here) = active development content (lively, editable).
# "demo" for test/demo data. "template" (sablona) for clean/minimal content.
# Web sablona: AISHA_SEED_DOMAIN selects from domains/templates/* (auto-defaulted for template profile in local deploy).
# These are passed into the generated .env (local analog of prod AISHA_SEED_PROFILE / AISHA_SEED_DOMAIN).
# You can override with AISHA_SEED_PROFILE=template AISHA_SEED_DOMAIN=company-wiki before running setup.
AISHA_SEED_PROFILE="${AISHA_SEED_PROFILE:-dev}"

# =============================================================================
# Step 4: Capture keys & generate .env
# =============================================================================
next_step "Environment Configuration"

# Generate .env (only if not exists or --reset)
if [[ ! -f ".env" ]] || $RESET; then
  if [[ -f ".env" ]] && $RESET; then
    mv .env ".env.backup.$(date +%s)"
    warn "Předchozí .env zálohován"
  fi

  cat > .env << ENVEOF
# =============================================================================
# .env — Auto-generated by setup.sh ($(date '+%Y-%m-%d %H:%M:%S'))
# =============================================================================
# Lokální vývojové prostředí — stack: Postgres17 (aisha-db) + PostgREST + AISHA Gateway + Keycloak (OIDC).
# Toto je stejný self-hosted stack jako v produkci — autentizace jde přes Keycloak.
# Pro produkci / cold-start viz .env.coolify.example nebo config/ soubory.
# =============================================================================

# ── AISHA API (local) ───────────────────────────────────────────────────────
VITE_AISHA_GATEWAY_URL=${LOCAL_AISHA_POSTGREST_URL}
AISHA_API_URL=${LOCAL_AISHA_POSTGREST_URL}
AISHA_ANON_KEY=${ANON_KEY}
AISHA_SERVICE_KEY=${SERVICE_ROLE_KEY}
AISHA_DB_URL=${LOCAL_DB_URL}

# Local seed profile (dev = active dev content, demo = test data, template = sablona)
AISHA_SEED_PROFILE=${AISHA_SEED_PROFILE}
# Web sablona from domains/templates/ (picked by AISHA_SEED_DOMAIN; svc-web-artifact /seed-default uses it)
AISHA_SEED_DOMAIN=${AISHA_SEED_DOMAIN:-}

# The values for all services are already loaded from .env.local.dev above (produced by the warmup "deploy" step from the presets).
# No additional computation or hardcoded defaults in this script.
# If some vars are not in the env file, they can be overridden via process.env before running setup.

# ── n8n (local) ──────────────────────────────────────────────────────────────
N8N_WEBHOOK_URL=${N8N_WEBHOOK_URL:-${LOCAL_N8N_URL}}
N8N_API_KEY=

# ── MCP (local — OAuth/Keycloak bearer for CLI smoke/provisioning) ───────────
AISHA_ACCESS_TOKEN=
EVYMO_MCP_URL=${LOCAL_AISHA_POSTGREST_URL}/functions/v1/mcp-knowledge-server

# ── LLM Providers (volitelné — doplň vlastní klíče pro AI features) ─────────
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=
ANTHROPIC_API_KEY=

# ── Ostatní (volitelné) ──────────────────────────────────────────────────────
DEEPL_API_KEY=
STRIPE_TEST_PUBLISHABLE_KEY=
STRIPE_TEST_SECRET_KEY=
PACKETA_API_KEY=
PACKETA_API_PASSWORD=
PACKETA_SENDER_ID=platform
GITHUB_WEBHOOK_SECRET=
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_VAPID_SUBJECT=
VITE_WEB_PUSH_VAPID_PUBLIC_KEY=

# ── Langfuse (local — pre-filled pro lokální Langfuse) ──────────────────────
LANGFUSE_HOST=${LANGFUSE_BASEURL:-${LOCAL_LANGFUSE_URL}}
LANGFUSE_PUBLIC_KEY=pk-lf-aisha-local-dev
LANGFUSE_SECRET_KEY=sk-lf-aisha-local-dev
LANGFUSE_BASEURL=${LANGFUSE_BASEURL:-${LOCAL_LANGFUSE_URL}}

# ── Insight Stack (local) — Ragnarok retrieval + Maestro dialog management ──
RAGNAROK_URL=${RAGNAROK_URL:-${LOCAL_RAGNAROK_URL}}
MAESTRO_URL=${MAESTRO_URL:-${LOCAL_MAESTRO_URL}}
INSIGHT_LLM_BACKEND=OpenAI
RAGNAROK_API_KEY=aisha-ragnarok-local
MAESTRO_API_KEY=aisha-maestro-local

# ── vLLM Self-hosted (volitelné — vyžaduje NVIDIA GPU) ──────────────────────
VLLM_EMBEDDING_URL=${VLLM_EMBEDDING_URL:-${LOCAL_VLLM_EMBED_URL}}
VLLM_GENERATION_URL=${VLLM_GENERATION_URL:-${LOCAL_VLLM_GEN_URL}}
VLLM_API_KEY=vllm

# ── Docker Model Runner (Docker Desktop 4.40+ — lokální LLM) ───────────────
DOCKER_MODEL_RUNNER_URL=${DOCKER_MODEL_RUNNER_URL:-${LOCAL_DMR_URL}}
# ── Ollama (Metal GPU accelerated LLM via llama.cpp) ─────────────────────
OLLAMA_URL=${OLLAMA_URL:-${LOCAL_OLLAMA_URL}}
# ── Admin Tools (local) ─────────────────────────────────────────────────────
NOCODB_URL=${NOCODB_URL:-${LOCAL_NOCODB_URL}}
NOCODB_API_TOKEN=
APPSMITH_URL=${APPSMITH_URL:-${LOCAL_APPSMITH_URL}}
APPSMITH_API_KEY=

# ── KeyCloak OIDC (local) ──────────────────────────────────────────────────
# Secret from KeyCloak realm > Clients > aisha-app > Credentials tab
# For local dev, KeyCloak auto-generates the secret on first import.
# (Auth flows through Keycloak directly.)
KEYCLOAK_CLIENT_SECRET=
ENVEOF

  ok ".env vygenerován pro lokální AISHA stack (Postgres17 + PostgREST + Keycloak)"

  # ── Copy third-party API keys from .env-prod-backup (if available) ─────────
  if [[ -f ".env-prod-backup" ]]; then
    info "Nalezen .env-prod-backup — kopíruji API klíče třetích stran..."

    # Keys to copy from backup (only empty ones in .env get filled)
    KEYS_TO_COPY=(
      "OPENAI_API_KEY"
      "GOOGLE_AI_API_KEY"
      "ANTHROPIC_API_KEY"
      "DEEPL_API_KEY"
      "N8N_API_KEY"
      "AISHA_ACCESS_TOKEN"
      "GITHUB_WEBHOOK_SECRET"
      "WEB_PUSH_VAPID_PUBLIC_KEY"
      "WEB_PUSH_VAPID_PRIVATE_KEY"
      "WEB_PUSH_VAPID_SUBJECT"
    )

    COPIED=0
    for KEY in "${KEYS_TO_COPY[@]}"; do
      # Get value from backup
      BACKUP_VAL=$(grep -E "^${KEY}=" .env-prod-backup 2>/dev/null | head -1 | cut -d= -f2- || true)
      if [[ -n "$BACKUP_VAL" ]]; then
        # Only fill if the key exists and is empty in .env
        if grep -qE "^${KEY}=$" .env 2>/dev/null; then
          sed -i'' -e "s|^${KEY}=$|${KEY}=${BACKUP_VAL}|" .env
          COPIED=$((COPIED + 1))
        fi
      fi
    done

    if [[ $COPIED -gt 0 ]]; then
      ok "Zkopírováno ${COPIED} API klíčů z .env-prod-backup"
    else
      info "Všechny klíče již byly vyplněny"
    fi

    # Copy LLM keys to .env (already done above by the main loop)
    : # no-op — edge functions now deployed via Keycloak/docker-compose, not Supabase CLI
  else
    echo ""
    warn "Pro AI funkce doplň API klíče do .env:"
    echo -e "    ${DIM}OPENAI_API_KEY${NC}       — platform.openai.com → API Keys"
    echo -e "    ${DIM}GOOGLE_AI_API_KEY${NC}    — aistudio.google.com → API Keys"
    echo -e "    ${DIM}ANTHROPIC_API_KEY${NC}    — console.anthropic.com → API Keys"
    echo ""
    echo -e "    ${DIM}Tip: ulož klíče do .env-prod-backup a příště se zkopírují automaticky${NC}"
  fi
else
  ok ".env již existuje (použij --reset pro přegenerování)"
fi

# Generate .mcp.json pointing to local MCP server.
# Route through mergeMcpJson so that --reset (RESET=true) upserts ONLY the
# aisha-knowledge entry and preserves any other MCP servers the user added by
# hand — the old 'cat >' heredoc clobbered the whole file unconditionally.
if [[ ! -f ".mcp.json" ]] || $RESET; then
  MCP_URL="${LOCAL_AISHA_POSTGREST_URL}/functions/v1/mcp-knowledge-server" \
  MCP_AUTH="Bearer ${ANON_KEY}" \
  node --input-type=module -e '
    import { readFileSync, writeFileSync, existsSync } from "fs";
    import { mergeMcpJson } from "./scripts/lib/mcp-json-merge.mjs";
    const existing = existsSync(".mcp.json") ? readFileSync(".mcp.json", "utf-8") : "";
    const merged = mergeMcpJson(existing, "aisha-knowledge", {
      type: "http",
      url: process.env.MCP_URL,
      headers: { Authorization: process.env.MCP_AUTH },
    });
    writeFileSync(".mcp.json", merged);
  '
  ok ".mcp.json nastaven na lokální MCP server"
else
  ok ".mcp.json již existuje"
fi

# =============================================================================
# Step 5: Docker services (Redis)
# =============================================================================
next_step "Docker Services (Redis)"

# Redis (aisha-redis) is part of the `core` stack brought up by local-warmup in
# Step 3. Here we just confirm it is reachable on the host (port 6379).
if command -v docker &>/dev/null; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep 'aisha-redis' >/dev/null; then
    for i in {1..10}; do
      if docker exec aisha-redis redis-cli ping 2>/dev/null | grep PONG >/dev/null; then
        break
      fi
      sleep 1
    done
    ok "Redis running (port 6379)"
  else
    warn "aisha-redis neběží — spusť: npm run warmup:local -- --preset minimum"
  fi
else
  warn "Docker není dostupný — Redis přeskočen"
fi

# =============================================================================
# Step 6: Database (migrations + seed + types)
# =============================================================================
next_step "Database Setup"

# NOTE: the `db:*:local` npm aliases (db:migrate:local / db:seed:local /
# db:types:gen:local) hard-target 127.0.0.1:57422 (the E2E stack started by
# `npm run test:e2e`). This setup brings the DB up via local-warmup, which
# publishes aisha-db on ${LOCAL_DB_PORT}. So we call the underlying scripts
# directly against the warmup DB instead of the 57422-bound aliases.
WARMUP_DB_URL="postgresql://${LOCAL_DB_USER}:${LOCAL_DB_PASSWORD}@${LOCAL_DB_HOST}:${LOCAL_DB_PORT}/postgres"

info "Registruji migrace..."
npm run db:migration:register 2>&1 | tail -1
ok "Migrace zaregistrovány"

info "Aplikuji migrace na lokální DB (port ${LOCAL_DB_PORT})..."
AISHA_DB_URL="$WARMUP_DB_URL" node scripts/db/migrate.mjs 2>&1 | tail -3
ok "Migrace aplikovány"

info "Seeduji lokální DB (port ${LOCAL_DB_PORT})..."
SEED_FILE="aisha/db/seed.sql"
[[ -f "aisha/db/seed.compiled.sql" ]] && SEED_FILE="aisha/db/seed.compiled.sql"
PGPASSWORD="$LOCAL_DB_PASSWORD" psql -h "$LOCAL_DB_HOST" -p "$LOCAL_DB_PORT" -U "$LOCAL_DB_USER" -d postgres \
  -v ON_ERROR_STOP=1 -q -f "$SEED_FILE" 2>&1 | tail -1
ok "Seed aplikován"

# Apply E2E test users seed (dev-ready accounts with real passwords)
if [[ -f "aisha/db/seed.e2e.sql" ]]; then
  info "Vytvářím dev test uživatele (funkční hesla pro přihlášení)..."
  PGPASSWORD="$LOCAL_DB_PASSWORD" psql -h "$LOCAL_DB_HOST" -p "$LOCAL_DB_PORT" -U "$LOCAL_DB_USER" -d postgres -q < aisha/db/seed.e2e.sql 2>&1 | tail -1 || true
  ok "Dev test uživatelé vytvořeni"
fi

info "Generuji TypeScript typy z DB (port ${LOCAL_DB_PORT})..."
AISHA_DB_URL="$WARMUP_DB_URL" node scripts/db/gen-types.mjs 2>&1 | tail -1
ok "Typy vygenerovány"

# =============================================================================
# Step: Backend Services (Ragnarok + Langfuse + Edge Functions) — optional
# =============================================================================
if $WITH_BACKEND; then
  next_step "Backend Services (Ragnarok, Langfuse, Edge Functions)"

  # -- Insight stack (Elasticsearch + Ragnarok + Maestro) --
  info "Startuji Insight stack (Elasticsearch + Ragnarok + Maestro)..."
  docker compose -f docker-compose.local.yml --profile insight up -d 2>&1 | head -5 || true

  # Wait for Elasticsearch
  info "Cekam na Elasticsearch (${LOCAL_ELASTICSEARCH_URL})..."
  ES_READY=false
  for i in {1..60}; do
    if curl -sf "${LOCAL_ELASTICSEARCH_URL}/_cluster/health" &>/dev/null; then
      ES_READY=true
      break
    fi
    sleep 2
  done
  if $ES_READY; then
    ok "Elasticsearch bezi na ${LOCAL_ELASTICSEARCH_URL}"
  else
    warn "Elasticsearch se nespustil do 120s"
  fi

  # Wait for Ragnarok
  info "Cekam na Ragnarok RAG engine (${LOCAL_RAGNAROK_URL})..."
  RAG_READY=false
  for i in {1..30}; do
    if curl -sf "${LOCAL_RAGNAROK_URL}/health" &>/dev/null; then
      RAG_READY=true
      break
    fi
    sleep 2
  done
  if $RAG_READY; then
    ok "Ragnarok bezi na ${LOCAL_RAGNAROK_URL} (docs: ${LOCAL_RAGNAROK_URL}/docs)"
  else
    warn "Ragnarok se nespustil — zkontroluj: docker compose -f docker-compose.local.yml logs ragnarok"
  fi

  # -- Maestro (Insight Dialog Management) --
  info "Cekam na Maestro dialog management (${LOCAL_MAESTRO_URL})..."
  MAESTRO_READY=false
  for i in {1..30}; do
    if curl -sf "${LOCAL_MAESTRO_URL}/health" &>/dev/null; then
      MAESTRO_READY=true
      break
    fi
    sleep 2
  done
  if $MAESTRO_READY; then
    ok "Maestro bezi na ${LOCAL_MAESTRO_URL} (Alquist Insight dialog management)"
  else
    warn "Maestro se nespustil — zkontroluj: docker compose -f docker-compose.local.yml logs maestro"
  fi

  # -- Langfuse --
  info "Startuji Langfuse v3 (LLM Observability)..."
  docker compose -f docker-compose.local.yml --profile langfuse up -d 2>&1 | head -5 || true

  info "Cekam na Langfuse (${LOCAL_LANGFUSE_URL}) — start muze trvat ~2 min..."
  LF_READY=false
  for i in {1..90}; do
    if curl -sf "${LOCAL_LANGFUSE_URL}/api/public/health" &>/dev/null; then
      LF_READY=true
      break
    fi
    sleep 2
  done
  if $LF_READY; then
    ok "Langfuse bezi na ${LOCAL_LANGFUSE_URL}"
    info "Login: admin@example.com / admin123"
    info "Langfuse keys: pk-lf-aisha-local-dev / sk-lf-aisha-local-dev"
  else
    warn "Langfuse se nespustil do 180s — zkontroluj: docker compose -f docker-compose.local.yml logs langfuse"
  fi

  # -- Edge Functions (deployed via Docker services, not Supabase CLI) --
  info "Edge functions are deployed as Docker services in docker-compose.local.yml"
  ok "Edge Functions — use docker compose -f docker-compose.local.yml up svc-mcp-knowledge"
fi

# =============================================================================
# Step: Admin Tools (NocoDB, Appsmith, pgAdmin, KeyCloak) — optional
# =============================================================================
if $WITH_ADMIN; then
  next_step "Admin Tools (NocoDB, Appsmith, pgAdmin, KeyCloak)"

  # Start admin profile (NocoDB + Appsmith + Langfuse deps are already up if --with-backend)
  info "Startuji admin stack (NocoDB, Appsmith, pgAdmin)..."
  docker compose -f docker-compose.local.yml --profile admin up -d 2>&1 | head -5 || true

  # Start KeyCloak
  info "Startuji KeyCloak (OIDC provider)..."
  docker compose -f docker-compose.local.yml --profile keycloak up -d 2>&1 | head -5 || true

  # Start pgAdmin
  docker compose -f docker-compose.local.yml --profile db up -d 2>&1 | head -3 || true

  # Wait for NocoDB
  info "Cekam na NocoDB (${LOCAL_NOCODB_URL})..."
  NOCODB_READY=false
  for i in {1..30}; do
    if curl -sf "${LOCAL_NOCODB_URL}/api/v1/health" &>/dev/null; then
      NOCODB_READY=true
      break
    fi
    sleep 2
  done
  if $NOCODB_READY; then
    ok "NocoDB bezi na ${LOCAL_NOCODB_URL}"
    info "NocoDB je automaticky pripojen k local DB"
  else
    warn "NocoDB se nespustil do 60s"
  fi

  # Wait for Appsmith
  info "Cekam na Appsmith (${LOCAL_APPSMITH_URL}) — start muze trvat ~2 min..."
  APPSMITH_READY=false
  for i in {1..90}; do
    if curl -sf "${LOCAL_APPSMITH_URL}/api/v1/health" &>/dev/null; then
      APPSMITH_READY=true
      break
    fi
    sleep 2
  done
  if $APPSMITH_READY; then
    ok "Appsmith bezi na ${LOCAL_APPSMITH_URL}"
    info "Appsmith: vytvor Datasource → PostgreSQL → host.docker.internal:${LOCAL_DB_PORT}, user: postgres, pass: postgres, db: postgres"
  else
    warn "Appsmith se nespustil do 180s"
  fi

  # Wait for KeyCloak
  info "Cekam na KeyCloak (${LOCAL_KC_URL})..."
  KC_READY=false
  for i in {1..60}; do
    if curl -sf "${LOCAL_KC_URL}/health/ready" &>/dev/null; then
      KC_READY=true
      break
    fi
    sleep 2
  done
  if $KC_READY; then
    ok "KeyCloak bezi na ${LOCAL_KC_URL}"
    info "Admin console: ${LOCAL_KC_URL}/admin (admin / admin)"
    info "Aisha realm importovan z keycloak/aisha-realm.json"
  else
    warn "KeyCloak se nespustil do 120s"
  fi

  ok "pgAdmin dostupny na ${LOCAL_PGADMIN_URL} (admin@example.com / admin)"

  # Provision NocoDB views if Aisha setup is enabled
  if $WITH_AISHA && $NOCODB_READY; then
    info "Provisionuji NocoDB views..."
    npm run aisha:nocodb:views 2>&1 | tail -3 || warn "NocoDB views provisioning selhal (non-critical)"
  fi

  # Provision SSO federation (Keycloak client secrets + NocoDB OIDC)
  if $KC_READY; then
    info "Provisionuji SSO federaci (Keycloak + NocoDB OIDC)..."
    # ⛔ Původní tvar byl rozbitý DVAKRÁT:
    #   bash … 2>&1 | tail -10 || warn "non-critical"
    # Roura předá návratový kód `tail`u, takže `|| warn` NIKDY nevystřelilo — a
    # `tail` navíc uřízl diagnostiku, tedy jedinou informaci o tom, CO selhalo.
    # Bez tohohle kroku nefunguje přihlášení přes proxy ani lokálně, takže to
    # „non-critical" nebyla pravda. Výstup se proto SCHOVÁ, ne zahodí, a kód se
    # čte ze SKUTEČNÉHO příkazu. Naměřeno 2026-08-20 (rozešlo se 11 secretů).
    _sso_log="$(mktemp)"
    if bash scripts/provision-sso.sh --local >"$_sso_log" 2>&1; then
      tail -10 "$_sso_log"
      rm -f "$_sso_log"
    else
      tail -20 "$_sso_log"
      rm -f "$_sso_log"
      err "SSO provisioning selhal — Keycloak nedostal secrety důvěrných klientů."
      err "Přihlášení přes proxy skončí na 'unauthorized_client'. Viz výpis výš."
      exit 1
    fi
    ok "SSO: Appsmith via OAuth2 Proxy na ${LOCAL_APPSMITH_URL//8090/4180}"
    ok "SSO: Langfuse OIDC na ${LOCAL_LANGFUSE_URL} (Sign in with AISHA)"
  else
    warn "KeyCloak nebezi — SSO provisioning preskocen"
    info "Spustte pozdeji: npm run sso:provision:local"
  fi
fi

# =============================================================================
# Step: n8n Workflow Engine — optional
# =============================================================================
if $WITH_N8N; then
  next_step "n8n Workflow Engine"

  info "Startuji n8n..."
  docker compose -f docker-compose.local.yml --profile n8n up -d 2>&1 | head -5 || true

  # Wait for n8n to come up
  info "Čekám na n8n (${LOCAL_N8N_URL})..."
  N8N_READY=false
  for i in {1..60}; do
    if curl -sf "${LOCAL_N8N_URL}/healthz" &>/dev/null; then
      N8N_READY=true
      break
    fi
    sleep 2
  done

  if $N8N_READY; then
    ok "n8n běží na ${LOCAL_N8N_URL}"

    # Try to get/create n8n API key if available
    # n8n local dev mode has no auth by default (N8N_USER_MANAGEMENT_DISABLED=true)
    # We can create an API key via the REST API
    N8N_LOCAL_API_KEY=""
    API_KEY_RESP=$(curl -sf "${LOCAL_N8N_URL}/api/v1/me/api-keys" 2>/dev/null || echo "")
    if grep -q "apiKey" <<< "$API_KEY_RESP"; then
      N8N_LOCAL_API_KEY=$(echo "$API_KEY_RESP" | grep -oE '"apiKey":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi

    if [[ -z "$N8N_LOCAL_API_KEY" ]]; then
      # Create a new API key
      CREATE_RESP=$(curl -sf -X POST "${LOCAL_N8N_URL}/api/v1/me/api-keys" 2>/dev/null || echo "")
      if grep -q "apiKey" <<< "$CREATE_RESP"; then
        N8N_LOCAL_API_KEY=$(echo "$CREATE_RESP" | grep -oE '"apiKey":"[^"]*"' | head -1 | cut -d'"' -f4)
      fi
    fi

    if [[ -n "$N8N_LOCAL_API_KEY" ]]; then
      # Update .env with the n8n API key
      if grep -q "^N8N_API_KEY=$" .env 2>/dev/null; then
        sed -i'' -e "s|^N8N_API_KEY=$|N8N_API_KEY=${N8N_LOCAL_API_KEY}|" .env
      fi
      ok "n8n API key nastaven v .env"
    else
      warn "n8n API key se nepodařilo získat — nastav ručně v .env"
      info "Otevři ${LOCAL_N8N_URL} → Settings → API → Create API Key"
    fi

    # Set n8n environment variables for PostgREST connection
    # These are already in docker-compose.local.yml via env vars
    ok "n8n má přístup k lokálnímu PostgREST přes env variables"

    # ── Provision n8n credentials for workflow activation ──
    if [[ -n "$N8N_LOCAL_API_KEY" ]] && [[ -n "$SERVICE_ROLE_KEY" ]]; then
      info "Vytvářím n8n credentials pro workflow aktivaci..."

      # Create AISHA PostgREST (Service Role) credential
      CRED_RESP=$(curl -sf -X POST "${LOCAL_N8N_URL}/api/v1/credentials" \
        -H "X-N8N-API-KEY: ${N8N_LOCAL_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"AISHA PostgREST (Service Role)\",\"type\":\"httpHeaderAuth\",\"data\":{\"name\":\"apikey\",\"value\":\"${SERVICE_ROLE_KEY}\"}}" 2>/dev/null || echo "")
      if grep -q '"id"' <<< "$CRED_RESP"; then
        ok "Credential 'AISHA PostgREST (Service Role)' vytvořen"
      else
        info "Credential 'AISHA PostgREST (Service Role)' již existuje nebo se nepodařilo vytvořit"
      fi

      # Create PostgREST Service Role (alias used by some workflows)
      curl -sf -X POST "${LOCAL_N8N_URL}/api/v1/credentials" \
        -H "X-N8N-API-KEY: ${N8N_LOCAL_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"PostgREST Service Role\",\"type\":\"httpHeaderAuth\",\"data\":{\"name\":\"apikey\",\"value\":\"${SERVICE_ROLE_KEY}\"}}" &>/dev/null || true

      # Create AISHA PostgREST custom credential if custom nodes are loaded.
      # Workflow JSONs reference credential type aishaPostgrestApi with the name "AISHA PostgREST".
      POSTGREST_LOCAL_URL="${AISHA_POSTGREST_URL:-http://host.docker.internal:3001}"
      curl -sf -X POST "${LOCAL_N8N_URL}/api/v1/credentials" \
        -H "X-N8N-API-KEY: ${N8N_LOCAL_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"AISHA PostgREST\",\"type\":\"aishaPostgrestApi\",\"data\":{\"postgrestUrl\":\"${POSTGREST_LOCAL_URL}\",\"serviceRoleKey\":\"${SERVICE_ROLE_KEY}\",\"anonKey\":\"${ANON_KEY:-}\"}}" &>/dev/null || true

      ok "n8n credentials připraveny"

      # Deploy workflows from n8n/workflows/ to local n8n
      info "Deployuji workflows do lokálního n8n..."
      N8N_URL=${LOCAL_N8N_URL} N8N_API_KEY=$N8N_LOCAL_API_KEY npm run aisha:workflows:deploy:force 2>&1 | tail -5 || warn "Deploy workflows selhal (non-critical)"
    fi
  else
    warn "n8n se nespustil do 120s — zkontroluj: docker compose -f docker-compose.local.yml logs n8n"
  fi

  if $WITH_AISHA; then
    next_step "Aisha Dirigent Setup"

    if $N8N_READY; then
      info "Syncuji n8n workflow definice..."
      npm run aisha:workflows:sync 2>&1 | tail -3 || warn "Sync workflows selhal (non-critical)"

      info "Deployuji agent prompty..."
      npm run aisha:prompts:deploy 2>&1 | tail -1 || warn "Deploy prompts selhal (non-critical)"

      info "Deployuji MCP tools..."
      npm run aisha:tools:deploy 2>&1 | tail -1 || warn "Deploy tools selhal (non-critical)"

      info "Bootstrapuji Dirigent konfiguraci..."
      npm run dirigent:bootstrap 2>&1 | tail -1 || warn "Bootstrap selhal (non-critical)"

      ok "Aisha Dirigent nakonfigurován"
    else
      warn "n8n neběží — Aisha setup přeskočen"
    fi
  fi
else
  info "n8n přeskočen (spusť s --with-n8n pro n8n, --with-aisha pro kompletní orchestraci)"
fi
# =============================================================================
# Step: vLLM Self-hosted GPU Models — optional
# =============================================================================
if $WITH_VLLM; then
  next_step "vLLM Self-hosted Models (GPU)"

  # Check for NVIDIA GPU
  if command -v nvidia-smi &>/dev/null; then
    GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)
    ok "NVIDIA GPU detekovan: $GPU_INFO"
  else
    warn "nvidia-smi nenalezena — vLLM vyzaduje NVIDIA GPU + NVIDIA Container Toolkit"
    warn "Na macOS/CPU: pouzij cloud LLM providers (OPENAI_API_KEY v .env) misto --with-vllm"
  fi

  info "Startuji vLLM Embedding (Qwen3-Embedding-0.6B)..."
  info "Startuji vLLM Generation (Qwen3-30B-A3B)..."
  info "Prvni start stahuje modely — muze trvat 10-30 minut!"
  docker compose -f docker-compose.local.yml --profile vllm up -d 2>&1 | head -5 || true

  # Wait for embedding model (shorter timeout — smaller model)
  info "Cekam na vLLM Embedding (${VLLM_EMBEDDING_URL})..."
  VLLM_EMB_READY=false
  for i in {1..180}; do
    if curl -sf "${VLLM_EMBEDDING_URL}/health" &>/dev/null; then
      VLLM_EMB_READY=true
      break
    fi
    sleep 5
  done
  if $VLLM_EMB_READY; then
    ok "vLLM Embedding bezi na ${VLLM_EMBEDDING_URL}/v1"
  else
    warn "vLLM Embedding se nespustil — pravdepodobne stahuje model"
    info "Zkontroluj: docker compose -f docker-compose.local.yml logs -f vllm-embedding"
  fi

  # Check generation model (likely still loading)
  VLLM_GEN_READY=false
  if curl -sf "${VLLM_GENERATION_URL}/health" &>/dev/null; then
    VLLM_GEN_READY=true
  fi
  if $VLLM_GEN_READY; then
    ok "vLLM Generation bezi na ${VLLM_GENERATION_URL}/v1"
  else
    info "vLLM Generation (Qwen3-30B) se stale nacita..."
    info "Sleduj: docker compose -f docker-compose.local.yml logs -f vllm-generation"
  fi

  # Update Ragnarok to use local vLLM if both are running
  if $WITH_BACKEND && $VLLM_EMB_READY; then
    info "Ragnarok muze pouzivat lokalni vLLM — nastav v Ragnarok configu"
  fi
fi
# =============================================================================
# Summary & Dev Server
# =============================================================================
TOTAL_ELAPSED=$(( SECONDS - TOTAL_START ))

banner "Setup Complete! (${TOTAL_ELAPSED}s)"

echo ""
echo -e "  ${BOLD}Lokalni endpointy:${NC}"
echo -e "    Frontend:        ${GREEN}http://localhost:5173${NC}"
echo -e "    AISHA API:       ${GREEN}${LOCAL_AISHA_POSTGREST_URL}${NC}"
echo -e "    PostgreSQL:      ${DIM}postgresql://${LOCAL_DB_USER}:${LOCAL_DB_PASSWORD}@${LOCAL_DB_HOST}:${LOCAL_DB_PORT}/postgres${NC}"
$WITH_N8N && echo -e "    n8n Dashboard:   ${GREEN}${LOCAL_N8N_URL}${NC}"
$WITH_BACKEND && echo -e "    Ragnarok RAG:    ${GREEN}${LOCAL_RAGNAROK_URL}${NC}  ${DIM}(docs: /docs)${NC}"
$WITH_BACKEND && echo -e "    Maestro Dialog:  ${GREEN}${LOCAL_MAESTRO_URL}${NC}  ${DIM}(Alquist Insight)${NC}"
$WITH_BACKEND && echo -e "    Elasticsearch:   ${GREEN}${LOCAL_ELASTICSEARCH_URL}${NC}"
$WITH_BACKEND && echo -e "    Langfuse:        ${GREEN}${LOCAL_LANGFUSE_URL}${NC}  ${DIM}(admin@example.com / admin123)${NC}"
$WITH_BACKEND && echo -e "    Edge Functions:  ${GREEN}${LOCAL_AISHA_POSTGREST_URL}/functions/v1/${NC}"
echo -e "    Seed profile:    ${GREEN}${AISHA_SEED_PROFILE}${NC}  (dev=active dev content, demo=test, template=sablona)"
echo -e "    Web sablona:     ${GREEN}${AISHA_SEED_DOMAIN:-"(default)"} ${NC}  (domains/templates/ or default skeleton; /seed-default on boot)"
$WITH_ADMIN && echo -e "    NocoDB:          ${GREEN}${LOCAL_NOCODB_URL}${NC}  ${DIM}(auto-connected to local DB)${NC}"
$WITH_ADMIN && echo -e "    Appsmith:        ${GREEN}${LOCAL_APPSMITH_URL}${NC}  ${DIM}(dashboard builder)${NC}"
$WITH_ADMIN && echo -e "    pgAdmin:         ${GREEN}${LOCAL_PGADMIN_URL}${NC}  ${DIM}(admin@example.com / admin)${NC}"
$WITH_ADMIN && echo -e "    KeyCloak:        ${GREEN}${LOCAL_KC_URL}${NC}  ${DIM}(admin / admin)${NC}"
$WITH_VLLM && echo -e "    vLLM Embedding:  ${GREEN}${LOCAL_VLLM_EMBED_URL}${NC}  ${DIM}(Qwen3-Embedding-0.6B)${NC}"
$WITH_VLLM && echo -e "    vLLM Generation: ${GREEN}${LOCAL_VLLM_GEN_URL}${NC}  ${DIM}(Qwen3-30B-A3B)${NC}"
echo ""
echo -e "  ${BOLD}Vygenerovane soubory:${NC}"
echo -e "    ${DIM}.env${NC}                 — environment variables"
echo -e "    ${DIM}.env.local${NC}          — local model / backend secrets"
echo -e "    ${DIM}.mcp.json${NC}            — MCP Knowledge Server config"
echo ""
echo -e "  ${BOLD}Volitelne — doplni vlastni klice v .env:${NC}"
echo -e "    ${DIM}OPENAI_API_KEY${NC}       — pro AI analyzu a chat"
echo -e "    ${DIM}ANTHROPIC_API_KEY${NC}    — pro Claude agenty"
echo -e "    ${DIM}GOOGLE_AI_API_KEY${NC}    — pro Gemini"
$WITH_VLLM || echo -e "    ${DIM}--with-vllm${NC}         — self-hosted LLM (GPU, misto cloud API klicu)"
echo ""
echo -e "  ${BOLD}Uzitecne prikazy:${NC}"
echo -e "    ${DIM}npm run dev${NC}              — spusteni dev serveru"
echo -e "    ${DIM}npm run warmup${NC}           — kompletni warmup (testy + build)"
echo -e "    ${DIM}npm run models:check${NC}     — prehled LLM modelu a ceniku"
echo -e "    ${DIM}npm run models:wizard${NC}    — interaktivni konfigurace modelu"
echo -e "    ${DIM}npm run infra:status${NC}     — stav infrastruktury"
echo -e "    ${DIM}npm run setup -- --status${NC} — kontrola setupu"
echo ""

# ── Optional: LLM Model Configuration Wizard ────────────────────────────────
# Offer to run the model wizard if API keys are present but tiers not configured
HAS_LLM_KEYS=false
grep -qE "^OPENAI_API_KEY=.+" .env 2>/dev/null && HAS_LLM_KEYS=true
grep -qE "^GOOGLE_AI_API_KEY=.+" .env 2>/dev/null && HAS_LLM_KEYS=true
grep -qE "^ANTHROPIC_API_KEY=.+" .env 2>/dev/null && HAS_LLM_KEYS=true

HAS_TIER_CONFIG=false
grep -qE "^MODEL_TIER_" .env 2>/dev/null && HAS_TIER_CONFIG=true

if $HAS_LLM_KEYS && ! $HAS_TIER_CONFIG; then
  echo ""
  echo -e "  ${CYAN}${BOLD}LLM Model Configuration${NC}"
  echo -e "  ${DIM}Nalezeny API klice, ale model tiers nejsou nakonfigurovane.${NC}"
  echo -e "  ${DIM}AISHA vybira modely dynamicky — od nejlevnejsich po nejsilnejsi.${NC}"
  echo ""
  read -r -t 30 -p "  Chces nastavit LLM modely ted? [Y/n] " CONFIGURE_MODELS || true
  echo ""
  if [[ ! "${CONFIGURE_MODELS:-Y}" =~ ^[Nn]$ ]]; then
    node scripts/models-wizard.mjs
  else
    info "Model wizard preskocen — spust kdykoli: npm run models:wizard"
  fi
elif ! $HAS_LLM_KEYS; then
  echo -e "  ${YELLOW}⚠${NC} ${DIM}Zadny LLM API klic nenastaven — pro AI features doplni klice a spust:${NC}"
  echo -e "    ${DIM}npm run models:wizard${NC}"
  echo ""
fi

# ── Login Credentials ──────────────────────────────────────────────────────
echo -e "  ${CYAN}${BOLD}Přihlašovací údaje pro testování${NC}"
echo ""
echo -e "  ${BOLD}Frontend (http://localhost:5173):${NC}"
echo -e "    ┌──────────────────────────┬───────────────┬──────────────────┐"
echo -e "    │ Email                    │ Heslo         │ Role             │"
echo -e "    ├──────────────────────────┼───────────────┼──────────────────┤"
echo -e "    │ ${GREEN}admin@platform.rtn${NC}      │ Admin123!     │ ${BOLD}admin${NC}            │"
echo -e "    │ ${GREEN}member@platform.rtn${NC}     │ Member123!    │ member           │"
echo -e "    │ ${GREEN}partner@platform.rtn${NC}    │ Partner123!   │ practitioner     │"
echo -e "    │ ${GREEN}staff@platform.rtn${NC}      │ Staff123!     │ staff            │"
echo -e "    └──────────────────────────┴───────────────┴──────────────────┘"
echo ""
echo -e "  ${BOLD}Služby:${NC}"
$WITH_N8N && \
echo -e "    n8n Dashboard         ${DIM}${LOCAL_N8N_URL}${NC}      ${DIM}(auth disabled)${NC}"
$WITH_BACKEND && \
echo -e "    Langfuse              ${DIM}${LOCAL_LANGFUSE_URL}${NC}      ${DIM}admin@example.com / admin123${NC}"
$WITH_ADMIN && \
echo -e "    pgAdmin               ${DIM}${LOCAL_PGADMIN_URL}${NC}      ${DIM}admin@example.com / admin${NC}"
$WITH_ADMIN && \
echo -e "    KeyCloak              ${DIM}${LOCAL_KC_URL}${NC}      ${DIM}admin / admin${NC}"
$WITH_ADMIN && \
echo -e "    NocoDB                ${DIM}${LOCAL_NOCODB_URL}${NC}      ${DIM}(first-time setup)${NC}"
$WITH_ADMIN && \
echo -e "    Appsmith              ${DIM}${LOCAL_APPSMITH_URL}${NC}      ${DIM}(first-time setup)${NC}"
echo ""
echo -e "  ${DIM}PostgreSQL: PGPASSWORD=${LOCAL_DB_PASSWORD} psql -h ${LOCAL_DB_HOST} -p ${LOCAL_DB_PORT} -U ${LOCAL_DB_USER} -d postgres${NC}"
echo ""

if ! $SKIP_DEV; then
  echo -e "  ${CYAN}${BOLD}Spouštím dev server...${NC}"
  echo ""
  exec npm run dev
fi

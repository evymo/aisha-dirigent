#!/usr/bin/env bash
# =============================================================================
# warmup.sh — Unified Warmup Workflow
# =============================================================================
#
# Orchestrates the full developer environment warmup in logical stages:
#
#   Stage 1: INFRA    — Start local AISHA stack (Postgres17 + PostgREST + Keycloak + Gateway)
#                       via local-warmup.sh (the production-like self-hosted stack).
#                       Legacy CLI-local auth stack path is DEPRECATED.
#   Stage 2: LLM      — Auto-detect & setup local LLM backend
#   Stage 3: DB       — Migrate, seed, generate types
#   Stage 4: VERIFY   — TypeScript, ESLint, i18n checks
#   Stage 5: TEST     — Unit tests + gate tests
#   Stage 6: BUILD    — Production build + TypeDoc
#   Stage 7: AISHA    — SSO federation, n8n workflows, tools (optional)
#
# NOTE: The canonical local development entrypoint is now:
#   npm run setup                 # or npm run warmup:local
# These use the real AISHA stack. Old CLI-local DB/auth dev
# no longer matches current auth (Keycloak OIDC),
# data access (PostgREST + gateway), or edge functions (Fastify services).
#
# Usage:
#   ./scripts/warmup.sh                    # Full warmup (stages 1-5)
#   ./scripts/warmup.sh --all              # Full warmup including Aisha (1-7)
#   ./scripts/warmup.sh --quick            # Quick: infra + db + verify only
#   ./scripts/warmup.sh --stage infra      # Only Stage 1
#   ./scripts/warmup.sh --stage llm        # Only Stage 2
#   ./scripts/warmup.sh --stage db         # Only Stage 3
#   ./scripts/warmup.sh --stage verify     # Only Stage 4
#   ./scripts/warmup.sh --stage test       # Only Stage 5
#   ./scripts/warmup.sh --stage build      # Only Stage 6
#   ./scripts/warmup.sh --stage aisha      # Only Stage 7
#   ./scripts/warmup.sh --from db          # From Stage 2 onwards
#   ./scripts/warmup.sh --status           # Check what's running
#   ./scripts/warmup.sh --dry              # Dry-run (show what would run)
#
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
skip()   { echo -e "  ${DIM}○ $*${NC}"; }
stage()  { echo -e "\n${MAGENTA}${BOLD}━━━ Stage $1: $2 ━━━${NC}"; }
banner() { echo -e "\n${CYAN}${BOLD}╔══════════════════════════════════════════╗${NC}"; \
           echo -e "${CYAN}${BOLD}║  $1${NC}"; \
           echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════╝${NC}"; }

# ── Timer ────────────────────────────────────────────────────────────────────
TOTAL_START=$SECONDS
stage_time() {
  local elapsed=$(( SECONDS - ${1:-$TOTAL_START} ))
  echo -e "  ${DIM}(${elapsed}s)${NC}"
}

# ── State ────────────────────────────────────────────────────────────────────
DRY_RUN=false
INCLUDE_AISHA=false
QUICK_MODE=false
SINGLE_STAGE=""
FROM_STAGE=""
STATUS_ONLY=false
FAILED_STAGES=()

# ── Parse args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)        INCLUDE_AISHA=true; shift ;;
    --quick)      QUICK_MODE=true; shift ;;
    --stage)      SINGLE_STAGE="$2"; shift 2 ;;
    --from)       FROM_STAGE="$2"; shift 2 ;;
    --status)     STATUS_ONLY=true; shift ;;
    --dry)        DRY_RUN=true; shift ;;
    -h|--help)    head -30 "$0" | tail -28; exit 0 ;;
    *)            echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────────────────
run_cmd() {
  local desc="$1"
  shift
  # ⛔ Amputace volání (pokračovací \ ukousnuté komentářem) tu dřív prošla ZELENĚ:
  #    po `shift` zbylo prázdné "$@", a prázdný příkaz v shellu vrací 0 → `ok`.
  #    Helper, který hlásí úspěch příkazu, jaký nikdy nedostal, je lživý přístroj.
  if [ "$#" -eq 0 ]; then
    fail "$desc — run_cmd nedostal žádný příkaz (amputované volání?)"
    return 1
  fi
  if $DRY_RUN; then
    info "[DRY] $desc"
    echo -e "       ${DIM}$*${NC}"
    return 0
  fi
  info "$desc"
  if "$@"; then
    ok "$desc"
    return 0
  else
    fail "$desc (exit $?)"
    return 1
  fi
}

should_run_stage() {
  local stage_name="$1"
  local stage_num="$2"

  # Single stage mode
  if [[ -n "$SINGLE_STAGE" ]]; then
    [[ "$SINGLE_STAGE" == "$stage_name" ]] && return 0 || return 1
  fi

  # From stage mode
  if [[ -n "$FROM_STAGE" ]]; then
    local from_num
    case "$FROM_STAGE" in
      infra)  from_num=1 ;;
      llm)    from_num=2 ;;
      db)     from_num=3 ;;
      verify) from_num=4 ;;
      test)   from_num=5 ;;
      build)  from_num=6 ;;
      aisha)  from_num=7 ;;
      *)      from_num=1 ;;
    esac
    [[ $stage_num -ge $from_num ]] && return 0 || return 1
  fi

  # Quick mode: stages 1, 3, 4 only (infra + db + verify, skip LLM)
  if $QUICK_MODE; then
    [[ $stage_num -eq 2 ]] && return 1  # skip LLM in quick mode
    [[ $stage_num -gt 4 ]] && return 1  # skip test/build/aisha
    return 0
  fi

  # Aisha: only with --all or explicit
  if [[ $stage_num -eq 7 ]] && ! $INCLUDE_AISHA; then
    return 1
  fi

  return 0
}

# ── Status ───────────────────────────────────────────────────────────────────
show_status() {
  banner "Environment Status"

  echo -e "\n${BOLD}Local AISHA stack (recommended):${NC}"
  if [[ -f docker-compose.local.generated.json ]] && command -v docker &>/dev/null; then
    if docker compose -f docker-compose.local.generated.json ps --status running --format "{{.Service}}" 2>/dev/null | grep -q .; then
      ok "AISHA local services running (from local-warmup / local-compose-gen)"
      docker compose -f docker-compose.local.generated.json ps --status running --format "table {{.Service}}\t{{.Status}}" 2>/dev/null | tail -n +2 | sed 's/^/    /'
    else
      warn "No AISHA local generated compose running. Run: npm run warmup:local or npm run setup"
    fi
  else
    warn "No docker-compose.local.generated.json (run local-warmup first)"
  fi

  echo -e "\n${BOLD}Legacy local auth stack (DEPRECATED):${NC}"
  if npx supabase status &>/dev/null 2>&1; then
    warn "Legacy 'npx supabase' stack is running. This does not provide current Keycloak auth or match prod architecture."
    npx supabase status 2>/dev/null | head -10 | sed 's/^/    /'
  else
    skip "No legacy local auth stack running (good)"
  fi

  echo -e "\n${BOLD}Node modules:${NC}"
  if [[ -d "node_modules" ]]; then ok "node_modules present"; else fail "node_modules missing — run npm install"; fi

  echo -e "\n${BOLD}Types:${NC}"
  if [[ -f "src/integrations/db/types.ts" ]]; then
    local ts_age=$(( ($(date +%s) - $(stat -f %m "src/integrations/db/types.ts" 2>/dev/null || echo 0)) / 3600 ))
    ok "types.ts exists (last modified ${ts_age}h ago)"
  else
    fail "types.ts missing — run npm run db:types:gen:local"
  fi

  echo -e "\n${BOLD}i18n:${NC}"
  if [[ -f "src/i18n/locales/en.json" ]] && [[ -f "src/i18n/locales/cs.json" ]]; then
    ok "Locale files present (en, cs)"
  else
    warn "Some locale files missing"
  fi
}

if $STATUS_ONLY; then
  show_status
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# WARMUP STAGES
# ══════════════════════════════════════════════════════════════════════════════

banner "Evymo Warmup Workflow"
echo -e "  ${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
$DRY_RUN && echo -e "  ${YELLOW}DRY RUN — no commands will be executed${NC}"
$QUICK_MODE && echo -e "  ${BLUE}QUICK MODE — stages 1, 3-4 only (skip LLM)${NC}"
[[ -n "$SINGLE_STAGE" ]] && echo -e "  ${BLUE}SINGLE STAGE: $SINGLE_STAGE${NC}"
[[ -n "$FROM_STAGE" ]] && echo -e "  ${BLUE}FROM STAGE: $FROM_STAGE${NC}"

# ┌─────────────────────────────────────────────────────────────────────────────
# │ Stage 1: INFRA — Start local AISHA stack (current self-hosted: Postgres17 + PostgREST + Keycloak + Gateway)
# └─────────────────────────────────────────────────────────────────────────────
# This is the canonical local development infrastructure.
# It uses the same compose definitions and manifest as production (via local-warmup + local-compose-gen).
# No legacy auth runtime or legacy DB CLI is used for local dev anymore.
if should_run_stage "infra" 1; then
  stage "1/7" "INFRA — Local AISHA Stack (Postgres + PostgREST + Keycloak + Services)"
  STAGE_START=$SECONDS

  # Check node_modules
  if [[ ! -d "node_modules" ]]; then
    run_cmd "Installing dependencies" npm install
  else
    skip "node_modules already present"
  fi

  # Always use the modern local AISHA stack (replaces any old Supabase local).
  if command -v docker &>/dev/null && docker info >/dev/null 2>&1; then
    if [[ -n "${AISHA_LOCAL_APPS:-}" ]]; then
      run_cmd "Spouštím AISHA local stack (apps: $AISHA_LOCAL_APPS)" \
        bash "$SCRIPT_DIR/local-warmup.sh" --apps "$AISHA_LOCAL_APPS"
    else
      preset="${AISHA_LOCAL_PRESET:-}"
      if [[ -z "$preset" ]]; then
        if $QUICK_MODE; then preset="minimum"
        elif $INCLUDE_AISHA; then preset="full-light"
        else preset="optimum"
        fi
      fi
      run_cmd "Spouštím AISHA local stack (preset: $preset)" \
        bash "$SCRIPT_DIR/local-warmup.sh" --preset "$preset"
    fi
  else
    warn "Docker daemon nedostupný — skipping AISHA local stack"
  fi

  # Warn if legacy Supabase local is somehow still present (should not be started by us).
  if ! $DRY_RUN && command -v npx >/dev/null 2>&1 && npx supabase status &>/dev/null 2>&1; then
    warn "Legacy 'npx supabase' local appears to be running. This is not started by current warmup and is not compatible with Keycloak auth / current stack."
    warn "Stop it with 'npx supabase stop' if present. Use only 'npm run warmup:local' / 'npm run setup' for local dev."
  fi

  stage_time $STAGE_START
fi

# ┌─────────────────────────────────────────────────────────────────────────────
# │ Stage 2: LLM — Auto-detect & setup local LLM backend
# └─────────────────────────────────────────────────────────────────────────────
if should_run_stage "llm" 2; then
  stage "2/7" "LLM — Local LLM Backend"
  STAGE_START=$SECONDS

  AUTO_SELECT="${SCRIPT_DIR}/ai/auto-select.sh"
  if [[ -f "${AUTO_SELECT}" ]]; then
    # Detect what's available
    local_llm_json="$(bash "${AUTO_SELECT}" --json 2>/dev/null || echo '{}')"
    llm_backend="$(echo "${local_llm_json}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('backend','none'))" 2>/dev/null || echo 'none')"
    llm_model="$(echo "${local_llm_json}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('model',''))" 2>/dev/null || echo '')"
    llm_url="$(echo "${local_llm_json}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo '')"
    llm_env_var="$(echo "${local_llm_json}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('env_var',''))" 2>/dev/null || echo '')"

    if [[ "${llm_backend}" != "none" ]] && [[ -n "${llm_backend}" ]]; then
      ok "Detected backend: ${llm_backend} (model: ${llm_model})"

      # Install and pull model if not already available
      run_cmd "Setting up ${llm_backend} backend" bash "${AUTO_SELECT}" --install || true

      # Write env var to .env.local if not already set
      # Local model services run via Docker → use host.docker.internal
      if [[ -n "${llm_env_var}" ]] && [[ -n "${llm_url}" ]] && ! $DRY_RUN; then
        docker_url="${llm_url//localhost/host.docker.internal}"
        docker_url="${docker_url//127.0.0.1/host.docker.internal}"
        env_file="${PROJECT_ROOT}/.env.local"
        if [[ -f "${env_file}" ]]; then
          if ! grep -q "^${llm_env_var}=" "${env_file}" 2>/dev/null; then
            echo "${llm_env_var}=${docker_url}" >> "${env_file}"
            ok "Added ${llm_env_var}=${docker_url} to .env.local"
          else
            skip "${llm_env_var} already set in .env.local"
          fi

          # Write AISHA_DEFAULT_LOCAL_MODEL — detected model for all edge functions
          if [[ -n "${llm_model}" ]]; then
            # Prefix with backend for edge function routing (ollama-*, docker-ai/*)
            case "${llm_backend}" in
              ollama) local_model_id="ollama-${llm_model}" ;;
              docker) local_model_id="docker-ai/${llm_model}" ;;
              mlx)    local_model_id="${llm_model}" ;;
              *)      local_model_id="${llm_model}" ;;
            esac
            if ! grep -q "^AISHA_DEFAULT_LOCAL_MODEL=" "${env_file}" 2>/dev/null; then
              echo "AISHA_DEFAULT_LOCAL_MODEL=${local_model_id}" >> "${env_file}"
              ok "Added AISHA_DEFAULT_LOCAL_MODEL=${local_model_id} to .env.local"
            else
              # Update if changed (different model detected)
              current="$(grep "^AISHA_DEFAULT_LOCAL_MODEL=" "${env_file}" | cut -d= -f2-)"
              if [[ "${current}" != "${local_model_id}" ]]; then
                sed -i '' "s|^AISHA_DEFAULT_LOCAL_MODEL=.*|AISHA_DEFAULT_LOCAL_MODEL=${local_model_id}|" "${env_file}"
                ok "Updated AISHA_DEFAULT_LOCAL_MODEL=${local_model_id} (was: ${current})"
              else
                skip "AISHA_DEFAULT_LOCAL_MODEL already set to ${local_model_id}"
              fi
            fi
          fi
        fi
      fi

      # Health check
      if curl -sf "${llm_url}/models" &>/dev/null 2>&1 || \
         curl -sf "${llm_url%/v1}/api/tags" &>/dev/null 2>&1; then
        ok "LLM server healthy at ${llm_url}"
      else
        warn "LLM server not responding at ${llm_url} — may need manual start"
      fi
    else
      warn "No LLM backend detected — install with: npm run ollama:setup"
    fi
  else
    warn "auto-select.sh not found — skipping LLM stage"
  fi

  stage_time $STAGE_START
fi

# ┌─────────────────────────────────────────────────────────────────────────────
# │ Stage 3: DB — Migrations, types, seed
# └─────────────────────────────────────────────────────────────────────────────
if should_run_stage "db" 3; then
  stage "3/7" "DB — Database Setup"
  STAGE_START=$SECONDS

  run_cmd "Registering migrations" npm run db:migration:register
  run_cmd "Applying local migrations" npm run db:migrate:local
  run_cmd "Generating TypeScript types" npm run db:types:gen:local

  # Seed only if explicitly requested or on fresh setup
  if [[ -n "$SINGLE_STAGE" ]] || [[ -n "$FROM_STAGE" ]]; then
    run_cmd "Seeding local database" npm run db:seed:local
  else
    skip "Seed skipped (run --stage db for seeding)"
  fi

  stage_time $STAGE_START
fi

# ┌─────────────────────────────────────────────────────────────────────────────
# │ Stage 4: VERIFY — TypeScript, ESLint, i18n
# └─────────────────────────────────────────────────────────────────────────────
if should_run_stage "verify" 4; then
  stage "4/7" "VERIFY — Code Quality"
  STAGE_START=$SECONDS

  if ! run_cmd "TypeScript check" npx tsc --noEmit -p tsconfig.app.json; then
    FAILED_STAGES+=("verify:tsc")
  fi

  if ! run_cmd "ESLint check" npm run lint; then
    FAILED_STAGES+=("verify:lint")
  fi

  if ! run_cmd "i18n check" npm run i18n:check; then
    FAILED_STAGES+=("verify:i18n")
  fi

  stage_time $STAGE_START
fi

# ┌─────────────────────────────────────────────────────────────────────────────
# │ Stage 5: TEST — Unit tests + gate tests
# └─────────────────────────────────────────────────────────────────────────────
if should_run_stage "test" 5; then
  stage "5/7" "TEST — Test Suite"
  STAGE_START=$SECONDS

  if ! run_cmd "Gate tests (architecture, hygiene, security)" npm run test:gates; then
    FAILED_STAGES+=("test:gates")
  fi

  if ! run_cmd "Unit tests (all)" npm run test:run; then
    FAILED_STAGES+=("test:unit")
  fi

  stage_time $STAGE_START
fi

# ┌─────────────────────────────────────────────────────────────────────────────
# │ Stage 6: BUILD — Production build
# └─────────────────────────────────────────────────────────────────────────────
if should_run_stage "build" 6; then
  stage "6/7" "BUILD — Production Build"
  STAGE_START=$SECONDS

  if ! run_cmd "Production build (Vite + TypeDoc)" npm run build; then
    FAILED_STAGES+=("build")
  fi

  stage_time $STAGE_START
fi

# ┌─────────────────────────────────────────────────────────────────────────────
# │ Stage 7: AISHA — SSO federation + n8n + tools (optional)
# └─────────────────────────────────────────────────────────────────────────────
if should_run_stage "aisha" 7; then
  stage "7/7" "AISHA — Orchestration"
  STAGE_START=$SECONDS

  # ── SSO Federation (independent of n8n) ──────────────────────────────────
  KC_URL="${KEYCLOAK_URL:-http://localhost:8180}"
  if $DRY_RUN || curl -sf "${KC_URL}/realms/${KEYCLOAK_REALM:?KEYCLOAK_REALM required}/.well-known/openid-configuration" &>/dev/null; then
    # ⛔ `|| true` tu spolklo nezdar razítkování secretů (viz aisha-cold-start.sh).
    # Warmup smí být shovívavý k tomu, co je volitelné — ne k tomu, bez čeho
    # nikdo neprojde přihlášením.
    run_cmd "Provisioning SSO federation (KC groups scope + client secrets)" \
      bash scripts/provision-sso.sh || {
        echo "[warmup] ⛔ provision-sso.sh selhal — Keycloak nemá secrety důvěrných klientů;" >&2
        echo "[warmup]    přihlášení přes proxy skončí na 'unauthorized_client'." >&2
        exit 1
      }
    run_cmd "Verifying SSO status" \
      bash scripts/provision-sso.sh --check || true

    # Verify OAuth2 Proxies are healthy
    for proxy_name in appsmith-auth nocodb-auth; do
      proxy_port=$( [[ "$proxy_name" == "appsmith-auth" ]] && echo 4180 || echo 4181 )
      if $DRY_RUN || curl -sf "http://localhost:${proxy_port}/ping" &>/dev/null; then
        ok "OAuth2 Proxy ${proxy_name} healthy (:${proxy_port})"
      else
        warn "OAuth2 Proxy ${proxy_name} not reachable on :${proxy_port}"
      fi
    done

    # Provision Appsmith (admin user, workspace, StoryLoop app)
    : "${PUBLIC_TLD:?PUBLIC_TLD must be set}"
    if $DRY_RUN || curl -sf "http://localhost:8090/api/v1/health" &>/dev/null \
                 || curl -sf "https://appsmith.${PUBLIC_TLD}/api/v1/health" &>/dev/null; then
      run_cmd "Provisioning Appsmith StoryLoop dashboard" \
        bash scripts/provision-appsmith.sh || true
    else
      warn "Appsmith not reachable — skipping dashboard provisioning"
    fi
  else
    warn "Keycloak not reachable at ${KC_URL} — skipping SSO provisioning"
    info "Start Keycloak with: docker compose -f docker-compose.local.yml --profile keycloak up -d"
  fi

  # ── n8n Workflows & Tools ────────────────────────────────────────────────
  N8N_URL="${N8N_WEBHOOK_URL:-http://localhost:5678}"
  if $DRY_RUN || curl -sf "${N8N_URL}/healthz" &>/dev/null; then

    run_cmd "Verifying n8n workflows" npm run aisha:workflows:verify || true
    run_cmd "Syncing n8n workflows" npm run aisha:workflows:sync || true
    run_cmd "Deploying agent prompts" npm run aisha:prompts:deploy || true
    run_cmd "Deploying MCP tools" npm run aisha:tools:deploy || true
    run_cmd "Setting up NocoDB views" npm run aisha:nocodb:views || true
    run_cmd "Activating watchdogs" npm run aisha:watchdogs:activate || true
    run_cmd "Checking watchdog status" npm run aisha:watchdogs:status || true
    run_cmd "Integration smoke test" npm run aisha:integration:smoke || true

  else
    warn "n8n not reachable at ${N8N_URL} — skipping n8n stage"
    info "Start n8n with: npm run infra:up:n8n"
  fi

  stage_time $STAGE_START
fi

# ══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════════════════════════════
echo ""
TOTAL_ELAPSED=$(( SECONDS - TOTAL_START ))

if [[ ${#FAILED_STAGES[@]} -eq 0 ]]; then
  banner "Warmup Complete (${TOTAL_ELAPSED}s)"
  ok "All stages passed"
else
  banner "Warmup Finished with Issues (${TOTAL_ELAPSED}s)"
  echo ""
  for f in "${FAILED_STAGES[@]}"; do
    fail "Failed: $f"
  done
  echo ""
  warn "Fix the issues above and re-run the failed stages:"
  echo -e "  ${DIM}./scripts/warmup.sh --stage verify${NC}"
fi

echo ""

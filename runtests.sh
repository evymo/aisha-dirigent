#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# runtests.sh — Kompletní testovací sada pro CI / pre-deploy validaci
# ============================================================================
# Spouští všechny kontroly nutné k nasazení:
#   TypeScript, ESLint, i18n, SQL source of truth, security, gate testy,
#   unit testy (web + mobile), build
#
# Použití:
#   bash runtests.sh          # Vše včetně mobile
#   SKIP_MOBILE=true bash runtests.sh   # Bez mobile testů
#   SKIP_BUILD=true  bash runtests.sh   # Bez produkčního buildu
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

STEP=0
FAILED=0

run_step() {
  STEP=$((STEP + 1))
  echo ""
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}[$STEP] $1${NC}"
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  if eval "$2"; then
    echo -e "${GREEN}✅ [$STEP] $1 — OK${NC}"
  else
    echo -e "${RED}❌ [$STEP] $1 — FAILED${NC}"
    FAILED=$((FAILED + 1))
    if [[ "${FAIL_FAST:-false}" == "true" ]]; then
      echo -e "${RED}FAIL_FAST je zapnutý, ukončuji.${NC}"
      exit 1
    fi
  fi
}

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           AISHA — Kompletní testovací sada                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ── 1. TypeScript ──────────────────────────────────────────────────
run_step "TypeScript (web)" "npx tsc --noEmit"

# ── 2. ESLint ──────────────────────────────────────────────────────
run_step "ESLint" "npm run lint"
run_step "ESLint — console.log detection" "npm run lint:console"

# ── 3. i18n ────────────────────────────────────────────────────────
run_step "i18n (segmenty + schémata + runtime + mobile)" "npm run i18n:check"

# ── 4. SQL & DB validace ───────────────────────────────────────────
run_step "SQL source of truth" "npm run db-mgr:source"
run_step "Access flow report" "npm run db-mgr:access"
run_step "Flow consistency report" "npm run db-mgr:flow"
run_step "SQL SECURITY DEFINER hardening" "npm run test:sql:definer-hardening"
run_step "SQL audited — no SELECT *" "npm run test:sql:audited-no-select-star"

# ── 5. RPC & consistency validace ──────────────────────────────────
run_step "RPC + consistency validace" "npm run validate:static"
run_step "Mobile RPC-only check" "npm run test:mobile:rpc-only"

# ── 6. Gate testy (security, i18n, code hygiene, RLS, SQL) ────────
run_step "Gate testy (181 kontrol)" "npm run test:gates"

# ── 7. Unit testy (web) ───────────────────────────────────────────
run_step "Unit testy — web (Vitest)" "npm run test:run"

# ── 7b. Unit testy (services/svc-*) ──────────────────────────────
# Auto-discovered runner — runs vitest in every services/svc-* that has
# a test script + tests. Services without tests are silently skipped
# (covered by the wider hook-coverage gate philosophy).
run_step "Unit testy — services (Vitest, auto-discovered)" "npm run test:services"

# ── 8. Mobile ─────────────────────────────────────────────────────
if [[ "${SKIP_MOBILE:-false}" != "true" ]]; then
  run_step "Mobile (TypeScript + ESLint + Jest)" "npm run test:mobile:ci"
else
  echo ""
  echo -e "${YELLOW}⏭️  Mobile testy přeskočeny (SKIP_MOBILE=true)${NC}"
fi

# ── 9. Build ──────────────────────────────────────────────────────
if [[ "${SKIP_BUILD:-false}" != "true" ]]; then
  run_step "Produkční build (Vite + TypeDoc)" "npm run build"
else
  echo ""
  echo -e "${YELLOW}⏭️  Build přeskočen (SKIP_BUILD=true)${NC}"
fi

# ── Výsledek ───────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
if [[ $FAILED -eq 0 ]]; then
  echo -e "║  ${GREEN}✅ Všech $STEP kroků prošlo — READY TO DEPLOY${NC}              ║"
else
  echo -e "║  ${RED}❌ $FAILED z $STEP kroků selhalo${NC}                              ║"
fi
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

exit $FAILED

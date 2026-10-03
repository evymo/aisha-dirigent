#!/usr/bin/env bash
# ============================================================================
# runtests.omni-acceptance.sh — AISHA Omni ACCEPTANCE suite runner
# ============================================================================
# The Omni acceptance suite is the EXECUTABLE SPEC / definition-of-done for
# docs/planning/AISHA_OMNI_GATEWAY.md (v4, §0–§20). It is ISOLATED from normal
# CI (the default vitest.config.ts EXCLUDES src/tests/omni-acceptance/**; e2e
# and pgTAP omni specs self-skip unless OMNI_ACCEPTANCE is set).
#
# IMPORTANT: this suite is INTENTIONALLY RED today. Many LIVE tests prove
# current bugs (cross-tenant story leak, complexity tier never branching,
# governance-after-model-selection, kebab router imports, …) and act as
# regression guards that flip GREEN as the implementation lands. A non-zero
# result here is EXPECTED until Phase A is complete — this script is
# report-style and does NOT fail the build.
#
# Usage:
#   bash runtests.omni-acceptance.sh                 # vitest acceptance only
#   E2E=1 bash runtests.omni-acceptance.sh           # + Playwright e2e/omni
#   PGTAP=1 bash runtests.omni-acceptance.sh         # + pgTAP omni (needs DB)
#   ALL=1 bash runtests.omni-acceptance.sh           # everything
#
# Wire real live assertions by also exporting (per-spec docblocks list these):
#   AISHA_DB_URL / DATABASE_URL, OMNI_BASE_URL, OMNI_PAT, OMNI_SERVICE_TOKEN,
#   OMNI_TENANT_A_JWT, OMNI_TENANT_B_JWT
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")"

# Project requires Node 22 (.nvmrc). A fresh shell may default to an older
# system node (vitest is ESM → an old node fails with "SyntaxError: Unexpected
# string"). Activate the right node via nvm when available.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  nvm use >/dev/null 2>&1 || nvm use 22 >/dev/null 2>&1 || true
fi
echo "node: $(node -v 2>/dev/null || echo '??')"

export OMNI_ACCEPTANCE=1
YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
hr() { echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

hr; echo -e "${YELLOW}[1] Vitest — Omni acceptance (unit + integration)${NC}"; hr
npx vitest run --config vitest.omni-acceptance.config.ts --reporter=dot || true

if [ "${E2E:-0}" = "1" ] || [ "${ALL:-0}" = "1" ]; then
  hr; echo -e "${YELLOW}[2] Playwright — e2e/omni${NC}"; hr
  npx playwright test e2e/omni --reporter=line || true
else
  echo -e "${YELLOW}[2] Playwright e2e/omni — SKIPPED (set E2E=1 or ALL=1)${NC}"
fi

if [ "${PGTAP:-0}" = "1" ] || [ "${ALL:-0}" = "1" ]; then
  hr; echo -e "${YELLOW}[3] pgTAP — aisha/db/tests/schema/omni${NC}"; hr
  if [ -x ./aisha/db/tests/run-schema-tests.sh ]; then
    OMNI_ONLY=1 ./aisha/db/tests/run-schema-tests.sh || true
  elif command -v pg_prove >/dev/null 2>&1 && [ -n "${AISHA_DB_URL:-${DATABASE_URL:-}}" ]; then
    pg_prove -d "${AISHA_DB_URL:-$DATABASE_URL}" aisha/db/tests/schema/omni/*.sql || true
  else
    echo -e "${RED}pgTAP harness or DB not available — skipping (install pg_prove + set AISHA_DB_URL).${NC}"
  fi
else
  echo -e "${YELLOW}[3] pgTAP omni — SKIPPED (set PGTAP=1 or ALL=1)${NC}"
fi

hr
echo -e "${GREEN}Omni acceptance run complete.${NC} Red tests are the regression guards / acceptance targets."
echo "Turn them GREEN in the §20 order (router consolidation → streaming inversion → PAT story binding → /v1 → broadcast → governance)."
exit 0

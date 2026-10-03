#!/usr/bin/env bash
# ==============================================================================
# run-against-production.sh — Playwright E2E v kontejneru proti produkci
# ==============================================================================
# Spouští subset Playwright testů, které lze bezpečně provést proti deployed
# platformě. Anonymní/public testy běží out-of-the-box; auth flows vyžadují
# pre-provisioned test uživatele na produkčním Keycloaku (admin@platform.rtn,
# member@platform.rtn, partner@platform.rtn) — ty zatím nejsou seedované.
#
# Pro Google/Apple OAuth: testy ověří, že login UI redirectne na
# https://auth.example.com/...?kc_idp_hint=google — celý flow v Google/Apple
# se NEDAJÍ automatizovat (bot detection), takže testujeme pouze front-end
# integraci.
#
# Použití:
#   bash scripts/e2e/run-against-production.sh [--auth] [--full] [--ui]
#     --auth   include auth-required tests (vyžaduje E2E_*_PASSWORD env vars +
#              provisioned test users na produkci)
#     --full   include slower production-platform-audit
#     --ui     run in headed mode for debugging (only locally, not in container)
#
# Output: ./playwright-report/index.html, test-results/e2e-results.json
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# ── Args ──────────────────────────────────────────────────────────────────────
INCLUDE_AUTH=0
FULL_AUDIT=0
HEADED=0
for a in "$@"; do
  case "$a" in
    --auth) INCLUDE_AUTH=1 ;;
    --full) FULL_AUDIT=1 ;;
    --ui)   HEADED=1 ;;
    *) echo "unknown arg: $a"; exit 2 ;;
  esac
done

# ── Production targets (override via env) ─────────────────────────────────────
export E2E_BASE_URL="${E2E_BASE_URL:?E2E_BASE_URL required (e.g. https://web.<your-domain>)}"
export VITE_KC_URL="${VITE_KC_URL:?VITE_KC_URL required (e.g. https://auth.<your-domain>)}"
export E2E_KC_AUTHORITY="${E2E_KC_AUTHORITY:-${VITE_KC_URL}/realms/${KEYCLOAK_REALM:?KEYCLOAK_REALM required}}"
export E2E_KC_CLIENT_ID="${E2E_KC_CLIENT_ID:-aisha-app}"

# Skip starting local dev server — production is the target
export E2E_SKIP_SERVER=1

# ── Test selection ────────────────────────────────────────────────────────────
SPECS=(
  "e2e/public-smoke.generated.spec.ts"
  "e2e/prod-oidc-flow.spec.ts"
  "e2e/services-health.spec.ts"
)

if (( FULL_AUDIT )); then
  SPECS+=("e2e/production-platform-audit.spec.ts")
fi

if (( INCLUDE_AUTH )); then
  # Auth tests need real credentials — refuse to run without explicit user opt-in
  : "${E2E_ADMIN_PASSWORD:?E2E_ADMIN_PASSWORD must be set for --auth (or skip --auth for anon-only)}"
  SPECS+=(
    "e2e/admin.spec.ts"
    "e2e/member-flow.spec.ts"
    "e2e/backend-verification.spec.ts"
    "e2e/ai-features.spec.ts"
  )
fi

# ── Check: are we using a containerized runner? ───────────────────────────────
if (( HEADED )); then
  echo "ℹ️  Headed mode — running locally (cannot containerize headed Chrome reliably on macOS)"
  exec npx playwright test --headed --project=chromium "${SPECS[@]}"
fi

# Default: run in container (consistent CI-like environment, no node_modules contamination)
PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.59.1-noble}"
echo "🐳 Running Playwright in container: $PLAYWRIGHT_IMAGE"
echo "   Target: $E2E_BASE_URL"
echo "   KC:     $E2E_KC_AUTHORITY"
echo "   Specs:  ${SPECS[*]}"
echo

# Pull image (ignore failure — might already be cached)
docker pull --quiet "$PLAYWRIGHT_IMAGE" >/dev/null 2>&1 || true

mkdir -p playwright-report test-results

# Run via docker — mount repo as /work, install deps fresh inside container,
# pass production env vars through. --network host so container can reach the
# production endpoints from its own DNS resolver (host mode = use host resolver).
docker run --rm \
  --network host \
  -v "$ROOT:/work" \
  -w /work \
  -e CI=1 \
  -e E2E_BASE_URL \
  -e E2E_SKIP_SERVER \
  -e VITE_KC_URL \
  -e VITE_KC_AUTHORITY="${E2E_KC_AUTHORITY}" \
  -e E2E_KC_AUTHORITY \
  -e E2E_KC_CLIENT_ID \
  -e E2E_ADMIN_EMAIL="${E2E_ADMIN_EMAIL:-}" \
  -e E2E_ADMIN_PASSWORD="${E2E_ADMIN_PASSWORD:-}" \
  -e E2E_MEMBER_EMAIL="${E2E_MEMBER_EMAIL:-}" \
  -e E2E_MEMBER_PASSWORD="${E2E_MEMBER_PASSWORD:-}" \
  -e E2E_PARTNER_EMAIL="${E2E_PARTNER_EMAIL:-}" \
  -e E2E_PARTNER_PASSWORD="${E2E_PARTNER_PASSWORD:-}" \
  -e CONTAINER_USER_ID="$(id -u)" \
  -e CONTAINER_GROUP_ID="$(id -g)" \
  --user "$(id -u):$(id -g)" \
  --tmpfs /tmp \
  -e HOME=/tmp \
  "$PLAYWRIGHT_IMAGE" \
  bash -c '
    set -euo pipefail
    echo "📦 Installing dependencies (cached if possible)..."
    npm ci --prefer-offline --no-audit --no-fund --no-progress 2>&1 | tail -3
    echo "🎭 Running Playwright (production config — no setup project)..."
    npx playwright test \
      --config=playwright.prod.config.ts \
      --project=chromium \
      --reporter=list,html,json \
      "$@"
  ' bash "${SPECS[@]}"

echo
echo "✅ Done. Report: playwright-report/index.html"
echo "   JSON: test-results/e2e-results.json"

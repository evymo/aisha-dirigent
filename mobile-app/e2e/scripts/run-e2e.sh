#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-all}"
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLOW_DIR="$BASE_DIR/flows"

# Flows take a screenshot of each verified screen (the tests double as App Store
# capture). SHOT_DIR is where those PNGs land — default to a throwaway artifacts
# dir for plain test runs; the store wrapper overrides it to a per-locale/device
# folder. Exported so Maestro can substitute ${SHOT_DIR} in the flows.
export SHOT_DIR="${SHOT_DIR:-$BASE_DIR/.artifacts/screenshots}"

# ⛔ NAMĚŘENO 2026-09-04: všech pět scénářů mělo `appId: cz.id3a.aisha.app`
# natvrdo — tedy PLATFORMNÍ appku. My přitom stavíme `cz.riq.app` a
# `cz.riq.ridic`. Testy tak nemohly NIKDY spadnout na naší aplikaci, protože
# ji nikdy nespustily. Měřidlo, které neměří ani ten správný program.
#
# ⭐ `appId` se proto ODVOZUJE z profilu instance — z téhož `version.json`,
# ze kterého se staví. Nemůže se tím rozejít s tím, co se skutečně nasazuje.
# ⛔ ŽÁDNÝ FALLBACK: bez profilu nevíme, co testovat, a hádat bundleId znamená
# tiše otestovat cizí appku — přesně tu vadu, kterou tohle léčí.
if [ -z "${APP_ID:-}" ]; then
    PROFIL="${AISHA_APP_VERSION_FILE:-${AISHA_INSTANCE_OVERLAY:+$AISHA_INSTANCE_OVERLAY/version.json}}"
    if [ -z "$PROFIL" ] || [ ! -f "$PROFIL" ]; then
        echo "[error] Nevím, KTEROU appku testovat." >&2
        echo "        Nastav AISHA_INSTANCE_OVERLAY (povrch instance) nebo AISHA_APP_VERSION_FILE," >&2
        echo "        případně APP_ID přímo. Bundle id se NEHÁDÁ — testovat cizí appku je horší" >&2
        echo "        než netestovat: zeleno by neznamenalo nic." >&2
        exit 1
    fi
    APP_ID=$(grep '"bundleId"' "$PROFIL" | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    if [ -z "$APP_ID" ]; then
        echo "[error] $PROFIL neuvádí app.bundleId — nevím, co spustit." >&2
        exit 1
    fi
fi
export APP_ID
echo "[ok] Testovaná appka: $APP_ID"
mkdir -p "$SHOT_DIR"

if ! command -v maestro >/dev/null 2>&1; then
  echo "Maestro CLI was not found in PATH."
  echo "Install: curl -Ls \"https://get.maestro.mobile.dev\" | bash"
  exit 1
fi

if [[ -z "${E2E_USER_EMAIL:-}" || -z "${E2E_USER_PASSWORD:-}" ]]; then
  echo "Set E2E_USER_EMAIL and E2E_USER_PASSWORD before running auth/full flows."
  if [[ "$MODE" != "smoke" ]]; then
    exit 1
  fi
fi

case "$MODE" in
  smoke)
    maestro test "$FLOW_DIR/smoke/app-launches.yaml"
    ;;
  auth)
    maestro test "$FLOW_DIR/auth/login-success.yaml"
    maestro test "$FLOW_DIR/auth/logout.yaml"
    ;;
  # ⭐ ŘIDIČOVA PRÁCE, ne jen přihlášení. Do 2026-09-04 e2e pokrývalo login,
  # logout a přepínání záložek — tedy nic z toho, čím ta appka existuje.
  ridic)
    maestro test "$FLOW_DIR/ridic/predani-s-podpisem.yaml"
    ;;
  all)
    maestro test "$FLOW_DIR/smoke/app-launches.yaml"
    maestro test "$FLOW_DIR/auth/login-success.yaml"
    maestro test "$FLOW_DIR/smoke/post-login-navigation.yaml"
    maestro test "$FLOW_DIR/navigation/tab-switching.yaml"
    maestro test "$FLOW_DIR/ridic/predani-s-podpisem.yaml"
    maestro test "$FLOW_DIR/auth/logout.yaml"
    ;;
  screenshots)
    # The capture path: log in, then walk + screenshot the marketing screens.
    maestro test "$FLOW_DIR/auth/login-success.yaml"
    maestro test "$FLOW_DIR/smoke/post-login-navigation.yaml"
    echo "Screenshots → $SHOT_DIR"
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo "Usage: bash ./e2e/scripts/run-e2e.sh [smoke|auth|ridic|all|screenshots]"
    exit 2
    ;;
esac

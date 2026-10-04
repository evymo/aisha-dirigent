#!/usr/bin/env bash
# SessionStart — připraví cloudovou session Claude Code jako vývojářskou stanici:
# submodul extranet SDK, závislosti (root + workspaces, VS Code rozšíření,
# mobilní aplikace) a buildy z „Getting started" (build:packages → web build).
#
# Běží JEN v cloudu (CLAUDE_CODE_REMOTE=true); lokálně je no-op.
# Synchronní: session naběhne až po doběhnutí, takže testy a linter jsou hned
# k dispozici. Idempotentní: instalace je no-op nad hotovým stromem a buildy se
# přeskočí, pokud se od posledního běhu nezměnil HEAD ani pracovní strom.
#
# Žádný vlastní registr: @aisha/* jsou workspaces ze zdroje (extranet SDK ze
# submodulu packages/extranet-sdk), cizí balíky jdou z registry.npmjs.org podle
# lockfilu. Hlídá brána npmrc-registr-musi-mit-adresu.
#
# Volby (env): AISHA_SESSION_SKIP_BUILD=1 — jen instalace, bez buildů.
#
# Hook type: SessionStart
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

LOG=/tmp/aisha-session-start.log
: > "$LOG"
SUMMARY=()
FAILED=0

export npm_config_audit=false
export npm_config_fund=false

# run_step <popis> <příkaz…> — výstup do logu, do souhrnu jen výsledek a čas.
run_step() {
  local label="$1"
  shift
  local started=$SECONDS
  echo "=== $label: $*" >> "$LOG"
  if "$@" >> "$LOG" 2>&1; then
    SUMMARY+=("✓ $label ($((SECONDS - started))s)")
    return 0
  fi
  SUMMARY+=("✗ $label ($((SECONDS - started))s) — viz $LOG")
  FAILED=1
  echo "[session-start] $label selhal, konec logu:" >&2
  tail -25 "$LOG" >&2
  return 1
}

# ── Extranet SDK (submodul, zdroj workspaces @aisha/extranet-sdk-*) ──────────
# Klonuje se přes GitHub proxy session — repo evymo/aisha-extranet-sdk musí být
# v session připojené. Session s více repy ho má i jako sousední klon; ten
# poslouží, když proxy klon odmítne (připnutý commit musí v klonu být).
init_sdk() {
  [ -f packages/extranet-sdk/package.json ] && return 0
  git submodule update --init packages/extranet-sdk && return 0
  local sourozenec
  sourozenec="$(dirname "$PWD")/aisha-extranet-sdk"
  [ -d "$sourozenec/.git" ] || return 1
  git -c protocol.file.allow=always -c "submodule.packages/extranet-sdk.url=$sourozenec" \
    submodule update --init packages/extranet-sdk
}

INSTALL_OK=1
run_step "submodul packages/extranet-sdk" init_sdk || INSTALL_OK=0

# ── Instalace ────────────────────────────────────────────────────────────────
# `--no-save`: lockfile ani package.json se nepřepisují (strom zůstane čistý).
if [ "$INSTALL_OK" = 1 ]; then
  run_step "npm install (root + workspaces)" npm install --no-save || INSTALL_OK=0
fi

# Rozšíření a mobilní aplikace mají vlastní lockfile a nejsou workspaces.
if [ "$INSTALL_OK" = 1 ]; then
  run_step "npm install (extensions/aisha-dirigent)" \
    npm install --no-save --prefix extensions/aisha-dirigent || true
  run_step "npm install (mobile-app)" npm install --no-save --prefix mobile-app || true
fi

# ── Buildy ───────────────────────────────────────────────────────────────────
STAMP_DIR="node_modules/.cache/aisha-session-start"
STAMP_FILE="$STAMP_DIR/build.stamp"
build_key() {
  printf '%s %s' \
    "$(git rev-parse HEAD 2>/dev/null)" \
    "$(git status --porcelain=v1 --untracked-files=no 2>/dev/null | sha1sum | cut -c1-16)"
}

if [ "$INSTALL_OK" != 1 ]; then
  SUMMARY+=("• buildy přeskočeny (instalace selhala)")
elif [ "${AISHA_SESSION_SKIP_BUILD:-}" = "1" ]; then
  SUMMARY+=("• buildy přeskočeny (AISHA_SESSION_SKIP_BUILD=1)")
elif [ -f "$STAMP_FILE" ] && [ "$(cat "$STAMP_FILE")" = "$(build_key)" ] && [ -f dist/index.html ]; then
  SUMMARY+=("• buildy aktuální (beze změn od posledního běhu)")
else
  BUILD_FAILED=0
  run_step "build:packages (@aisha/* knihovny)" npm run build:packages || BUILD_FAILED=1
  run_step "compile (VS Code rozšíření)" npm --prefix extensions/aisha-dirigent run compile || BUILD_FAILED=1
  run_step "build (web aplikace)" npm run build || BUILD_FAILED=1
  if [ "$BUILD_FAILED" = 0 ]; then
    mkdir -p "$STAMP_DIR"
    build_key > "$STAMP_FILE"
  fi
fi

# ── Docker pro DB testy ──────────────────────────────────────────────────────
# Snapshot cloudového prostředí drží soubory, ne procesy: dockerd se startuje
# v každé session znovu. `npm run test:db` pak postaví/vezme throwaway Postgres.
if command -v dockerd > /dev/null 2>&1 && ! docker info > /dev/null 2>&1; then
  (dockerd > /tmp/dockerd.log 2>&1 &)
  SUMMARY+=("• dockerd spuštěn na pozadí (npm run test:db)")
fi

# ── Souhrn (stdout jde Claudovi do kontextu) ─────────────────────────────────
echo "--- AISHA cloud setup ---"
printf '  %s\n' "${SUMMARY[@]}"
echo "  Testy: npm run test:run · npm run test:gates:light · npm run test:services · npm run lint · npm run test:db"
echo "  Log: $LOG"

exit "$FAILED"

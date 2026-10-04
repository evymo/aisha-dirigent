#!/usr/bin/env bash
# SessionStart — připraví cloudovou session Claude Code jako vývojářskou stanici:
# nainstaluje závislosti a sestaví vše, co README uvádí v „Getting started"
# (npm install → build:packages → web build), plus VS Code rozšíření.
#
# Běží JEN v cloudu (CLAUDE_CODE_REMOTE=true); lokálně je no-op.
# Synchronní: session naběhne až po doběhnutí, takže testy a linter jsou hned
# k dispozici. Idempotentní: instalace je no-op nad hotovým stromem a buildy se
# přeskočí, pokud se od posledního běhu nezměnil HEAD ani pracovní strom.
#
# ⛔ PROČ --replace-registry-host=always
# package-lock.json nese u ~315 balíků `resolved` na zrcadlo npm.id3a.cz, které
# cloudová proxy nepustí (403). Volba přepíše hostitele na nakonfigurovaný
# registr (npmjs.org; pro @aisha/* VERDACCIO_URL z .npmrc) — obsah ověřuje
# `integrity` z locku, takže jde o tytéž tarbally.
#
# ⛔ PROČ SE MŮŽE VYNECHAT apps/workbench-shell
# Závisí na @aisha/extranet-sdk-ui, který je publikovaný JEN na privátním
# zrcadle (na npmjs 404). Workspace se zahrne, jakmile je SDK k dispozici:
#   · leží v packages/extranet-sdk-ui/ (stane se z něj workspace), nebo
#   · je nastavený VERDACCIO_URL (+ VERDACCIO_TOKEN) a registr balík vydá.
# Jinak se SDK připojí symlinkem ze sousedního klonu evymo/aisha-extranet-sdk
# (../aisha-extranet-sdk/packages/ui), je-li v session — root tsc, testy a brány
# ho pak vidí; workbench-shell zůstává mimo instalaci (lock chce verzi z registru).
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

# Nenastavená proměnná by v .npmrc zůstala doslova jako "${VERDACCIO_TOKEN}".
export VERDACCIO_TOKEN="${VERDACCIO_TOKEN:-}"
export npm_config_replace_registry_host=always
export npm_config_audit=false
export npm_config_fund=false

# Platí i pro další `npm install` během session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export npm_config_replace_registry_host=always' >> "$CLAUDE_ENV_FILE"
fi

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

# ── Výběr workspaces ─────────────────────────────────────────────────────────
sdk_available() {
  [ -f packages/extranet-sdk-ui/package.json ] && return 0
  [ -n "${VERDACCIO_URL:-}" ] || return 1
  npm view @aisha/extranet-sdk-ui version --registry "$VERDACCIO_URL" >/dev/null 2>&1
}

WORKSPACE_ARGS=()
if sdk_available; then
  SUMMARY+=("• workspaces: všechny (extranet SDK dostupné)")
else
  while IFS= read -r ws; do
    WORKSPACE_ARGS+=("--workspace=$ws")
  done < <(node -e '
    const fs = require("fs"), path = require("path");
    for (const glob of require("./package.json").workspaces) {
      const base = glob.replace(/\/\*$/, "");
      for (const dir of fs.readdirSync(base)) {
        const ws = path.join(base, dir);
        if (ws !== "apps/workbench-shell" && fs.existsSync(path.join(ws, "package.json"))) console.log(ws);
      }
    }')
  WORKSPACE_ARGS+=("--include-workspace-root")
  SUMMARY+=("• workspaces: bez apps/workbench-shell (chybí @aisha/extranet-sdk-ui)")
fi

# ── Instalace ────────────────────────────────────────────────────────────────
# `--no-save`: lockfile ani package.json se nepřepisují (strom zůstane čistý).
INSTALL_OK=1
run_step "npm install (root + workspaces)" \
  npm install --no-save ${WORKSPACE_ARGS[@]+"${WORKSPACE_ARGS[@]}"} || INSTALL_OK=0

# Rozšíření má vlastní lockfile a není workspace.
if [ "$INSTALL_OK" = 1 ]; then
  run_step "npm install (extensions/aisha-dirigent)" \
    npm install --no-save --prefix extensions/aisha-dirigent || true
fi

# Extranet SDK ze sousedního klonu — jen když ho nenainstaloval registr.
# Po každém `npm install` znovu: reify by symlink jako cizí balík odklidil.
SDK_SIBLING="$(dirname "$PWD")/aisha-extranet-sdk/packages/ui"
if [ "$INSTALL_OK" = 1 ] && [ ${#WORKSPACE_ARGS[@]} -gt 0 ] && [ -f "$SDK_SIBLING/package.json" ]; then
  rm -rf node_modules/@aisha/extranet-sdk-ui
  ln -s "$SDK_SIBLING" node_modules/@aisha/extranet-sdk-ui
  SUMMARY+=("• @aisha/extranet-sdk-ui → $SDK_SIBLING (v$(node -p "require('$SDK_SIBLING/package.json').version"))")
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

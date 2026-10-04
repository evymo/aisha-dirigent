#!/bin/bash
# =============================================================================
# Setup script cloudového prostředí AISHA (Claude Code on the web)
# =============================================================================
# KAM: claude.ai/code → menu cloud environmentu v titulku session → Edit →
#      pole „Setup script". Vložit CELÝ obsah tohoto souboru.
#
# Běží jako root na Ubuntu 24.04 PŘED startem Claude Code, a to jen při prvním
# startu prostředí: výsledek se uloží jako snapshot souborového systému a další
# session ho převezmou hotový (znovu se staví při změně skriptu nebo povolených
# domén a po ~7 dnech). Snapshot drží SOUBORY, ne běžící procesy — dockerd se
# musí v každé session spustit znovu (dělá to .claude/hooks/session-start.sh).
#
# ⛔ LIMIT ~5 MINUT: delší setup se NEcachuje. Kroky proto běží paralelně.
#
# Co připraví (vše idempotentní; chybějící repo se přeskočí):
#   1. bezpečnostní skenery: gitleaks (Go proxy), semgrep (PyPI)
#   2. aisha-orchestrator: npm závislosti + buildy (= .claude/hooks/session-start.sh),
#      pak throwaway Postgres image pro `npm run test:db`
#   3. Python repa insight, potok, aisha-local-ingest: venv v /opt/venvs/<repo>
#
# Repa hledá v /home/user/<repo>, kam je cloudová session klonuje. Session pro
# celý projekt: evymo/aisha-orchestrator + aisha-extranet-sdk (SDK se připojí
# symlinkem, privátní zrcadlo pak není potřeba) + insight + potok + aisha-local-ingest.
#
# ── Nastavení prostředí, ke kterému skript patří ─────────────────────────────
# Network access: Custom, zaškrtnout „Also include default list of common
# package managers", Allowed domains:
#     deb.debian.org         # apt v buildu infra/postgres (DB testy)
#     apt.postgresql.org     # pgaudit/pgtap v buildu infra/postgres
#   volitelně:
#     npm.id3a.cz            # privátní npm zrcadlo (SDK z registru místo z klonu)
#     api.backend.id3a.cz    # MCP server aisha-knowledge (.mcp.json)
# Environment variables:
#     VERDACCIO_TOKEN=
#     npm_config_replace_registry_host=always
#     REGISTRY_PROXY=mirror.gcr.io/   # Docker Hub přes Google mirror (anonymní pull = 429)
#     BASH_DEFAULT_TIMEOUT_MS=600000
#     BASH_MAX_TIMEOUT_MS=1800000
#   s povoleným npm.id3a.cz navíc: VERDACCIO_URL=https://npm.id3a.cz/
# Token k zrcadlu (je-li potřeba) NE do proměnných — ty vidí každý uživatel
# prostředí. Patří do „API credentials" pro host npm.id3a.cz.
# =============================================================================
set -uo pipefail
# Bez -e záměrně: jeden selhaný krok nesmí zastavit ostatní ani start session.
# Každý krok hlásí ✓/✗ do souhrnu a má vlastní log.

ROOT=/home/user
LOGDIR=/var/log/aisha-setup
SUMMARY="$LOGDIR/summary.txt"
mkdir -p "$LOGDIR" /opt/venvs
: > "$SUMMARY"

# step <jméno> <funkce> — spustí funkci na pozadí s logem a záznamem do souhrnu.
step() {
  local name="$1" fn="$2"
  (
    local started=$SECONDS
    if "$fn" > "$LOGDIR/$name.log" 2>&1; then
      echo "✓ $name ($((SECONDS - started))s)" >> "$SUMMARY"
    else
      echo "✗ $name ($((SECONDS - started))s) — viz $LOGDIR/$name.log" >> "$SUMMARY"
    fi
  ) &
}

scanners() {
  GOBIN=/usr/local/bin go install github.com/zricethezav/gitleaks/v8@v8.28.0
  UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --force semgrep
}

orchestrator() {
  local repo="$ROOT/aisha-orchestrator"
  [ -f "$repo/package.json" ] || { echo "repo chybí: $repo"; return 0; }
  # Instalace + build: tentýž skript, který běží jako SessionStart hook.
  # Větev, která hook ještě nemá, dostane tytéž kroky natvrdo.
  local hook="$repo/.claude/hooks/session-start.sh"
  if [ -f "$hook" ]; then
    CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR="$repo" CLAUDE_ENV_FILE=/dev/null bash "$hook"
  else
    (cd "$repo" && export VERDACCIO_TOKEN="${VERDACCIO_TOKEN:-}" \
      && npm install --no-save --no-audit --no-fund --replace-registry-host=always \
      && npm run build:packages && npm run build)
  fi
  # Throwaway DB image (tag nese otisk infra/postgres → staví se jen při změně).
  if ! docker info > /dev/null 2>&1; then
    (dockerd > /var/log/dockerd.log 2>&1 &)
    for _ in $(seq 1 30); do docker info > /dev/null 2>&1 && break; sleep 1; done
  fi
  cd "$repo" && AISHA_TESTDB_NO_SEED=1 node scripts/db/with-throwaway-db.mjs -- true
}

venv_potok() {
  local repo="$ROOT/potok"
  [ -d "$repo" ] || { echo "repo chybí: $repo"; return 0; }
  uv venv --allow-existing /opt/venvs/potok
  uv pip install --python /opt/venvs/potok -r "$repo/requirements-ci.txt"
}

venv_local_ingest() {
  local repo="$ROOT/aisha-local-ingest"
  [ -d "$repo" ] || { echo "repo chybí: $repo"; return 0; }
  uv venv --allow-existing /opt/venvs/aisha-local-ingest
  uv pip install --python /opt/venvs/aisha-local-ingest \
    -e "$repo[pdf,docx,xlsx,imaging,tokenizer,schema]" pytest
}

venv_insight() {
  local repo="$ROOT/insight"
  [ -d "$repo" ] || { echo "repo chybí: $repo"; return 0; }
  # Kořenový Pipfile = vývojový souhrn všech podprojektů (kronos, maestro, ragnarok).
  # ⛔ Lock pinuje torch s CUDA stackem (nvidia-*, triton) = jednotky GB; to se
  # do 5minutového limitu cache nevejde a VM nemá GPU. Lock je úplný (tranzitivní
  # piny), proto `--no-deps` bez GPU stacku. CPU torch jen s AISHA_SETUP_TORCH_CPU=1
  # a `download.pytorch.org` v Allowed domains (bez něj ragnarok embeddingy nepoběží).
  (cd "$repo" && uvx pipenv requirements --dev) \
    | grep -vE '^(torch|triton|nvidia-[a-z0-9-]+|cuda-[a-z0-9-]+)==' > /opt/venvs/insight.requirements.txt
  uv venv --allow-existing --python 3.11 /opt/venvs/insight
  (cd "$repo" && uv pip install --no-deps --python /opt/venvs/insight -r /opt/venvs/insight.requirements.txt)
  if [ "${AISHA_SETUP_TORCH_CPU:-}" = "1" ]; then
    uv pip install --python /opt/venvs/insight torch \
      --index-url https://download.pytorch.org/whl/cpu
  fi
}

step scanners scanners
step aisha-orchestrator orchestrator
step venv-potok venv_potok
step venv-aisha-local-ingest venv_local_ingest
step venv-insight venv_insight
wait

echo "--- AISHA cloud environment setup ---"
sort "$SUMMARY"
echo "Logy: $LOGDIR"
exit 0

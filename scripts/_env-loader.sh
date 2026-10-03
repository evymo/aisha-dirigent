#!/usr/bin/env bash
# scripts/_env-loader.sh — Sourcable env loader pro test skripty
#
# Usage:
#   source "$(dirname "$0")/_env-loader.sh"      # auto-detect tier
#   AISHA_TIER=staging source ".../_env-loader.sh"
#
# Tiers (in priority order):
#   - local       — host-port containers (localhost:9696, etc.); .env.local.dev
#   - staging     — staging mesh / coolify dev cluster; .env.staging (if exists)
#   - production  — Coolify Backend deploy; .env.coolify
#
# Auto-detect logic:
#   1. If AISHA_TIER explicitly set → use it
#   2. If aisha-local-ragnarok container běží → "local"
#   3. If .env.coolify má production URL → "production"
#   4. Default → "local"
#
# Vars exported (always normalised to canonical names):
#   POSTGREST_URL          — http://aisha-postgrest:3000 | mesh URL | local
#   POSTGREST_SERVICE_TOKEN
#   RAGNAROK_URL           — http://localhost:9696 | https://api.backend… | mesh
#   RAGNAROK_API_KEY
#   MAESTRO_URL
#   MAESTRO_API_KEY
#   KRONOS_SHIM_URL
#   OPENAI_API_KEY
#   AISHA_TIER             — exported for reference
#
# Konflikty local vs prod: tento loader DECIDOVĚ vybere right env file. Skripty
# pak nemusí switching řešit — stačí source loader.

# Detect repo root (parent of scripts/)
__ENV_LOADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
__REPO_ROOT="$(cd "$__ENV_LOADER_DIR/.." && pwd)"

__detect_tier() {
  if [ -n "${AISHA_TIER:-}" ]; then
    echo "$AISHA_TIER"
    return
  fi
  if docker ps --format "{{.Names}}" 2>/dev/null | grep -q "^aisha-local-ragnarok$"; then
    echo "local"
    return
  fi
  echo "local"
}

AISHA_TIER="$(__detect_tier)"

case "$AISHA_TIER" in
  local)
    # Local tier: tokeny + JWT_SECRET sdílí .env.coolify (musí matchovat
    # běžící postgrest container; .env.local.dev má placeholders), ale URLs
    # přepíšeme na host porty (localhost:9696 atp.) pro skripty volané z hosta.
    __ENV_FILE="$__REPO_ROOT/.env.coolify"
    ;;
  staging)
    __ENV_FILE="$__REPO_ROOT/.env.staging"
    [ ! -f "$__ENV_FILE" ] && __ENV_FILE="$__REPO_ROOT/.env.coolify"
    ;;
  production|prod|coolify)
    __ENV_FILE="$__REPO_ROOT/.env.coolify"
    AISHA_TIER="production"
    ;;
  *)
    echo "[env-loader] Unknown AISHA_TIER='$AISHA_TIER'; defaulting to local" >&2
    AISHA_TIER="local"
    __ENV_FILE="$__REPO_ROOT/.env.coolify"
    ;;
esac

if [ -f "$__ENV_FILE" ]; then
  # ⛔ CHYBA PŘI ČTENÍ SE NEZAMLČUJE (naměřeno 2026-09-16 na dvou instancích).
  # Tady stálo `source "$__ENV_FILE" 2>/dev/null || true`. Víceslovná hodnota bez
  # uvozovek přitom `source` buď ROZBIJE (u jedné instance skončil na 216. řádku
  # a všechno za ním — včetně UUID serverů — bylo pro skripty neviditelné;
  # story-init pak neuměl založit aplikaci, „protože neznal server"), nebo hodnotu
  # UŘÍZNE na první slovo. Obojí vypadalo jako úspěch: chyba šla do /dev/null
  # a `|| true` ji smazalo i z návratového kódu.
  #
  # Načtení je předpoklad, ne detail: skript, který pokračuje s useknutým
  # prostředím, hlásí cizí příznaky. Proto se chyba VYPÍŠE a volající skončí;
  # nápravu (uvozování + kontrolu) drží `scripts/aisha-env-doctor.mjs`.
  # Návratový kód TU NESTAČÍ: `KLIC=dve slova` spustí `slova` jako příkaz, ten
  # selže — ale `source` vrátí status POSLEDNÍHO řádku, tedy klidně nulu.
  # (Změřeno na dvou instancích: jedna abortovala, druhá vrátila 0 a hodnoty
  # uřízla na první slovo.) Měří se proto VÝSTUP: env soubor nemá co říkat.
  # `mktemp` BEZ argumentů: `-t JMENO` je macOS tvar a GNU mktemp na Linuxu na něm
  # SELŽE (naměřeno v CI 2026-09-16 — soubor nevznikl, měřidlo mlčelo a loader
  # pokračoval s useknutým prostředím, tedy přesně to, co má hlídat). Holé `mktemp`
  # umí obojí a samo respektuje TMPDIR, takže se tu nic nedosazuje.
  if ! __env_chyby="$(mktemp)"; then
    echo "[env-loader] ⛔ nejde založit dočasný soubor pro chyby čtení — bez něj bych načtení NEZMĚŘIL." >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$__ENV_FILE" 2>"$__env_chyby" || true
  set +a
  if [ -s "$__env_chyby" ]; then
    echo "[env-loader] ⛔ ${__ENV_FILE##*/} se nenačetl celý — prostředí je NEÚPLNÉ:" >&2
    head -3 "$__env_chyby" | sed 's/^/[env-loader]    /' >&2
    echo "[env-loader]    Příčina bývá víceslovná hodnota bez uvozovek: source ji rozpadne (a zbytek souboru" >&2
    echo "[env-loader]    už nepřečte), nebo ji uřízne na první slovo. Obojí vypadá jako úspěch." >&2
    echo "[env-loader]    Náprava: node scripts/aisha-env-doctor.mjs   (srovná uvozování a vypíše klíče)" >&2
    rm -f "$__env_chyby"
    exit 1
  fi
  rm -f "$__env_chyby"
fi

# Tier-specific URL overrides AFTER env file load (local containers != prod mesh).
# Everything parameterized from central local deploy config (config/local-presets.mjs
# + getters). No magic localhost strings in deploy scripts. Matches the goal that
# all deploy-time things (local-warmup, setup, loaders, cold-start etc.) are dynamic.
if [ "$AISHA_TIER" = "local" ]; then
  # Use node to query the same source of truth as local-warmup/setup (devEnvDefaults + getters).
  # Falls back to safe reference if node/presets not available (early bootstrap).
  POSTGREST_URL=$(node --input-type=module -e '
    import { getLocalGatewayUrl } from "./config/local-presets.mjs";
    console.log(process.env.POSTGREST_URL || getLocalGatewayUrl().replace(/:3001$/, ":3000"));
  ' )
  RAGNAROK_URL=$(node --input-type=module -e '
    import { getLocalRagnarokUrl } from "./config/local-presets.mjs";
    console.log(process.env.RAGNAROK_URL || getLocalRagnarokUrl());
  ' )
  MAESTRO_URL=$(node --input-type=module -e '
    import { getLocalMaestroUrl } from "./config/local-presets.mjs";
    console.log(process.env.MAESTRO_URL || getLocalMaestroUrl());
  ' )
  KRONOS_SHIM_URL=$(node --input-type=module -e '
    import { getLocalKronosShimUrl } from "./config/local-presets.mjs";
    console.log(process.env.KRONOS_SHIM_URL || getLocalKronosShimUrl());
  ' )
  : "${RAGNAROK_API_KEY:=aisha-ragnarok-local}"
  : "${MAESTRO_API_KEY:=aisha-maestro-local}"
  : "${KRONOS_API_KEY:=aisha-kronos-shim-local}"
fi

export AISHA_TIER POSTGREST_URL POSTGREST_SERVICE_TOKEN RAGNAROK_URL RAGNAROK_API_KEY \
       MAESTRO_URL MAESTRO_API_KEY KRONOS_SHIM_URL KRONOS_API_KEY OPENAI_API_KEY

# Banner pokud BASH spuštěn interaktivně z test skriptu
if [ "${AISHA_ENV_LOADER_QUIET:-0}" != "1" ]; then
  echo "[env] tier=$AISHA_TIER  pg=${POSTGREST_URL}  ragnarok=${RAGNAROK_URL%/*}/  maestro=${MAESTRO_URL%/*}/" >&2
fi

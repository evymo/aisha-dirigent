#!/usr/bin/env bash
# =============================================================================
# cold-start-doctor.sh — Komplexní preflight pro produkční cold-start
# =============================================================================
# Ověří všechny předpoklady, které musí být splněny PŘED spuštěním
# `bash scripts/aisha-cold-start.sh`. Read-only — žádné modifikace.
#
# 7 fází:
#   A. Environment — required env vars přítomné
#   B. Files       — manifest + compose soubory existují
#   C. Env contract — aisha-env-doctor.mjs --report (chybějící klíče v .env.coolify)
#   D. Compose interpolation — preflight-compose.sh (každý compose se renderuje)
#   E. Manifest ↔ compose match — bidirectional consistency
#   F. Coolify API — connectivity check
#   G. Git host — dosažitelnost gitového původu (origin), ze kterého staví Coolify
#   K. Keycloak    — servíruje instance svůj realm? (varování; --no-network = neměřeno)
#
# Exit codes:
#   0 — green (cold-start je safe spustit)
#   1 — fatal (cold-start by selhal; oprav před spuštěním)
#   2 — warnings (cold-start může projít, ale s rizikem)
#
# Usage:
#   bash scripts/cold-start-doctor.sh                  # full check
#   bash scripts/cold-start-doctor.sh --no-network     # skip API/git checks
#   bash scripts/cold-start-doctor.sh --phase A,B,C    # only specific phases
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Env soubor prostředí z jednoho domova (PR2 izolace): ve stagingu `.env.<env>`,
# ne produkční `.env.coolify` — fáze C/D a měření níž čtou TENTÝŽ soubor, který
# cold-start generuje. Cold-start předává ENV_FILE výslovně.
# shellcheck source=lib/prostredi-behu.sh
. "$SCRIPT_DIR/lib/prostredi-behu.sh"
DOKTOR_ENV_SOUBOR="${ENV_FILE:-$(pb_env_soubor "$REPO_ROOT" "${AISHA_ENV:-}")}" || {
  echo "✗ AISHA_ENV=${AISHA_ENV:-} není známý tvar prostředí." >&2; exit 2; }
cd "$REPO_ROOT"

# ── Colors ──────────────────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'; N='\033[0m'; BOLD='\033[1m'; DIM='\033[2m'
ok()    { echo -e "  ${G}✓${N} $*"; PASS_COUNT=$((PASS_COUNT+1)); }
fail()  { echo -e "  ${R}✗${N} $*"; FAIL_COUNT=$((FAIL_COUNT+1)); FAIL_REASONS+=("$*"); }
warn()  { echo -e "  ${Y}⚠${N} $*"; WARN_COUNT=$((WARN_COUNT+1)); WARN_REASONS+=("$*"); }
info()  { echo -e "  ${B}ℹ${N} $*"; }
phase() { echo -e "\n${C}${BOLD}━━━ Phase $1: $2 ━━━${N}"; }
# Výstup nástrojů, které doktor měří, nese ANSI barvy. Kotva `…OK$` na obarveném
# řádku NIKDY netrefí (řádek končí `ESC[0m`), takže počítání přes grep hlásilo
# nulu nad zeleným výsledkem (naměřeno 2026-09-13, fáze D: „0 stacku" při 34 OK).
# Co se čte strojově, čte se bez barev.
bez_barev() { sed $'s/\033\\[[0-9;]*m//g'; }

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
FAIL_REASONS=()
WARN_REASONS=()

# ── Args ────────────────────────────────────────────────────────────────────
NO_NETWORK=0
PHASES_FILTER=""
# ⛔ NAMĚŘENO 2026-08-16: doktor blokoval `--wipe` kvůli DVĚMA aplikacím téhož
# jména — tedy kvůli stavu, který ten wipe SÁM odstraní (smaže všechny aplikace
# projektu a manifest založí jednu). Fail-closed na podmínku, kterou právě
# spuštěná operace ruší; táž třída jako „fail-closed musí respektovat pozici
# ve vlně". Cold-start proto svůj ZÁMĚR ohlásí a doktor podle něj rozliší,
# co je překážka a co jen popis výchozího stavu.
#
# POZOR na hranici: platí to JEN pro nálezy uvnitř NAŠEHO projektu. Kolize
# aliasů s CIZÍM nájemníkem zůstává FAIL i při wipu — náš wipe na cizí projekt
# nesahá, takže po něm bude ta kolize pořád tam.
WIPE_PLANNED="${AISHA_WIPE_PLANNED:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-network) NO_NETWORK=1; shift ;;
    --phase) PHASES_FILTER="$2"; shift 2 ;;
    --wipe-planned) WIPE_PLANNED=1; shift ;;
    -h|--help) head -28 "$0" | tail -26; exit 0 ;;
    *) fail "Unknown option: $1"; exit 1 ;;
  esac
done

should_run_phase() {
  local p="$1"
  if [[ -z "$PHASES_FILTER" ]]; then return 0; fi
  [[ ",$PHASES_FILTER," == *",$p,"* ]] && return 0 || return 1
}

# ── Banner ──────────────────────────────────────────────────────────────────
echo -e "${C}${BOLD}╔══════════════════════════════════════════════════════════════╗${N}"
echo -e "${C}${BOLD}║  AISHA Cold-Start Doctor — preflight readiness check          ║${N}"
echo -e "${C}${BOLD}╚══════════════════════════════════════════════════════════════╝${N}"
echo -e "  ${DIM}$(date '+%Y-%m-%d %H:%M:%S')${N}"

# ⛔ NAMĚŘENO 2026-09-02 na <fork>: doktor hlásil „COOLIFY_PROJECT_UUID not set" a
# „No server identity" — tedy NOT READY — zatímco cold-start týž projekt i všechny
# čtyři sloty resolvoval bez potíží. Příčina: resolve_target_env níž sourcuje
# config/coolify-environments.env, jenže ten je ŠABLONA (${COOLIFY_PROD_*:-}) a
# hodnoty do ní dodává .env.local. Cold-start proto načítá .env.local PRVNÍ a teprve
# pak zálohu (pre_resolve_load_env); doktor měl jen tu druhou půlku, takže se šablona
# rozvinula do prázdna. Preflight, který před NEVRATNÝM nasazením lže do červena, je
# horší než žádný: nutí operátora sáhnout po --skip-doctor a přijít i o ostatních 33 testů.
ENV_LOCAL_FILE="${AISHA_ENV_LOCAL_FILE:-$REPO_ROOT/.env.local}"
if [[ -f "$ENV_LOCAL_FILE" ]] && [[ "$ENV_LOCAL_FILE" != "/dev/null" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_LOCAL_FILE"
  set +a
fi

# Source .env-prod-backup if exists (for GIT_TOKEN, COOLIFY_API_KEY, etc.).
# Override path via AISHA_PROD_BACKUP_FILE — testy mohou nastavit na /dev/null
# aby doctor neložil real production creds.
PROD_BACKUP_FILE="${AISHA_PROD_BACKUP_FILE:-$REPO_ROOT/.env-prod-backup}"
if [[ -f "$PROD_BACKUP_FILE" ]] && [[ "$PROD_BACKUP_FILE" != "/dev/null" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$PROD_BACKUP_FILE"
  set +a
fi

# Credentials the vault does not hold: fill from the canonical chain.
#
# .env-prod-backup carries the GENERATED secrets (that is what the reverse-sync
# reconstructs). Operator credentials — the Coolify and git tokens — are not
# generated, so they legitimately live in .env.coolify and never appear there.
# Sourcing only the vault therefore reported "<token> empty" while the
# token sat in .env.coolify, blocking a wipe on a condition that was not true.
#
# A doctor must diagnose what the toolchain will ACTUALLY see, so it reads the
# same chain every other tool now reads. Only fills what is still unset, so an
# explicit export or the vault keeps precedence.
# shellcheck source=scripts/lib/coolify-credentials.sh
if [[ -f "$REPO_ROOT/scripts/lib/coolify-credentials.sh" ]] && [[ "$PROD_BACKUP_FILE" != "/dev/null" ]]; then
  . "$REPO_ROOT/scripts/lib/coolify-credentials.sh"
  for _k in GIT_TOKEN GITHUB_TOKEN COOLIFY_API_TOKEN COOLIFY_API_KEY COOLIFY_URL COOLIFY_PROJECT_UUID; do
    [[ -n "${!_k:-}" ]] && continue
    _v="$(config_env_key "$_k" 2>/dev/null || true)"
    [[ -n "$_v" ]] && export "$_k=$_v"
  done
  unset _k _v
fi

# Source timeouts config (per-env tunables)
if [[ -f "$REPO_ROOT/config/cold-start-timeouts.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$REPO_ROOT/config/cold-start-timeouts.env"
  set +a
fi

# Který manifest se měří, rozhoduje SDÍLENÁ hranice instance — týž resolver, jaký
# používají .mjs nástroje (lib/coolify-instance-scope.mjs). Vlastní kopie pravidla
# by driftovala proti tomu, podle čeho se doopravdy nasazuje, a manifest rozhoduje,
# ČÍ aplikace se prohlížejí: tichý default by na cizí instanci ohlásil zdraví
# upstreamu.
#
# `--allow-default` je tu ZÁMĚRNĚ, ne z pohodlí. Doktor je PREFLIGHT: musí jít
# spustit i nad čerstvým klonem, kde identita ještě deklarovaná není — jinak by
# nástroj, který má nedeklarovanou identitu NAHLÁSIT, sám odmítl nastartovat a
# operátor by se příčinu nedozvěděl. Fail-loud na nedeklarovanou identitu má
# doktor na svém místě dál (fáze A), s diagnostikou a nápravou.
if ! MANIFEST=$(node "$REPO_ROOT/scripts/lib/coolify-instance-scope.mjs" --manifest-path --allow-default 2>/dev/null); then
  echo "FATAL: nepodařilo se určit manifest instance." >&2
  echo "  node scripts/lib/coolify-instance-scope.mjs --manifest-path  ← spusť pro příčinu" >&2
  exit 2
fi
STORY="$(basename "$MANIFEST" .manifest)"
if [[ -n "${AISHA_INSTANCE:-}" ]] && [[ -f "$REPO_ROOT/config/domains-${AISHA_INSTANCE}.env" ]]; then
  # nounset off while sourcing: the overlay may reference vault vars (GIT_BASE_URL)
  # that are empty on a from-committed-repo preflight — don't abort the doctor.
  set +u
  set -a
  # shellcheck source=/dev/null
  . "$REPO_ROOT/config/domains-${AISHA_INSTANCE}.env"
  set +a
  set -u
fi
API_TIMEOUT="${AISHA_DOCTOR_API_TIMEOUT_S:-10}"

resolve_target_env() {
  [[ -n "${AISHA_ENV:-}" ]] || return 0
  local envs_file="$REPO_ROOT/config/coolify-environments.env"
  [[ -f "$envs_file" ]] || { fail "AISHA_ENV=$AISHA_ENV set but $envs_file missing"; return 1; }
  set -a
  # shellcheck source=/dev/null
  . "$envs_file"
  set +a

  # Prefix z jednoho domova (scripts/lib/prostredi-behu.sh) — táž odpověď jako obal,
  # cold-start i discovery. Story sloty (<story>-{staging,prod}) mají slot ze jména
  # prostředí; dřív tu byla vlastní kopie mapování (a doktor bez ní padal na každém
  # story nasazení, které volající podporuje).
  local prefix
  if ! prefix="$(pb_prefix "$AISHA_ENV")"; then
    fail "Invalid AISHA_ENV=$AISHA_ENV (expected production, staging, or <story>-{staging,prod})"; return 1
  fi

  local url_var="${prefix}URL"
  local project_var="${prefix}PROJECT_UUID"
  local frontend_var="${prefix}SERVER_UUID_FRONTEND"
  local backend_var="${prefix}SERVER_UUID_BACKEND"
  local experimental_var="${prefix}SERVER_UUID_EXPERIMENTAL"

  if [[ -n "${COOLIFY_URL:-}" && -n "${!url_var:-}" && "$COOLIFY_URL" != "${!url_var}" ]]; then
    fail "COOLIFY_URL conflicts with AISHA_ENV=$AISHA_ENV ($COOLIFY_URL != ${!url_var})"
    return 1
  fi
  export COOLIFY_URL="${COOLIFY_URL:-${!url_var:-}}"
  export COOLIFY_BASE_URL="${COOLIFY_BASE_URL:-$COOLIFY_URL}"
  export COOLIFY_PROJECT_UUID="${COOLIFY_PROJECT_UUID:-${!project_var:-}}"
  export COOLIFY_SERVER_UUID_FRONTEND="${COOLIFY_SERVER_UUID_FRONTEND:-${!frontend_var:-}}"
  export COOLIFY_SERVER_UUID_BACKEND="${COOLIFY_SERVER_UUID_BACKEND:-${!backend_var:-}}"
  export COOLIFY_SERVER_UUID_EXPERIMENTAL="${COOLIFY_SERVER_UUID_EXPERIMENTAL:-${!experimental_var:-}}"
}

resolve_target_env || true

# ============================================================================
# Phase A — Environment
# ============================================================================
if should_run_phase A; then
  phase A "Environment variables"

  # Critical secrets — per-var error messages.
  # COOLIFY_API_KEY ↔ COOLIFY_API_TOKEN alias (legacy naming — některé skripty
  # v repu používají TOKEN, jiné KEY; .env-prod-backup obsahuje TOKEN).
  COOLIFY_API_KEY="${COOLIFY_API_KEY:-}"
  COOLIFY_API_TOKEN="${COOLIFY_API_TOKEN:-}"
  GIT_TOKEN="${GIT_TOKEN:-}"

  coolify_val="$COOLIFY_API_KEY"
  [[ -z "$coolify_val" ]] && coolify_val="$COOLIFY_API_TOKEN"
  if [[ -n "$coolify_val" ]]; then
    ok "COOLIFY_API_KEY present (${#coolify_val} chars)"
  else
    fail "COOLIFY_API_KEY (alias COOLIFY_API_TOKEN) empty — bez něj nelze volat Coolify API → cold-start step 1 (safety check) okamžitě failuje"
  fi

  # GIT_TOKEN — klon SOUKROMÝCH repozitářů (kód v Coolify, instanční overlaye přes
  # BuildKit secret git_token). Veřejný kód se naklonuje i bez něj; deklarovaný
  # overlay je ale soukromý z podstaty → bez tokenu build/migrate padne na 401.
  if [[ -n "$GIT_TOKEN" ]]; then
    ok "GIT_TOKEN present (${#GIT_TOKEN} chars)"
  elif [[ -n "${AISHA_INSTANCE_DATA_GIT_URL:-}${AISHA_WEB_DESIGN_GIT_URL:-}${KC_THEME_OVERLAY_GIT_URL:-}" ]]; then
    fail "GIT_TOKEN empty — instance deklaruje soukromý overlay (AISHA_INSTANCE_DATA_GIT_URL / AISHA_WEB_DESIGN_GIT_URL / KC_THEME_OVERLAY_GIT_URL); klon v buildu/migrate padne na 401"
  else
    warn "GIT_TOKEN empty — Coolify i buildy naklonují jen veřejná repa (kód stacku musí být veřejný)"
  fi

  if [[ -n "${COOLIFY_PROJECT_UUID:-}" ]]; then
    ok "COOLIFY_PROJECT_UUID = ${COOLIFY_PROJECT_UUID:0:12}…"
  else
    fail "COOLIFY_PROJECT_UUID not set — explicit Coolify project UUID required before cold-start"
  fi

  if [[ -n "${COOLIFY_ENVIRONMENT:-}" ]]; then
    ok "COOLIFY_ENVIRONMENT = $COOLIFY_ENVIRONMENT"
  else
    fail "COOLIFY_ENVIRONMENT not set — explicit Coolify environment name required before cold-start"
  fi

  # Server slot identity — DYNAMIC. cold-start auto-discovers the per-slot Coolify
  # server UUIDs from the live /servers API by matching ${SLOT}_HOSTNAME (see the
  # "Iter 19" block in aisha-cold-start.sh → generate-coolify-context.mjs). Nothing
  # is hardcoded: the only durable input is the hostname (operator env). So Phase A
  # only checks that a server-identity INPUT exists; the real UUID resolution is
  # verified live against /servers in Phase F. Pre-set COOLIFY_SERVER_UUID_* and
  # AISHA_TARGET_SERVER are optional overrides, NOT requirements.
  _uuid_override=0
  for uuid_var in COOLIFY_SERVER_UUID_FRONTEND COOLIFY_SERVER_UUID_BACKEND COOLIFY_SERVER_UUID_EXPERIMENTAL; do
    [[ -n "${!uuid_var:-}" ]] && _uuid_override=1
  done
  if [[ -n "${FRONTEND_HOSTNAME:-}${BACKEND_HOSTNAME:-}${EXPERIMENTAL_HOSTNAME:-}" ]]; then
    ok "Server hostnames set (F=${FRONTEND_HOSTNAME:-–} B=${BACKEND_HOSTNAME:-–} E=${EXPERIMENTAL_HOSTNAME:-–}) — Coolify server UUIDs auto-discovered from /servers (verified in Phase F)"
  elif [[ -n "${AISHA_TARGET_SERVER:-}" ]]; then
    ok "AISHA_TARGET_SERVER=${AISHA_TARGET_SERVER} — single-host: every slot pins to one server (UUID auto-discovered from /servers)"
  elif [[ "$_uuid_override" -eq 1 ]]; then
    ok "Explicit COOLIFY_SERVER_UUID_* override present (bypasses hostname discovery)"
  else
    fail "No server identity — cold-start can't resolve target servers. Set FRONTEND_HOSTNAME/BACKEND_HOSTNAME/EXPERIMENTAL_HOSTNAME (preferred — UUIDs auto-discovered from Coolify /servers), or AISHA_TARGET_SERVER (single-host), or COOLIFY_SERVER_UUID_FRONTEND/BACKEND/EXPERIMENTAL in .env-prod-backup"
  fi

  # Coolify URL
  if [[ -n "${COOLIFY_URL:-}" ]]; then
    ok "COOLIFY_URL = $COOLIFY_URL"
  else
    fail "COOLIFY_URL not set — explicit Coolify base URL required before cold-start"
  fi

  # Domain config
  if [[ -f "$REPO_ROOT/config/domains.env" ]]; then
    ok "config/domains.env exists"
    # Critical domain keys for edge/web builds (Dockerfile.web render-app-config
    # + VITE_ derivations) and for Coolify build args. Blank values here (e.g.
    # only .example placeholders after fresh clone or wrong overlay) cause
    # "variable is not set" during docker compose build on the target server
    # and hard FATAL in render-app-config → full deploy abort (see 2026-06-07
    # multi-server cold-start symptoms on Giah/Talos).
    # ⛔ MĚŘÍ SE ROZVINUTÁ HODNOTA, NE ŠABLONA. Do 2026-09-04 tahle smyčka četla
    # syrový řádek `config/domains.env` přes `cut -d= -f2-`, takže u
    # `APP_DOMAIN=${APP_DOMAIN:-}` dostala LITERÁL `${APP_DOMAIN:-}` — neprázdný,
    # bez slova „example" — a ohlásila ✅. Kontrola, která má chytat právě
    # `.example` placeholdery „after fresh clone or wrong overlay" (viz komentář
    # výš), tedy NEMOHLA SELHAT NIKDY. Doktor hlásil 38 pass / 0 fails a
    # cold-start umřel o fázi dál; `netbird.aisha.example.com` prošel až do
    # produkce právě tudy.
    #
    # Zdroj pravdy je resolver — týž idiom jako `_surf_env` níž. Když klíč
    # neemituje, dopadneme na rozvinutí šablony v podshellu (NE na její text).
    _dom_env="$(AISHA_PROFILE="${AISHA_PROFILE:-}" node "$REPO_ROOT/scripts/lib/derive-domains.mjs" --shell 2>/dev/null || true)"
    for dkey in APP_DOMAIN API_DOMAIN API_DOMAIN_PUBLIC PUBLIC_TLD INTERNAL_TLD KEYCLOAK_DOMAIN KEYCLOAK_DOMAIN_PUBLIC; do
      val="$(printf '%s\n' "$_dom_env" | sed -n "s/^${dkey}=//p" | head -1 | sed "s/^'//;s/'$//")"
      if [[ -z "$val" ]]; then
        # Zdrojování env souboru pod `set -e` MUSÍ být hlídané: neuvozená
        # víceslovná hodnota se rozpadne na slova a shodí celý skript
        # (brána env-file-source-guard). Podshell to neodstíní.
        val="$(set +e +u; set -a; . "$REPO_ROOT/config/domains.env" >/dev/null 2>&1; set +a; printf '%s' "${!dkey:-}")"
      fi
      val="$(printf '%s' "$val" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      if [[ -z "$val" ]]; then
        fail "domains: $dkey se nerozvinul na žádnou hodnotu — edge/web build dostane prázdný build arg a render-app-config skončí FATAL"
      elif [[ "$val" == *'${'* ]]; then
        fail "domains: $dkey zůstal NEROZVINUTÝ ($val) — šablona se někde předala jako text místo hodnoty"
      elif [[ "$val" == *"example"* || "$val" == *"placeholder"* ]]; then
        fail "domains: $dkey je zástupný symbol ($val). Příkladové TLD přišlo z deklarace instance (config/domains-<env>.env, .env-prod-backup, profil) — ze vzorového souboru ke config/domains.env cold-start od 2026-09-13 nic nedoplňuje; ověř i 'derive-domains.mjs --check --manifest=<cesta>'"
      else
        ok "domains: $dkey = $val"
      fi
    done
  else
    fail "config/domains.env missing — cold-start step 0 abortuje"
  fi
fi

# ============================================================================
# Phase B — Files
# ============================================================================
if should_run_phase B; then
  phase B "Required files"

  # Manifest se NEkontroluje jako cesta v repu: jeho domov určuje resolver
  # (--manifest → overlay instance → repo), protože inventář je instanční data
  # a od `43dcc148c`/`5c6435b21` nemá ve veřejném stromě co dělat. Kontrola
  # repo-relativní cesty tvrdila „chybí" i instanci, která ho korektně má
  # v overlayi — a zároveň by prošla instanci, která ho tam má špatně.
  # $MANIFEST je už resolvovaný (Phase 0), takže se ověřuje TO, co se použije.
  if [[ -f "$MANIFEST" ]]; then
    ok "manifest: ${MANIFEST#"$REPO_ROOT"/}"
  else
    fail "manifest MISSING: $MANIFEST"
  fi

  for f in \
    scripts/aisha-cold-start.sh \
    scripts/aisha-redeploy.mjs \
    scripts/coolify-story-init.sh \
    scripts/coolify-deploy-init.sh \
    scripts/coolify-sync-envs.sh \
    scripts/aisha-env-doctor.mjs \
    scripts/preflight-compose.sh \
    infra/postgres/set-passwords.sh \
    infra/postgres/entrypoint-wrapper.sh ; do
    if [[ -f "$REPO_ROOT/$f" ]]; then
      ok "$f"
    else
      fail "$f MISSING"
    fi
  done

  # Manifest exists, parse it
  manifest="$MANIFEST"
  if [[ -f "$manifest" ]]; then
    app_count=$(grep -cE '^app:' "$manifest" || true)
    # Kolik aplikací JE správně, je vlastnost TÉTO instance (profil: tier_filter
    # + exclude), ne konstanta platformy. Dřív tu stálo `-ge 13` — počet plného
    # aisha stacku — takže lean instance dostala „Manifest has only 9 apps
    # (expected 13)" i s manifestem, který přesně odpovídal jejímu nasazení
    # (naměřeno na lean profilu <fork> 2026-08-11: 9 aplikací, všech 9 živých v Coolify).
    # Signál, o který tu jde, je „manifest není prázdný ani uříznutý"; jestli
    # sedí na skutečnost, prokazuje kontrola referencí na compose soubory níž,
    # a ta je na rozdíl od počtu pravdivá pro každou instanci.
    if [[ "$app_count" -gt 0 ]]; then
      ok "Manifest has $app_count apps"
    else
      fail "Manifest has no apps — prázdný nebo uříznutý manifest"
    fi
  fi
fi

# ============================================================================
# Phase C — Env contract (aisha-env-doctor)
# ============================================================================
if should_run_phase C; then
  phase C "Env contract (.env.coolify completeness)"

  if [[ ! -f "$DOKTOR_ENV_SOUBOR" ]]; then
    warn ".env.coolify missing — cold-start ji vygeneruje v step 2 (preflight nemá co kontrolovat)"
  else
    if node "$REPO_ROOT/scripts/aisha-env-doctor.mjs" --report >/tmp/env-doctor-report 2>&1; then
      ok "Env contract complete (no missing keys)"
    else
      rc=$?
      missing=$(grep -cE "^(❌|MISSING|missing)" /tmp/env-doctor-report 2>/dev/null || echo "?")
      if [[ "$rc" -eq 1 ]]; then
        fail "Env contract: $missing required keys still missing (run: node scripts/aisha-env-doctor.mjs)"
      else
        warn "Env contract: env-doctor returned exit $rc"
      fi
    fi
  fi
fi

# ============================================================================
# Phase D — Compose interpolation
# ============================================================================
if should_run_phase D; then
  phase D "Compose interpolation (preflight-compose.sh)"

  if [[ ! -f "$DOKTOR_ENV_SOUBOR" ]]; then
    warn ".env.coolify missing — preflight-compose nemůže běžet bez něj (cold-start ji vygeneruje v step 2)"
  elif ! command -v docker >/dev/null 2>&1; then
    warn "docker CLI nedostupný — preflight-compose vyžaduje 'docker compose config'"
  else
    # ⛔ POČET SE ČTE BEZ BAREV A OVĚŘUJE PROTI TOMU, CO PREFLIGHT OHLÁSIL SÁM.
    # Do 2026-09-13 tu stálo `grep -cE "^   .*OK$"` nad obarveným výstupem: kotva
    # `OK$` netrefila ani jeden řádek (končí `ESC[0m`) a doktor hlásil „0 stacku"
    # nad během, kde prošlo 34 souborů. Pravidlo počítání má jeden domov
    # (lib/preflight-compose-pocet.awk) a nesoulad počtu s ohlášeným celkem je
    # NÁLEZ o měřidle, ne číslo, které se vytiskne.
    preflight_pocet_zprava() {  # $1 = soubor s výstupem preflightu; vydá text o počtu
      local _p _ok _fail _celkem
      _p="$(awk -f "$REPO_ROOT/scripts/lib/preflight-compose-pocet.awk" "$1" 2>/dev/null)"
      _ok="$(printf '%s' "$_p" | sed -n 's/.*ok=\([0-9]*\).*/\1/p')"
      _fail="$(printf '%s' "$_p" | sed -n 's/.*fail=\([0-9]*\).*/\1/p')"
      _celkem="$(printf '%s' "$_p" | sed -n 's/.*celkem=\([0-9]*\).*/\1/p')"
      if [[ -n "$_celkem" && "$_ok" == "$_celkem" && "$_fail" == "0" ]]; then
        printf '%s stacků OK' "$_ok"
      else
        printf 'počet NEZMĚŘEN — měřidlo napočítalo ok=%s fail=%s, preflight ohlásil celkem=%s (tvar výstupu preflight-compose se změnil?)' \
          "${_ok:-?}" "${_fail:-?}" "${_celkem:-nic}"
      fi
    }
    if bash "$REPO_ROOT/scripts/preflight-compose.sh" >/tmp/preflight-compose 2>&1; then
      _pc_zprava="$(preflight_pocet_zprava /tmp/preflight-compose)"
      case "$_pc_zprava" in
        *NEZMĚŘEN*) warn "Compose preflight prošel (kód 0), ale ${_pc_zprava}" ;;
        *)          ok "All compose files validated (${_pc_zprava})" ;;
      esac
    else
      _pc_stary_fail="$(awk -f "$REPO_ROOT/scripts/lib/preflight-compose-pocet.awk" /tmp/preflight-compose 2>/dev/null | sed -n 's/.*fail=\([0-9]*\).*/\1/p')"
      # Fail zůstává TVRDÝ — ale měří se proti ENVU, KTERÝ TENHLE BĚH VYROBÍ,
      # ne proti pozůstatku z minula.
      #
      # Doctor je Step 0, .env.coolify vzniká až ve Step 2. Preflight nad tím
      # starým souborem se mýlí obousměrně: nová povinná proměnná tam chybí
      # (faleš) a proměnná, kterou už nikdo nevyrábí, tam zůstane (mezera).
      # Naměřeno 2026-08-08: dvakrát zastavil nasazení a pokaždé ukázal jen
      # jednu mezeru z několika. Řešením není fail změkčit — to by mezery
      # pustilo dál — ale dát doctorovi pravdivé měřidlo: postavit env stejně
      # jako Step 2 (topologie + generate-secrets + env-doctor) do DOČASNÉHO
      # souboru a preflightovat proti němu. Produkční .env.coolify se nedotkne.
      _fresh_env="$(mktemp -t aisha-doctor-env.XXXXXX)"
      _fresh_ok=0
      if [[ -f "$DOKTOR_ENV_SOUBOR" ]]; then cp "$DOKTOR_ENV_SOUBOR" "$_fresh_env"; fi
      # ⛔ NAMĚŘENO 2026-09-20: komentář výš slibuje TŘI složky (topologie +
      # generate-secrets + env-doctor), ale kód spouštěl JEN env-doctor. Čerstvý
      # env proto nenesl nic, co vydává topologie ani generátor, a compose
      # preflight nad ním padal na proměnných, které v reálném běhu EXISTUJÍ:
      #   MESH_DNS_{NETWORK,SUBNET,RESOLVER_IP}      ← generate-secrets
      #   KEYCLOAK_{DOMAIN_PUBLIC,EXTRA_HOST_ALIAS}  ← derive-domains
      # Následek: TVRDÝ fail „cold-start by spadl ve Step 2b" u běhu, který by
      # prošel — naměřeno 28 z 34 stacků. Po doplnění obou složek 34/34.
      #
      # Nestačí je mít v PROSTŘEDÍ — ověřeno: doctor s 225 topologickými klíči
      # v env padal dál, protože preflight-compose jede `docker compose
      # --env-file` a čte ten SOUBOR. Musí se tedy připsat do něj.
      #
      # Proč to není kosmetika: doctor je Step 0 a jeho nenulový kód cold-start
      # ZASTAVÍ (`case "$DOCTOR_RC" … *) exit 1`). Falešný tvrdý fail tedy tlačí
      # operátora k `--skip-doctor`, tedy k vypnutí CELÉHO preflightu kvůli jeho
      # nepravdivé části. Falešný fail je horší než chybějící kontrola: učí lidi
      # kontrolu obcházet.
      #
      # Kdo koho přebíjí: u duplicitního klíče bere Compose POSLEDNÍ výskyt
      # (ověřeno minimálním případem), takže pořadí připsání = pořadí priority.
      # Zastaralý .env.coolify je první, topologie a generátor ho přepíšou —
      # přesně jako Step 2. Uvozené hodnoty (`KEY='v'`) Compose rozbaluje, takže
      # výstup generátoru jde připsat rovnou.
      #
      # `|| true` u obou: když složka selže, ať doktor doměří aspoň to, co umí,
      # místo aby spadl na chybě SVÉHO měřidla. Chybějící klíče se pak projeví
      # jako fail níž — pravdivě, jen méně přesně.
      if [[ -f "$REPO_ROOT/scripts/lib/derive-domains.mjs" ]]; then
        node "$REPO_ROOT/scripts/lib/derive-domains.mjs" --shell >>"$_fresh_env" 2>/dev/null || true
      fi
      if [[ -f "$REPO_ROOT/scripts/generate-secrets.mjs" ]]; then
        node "$REPO_ROOT/scripts/generate-secrets.mjs" \
          --env-coolify="$DOKTOR_ENV_SOUBOR" \
          --env-backup="${ENV_PROD_BACKUP:-}" \
          --preserve=1 \
          --netbird-mgmt-host="${NETBIRD_MGMT_HOST:-}" \
          --mesh-tld="${MESH_TLD:-}" \
          --nocodb-admin-email="${NOCODB_ADMIN_EMAIL:-${SMTP_ADMIN_EMAIL:-}}" \
          >>"$_fresh_env" 2>/dev/null || true
      fi
      if ENV_FILE="$_fresh_env" node "$REPO_ROOT/scripts/aisha-env-doctor.mjs" >/dev/null 2>&1; then _fresh_ok=1; fi
      if [[ "$_fresh_ok" == "1" ]] && ENV_FILE="$_fresh_env" bash "$REPO_ROOT/scripts/preflight-compose.sh" >/tmp/preflight-compose-fresh 2>&1; then
        _pc_zprava="$(preflight_pocet_zprava /tmp/preflight-compose-fresh)"
        case "$_pc_zprava" in
          *NEZMĚŘEN*) warn "Compose nad ČERSTVĚ sestaveným envem prošel (kód 0), ale ${_pc_zprava}" ;;
          *)          ok "Compose validuje proti ČERSTVĚ sestavenému envu (${_pc_zprava})" ;;
        esac
      else
        failed="$(awk -f "$REPO_ROOT/scripts/lib/preflight-compose-pocet.awk" /tmp/preflight-compose-fresh 2>/dev/null | sed -n 's/.*fail=\([0-9]*\).*/\1/p')"
        fail "Compose preflight selhal i nad čerstvým envem (${failed:-?} stacku) — cold-start by spadl ve Step 2b"
        bez_barev < /tmp/preflight-compose-fresh 2>/dev/null | grep -E "^   .*FAIL|required variable" | head -10 | sed "s/^/    /"
      fi
      rm -f "$_fresh_env"
      # Pozůstatek nad STARÝM .env.coolify: informace, ne verdikt (ten dal čerstvý env
      # výš). Bez hlavičky se tyhle řádky FAIL tiskly pod zelenou fajfku a četly se
      # jako rozpor. Docker varování (`level=warning`) se vynechávají — preflight
      # z každé chyby ukazuje jen tři řádky a varování je vytlačila (naměřeno
      # 2026-09-13: pod FAIL stály jen „The note variable is not set", příčina ne).
      info "nad STÁVAJÍCÍM .env.coolify selhalo ${_pc_stary_fail:-?} stacků (krok 2 ho přepíše; verdikt dal čerstvý env výš):"
      bez_barev < /tmp/preflight-compose 2>/dev/null | grep -E "^   .*FAIL|^      " | grep -v 'level=warning' | head -10 | sed 's/^/    /'
    fi
  fi
fi

# ============================================================================
# Phase E — Manifest ↔ compose consistency
# ============================================================================
if should_run_phase E; then
  phase E "Manifest ↔ compose consistency"

  # ⛔ MANIFEST ↔ TOPOLOGIE. Do 2026-09-05 tuhle osu neměřil NIKDO: fáze E níž
  # ověřuje, že compose soubory z manifestu EXISTUJÍ, ale ne že jim topologie umí
  # odvodit adresu. `derive-domains.mjs --check` přitom existoval — a nevolal ho
  # žádný skript kromě cold-startu; doktor ho jen zmiňoval v chybové hlášce.
  #
  # Naměřeno na produkci <fork>: manifest jmenoval 13 aplikací, topologie znala
  # 12. `coolify-story-init.sh` netbird ZALOŽIL, resolver mu odmítl dát adresu
  # (tier=optional bez `include`), a díru zaplnil fallback z domains.env.example:
  # `NETBIRD_DOMAIN=netbird.aisha.example.com`, `NETBIRD_API_URL=https://`.
  # Vlna 5 pak padla na pki-init a diagnóza ukazovala úplně jinam.
  #
  # Doktor je READ-ONLY preflight, tedy přesně místo, kde se to mělo chytit dřív,
  # než cold-start vůbec začne.
  if [[ -f "$MANIFEST" ]]; then
    _topo_out="$(AISHA_PROFILE="${AISHA_PROFILE:-}" node "$REPO_ROOT/scripts/lib/derive-domains.mjs" \
      --check --manifest="$MANIFEST" 2>&1 | grep -v '^\[derive-domains\] WARN' || true)"
    if printf '%s' "$_topo_out" | grep -q '^✓'; then
      ok "topologie: $(printf '%s' "$_topo_out" | sed 's/^✓ *//')"
    else
      fail "topologie ↔ manifest: $(printf '%s' "$_topo_out" | tr '\n' ' ' | cut -c1-400)"
    fi
  else
    fail "manifest '$MANIFEST' nenalezen — topologii proti čemu měřit není"
  fi

  manifest="$MANIFEST"
  if [[ -f "$manifest" ]]; then
    # 1. Every compose file referenced in manifest exists.
    # Format: `app: <name>:<host>:<compose>[:<tags>]`. Tags suffix (e.g.
    # `:bluegreen=on`) musí být oddělen — bash split na `:` jen do 4 polí.
    referenced=0
    missing=0
    while IFS=: read -r _ name _ compose tags; do
      [[ -z "$compose" ]] && continue
      compose=$(echo "$compose" | tr -d '[:space:]')
      referenced=$((referenced+1))
      if [[ -f "$REPO_ROOT/$compose" ]]; then
        :
      else
        fail "Manifest references missing file: $compose (app: $name)"
        missing=$((missing+1))
      fi
    done < <(grep -E '^app:' "$manifest")
    if [[ "$missing" -eq 0 ]]; then
      ok "All $referenced manifest compose refs exist"
    fi

    # 2. Every docker-compose.coolify-*.yml in repo is referenced (or explicitly skipped)
    orphans=()
    for f in "$REPO_ROOT"/docker-compose.coolify-*.yml "$REPO_ROOT"/docker-compose.coolify.yml; do
      [[ -f "$f" ]] || continue
      base=$(basename "$f")
      # Skip "shared" / "monitoring" / "livekit" / "playwright" (per-host
      # helpers + on-demand sidecars, not in manifest because they have no
      # canonical subdomain / public route — they're opt-in QA / monitoring
      # workers brought up via explicit `docker compose -f ... -f ... up -d`.)
      case "$base" in
        docker-compose.coolify-monitoring.yml|\
        docker-compose.coolify-livekit.yml|\
        docker-compose.coolify-playwright.yml) continue ;;
      esac
      # Sirotek = compose, který nereferencuje ŽÁDNÝ manifest — ne jen ten právě
      # kontrolovaný. Instalace s více story (fork nad platformou: aisha.manifest
      # + <fork>.manifest) má sibling stacky záměrně mimo hlavní manifest;
      # kontrola jen proti němu je hlásí napořád, doktor kvůli warningu vrací
      # exit 2 a brána cold-start-doctor (čeká exit 0) je pak trvale červená.
      if ! grep -qlF "$base" "$REPO_ROOT"/coolify/manifests/*.manifest >/dev/null 2>&1; then
        orphans+=("$base")
      fi
    done
    if [[ "${#orphans[@]}" -eq 0 ]]; then
      ok "No orphan compose files (every *.yml is referenced)"
    else
      warn "Compose files not referenced in manifest: ${orphans[*]}"
    fi
  fi

  # ── DEPLOY VĚTEV: ODCHYLKA MUSÍ NÉST DŮVOD ────────────────────────────────
  # Výklad i měření žijí v jednom domově (brána ho spouští nad dočasnými repy).
  # shellcheck source=lib/deploy-vetev-odchylka.sh
  . "$SCRIPT_DIR/lib/deploy-vetev-odchylka.sh"
  deploy_vetev_odchylka "$REPO_ROOT" "$MANIFEST"
fi

# ============================================================================
# Phase F — Coolify API connectivity
# ============================================================================
if should_run_phase F && [[ "$NO_NETWORK" -eq 0 ]]; then
  phase F "Coolify API connectivity"

  if [[ -z "${COOLIFY_URL:-}" ]]; then
    fail "COOLIFY_URL missing — cannot run Coolify API connectivity check"
    COOLIFY_URL=""
  fi
  # COOLIFY_API_KEY ↔ COOLIFY_API_TOKEN alias (.env-prod-backup používá TOKEN).
  api_token="${COOLIFY_API_KEY:-${COOLIFY_API_TOKEN:-}}"
  if [[ -z "$api_token" ]]; then
    warn "COOLIFY_API_KEY/TOKEN missing — skipping API check"
  elif [[ -z "$COOLIFY_URL" ]]; then
    :
  else
    rc=$(curl -sS -o /tmp/coolify-ping -w "%{http_code}" -m "$API_TIMEOUT" \
      -H "Authorization: Bearer $api_token" \
      "$COOLIFY_URL/api/v1/version" 2>/dev/null || true)
    case "$rc" in
      200|201) ok "Coolify API reachable: $COOLIFY_URL ($(cat /tmp/coolify-ping 2>/dev/null | head -c 60))" ;;
      401|403) fail "Coolify API auth fail ($rc) — token invalid?" ;;
      000)     fail "Coolify API unreachable: $COOLIFY_URL (DNS/network?)" ;;
      *)       warn "Coolify API returned HTTP $rc (unexpected)" ;;
    esac

    # Live server-slot discovery — the SAME path cold-start uses (Iter 19).
    # Read-only: generate-coolify-context.mjs only emits to stdout (we pass no
    # --env-coolify, so it never writes). This is the real "are my servers named
    # / reachable correctly" check that Phase A cannot do offline: it confirms
    # each ${SLOT}_HOSTNAME actually matches a Coolify server → non-empty UUID.
    if [[ "$rc" == "200" || "$rc" == "201" ]]; then
      # stderr se ZACHOVÁVÁ. Dřív šel do /dev/null a s ním jediná informace o
      # tom, PROČ discovery nic nevydala — hlášení pak mluvilo o příznaku
      # („produced no output") místo o příčině.
      _disc_err="$(mktemp -t aisha-doctor-disc.XXXXXX)"
      # COOLIFY_AUTO_CREATE_PROJECT=0: doktor je kontrola. Při nenalezeném jménu
      # by discovery jinak projekt v Coolify ZALOŽILA (POST /projects) — mutace
      # uvnitř „read-only“ kroku, i v dry-runu cold-startu (incident 2026-09-24).
      # Ne-produkční běh posílá pin svého projektu (PR2 izolace) — doktor měří tentýž
      # projekt, na který pak míří cold-start, ne ten, na který ukazuje jméno.
      _disc_pin=""
      pb_je_prod "${AISHA_ENV:-}" || _disc_pin="${COOLIFY_PROJECT_UUID:-}"
      disc=$(COOLIFY_BASE_URL="$COOLIFY_URL" COOLIFY_API_TOKEN="$api_token" COOLIFY_AUTO_CREATE_PROJECT=0 AISHA_PROJEKT_PIN="$_disc_pin" \
        node "$REPO_ROOT/scripts/generate-coolify-context.mjs" --preserve=0 2>"$_disc_err" || true)
      if [[ -n "$disc" ]]; then
        for slot in FRONTEND BACKEND EXPERIMENTAL; do
          uuid=$(printf '%s\n' "$disc" | sed -n "s/^COOLIFY_SERVER_UUID_${slot}='\([^']*\)'.*/\1/p" | head -1)
          hostvar="${slot}_HOSTNAME"
          if [[ -n "$uuid" ]]; then
            ok "Slot discovery: ${slot} (${!hostvar:-name-match}) → ${uuid:0:12}…"
          else
            fail "Slot discovery: ${slot} unresolved — ${hostvar}='${!hostvar:-}' matches no Coolify server name/ip → cold-start can't place ${slot} apps"
          fi
        done
      elif [[ -z "${APP_NAME_PREFIX:-}${AISHA_STORY:-}" ]]; then
        # FAIL, ne warn: tohle není riziko, ale tvrdá předpodmínka. Cold-start se
        # v té situaci VŮBEC nespustí (aisha-cold-start.sh: „Identita instance
        # NENÍ deklarovaná" → exit 2), takže „READY with warnings — cold-start
        # může projít" by bylo nepravdivé. Identita navíc zaměřuje rozsah --wipe:
        # tenhle Coolify hostuje víc nájemníků (naměřeno 2026-08-09: 164 aplikací,
        # prefixy jednotlivých instancí), a dosazená hodnota už jednou nasadila
        # produkci jiného zákazníka.
        fail "Identita instance NENÍ deklarovaná (chybí APP_NAME_PREFIX i AISHA_STORY) — cold-start se odmítne spustit, nejde o riziko. Zaměřuje i rozsah --wipe. Deklaruj ji v .env.local."
      else
        fail "Coolify slot discovery selhala — server UUIDs by při cold-startu zůstaly nerozřešené. Důvod: $(head -c 300 "$_disc_err" | tr '\n' ' ')"
      fi
      rm -f "$_disc_err"
    fi
  fi
fi

# ── Verdikt dveří z KÓDU lib/dvere-soulad.mjs, nikdy z textu výkladu ─────────
# ⛔ NAMĚŘENO 2026-09-26: FATAL „EDGE_DOOR_MODE=enforce bez deklarovaných dveří"
# se rozhodoval shodou řetězce `EDGE_DOOR_MODE=enforce` ve výpisu měření. Ten
# ale stojí i ve VYSVĚTLENÍ vady KNOCK_UPSTREAM („… s EDGE_DOOR_MODE=enforce by
# edge zamkl všechny") — instance s režimem `off` tak dostala dva falešné FATALy
# (fáze P i oddíl dveří). Výpis je výklad pro člověka a jeho věty se mění;
# o FATALu rozhoduje návratový kód, který nese strukturovaný příznak
# `zavrenyEdgeBezDveri` (KOD_ZAVRENY_EDGE v lib/dvere-soulad.mjs — TÁŽ hodnota;
# brána src/tests/gates/doktor-dvere-verdikt-z-kodu.gate.test.ts ji měří).
DVERE_KOD_ZAVRENY_EDGE=4
DVERE_FATAL_ZAVRENY_EDGE="EDGE_DOOR_MODE=enforce bez deklarovaných dveří — edge by se zavřel a verdikt by neměl kdo dát"

# Fáze P: výpis `dvere-soulad.mjs --coolify` → ok/warn/fail. Řádky se třídí
# podle DRUHU (prefix protokolu: ✓ / ✗ kolize / ✗ vada / ? NEMĚŘENO), FATAL
# zavřeného edge jen podle kódu.   dvere_na_aplikaci_verdikt <soubor výpisu> <kód>
dvere_na_aplikaci_verdikt() {
  local radek
  while IFS= read -r radek; do
    case "$radek" in
      "✓ "*) ok "${radek#✓ }" ;;
      "✗ kolize: "*) fail "Veřejný UDP port koliduje s cizím projektem: ${radek#✗ kolize: }" ;;
      "✗ vada: "*) warn "Dveře na aplikaci: ${radek#✗ vada: }" ;;
      "? NEMĚŘENO: "*) warn "Dveře/UDP ${radek}" ;;
    esac
  done < "$1"
  case "$2" in
    0|1|3) : ;;
    "$DVERE_KOD_ZAVRENY_EDGE") fail "Dveře na aplikaci: $DVERE_FATAL_ZAVRENY_EDGE" ;;
    *) warn "dveře na aplikaci NEMĚŘENO (kód $2): $(tr '\n' ' ' < "$1" | cut -c1-300)" ;;
  esac
}

# Oddíl dveří: výpis `dvere-soulad.mjs --soulad` → ok/warn/fail, FATAL jen z kódu.
#   dvere_soulad_verdikt <výpis> <kód> <jméno souboru>
dvere_soulad_verdikt() {
  case "$2" in
    0) ok "Dveře: $(printf '%s' "$1" | sed 's/^✓ dveře: //' | head -1)" ;;
    1|"$DVERE_KOD_ZAVRENY_EDGE")
      if [ "$2" = "$DVERE_KOD_ZAVRENY_EDGE" ]; then fail "Dveře: $DVERE_FATAL_ZAVRENY_EDGE"; fi
      warn "Dveře: deklarace a hodnoty v $3 nejsou v souladu:"
      printf '%s\n' "$1" | tail -n +2 | sed 's/^/      /'
      ;;
    *) warn "Dveře: soulad NEZMĚŘEN — $(printf '%s' "$1" | head -1)" ;;
  esac
}

# ============================================================================
# Phase P — Doručení povinných proměnných compose do aplikací
# ============================================================================
#
# ⛔ NAMĚŘENO 2026-09-13 po slití forků do upstreamu: `Deploy: Core` spadl na
# `${MESH_DNS_NETWORK:?}`. Hodnota v .env.coolify BYLA — do aplikace ji nikdo
# nedoručil. Přes flotilu 20 z 32 aplikací, 8 klíčů, všechno `${X:?}`.
#
# Fáze C a D se ptají na SOUBOR (je .env.coolify úplný, jde nad ním compose
# interpolovat?). Na to, co drží APLIKACE — tedy co compose při nasazení
# opravdu uvidí —, se neptal nikdo. Mezi nimi leží sync, a když neproběhne
# (upgrade nasazené instance, merge s novou povinnou proměnnou), soubor je
# v pořádku a nasazení přesto spadne.
#
# WARN, ne FAIL: cold-start sám sync provádí (krok 4) dřív, než nasazuje, takže
# mezeru, kterou .env.coolify umí zaplnit, zavře. Přesně proto ale doktor vypíše
# příkaz — CI nasazení po merge ani ruční redeploy jedné appky cold-start
# nespouští. Klíč, který ani v .env.coolify NENÍ, hlídají fáze C a D.
#
# Při plánovaném wipu se neměří: aplikace vzniknou znovu a dostanou env celý.
if should_run_phase P && [[ "$NO_NETWORK" -eq 0 ]]; then
  phase P "Doručení povinných proměnných compose do aplikací"

  _p_prefix="${APP_NAME_PREFIX:-${AISHA_STORY:-}}"
  _p_token="${COOLIFY_API_KEY:-${COOLIFY_API_TOKEN:-}}"
  if [[ "$WIPE_PLANNED" == "1" ]]; then
    info "wipe je plánovaný — aplikace vzniknou znovu a env dostanou celý; stav těch dnešních se neměří"
  elif [[ -z "${COOLIFY_URL:-}" || -z "$_p_token" || -z "$_p_prefix" ]]; then
    warn "doručení povinných proměnných NEMĚŘENO — chybí COOLIFY_URL, token nebo identita instance (viz fáze A/F)"
  else
    _p_out="$(mktemp -t aisha-doctor-povinne.XXXXXX)"
    _p_rc=0
    COOLIFY_URL="$COOLIFY_URL" COOLIFY_API_TOKEN="$_p_token" APP_NAME_PREFIX="$_p_prefix" \
      node "$REPO_ROOT/scripts/lib/povinne-promenne.mjs" --coolify --prefix "$_p_prefix" \
        --env-file "$DOKTOR_ENV_SOUBOR" >"$_p_out" 2>&1 || _p_rc=$?
    case "$_p_rc" in
      0) ok "$(grep -m1 '^✓' "$_p_out" | sed 's/^✓ *//')" ;;
      1) warn "aplikace nemají doručené povinné proměnné — jejich PŘÍŠTÍ nasazení (CI po merge, ruční redeploy) spadne:"
         grep -vE '^✓' "$_p_out" | sed 's/^/      /' ;;
      3) warn "doručení povinných změřeno jen zčásti — část aplikací změřit nešla:"
         grep -E '^(✓|\?)' "$_p_out" | sed 's/^/      /' ;;
      *) warn "doručení povinných proměnných NEMĚŘENO (kód $_p_rc): $(tr '\n' ' ' < "$_p_out" | cut -c1-300)" ;;
    esac
    # ── Dveře NA APLIKACI a veřejné UDP porty proti cizím projektům ──────────
    # ⛔ NAMĚŘENO 2026-09-15: Coolify drží profil i režim dveří z dřívějška —
    # soubor může být v souladu a aplikace přesto nasadí starý stav. A ruční
    # UDP port instance se může srazit s aplikací JINÉHO projektu na témž
    # serveru (livekit 2026-08-12: `driver failed programming external
    # connectivity`). Obojí se měří jen čtením API (lib/dvere-soulad.mjs).
    # Kolize je FAIL (nasazení na ní spadne a cizí port nevezmeme); rozpor dveří
    # WARN (sync ho srovná); co změřit nešlo, je NEZMĚŘENO, ne zelená.
    _p_rc=0
    _p_dvere_op=()
    [ -f "$PROD_BACKUP_FILE" ] && [ "$PROD_BACKUP_FILE" != "/dev/null" ] && _p_dvere_op=(--operator-file "$PROD_BACKUP_FILE")
    COOLIFY_URL="$COOLIFY_URL" COOLIFY_API_TOKEN="$_p_token" APP_NAME_PREFIX="$_p_prefix" \
      node "$REPO_ROOT/scripts/lib/dvere-soulad.mjs" --coolify --prefix "$_p_prefix" \
        --env-file "$DOKTOR_ENV_SOUBOR" ${_p_dvere_op[@]+"${_p_dvere_op[@]}"} >"$_p_out" 2>&1 || _p_rc=$?
    dvere_na_aplikaci_verdikt "$_p_out" "$_p_rc"
    rm -f "$_p_out"
    unset _p_out _p_rc _p_dvere_op
  fi
  unset _p_prefix _p_token
fi

# ============================================================================
# Phase G — Git host (origin) connectivity
# ============================================================================
if should_run_phase G && [[ "$NO_NETWORK" -eq 0 ]]; then
  phase G "Git host (origin) connectivity"

  # Adresa git hostingu se NEMUSÍ deklarovat — odvodí se z gitového původu tohohle stromu.
  #
  # PROČ (naměřeno 2026-08-13 na riqu): dokud se čekala deklarace, chyběla —
  # a kontrola se „přeskočila" s warningem. Jenže Coolify staví VŠECH 37 riq
  # aplikací právě z toho git hostingu: nedosažitelnost není volitelný detail, je to
  # důvod, proč by celý cold-start postavil starý strom nebo nic. Přeskočená
  # kontrola nad povinnou závislostí je mlčení, ne úspěch — a deklarace, kterou
  # nikdo nevyplní, je ozdoba.
  #
  # Původ je přitom po ruce: `git remote` ho drží vždycky, a je to TÁŽ adresa,
  # ze které staví Coolify. Přihlašovací údaje v URL se ořežou (nesmí do logu).
  _git_host_url="${GIT_BASE_URL:-}"
  _git_host_zdroj="deklarováno (GIT_BASE_URL)"
  if [[ -z "$_git_host_url" ]]; then
    _remote_url="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
    if [[ -n "$_remote_url" ]]; then
      # Parsování má jeden domov — lib/git-origin.mjs. Vlastní sed výraz tady by
      # byl druhá implementace téhož, a ta se rozejde (viz identita instance, #905).
      _git_host_url="$(node "$REPO_ROOT/scripts/lib/git-origin.mjs" "$_remote_url" 2>/dev/null || true)"
      _git_host_zdroj="odvozeno z git remote origin"
    fi
  fi

  if [[ -z "$_git_host_url" ]]; then
    fail "Adresu git hostingu nelze zjistit: GIT_BASE_URL není a strom nemá remote 'origin'. Coolify staví aplikace z gitu — bez původu není z čeho stavět."
  else
    rc=$(curl -sS -o /dev/null -w "%{http_code}" -m "$API_TIMEOUT" "$_git_host_url" 2>/dev/null || true)
    case "$rc" in
      200|301|302) ok "Git host reachable: $_git_host_url (HTTP $rc, $_git_host_zdroj)" ;;
      000) fail "Git host unreachable: $_git_host_url ($_git_host_zdroj)" ;;
      *)   warn "Git host returned HTTP $rc — $_git_host_url ($_git_host_zdroj)" ;;
    esac

    # Má repo všechno, co jeho CI čte (secrets./vars.)? Kontrakt a měření bydlí
    # v lib/ci-kontrakt.mjs; tady se jen volá. Jen JMÉNA, žádné hodnoty.
    # ⛔ Zápis (apply) sem NEPATŘÍ — mění trvalou konfiguraci repa, a to jen
    #    ručně s „ano“ majitele. Chybějící tajemství CI cold-start neblokuje,
    #    ale je to riziko prvního nasazení z CI → varování.
    _ci_repo="${CI_KONTRAKT_REPO:-}"
    _ci_zdroj="deklarováno (CI_KONTRAKT_REPO)"
    if [[ -z "$_ci_repo" ]]; then
      _ci_repo="$(node "$REPO_ROOT/scripts/lib/git-origin.mjs" --repo "$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null)" 2>/dev/null || true)"
      _ci_repo="${_ci_repo#*/}"
      _ci_zdroj="odvozeno z git remote origin"
    fi
    if [[ -z "$_ci_repo" || "$_ci_repo" != */* ]]; then
      warn "CI kontrakt NEMĚŘENO: repo nelze zjistit (CI_KONTRAKT_REPO ani origin)"
    else
      _ci_out="$(mktemp)"
      _ci_rc=0
      # API a token dědí ci-kontrakt z prostředí (GITHUB_API_URL / GITHUB_TOKEN).
      node "$REPO_ROOT/scripts/lib/ci-kontrakt.mjs" --repo "$_ci_repo" \
        --env-file "$DOKTOR_ENV_SOUBOR" >"$_ci_out" 2>&1 || _ci_rc=$?
      case "$_ci_rc" in
        0) ok "CI kontrakt: repo $_ci_repo má vše, co jeho CI čte ($_ci_zdroj)" ;;
        1) warn "CI kontrakt: repo $_ci_repo NEMÁ, co jeho CI čte ($_ci_zdroj) — detail níž; doplnit: node scripts/lib/ci-kontrakt.mjs --repo $_ci_repo --env-file .env.coolify --apply --potvrzuji $_ci_repo (jen s „ano“ majitele)" ;;
        3) warn "CI kontrakt: $_ci_repo bez nálezu, ale část nezměřena ($_ci_zdroj)" ;;
        *) warn "CI kontrakt NEMĚŘENO pro $_ci_repo ($_ci_zdroj) — viz důvod níž" ;;
      esac
      [[ "$_ci_rc" -eq 0 ]] || sed 's/^/      /' "$_ci_out"
      rm -f "$_ci_out"
    fi
  fi
fi

# ============================================================================
# Phase K — Keycloak: servíruje instance SVŮJ realm?
# ============================================================================
#
# ⛔ NAMĚŘENO 2026-09-13 na nasazené instanci: kontejner Keycloaku `healthy`, schéma
# `keycloak` bez jediné tabulky a veřejná tvář odpovídala 404 na všechno —
# `/realms/<realm>/.well-known/openid-configuration`, `…/protocol/openid-connect/certs`
# i `/realms/master/…`. Doktor o tom nevěděl nic: zdraví kontejneru na otázku
# „přihlásí se sem někdo?" neodpovídá. Bez realmu nevydá Keycloak token — a bez
# tokenu padá všechno za ním (OIDC aplikace, mesh discovery, pki issuer).
#
# URL se skládá stejně jako sonda realmu ve fázi B cold-startu
# (`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration`),
# jen ze STANOVIŠTĚ OPERÁTORA: veřejná tvář, tytéž dva klíče jako
# netbird-peer-discover.mjs (keycloakUrlProOperatora) — výslovné KEYCLOAK_PUBLIC_URL,
# jinak KEYCLOAK_DOMAIN_PUBLIC. Vnitřní KEYCLOAK_URL ne: odsud se nepřeloží.
# Samé deklarace, žádný literál ani další alias.
#
# Hodnoty se čtou LOKÁLNĚ přes config_env_key (lib/coolify-credentials.sh: prostředí
# → řetěz lib/config-env-files.mjs, týž jako pověření výš) a do prostředí doktoru
# se NEEXPORTUJÍ: `.env.coolify` je náš vlastní výstup
# z minulého běhu, a kdyby se odtud domény vlily do prostředí, fáze A by pak
# resolveru předkládala ozvěnu jako deklaraci.
#
# VAROVÁNÍ, ne FAIL. Realm vzniká importem při startu kontejneru Keycloaku
# (keycloak/render-realm-and-start.sh: `kc.sh import --override false` založí
# realm, který v databázi CHYBÍ, a jeho selhání start NESHODÍ — odtud `healthy`
# bez realmu). Cold-start Keycloak nasazuje i s --skip-create (bez --skip-healthy,
# aisha-cold-start.sh krok 5) a fáze B realm ověřuje, takže blokovat tady by
# znamenalo zavřít jedinou cestu, která realm vyrobí.
if should_run_phase K; then
  phase K "Keycloak — servíruje instance svůj realm?"
  # Sociální přihlášení bez SMTP (rozhodnutí majitele 2026-09-27: WARN, ne FATAL).
  # Tok prvního přihlášení nepropojuje existující účet automaticky podle e-mailu
  # (keycloak/reconcile-realm-clients.sh, blok tok-prvniho-prihlaseni) — vlastník ho
  # musí ověřit. E-mailová cesta potřebuje SMTP realmu a ten stack nenese, takže
  # zbývá ověření HESLEM; účet bez hesla čeká na schválení v administraci (krok B).
  _k_social=""
  for _k_v in OAUTH_GOOGLE_CLIENT_ID OAUTH_APPLE_CLIENT_ID; do
    if declare -F config_env_key >/dev/null; then
      _k_h="$(config_env_key "$_k_v" 2>/dev/null || true)"
    else
      _k_h="${!_k_v:-}"
    fi
    [[ -n "$_k_h" ]] && _k_social="${_k_social:+$_k_social, }${_k_v%_CLIENT_ID}"
  done
  if [[ -n "$_k_social" ]]; then
    warn "Keycloak: sociální přihlášení zapnuté (${_k_social}) a realm nemá SMTP — existující účet se s vnějším IdP propojí jen ověřením HESLEM"
    echo "      Automatické propojení podle e-mailu je vypnuté (převzal by ho správce e-mailové domény)."
    echo "      Účet bez hesla se poprvé nepropojí sám — schválení v administraci (krok B, docs/deploy/OAUTH_PROVIDERS.md)."
  fi
  unset _k_social _k_v _k_h
  if [[ "$NO_NETWORK" -eq 1 ]]; then
    info "--no-network: realm instance NEZMĚŘEN (to není totéž jako servírovaný)"
  else
    # config_env_key existuje, jen když se řetěz čte (viz načtení coolify-credentials.sh
    # výš); izolace testů (AISHA_PROD_BACKUP_FILE=/dev/null) ho vypíná a zbude prostředí.
    _k_deklarace() {
      if declare -F config_env_key >/dev/null; then
        config_env_key "$1" 2>/dev/null || true
      else
        printf '%s' "${!1:-}"
      fi
    }
    _k_realm="$(_k_deklarace KEYCLOAK_REALM)"
    _k_zdroj="KEYCLOAK_PUBLIC_URL"
    _k_url="$(_k_deklarace KEYCLOAK_PUBLIC_URL)"
    if [[ -z "$_k_url" ]]; then
      _k_zdroj="KEYCLOAK_DOMAIN_PUBLIC"
      _k_dom="$(_k_deklarace KEYCLOAK_DOMAIN_PUBLIC)"
      [[ -n "$_k_dom" ]] && _k_url="https://${_k_dom}"
    fi
    if [[ -z "$_k_realm" ]]; then
      warn "Keycloak: realm NEZMĚŘEN — KEYCLOAK_REALM není deklarovaná (prostředí ani konfigurační řetěz)"
    elif [[ -z "$_k_url" ]]; then
      warn "Keycloak: realm '${_k_realm}' NEZMĚŘEN — veřejná adresa Keycloaku není deklarovaná (KEYCLOAK_PUBLIC_URL / KEYCLOAK_DOMAIN_PUBLIC)"
    else
      _k_disc="${_k_url%/}/realms/${_k_realm}/.well-known/openid-configuration"
      rc=$(curl -sS -o /dev/null -w "%{http_code}" -m "$API_TIMEOUT" "$_k_disc" 2>/dev/null || true)
      case "$rc" in
        200)
          ok "Keycloak servíruje realm '${_k_realm}' (${_k_disc}; adresa z ${_k_zdroj})" ;;
        000|"")
          warn "Keycloak: realm '${_k_realm}' NEZMĚŘEN — ${_k_url} nedosažitelný (DNS/síť/TLS); adresa z ${_k_zdroj}" ;;
        *)
          warn "Keycloak NESERVÍRUJE realm '${_k_realm}' (HTTP ${rc} na ${_k_disc}) — OIDC přihlášení, mesh discovery ani pki issuer bez něj nedostanou token"
          echo "      Zdravý kontejner to NEVYLUČUJE: import realmu při startu (render-realm-and-start.sh,"
          echo "      kc.sh import --override false) založí jen realm, který v DB chybí, a jeho selhání start neshodí."
          echo "      Cold-start to NEBLOKUJE — Keycloak nasadí znovu (i s --skip-create) a fáze B realm ověří."
          echo "      Když po nasazení realm pořád chybí, hledej příčinu v DB Keycloaku (schéma bez tabulek = nezapisuje)"
          echo "      a v logu kontejneru řádky [render-realm]." ;;
      esac
    fi
    unset -f _k_deklarace
    unset _k_realm _k_url _k_dom _k_zdroj _k_disc
  fi
fi

# ============================================================================
# Phase H — Federation readiness (opt-in: only validates when SOURCE_API_URL set)
# ============================================================================
# The source-broker stack is opt-in. When SOURCE_API_URL is unset this phase is a
# clean PASS no-op (non-federated forks are unaffected). When federation IS
# configured it checks the wiring is coherent for BOTH local and prod, plus the
# security invariant that the dev /sync bypass is off. File/manifest/env checks
# are network-free; only broker liveness is gated on --no-network.
if should_run_phase H; then
  phase H "Federation readiness (source-broker)"

  if [[ -z "${SOURCE_API_URL:-}" ]]; then
    ok "Federation disabled (SOURCE_API_URL unset) — no-op for a non-federated fork"
  else
    if [[ -f "$REPO_ROOT/docker-compose.coolify-source-broker.yml" ]]; then
      ok "Broker compose present (docker-compose.coolify-source-broker.yml)"
    else
      fail "SOURCE_API_URL set but docker-compose.coolify-source-broker.yml is MISSING"
    fi
    if grep -qE '^app: *source-broker:' "$MANIFEST" 2>/dev/null; then
      ok "Broker registered in the manifest (source-broker app)"
    else
      fail "source-broker app not found in $MANIFEST"
    fi
    if [[ -n "${KC_ALLOWED_CLIENTS:-}" ]]; then
      ok "KC_ALLOWED_CLIENTS set ($KC_ALLOWED_CLIENTS) — gateway accepts the SPA client"
    else
      warn "KC_ALLOWED_CLIENTS unset — the gateway will 401 the SPA client's logins"
    fi
    if [[ "${BROKER_DEV_ALLOW_UNAUTHED_SYNC:-}" == "true" ]]; then
      warn "BROKER_DEV_ALLOW_UNAUTHED_SYNC=true — dev /sync bypass is ON (must be unset in prod)"
    fi
    if [[ "$NO_NETWORK" -eq 0 ]]; then
      bh="${BROKER_HEALTH_URL:-http://127.0.0.1:8090/healthz}"
      rc=$(curl -sS -o /dev/null -w "%{http_code}" -m "$API_TIMEOUT" "$bh" 2>/dev/null || true)
      case "$rc" in
        200) ok "Broker /healthz reachable ($bh)" ;;
        000) warn "Broker /healthz not reachable at $bh (broker not up yet?)" ;;
        *)   warn "Broker /healthz returned HTTP $rc" ;;
      esac
    fi
  fi
fi

# ============================================================================
# Phase I — Orchestration executor wiring (OpenClaw)
# ============================================================================
# OpenClaw is a tier:optional agent-mesh executor. Its svc-ai-chat adapter
# self-enables ONLY when OPENCLAW_URL + OPENCLAW_API_KEY resolve at runtime
# (adapters.ts isAvailable + selfRegister — DERIVED, never a seed flip). A
# preflight doctor has no DB, so it can't read ai_runtime_registry; instead it
# proves — STATICALLY, read-only — that the wiring chain PRODUCING those two
# values is coherent across all four SoTs (catalog→topology, generate-secrets→key,
# env-doctor→contract, compose→env+SSRF). An absent optional executor is INFO; a
# HALF-wired one (some SoTs agree, others don't) is a fail-loud the adapter would
# otherwise hide as a silent "openclaw disabled".
if should_run_phase I; then
  phase I "Orchestration executor wiring (OpenClaw)"

  CC="docker-compose.coolify-ai-chat.yml"
  if grep -q '"aisha-openclaw"' "$REPO_ROOT/config/services.json" 2>/dev/null; then
    ok "Catalog lists openclaw with an internal endpoint (topology emits OPENCLAW_URL)"

    # 1. key BIRTH — generate-secrets mints the shared bearer (svc-ai-chat ↔ svc-openclaw)
    if grep -qE "emit\('OPENCLAW_API_KEY'" "$REPO_ROOT/scripts/generate-secrets.mjs"; then
      ok "generate-secrets mints OPENCLAW_API_KEY (shared service bearer)"
    else
      fail "openclaw in catalog but generate-secrets does NOT mint OPENCLAW_API_KEY — adapter can't authenticate"
    fi

    # 2. CONTRACT — env-doctor declares both keys (so they're validated/healed)
    if grep -qE '"OPENCLAW_API_KEY"' "$REPO_ROOT/scripts/aisha-env-doctor.mjs" \
       && grep -qE '"OPENCLAW_URL"' "$REPO_ROOT/scripts/aisha-env-doctor.mjs"; then
      ok "env-doctor contracts OPENCLAW_API_KEY (secret) + OPENCLAW_URL (placeholder)"
    else
      fail "env-doctor missing OPENCLAW_API_KEY/OPENCLAW_URL contract — keys go unvalidated"
    fi

    # 3. COMPOSE — the ai-chat container receives the three vars + SSRF allows the host
    if grep -qE 'OPENCLAW_URL:' "$REPO_ROOT/$CC" && grep -qE 'OPENCLAW_API_KEY:' "$REPO_ROOT/$CC"; then
      ok "ai-chat compose wires OPENCLAW_URL + OPENCLAW_API_KEY + LANGGRAPH_ENABLE_OPENCLAW"
    else
      fail "ai-chat compose does NOT pass OPENCLAW_URL/OPENCLAW_API_KEY — the adapter sees empty config"
    fi
    # ⛔ NAMĚŘENO 2026-08-19: tady se hledalo `aisha-openclaw`, takže doktor
    # VYŽADOVAL adresu CIZÍ instance. Seznam se od té doby ODVOZUJE (složenina
    # v config/domains.env + derive-composites.sh, týž mechanismus jako CORS),
    # takže se měří DERIVACE: hostitel z OPENCLAW_URL musí být v seznamu.
    # Prázdný seznam je platný stav (openclaw nenasazen) — ssrf.ts je fail-closed.
    _openclaw_host="${OPENCLAW_URL#*://}"; _openclaw_host="${_openclaw_host%%:*}"
    if ! grep -qE 'SSRF_HOST_ALLOWLIST:[[:space:]]*\$\{[A-Za-z_][A-Za-z0-9_]*(:-)?\}' "$REPO_ROOT/$CC"; then
      fail "ai-chat compose si SSRF seznam PÍŠE — má ho jen odvodit ze složeniny (config/domains.env)"
    elif [ -z "$_openclaw_host" ]; then
      info "OPENCLAW_URL prázdná — openclaw není nasazen, prázdný SSRF seznam je správně"
    elif ! printf '%s' "${AI_CHAT_SSRF_ALLOWLIST:-}" | grep -qF "$_openclaw_host"; then
      fail "SSRF seznam neobsahuje $_openclaw_host (z OPENCLAW_URL) — derivace se nedopočítala, spusť redeploy"
    else
      ok "SSRF seznam odvozen z OPENCLAW_URL → $_openclaw_host"
    fi

    # 4. REACHABILITY — only when the stack is up AND the env carries the derived URL.
    #    Absent = INFO: OPENCLAW_URL is born at cold-start (sourced topology), so a
    #    preflight run legitimately has no URL and the executor isn't deployed yet.
    if [[ "$NO_NETWORK" -eq 0 && -n "${OPENCLAW_URL:-}" ]]; then
      rc=$(curl -sS -o /dev/null -w "%{http_code}" -m "$API_TIMEOUT" "${OPENCLAW_URL%/}/health" 2>/dev/null || true)
      case "$rc" in
        200) ok "OpenClaw /health reachable ($OPENCLAW_URL) — adapter will self-register is_enabled" ;;
        000) info "OpenClaw not reachable at $OPENCLAW_URL (not deployed yet — adapter stays disabled, no fail)" ;;
        *)   warn "OpenClaw /health returned HTTP $rc at $OPENCLAW_URL" ;;
      esac
    else
      info "OpenClaw reachability skipped (no-network or OPENCLAW_URL not in env — derived at cold-start)"
    fi
  else
    info "openclaw not in the service catalog — optional executor absent (no-op)"
  fi
fi

# ── Fáze J: identita ve vnitřních adresách ───────────────────────────────────
#
# ⛔ NAMĚŘENO 2026-08-21. Adresa, jejíž host je jméno kontejneru BEZ identity
# instance, je na sdíleném hostiteli adresa bez vlastníka: patří tomu, kdo na
# dané síti odpoví první. Nic přitom neselže — spojení se naváže a odpoví cizí
# služba. Vada bez příznaku, která se projeví o vrstvy dál.
#
# Sem patří proto, že cold-start je poslední místo, kde se to dá zastavit
# LEVNĚ: po něm už ta adresa žije v env všech aplikací.
#
# WARN, ne FAIL: sanace běží po vlnách (viz ZNAMY_DLUH v bráně
# `hostitel-nesmi-nest-jmeno-instance-natvrdo`) a zastavit kvůli známému dluhu
# nasazení, které s ním nic nedělá, by z doktora udělalo překážku místo měřidla.
if should_run_phase J; then
  phase J "Identita ve vnitřních adresách"

  if [[ -x "$REPO_ROOT/scripts/identita-adres-audit.mjs" ]] || [[ -f "$REPO_ROOT/scripts/identita-adres-audit.mjs" ]]; then
    _ia_out="$(cd "$REPO_ROOT" && node scripts/identita-adres-audit.mjs --json 2>/dev/null || true)"
    _ia_n="$(printf '%s' "$_ia_out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).nalezu))}catch{process.stdout.write("")}})' 2>/dev/null)"
    if [[ -z "$_ia_n" ]]; then
      warn "audit identity adres nevrátil výsledek — NEMĚŘENO (ne 'čisto')"
    elif [[ "$_ia_n" -eq 0 ]]; then
      ok "žádná vnitřní adresa nepostrádá identitu instance"
    else
      warn "$_ia_n vnitřních adres bez identity instance — 'npm run audit:identita-adres' vypíše které"
    fi
    unset _ia_out _ia_n
  else
    warn "scripts/identita-adres-audit.mjs chybí — tuhle třídu nikdo neměří"
  fi
fi


# `--phase` filtr platí i tady. Do 2026-08-11 fáze S a N stály MIMO dispatch,
# takže `--phase B,E` je pustil taky — filtr sliboval výběr, který nedělal.
if should_run_phase S; then
phase "S" "SURFACES (extranet / mobile — opt-in)"

# A surface is a standalone Dockerfile app, not a compose stack, so nothing in
# the service catalog covers it. Two things have to line up or the deployed app
# is unusable in a way that looks like a backend fault:
#
#   1. the profile must DECLARE it (otherwise a cold start silently produces a
#      stack with no extranet — measured 2026-07-28), and
#   2. its browser origin must reach ALLOWED_ORIGINS (otherwise the app signs in
#      and every API call dies at the CORS preflight with
#      `Origin … not in CORS allowlist` — the same day, same instance).
#
# Both are derived from the one declaration by derive-domains.mjs, so this check
# reads what the resolver emits rather than re-deriving anything itself.
#
# ⛔ NAMĚŘENO 2026-09-13: tady stálo `--shell 2>/dev/null || true`. Derivace
# ale PADÁ právě na vadách povrchu — overlay instance nemá
# `surfaces/<jméno>/app.config.json`, nebo se jeho issuer / client_id / adresa
# API rozchází s derivací. Spolknutý pád dal prázdný výstup a ten se četl jako
# „profile declares no surfaces" — doktor tedy nejhorší vadu povrchu ohlásil
# jako `ℹ nic k provisioningu`. Pád derivace je nález, ne prázdná topologie.
#
# Realm derivace nevydává (je to deklarace instance), a bez něj overlay issuer
# změří jen napůl. Bere se tam, odkud ho dostane stack: z prostředí, jinak
# rozvinutím config/domains.env (týž idiom jako fáze B výš).
_surf_realm="${KEYCLOAK_REALM:-$(set +e +u; set -a; . "$REPO_ROOT/config/domains.env" >/dev/null 2>&1; set +a; printf '%s' "${KEYCLOAK_REALM:-}")}"
_surf_err="$(mktemp -t doctor-surf.XXXXXX)"
_surf_rc=0
_surf_env="$(AISHA_PROFILE="${AISHA_PROFILE:-}" KEYCLOAK_REALM="$_surf_realm" node scripts/lib/derive-domains.mjs --shell 2>"$_surf_err")" || _surf_rc=$?
# Resolver hodnoty uvozuje (výstup se jinde sourcuje a strukturované hodnoty
# nesou `|`/`;`) — tady čteme hodnotu, tak okrajové uvozovky odstraníme.
_surfaces="$(printf '%s\n' "$_surf_env" | sed -n "s/^AISHA_SURFACES=//p" | sed "s/^'//;s/'$//")"
_origins="$(printf '%s\n' "$_surf_env" | sed -n "s/^SURFACE_ORIGINS=//p" | sed "s/^'//;s/'$//")"
while IFS= read -r _surf_w; do
  [[ -n "$_surf_w" ]] && warn "surfaces: ${_surf_w#\[derive-domains\] WARN }"
done < <(grep 'WARN overlay povrchu' "$_surf_err" 2>/dev/null)

if [[ "$_surf_rc" -ne 0 ]]; then
  fail "surfaces: derivace topologie SPADLA (rc=$_surf_rc) — povrch NEZMĚŘEN, ne 'bez povrchů': $(grep -v '^\[derive-domains\] WARN' "$_surf_err" | grep -vE '^[[:space:]]+at |^Node\.js|^file:|^[[:space:]]*(throw|\^)' | tr '\n' ' ' | cut -c1-900)"
elif [[ -z "$_surfaces" ]]; then
  info "profile declares no surfaces — nothing to provision (upstream / surface-less instance)"
else
  ok "profile declares surfaces: $_surfaces"

  # Every declared surface must contribute an origin. A triple that parses but
  # yields no origin means the declaration is malformed (missing subdomain), and
  # the failure would only show up as a CORS rejection after deploy.
  _n_surf=$(printf '%s' "$_surfaces" | tr ',' '\n' | grep -c .)
  _n_orig=$(printf '%s' "$_origins" | tr ',' '\n' | grep -c . || true)
  if [[ "$_n_orig" -ne "$_n_surf" ]]; then
    fail "surfaces: $_n_surf declared but $_n_orig origin(s) derived — a triple is missing its subdomain"
  else
    ok "surfaces: $_n_orig origin(s) derived ($_origins)"
  fi

  # The composed allowlist must actually contain them. This is the check that
  # would have caught the 2026-07-28 outage before it reached a browser.
  # The resolver's output has to be in scope BEFORE domains.env is sourced —
  # ALLOWED_ORIGINS interpolates ${SURFACE_ORIGINS}, so sourcing the file alone
  # composes the list without them and reports a false failure. (It did, first run.)
  # set +e / +u around the source: an env file with a multi-word unquoted value
  # word-splits and aborts the whole script under `set -e`, and the failure
  # happens INSIDE the source builtin, where `|| true` never gets evaluated.
  # (env-file-source-guard.gate pins this; it caught this very line.)
  _allowed="$(
    set +e
    set +u
    set -a
    eval "$_surf_env" >/dev/null 2>&1
    . config/domains.env >/dev/null 2>&1
    set +a
    printf '%s' "${ALLOWED_ORIGINS:-}"
  )"
  _missing=""
  for o in ${_origins//,/ }; do
    case ",$_allowed," in *",$o,"*) ;; *) _missing="$_missing $o" ;; esac
  done
  if [[ -n "$_missing" ]]; then
    fail "surface origin(s) NOT in ALLOWED_ORIGINS:$_missing — the app would be blocked at the CORS preflight"
  else
    ok "every surface origin is in ALLOWED_ORIGINS"
  fi

  # The provisioner must be reachable from the flow. It existed and was called
  # by nothing for as long as the surfaces did.
  if grep -q 'provision-surfaces.sh' scripts/aisha-cold-start.sh; then
    ok "cold-start calls provision-surfaces.sh"
  else
    fail "scripts/provision-surfaces.sh is not called from aisha-cold-start.sh — surfaces would never be created"
  fi
fi
rm -f "$_surf_err"

# ============================================================================
# Summary
fi  # should_run_phase S

# ============================================================================
# Phase: EXPOZICE TAJEMSTVÍ V BUILDU
# ============================================================================
# ⛔ NAMĚŘENO 2026-08-15 živě přes Coolify API napříč všemi buildícími
# aplikacemi: do buildu šlo 983 hodnot, které tam nikdo nepotřebuje, z toho
# 229 tajemství (139 různých) — COOLIFY_API_KEY, ANTHROPIC_API_KEY (5×), hesla
# Appsmithu, Grafany, ClickHouse. Build arg se zapisuje do metadat obrazu;
# `docker history` ho vydá komukoli, kdo na obraz dosáhne, a napořád.
#
# PROČ SE TO STALO NEVIDITELNÝM: nikdo se na to neptal. Hodnota se doručí,
# deploy je zelený, obraz běží — a že s sebou nese o 40 tajemství víc, se
# nikde neobjeví. Proto ta kontrola patří sem: cold-start je jediné místo,
# které vidí VŠECHNY aplikace téhle instance najednou.
#
# WARN, ne FAIL: cold-start tím neblokujeme (běžící stack je takhle dnes celý),
# ale operátor to musí VIDĚT. Číslo se dá sledovat mezi běhy — a to je rozdíl
# mezi dluhem, o kterém se ví, a dluhem, který se tiše nese dál.
if should_run_phase X; then
phase "X" "Expozice tajemství v buildu (build-time env)"

# ── ČÁST 1: stačí zúžená množina na parsování? (orákulum, bez sítě) ─────────
# Zúžení build-time množiny je bezpečnostní opatření, ale má DRUHOU stranu:
# vypadne-li z ní klíč, který compose při parsování opravdu potřebuje, nasazení
# umře na "required variable X is missing a value". Rozhodne o tom PARSER, ne
# úsudek — proto se tu spouští orákulum, které compose zkusí rozparsovat
# s prostředím obsahujícím právě jen odvozené klíče.
#
# Běží i s --no-network: nepotřebuje Coolify, jen docker CLI (bez démona).
_orakulum="$SCRIPT_DIR/compose-buildtime-oracle.sh"
if [[ ! -x "$_orakulum" && ! -f "$_orakulum" ]]; then
  warn "orákulum $_orakulum chybí — dostatečnost build-time množiny NEZMĚŘENA"
else
  _ovystup=$(bash "$_orakulum" 2>&1); _orc=$?
  _osouhrn=$(printf '%s\n' "$_ovystup" | grep '^orákulum:' | tail -1)
  if [[ "$_orc" -eq 2 ]]; then
    warn "orákulum se nespustilo (chybí docker CLI) — dostatečnost build-time množiny NEZMĚŘENA"
  elif [[ "$_orc" -eq 0 ]]; then
    ok "odvozená build-time množina stačí na parsování compose — ${_osouhrn#orákulum: }"
  else
    fail "odvozená build-time množina NESTAČÍ na parsování — ${_osouhrn#orákulum: }"
    printf '%s\n' "$_ovystup" | grep -E '^✗|^    ' | head -12 | sed 's/^/      /' >&2
    echo "      Takhle by nasazení umřelo na 'required variable X is missing a value'." >&2
  fi
fi

# ── ČÁST 1a: nese vnitřní adresa identitu instance? ─────────────────────────
# ⛔ NAMĚŘENO 2026-08-16 živě (varra, síť `coolify`): 2× `db`, 2× `redis`,
# 2× `web`, 3× `n8n-redis` od RŮZNÝCH nájemníků. Coolify tam každé službě přidá
# jako alias její klíč v compose a ten identitu nenese; DNS mezi stejnojmennými
# round-robinuje. Odkaz na holé `db:5432` proto může skončit u cizí databáze.
#
# Přidat alias nestačí — holý klíč tam Docker dá vždycky. Měří se tedy PÁR:
# žádný holý odkaz A žádné prefixované jméno bez deklarovaného aliasu. Druhá
# půlka je nutná: bez ní by šlo první „splnit" odkazem do prázdna.
#
# Běží i s --no-network: potřebuje jen docker CLI a jq, ne démona ani Coolify.
_orakulum_jmen="$SCRIPT_DIR/compose-alias-oracle.sh"
if [[ ! -f "$_orakulum_jmen" ]]; then
  warn "orákulum jmen $_orakulum_jmen chybí — identita vnitřních adres NEZMĚŘENA"
else
  _jvystup=$(bash "$_orakulum_jmen" 2>&1); _jrc=$?
  if [[ "$_jrc" -eq 2 ]]; then
    warn "orákulum jmen se nespustilo (chybí docker CLI nebo jq) — identita vnitřních adres NEZMĚŘENA"
  elif [[ "$_jrc" -eq 0 ]]; then
    ok "vnitřní adresy nesou identitu instance (žádný holý odkaz, žádný odkaz bez aliasu)"
  else
    fail "vnitřní adresa nenese identitu instance — na sdílené síti ji nárokuje i cizí nájemník"
    printf '%s\n' "$_jvystup" | grep -E '^✗|^    ' | head -14 | sed 's/^/      /' >&2
    # ⛔ NAMĚŘENO 2026-08-26: `head -14` z výstupu udělá zprávu, ze které se
    # nález nedá vyšetřit — a orákulum se přitom samostatně nechovalo stejně
    # jako pod doktorem. Rozdíl nešel dohledat, protože zbytek výstupu nikde
    # nezůstal. Celý výstup se proto ODKLÁDÁ a cesta se vypíše; useknutá
    # diagnostika je vada sama o sobě.
    # `mktemp` si dočasný adresář určí sám (a TMPDIR ctí) — dosazený literál
    # `/tmp` by HÁDAL fakt o světě, což brána zadny-fallback-nad-identitou
    # správně odmítá.
    _jsoubor="$(mktemp)"
    printf '%s\n' "$_jvystup" > "$_jsoubor" 2>/dev/null || true
    echo "      Celý výstup orákula: $_jsoubor" >&2
  fi
fi

# ── ČÁST 1b: CO S TÍM — plán nápravy, ne jen číslo ──────────────────────────
# Změřit expozici nestačí. Číslo bez dalšího kroku je výčitka, ne diagnóza —
# a operátor z něj nepozná, co je připravené k převodu a co potřebuje napřed
# pojistku u spotřeby. Pořadí (read-back → pojistka → passthrough) je závazné:
# obrátit ho znamená účet bez použitelného hesla.
_plan="$SCRIPT_DIR/buildtime-remediation-plan.mjs"
if [[ -f "$_plan" ]]; then
  _pj=$(node "$_plan" --json 2>/dev/null)
  if [[ -n "$_pj" ]] && echo "$_pj" | jq -e '.souhrn' >/dev/null 2>&1; then
    _pc=$(echo "$_pj" | jq -r '.souhrn.celkem')
    _pp=$(echo "$_pj" | jq -r '.souhrn.pripraveno')
    _pg=$(echo "$_pj" | jq -r '.souhrn.chybiPojistka')
    _pf=$(echo "$_pj" | jq -r '.souhrn.ciziSpotrebitel')
    if [[ "$_pc" -eq 0 ]]; then
      ok "žádné tajemství si build-time nevynucuje přes \${VAR:?}"
    else
      info "compose si build-time vynucuje u ${_pc} tajemství — plán: ${_pp} připraveno, ${_pg} chybí pojistka, ${_pf} cizí spotřebitel"
      if [[ "$_pg" -gt 0 ]]; then
        warn "${_pg} tajemství čte NÁŠ startovací skript, ale bez pojistky na prázdno"
        echo "      Nejdřív pojistka u spotřeby, TEPRVE PAK passthrough — opačně vznikne" >&2
        echo "      účet bez použitelného hesla a rohatka to bude hlásit jako zlepšení." >&2
      fi
      echo "      Celý plán:  node scripts/buildtime-remediation-plan.mjs" >&2
      echo "      Vzor pojistky: docker-compose.coolify-shared-redis.yml (entrypoint)" >&2
    fi
  else
    warn "plán nápravy se nepodařilo spočítat — zbývající dluh NEZMĚŘEN"
  fi
fi

# ── ČÁST 2: co Coolify do buildu opravdu posílá (potřebuje síť) ─────────────
if [[ "$NO_NETWORK" -eq 1 ]]; then
  info "--no-network: živá expozice v Coolify NEZMĚŘENA (to není totéž jako nulová)"
elif [[ -z "${COOLIFY_URL:-}" || -z "${COOLIFY_API_TOKEN:-}${COOLIFY_API_KEY:-}" ]]; then
  info "Coolify API není nakonfigurované — expozice NEZMĚŘENA (to není totéž jako nulová)"
else
  # shellcheck source=lib/coolify-buildtime-envs.sh
  . "$SCRIPT_DIR/lib/coolify-buildtime-envs.sh"
  _ct="${COOLIFY_API_TOKEN:-$COOLIFY_API_KEY}"
  _api="${COOLIFY_URL%/}/api/v1"
  # ⛔ NAMĚŘENO 2026-08-16: doktor si aplikace vybíral podle `name` s prefixem
  # `aisha` a napočítal 33; sync, který se ptá podle PROJEKTU, jich obsloužil 32.
  # Ten rozdíl nebyl chybou syncu — byla to CIZÍ aplikace `aisha-registry`
  # z projektu `a1sh4`. Doktor tedy (a) přičítal cizí expozici k naší a hlásil ji
  # jako náš nejhorší případ, který se nedaří opravit, a (b) četl env metadata
  # cizího nájemníka. Prefix jména si na sdíleném Coolify může zvolit kdokoli;
  # identita je PROJEKT. Odpověď na „které aplikace jsou naše" má proto JEDEN
  # domov, který sdílíme se syncem.
  # shellcheck source=lib/coolify-our-apps.sh
  . "$SCRIPT_DIR/lib/coolify-our-apps.sh"
  _apps=$(coolify_our_applications "$_api" "$_ct") || _apps=""
  if [[ -z "$_apps" ]] || ! echo "$_apps" | jq -e 'type == "array"' >/dev/null 2>&1; then
    warn "seznam NAŠICH aplikací se nepodařilo zjistit — expozice NEZMĚŘENA (to není nula)"
    _apps=""
  else
    # Duplicitní jméno UVNITŘ našeho projektu je skutečná vada: dvě naše
    # aplikace téhož jména se perou o tytéž aliasy a jména kontejnerů na
    # sdíleném hostiteli, a nástroje, které je adresují jménem, sáhnou na jednu.
    _dupl=$(coolify_duplicate_app_names "$_apps")
    if [[ -n "$_dupl" ]]; then
      while IFS=$'\t' read -r _dn _duuids; do
        [[ -z "$_dn" ]] && continue
        if [[ "$WIPE_PLANNED" == "1" ]]; then
          # `--wipe` smaže VŠECHNY aplikace projektu a manifest založí právě
          # jednu. Duplicita je tedy popis výchozího stavu, ne překážka běhu —
          # blokovat kvůli ní znamená bránit operaci, která ji odstraní.
          info "[$_dn] dvě aplikace téhož jména (${_duuids}) — wipe je smaže obě, manifest založí jednu"
        else
          fail "[$_dn] DVĚ NAŠE aplikace téhož jména (${_duuids}) — perou se o aliasy i jména kontejnerů"
        fi
      done <<< "$_dupl"
      if [[ "$WIPE_PLANNED" != "1" ]]; then
        echo "      Náprava: spustit cold-start s --wipe (smaže obě, manifest založí jednu)," >&2
        echo "      nebo zrušit zbytnou aplikaci v Coolify ručně." >&2
      fi
    fi

    # ── Předpověď: dokáže krok 4 vůbec nastavit domény? ───────────────────────
    #
    # ⛔ NAMĚŘENO 2026-08-17: krok 4 nastavil 0 domén ze 16 a cold-start běžel
    # dál. Coolify odmítá `docker_compose_domains`, dokud aplikace nemá
    # `docker_compose_raw` (update_by_uuid → 422 „Cannot set
    # docker_compose_domains without docker_compose_raw"). Raw plní ASYNCHRONNÍ
    # úloha `LoadComposeFile`, dispatchovaná při create — a tu frontu ucpe
    # cold-start sám: aplikace vznikly 06:21–06:58, raw dorazil 07:46–07:48.
    # Výsledkem byla instance bez jediné Traefik routy, poznaná až podle 404.
    #
    # Tahle otázka se dá zodpovědět PŘED během, ne až z jeho následků.
    #
    # Proč WARN a ne FAIL: nápravou prázdného raw je právě jedno nasazení
    # (deploy raw doplní). Zablokovat běh by tedy zablokovalo jedinou cestu ven
    # — fail-closed na podmínku, kterou splní teprve ta operace, které bráníme.
    # Po `--wipe` je otázka bezpředmětná: aplikace vzniknou znovu a create jim
    # raw pošle rovnou.
    if [[ "$WIPE_PLANNED" != "1" ]]; then
      # Táž otázka jako bariéra v coolify-deploy-init.sh — jeden domov.
      _bez_raw=$(coolify_apps_without_compose_raw "$_apps" | tr '\n' ' ')
      if [[ -n "$_bez_raw" ]]; then
        _bez_raw_n=$(printf '%s' "$_bez_raw" | wc -w | tr -d ' ')
        warn "${_bez_raw_n} aplikací nemá načtený compose → krok 4 jim domény nastavit NEDOKÁŽE (zůstanou bez Traefik routy)"
        echo "      ${_bez_raw}" >&2
        echo "      Coolify ho plní asynchronní úlohou LoadComposeFile (dispatch při create)" >&2
        echo "      a při nasazení. Náprava: nechat je jednou nasadit a cold-start spustit znovu." >&2
      else
        ok "všechny naše aplikace mají načtený compose — krok 4 může domény nastavit"
      fi
    fi

    _zbytecnych=0; _tajnych=0; _mereno=0; _nejhorsi=""; _nejhorsi_n=0
    while IFS=$'\t' read -r _nm _uu _cl; do
      [[ -z "$_nm" || -z "$_cl" ]] && continue
      _cp="${PWD}/${_cl#/}"
      [[ -f "$_cp" ]] || continue
      _ev=$(curl -sS --http1.1 --max-time 60 -H "Authorization: Bearer ${_ct}" \
        -H "Accept: application/json" "${_api}/applications/${_uu}/envs" 2>/dev/null | tr -d '\000-\037')
      echo "$_ev" | jq -e 'type == "array"' >/dev/null 2>&1 || continue
      # NEJDŘÍV to nejzávažnější: klíč doručovaný jako BuildKit secret, který je
      # PŘESTO build-time. To znamená, že bezpečnostní oprava (#920) je bez
      # účinku — Dockerfile ho bere přes `--mount=type=secret`, ale Coolify ho
      # zároveň pošle jako `--build-arg` a zapeče do `docker history`.
      _bs=$(coolify_buildkit_secret_keys "$_cp")
      if [[ -n "$_bs" ]]; then
        _bsj=$(printf '%s\n' "$_bs" | jq -R -s 'split("\n") | map(select(length > 0))')
        # `unique`: Coolify drží na klíč DVA řádky (production + preview),
        # bez toho by se každé jméno vypsalo dvakrát a počty byly dvojnásobné.
        _zapecene=$(echo "$_ev" | jq -r --argjson bs "$_bsj" '
          [ .[] | select((.is_preview // false) == false)
                | select((.is_buildtime // false) == true)
                | select(.key | IN($bs[])) | .key ] | unique | join(", ")')
        if [[ -n "$_zapecene" ]]; then
          fail "[$_nm] BuildKit secret je PŘESTO build-time: ${_zapecene} — zapéká se do docker history"
          echo "      Dockerfile ho bere přes --mount=type=secret, ale Coolify ho zároveň" >&2
          echo "      posílá jako --build-arg. Bezpečnostní oprava je tím bez účinku." >&2
        fi
      fi

      _der=$(coolify_parse_required_keys "$_cp" "$_ev") || continue
      [[ -z "$_der" ]] && continue
      _mereno=$((_mereno+1))
      # ⛔ ZÁKLAD MUSÍ POKRÝT VŠECHNY BUILD-TIME SPOTŘEBITELE, ne jen compose.
      # Naměřeno 2026-08-21: doktor hlásil „105 hodnot navíc", ale porovnával
      # proti tomu, co potřebuje POUZE parsování compose. Dockerfile `ARG`
      # (a `.npmrc`, viz níž) jsou jiní spotřebitelé téhož build-time kanálu —
      # a padaly do „přebytku", přestože tam patří. Měřidlo tím obviňovalo
      # správně nastavenou konfiguraci.
      #
      # `.npmrc` v kořeni (`COPY . .` ho doveze do každého buildu) tenhle základ
      # POŘÁD NEVIDÍ — proto ho pokrývá regex a proto zbytek NENÍ nutně chyba.
      # Hlášku držíme jako INFO o rozdílu, ne jako obvinění.
      _dfa=$(coolify_dockerfile_arg_keys "$_cp" 2>/dev/null || true)
      _pr=$(printf '%s\n%s\n' "$_der" "$_dfa" | jq -R -s 'split("\n") | map(select(length > 0)) | unique')
      # Zbytečné = build-time, ale compose je při parsování nepotřebuje.
      _nadbytek=$(echo "$_ev" | jq -r --argjson pr "$_pr" '
        [ .[] | select((.is_preview // false) == false)
              | select((.is_buildtime // false) == true)
              | select((.key | IN($pr[])) | not) | .key ] | unique | length')
      _taj=$(echo "$_ev" | jq -r --argjson pr "$_pr" '
        [ .[] | select((.is_preview // false) == false)
              | select((.is_buildtime // false) == true)
              | select((.key | IN($pr[])) | not)
              | select(.key | test("TOKEN|SECRET|PASSWORD|APIKEY|API_KEY|_KEY$|_KEY_|PRIVATE|CREDENTIAL|SALT"; "i"))
              | select(.key | test("^VITE_|ANON_KEY|PUBLISHABLE|PUBLIC_KEY|_KEY_ID$"; "i") | not) | .key ] | unique | length')
      _zbytecnych=$((_zbytecnych + _nadbytek)); _tajnych=$((_tajnych + _taj))
      if (( _taj > _nejhorsi_n )); then _nejhorsi_n=$_taj; _nejhorsi="$_nm"; fi
    done < <(echo "$_apps" | jq -r '
      .[] | [.name, .uuid, (.docker_compose_location // "")] | @tsv')

    if (( _mereno == 0 )); then
      warn "žádnou aplikaci se nepodařilo změřit — expozice NEZMĚŘENA, ne nulová"
    elif (( _zbytecnych == 0 )); then
      ok "build dostává jen to, co compose při parsování potřebuje (${_mereno} aplikací)"
    else
      warn "do buildu jde ${_zbytecnych} hodnot navíc, z toho ${_tajnych} tajemství (${_mereno} aplikací)"
      echo "      Build arg se zapisuje do metadat obrazu — 'docker history' ho vydá napořád." >&2
      [[ -n "$_nejhorsi" ]] && echo "      Nejvíc: ${_nejhorsi} (${_nejhorsi_n} tajemství)." >&2
      echo "      Zbytek nese forma 'environment: X=\${SECRET}', která hodnotu protlačí" >&2
      echo "      build-time cestou; passthrough 'environment: - SECRET' ji tam nepustí." >&2
    fi
  fi
fi
fi  # should_run_phase X

# ============================================================================
# Phase: SÍŤOVÝ KONTRAKT — jména a odvozená URL
# ============================================================================
# Proč tady: cold-start je jediné místo, kde se instance skládá celá, takže je
# to jediné místo, kde má smysl ptát se, jestli si její JMÉNA sedí. Doteď to
# byly samostatné skripty, které nikdo nevolal — a nezavolaná kontrola je totéž
# jako žádná.
#
# Všechny tři čtou katalog + compose + TLD té instance, takže neobsahují jméno
# žádné konkrétní instalace a fungují na forku stejně jako tady.
#
# WARN, ne FAIL: tohle jsou dluhy, ne překážky startu. Cold-start s nimi projde
# (dnes stack běží), ale operátor je musí VIDĚT — jinak se tiše přenesou dál.
if should_run_phase N; then
phase "N" "Síťový kontrakt (jména, odvozená URL, dosah)"

# ── Warmup: kdo zakládá hostitelské sítě instance ───────────────────────────
#
# Sítě instance jsou ve všech compose `external: true`, tedy SLIB, že už na
# hostiteli existují. Slib potřebuje plnitele. Dřív ho neměl a projevilo se to
# až na stroji, kde síť nikdo historicky nevytvořil (varra, 2026-08-11:
# "network aisha-mesh-dns declared as external, but could not be found").
#
# Plnitelem je warmup aplikace (docker-compose.coolify-netinit.yml), jedna na
# každé placement — Coolify aplikace běží na JEDNOM serveru, takže jedna
# nestačí. Doctor tedy nekontroluje, jestli sítě existují (to je stav hostitele,
# na který odsud nevidíme), ale jestli je má KDO založit. To je vlastnost repa
# a měřitelná je vždy.
_netinit_compose="$REPO_ROOT/docker-compose.coolify-netinit.yml"
if [[ ! -f "$_netinit_compose" ]]; then
  fail "chybí docker-compose.coolify-netinit.yml — externí sítě instance nemá kdo založit; na hostu bez nich padne KAŽDÝ stack"
elif ! grep -q 'docker.sock' "$_netinit_compose"; then
  fail "warmup nemontuje docker.sock — bez něj síť na hostiteli založit nelze"
else
  _places="$(node -e '
    const j=require(process.argv[1]);
    const s=j.services||{};
    const pot=new Set(), maji=new Set();
    for (const [id,d] of Object.entries(s)) {
      if (!d || !d.placement) continue;
      if (id.startsWith("netinit-")) maji.add(d.placement); else pot.add(d.placement);
    }
    const chybi=[...pot].filter(p=>!maji.has(p));
    console.log(JSON.stringify({potreba:[...pot], chybi}));
  ' "$REPO_ROOT/config/services.json" 2>/dev/null || echo '{}')"
  _chybi="$(echo "$_netinit_compose" >/dev/null; echo "$_places" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log((j.chybi||[]).join(","))}catch{console.log("?")}})' 2>/dev/null)"
  if [[ "$_chybi" == "?" ]]; then
    warn "warmup kontrakt NEZMĚŘEN — config/services.json se nepodařilo přečíst"
  elif [[ -n "$_chybi" ]]; then
    fail "umístění bez warmupu: ${_chybi} — tam sítě instance nikdo nezaloží a stacky spadnou na 'declared as external, but could not be found'"
  else
    ok "každé umístění má warmup, který založí sítě instance (a cold-start ho po rolloutu smaže)"
  fi
fi

# ── Subnety instance: odvozené, RFC1918, navzájem disjunktní ────────────────
#
# Rozsahy sítí jsou zdroj, o který se instance na sdíleném stroji perou.
# Naměřeno 2026-08-11 na varra: aisha nesla z backupu 10.99.0.0/24, tentýž
# rozsah už držel jiný nájemník, `docker network create` padl na "Pool overlaps"
# a mesh-dns na tom stroji nevznikla. Odvozený rozsah byl přitom volný — jen se
# přes zachovanou hodnotu nikdy nedostal ke slovu.
#
# Doctor kontroluje VLASTNOST DEKLARACE (odvoditelná odsud, vždy): rozsahy jsou
# validní CIDR, uvnitř RFC1918 a navzájem se nepřekrývají. ŽIVÝ překryv s cizí
# sítí odsud vidět není — ten hlásí warmup přímo na hostiteli, i s příčinou.
_subnet_check="$(node -e '
  import("./scripts/lib/derive-subnets.mjs").then(({ isRfc1918 }) => {
    const zdroj = process.argv[1];
    const pary = Object.fromEntries(
      require("fs").readFileSync(zdroj, "utf8").split("\n")
        .map((l) => /^(NETSEG_(?:FRONTEND|BACKEND|DATA)_SUBNET|MESH_DNS_SUBNET)=(.*)$/.exec(l.trim()))
        .filter(Boolean).map((m) => [m[1], m[2].replace(/^["\x27]|["\x27]$/g, "")]),
    );
    const nalezy = [];
    const rozsah = (c) => {
      const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(c);
      if (!m) return null;
      const b = ((+m[1] << 24) >>> 0) + (+m[2] << 16) + (+m[3] << 8) + +m[4];
      return [b, b + 2 ** (32 - +m[5]) - 1];
    };
    const keys = Object.keys(pary);
    if (keys.length === 0) { console.log("NEZMĚŘENO"); return; }
    for (const k of keys) {
      if (!rozsah(pary[k])) nalezy.push(`${k}=${pary[k]} není platný CIDR`);
      else if (!isRfc1918(pary[k])) nalezy.push(`${k}=${pary[k]} NENÍ RFC1918 (veřejný rozsah)`);
    }
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = rozsah(pary[keys[i]]), b = rozsah(pary[keys[j]]);
      if (a && b && a[0] <= b[1] && b[0] <= a[1]) nalezy.push(`${keys[i]} a ${keys[j]} se překrývají`);
    }
    console.log(nalezy.length ? nalezy.join(" | ") : `OK ${keys.length}`);
  }).catch(() => console.log("NEZMĚŘENO"));
' "$DOKTOR_ENV_SOUBOR" 2>/dev/null || echo "NEZMĚŘENO")"
case "$_subnet_check" in
  "NEZMĚŘENO") warn "subnety instance NEZMĚŘENY — .env.coolify chybí (cold-start ji vyrobí ve step 2) nebo je neobsahuje" ;;
  OK\ *)       ok "subnety instance: ${_subnet_check#OK } rozsahů, všechny RFC1918 a navzájem disjunktní" ;;
  *)           fail "subnety instance: $_subnet_check" ;;
esac

# Platnost rozsahu ještě neznamená, že patří TÉHLE instanci. Zděděná hodnota je
# taky validní RFC1918 a s ostatními se nepřekrývá — přesně proto ji kontrola
# výš nepozná. Tady se ptáme na jinou otázku: sedí zapsané rozsahy na to, co
# identita instance ODVOZUJE? Rozdíl je buď vědomý override, nebo hodnota, která
# přežila svůj důvod (naměřeno 2026-08-11: MESH_DNS_SUBNET=10.99.0.0/24 zděděno
# z backupu, na varra ho držel jiný nájemník, mesh-dns tam nevznikla).
#
# WARN, ne FAIL: override je legitimní. Operátor ale musí VIDĚT, že se hodnota
# při příštím generate-secrets změní, a na co.
#
# ⚠️ „buď — nebo" je nedoměřeno (opraveno 2026-08-13). Kontrola četla JEN
# .env.coolify, tedy náš VLASTNÍ výstup z minulého běhu, a tím pádem nemohla ty
# dvě možnosti rozlišit. Na riqu pak hlásila warning nad hodnotou, kterou týž
# běh o dvě fáze později přepíše — preflight varoval před stavem, který sám
# opravuje. Zelená/žlutá, kterou operátor nemá jak vyhodnotit, ho jen učí
# nedívat se.
#
# Rozlišení má domov v generate-secrets (`declaredOverride`, #897) a tady se
# opakuje jeho pravidlo: vyhrává jen DEKLARACE — hodnota v prostředí, která se
# NEROVNÁ vaultu. Hodnota shodná s vaultem je ozvěna a hodnota jen v .env.coolify
# je setrvačnost; v obou případech vyhraje odvození z identity.
#
# Cestu k vaultu si doctor ODVODÍ. Dřív tu stálo "$ENV_PROD_BACKUP" — jenže to
# je pojem COLD-STARTU, doctor ho nikdy nedefinoval. Pod `set -u` shodila
# nedefinovaná proměnná celou substituci, ta vrátila prázdno a `case` z prázdna
# vyrobil verdikt „subnet NEODPOVÍDÁ odvození:" bez detailu (naměřeno
# 2026-08-14 na riqu i aishe). Selhání se převléklo za nález — proto se sem
# hodnota nebere z cizího slovníku.
_doctor_vault="${ENV_PROD_BACKUP:-$REPO_ROOT/.env-prod-backup}"
_subnet_drift="$(node "$REPO_ROOT/scripts/lib/subnet-drift.mjs" \
  "$DOKTOR_ENV_SOUBOR" "$_doctor_vault" 2>/dev/null || echo "NEZMERENO")"
case "$_subnet_drift" in
  NEZMERENO*) : ;;  # identita neznámá — už hlášeno kontrolou výš
  OK*)        ok "zapsané subnety sedí na odvození z identity instance" ;;
  PREPISE*)    ok "subnety se tímhle během narovnají na odvození z identity: ${_subnet_drift#PREPISE?}" ;;
  OVERRIDE*)   warn "subnet je operátorský OVERRIDE — nasadí se deklarovaná hodnota, ne odvozená: ${_subnet_drift#OVERRIDE?}" ;;
  *)           warn "subnet NEODPOVÍDÁ odvození: $_subnet_drift" ;;
esac

if [[ -f "$REPO_ROOT/scripts/derived-url-report.mjs" ]]; then
  _durl="$(node "$REPO_ROOT/scripts/derived-url-report.mjs" --json 2>/dev/null || echo '{}')"
  _missing="$(echo "$_durl" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log((JSON.parse(d).missingVars||[]).length)}catch{console.log("?")}})' 2>/dev/null)"
  _noid="$(echo "$_durl" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log((JSON.parse(d).servicesWithoutInternalUrl||[]).length)}catch{console.log("?")}})' 2>/dev/null)"
  # TVRDÁ NULA, žádná základna.
  #
  # Dřív tu stála dvě připíchnutá čísla (34 a 17) a hlásil se až jejich růst.
  # Takový práh nevynucuje nic: kdo přidá řádek, vypadá legitimně a doktor mlčí.
  # A hlavně — obě čísla byla z velké části artefakt MĚŘIDLA, ne dluh:
  #
  #   34 → 0  ptalo se jen derivace, ale do .env vedou DVĚ cesty; `KEYCLOAK_URL`
  #           doručuje env-doctor z CONTRACT a je to VEŘEJNÝ issuer, který se
  #           odvozovat nemá (stává se z něj `iss` claim v JWT).
  #   17 → …  ptalo se na `internal_url`, jenže od zavedení `internal_endpoints`
  #           má služba identitu i z druhého pole.
  #
  # Vada je až tehdy, když NĚKDO VOLÁ a jméno nedorazí — to měří `_missing` a
  # patří na něj tvrdá nula. Kolik služeb nemá vnitřní jméno je INVENTURA, ne
  # vada: clamav mluví TCP 3310 a edge/registry se volají zvenku, takže vnutit
  # jim HTTP jméno by bylo horší než ho nemít. Proto se jen vypíše.
  if [[ "$_missing" =~ ^[0-9]+$ ]]; then
    if (( _missing > 0 )); then
      warn "$_missing proměnných se čte s aliasovým fallbackem, který NIKDO nedoručuje — kód vždy skončí na holém aliasu (node scripts/derived-url-report.mjs)"
    else
      ok "každá proměnná čtená s fallbackem je doručovaná (derivace nebo env-doctor CONTRACT)"
    fi
  fi
  if [[ "$_noid" =~ ^[0-9]+$ ]]; then
    info "služeb bez vnitřního jména: $_noid (inventura — veřejné a ne-HTTP služby ho mít nemusí)"
  fi
else
  warn "derived-url-report.mjs chybí — kontrakt odvozených URL se neměří"
fi

if [[ -f "$REPO_ROOT/scripts/network-policy-report.mjs" ]]; then
  _pol="$(node "$REPO_ROOT/scripts/network-policy-report.mjs" 2>/dev/null | tr -d '\033' | sed 's/\[[0-9;]*m//g')"
  if echo "$_pol" | grep -q "A × B souhlasí"; then
    ok "startovací pořadí: katalog a vlny redeploye si neodporují"
  else
    warn "katalog a vlny redeploye si odporují (node scripts/network-policy-report.mjs)"
  fi
  _excess="$(echo "$_pol" | grep -oE "navíc dosažitelných [0-9]+" | grep -oE "[0-9]+" | head -1)"
  [[ -n "$_excess" ]] && info "nadbytečně dosažitelných vazeb: $_excess (živě: SSH_HOST=… node scripts/network-reachability-probe.mjs)"
fi

# ── Křížová kolize aliasů na sdílené síti ────────────────────────────────────
#
# Coolify připojuje KAŽDÝ kontejner na sdílenou síť `coolify` (ověřeno: i služba
# bez `networks:` bloku tam skončí) a compose k tomu automaticky přidá alias
# rovný jménu služby. Dva nájemníci s týmž generickým jménem služby si tedy
# nárokují TÝŽ alias a Docker DNS mezi nimi STŘÍDÁ.
#
# NAMĚŘENO 2026-08-10: alias `pki-db` se rozřešil na DVĚ adresy — na vlastní
# databázi a na databázi CIZÍHO nájemníka. Zhruba půlka spojení OpenXPKI tak
# mířila jinam, kde byly přihlašovací údaje správně odmítnuty → realm CA se
# nikdy nezaložila → `pki-init` v CORE po 600 s fail-closed → core nenaběhl.
# Vada byla PRAVDIVÁ v okamžiku nasazení, ale projevila se o tři vlny později a
# v úplně jiné aplikaci. Přesně proto to patří sem, PŘED deploy.
#
# Postiženo bylo 16 aliasů, mezi nimi `redis` sdílený s aisha-core — tam nejde
# jen o dostupnost, ale o možný únik dat mezi nájemníky.
#
# MĚŘÍ SE CÍLOVÝ HOST, NE TENHLE STROJ.
#
# První verze (2026-08-10) četla LOKÁLNÍ docker démon. Jenže cold-start se
# pouští z pracovní stanice a jen NASAZUJE na Coolify hosty — takže měřila
# úplně jiný stroj, než na kterém na tom záleží: hlásila kolize z mého
# vývojového stacku a přitom o produkci neřekla nic. Ještě horší dopad: tvrdý
# fail zastavil cold-start kvůli nálezu, který se cílového hostu netýkal.
# Přesně ta třída, kvůli které tahle kontrola vznikla — odpověď na jinou otázku.
#
# Kde se tedy měří:
#   1. AISHA_DOCTOR_DOCKER_HOSTS="talos giah" → přes `docker -H ssh://<host>`
#   2. jinak: TENHLE stroj, ale JEN je-li sám Coolify hostem (běží `coolify-proxy`)
#   3. jinak: NEZMĚŘENO — vypíše se, čím to zapnout. Prázdný výsledek z
#      nespuštěného měřidla nesmí vypadat jako zelená (feedback_tool_failure_read_as_data).
#
# ── ČÍ ten alias je: nález se musí vztáhnout k MOJÍ identitě ──────────────────
#
# První verze vypsala jen jména kolidujících aliasů. To je nález bez adresáta:
# na sdíleném hostiteli se běžně potkají DVA CIZÍ nájemníci a to není vada
# tohohle nasazení — zatímco „cizí kontejner drží MŮJ alias" je únik provozu
# mezi zákazníky. Tvrdý fail bez toho rozlišení zastaví cold-start kvůli cizí
# kolizi; mlčení naopak přejde tu vlastní.
#
# NAMĚŘENO 2026-08-15 na talosu: `aisha-db`, `aisha-gateway`, `aisha-postgrest`
# a `aisha-redis` drží po dvou kontejnerech, a ani jeden z nich není aisha —
# jsou to jádra DVOU CIZÍCH forků (`<fork>-core`, fork bez deklarované identity).
# `aisha-core` na talosu vůbec neběží, jenže `aisha-edge` ano a `aisha-gateway`
# se mu odsud přeloží na CIZÍ kontejner. Vypsat jen „4 aliasy kolidují" by o té
# podstatné věci — čí to jsou a kdo je drží — neřeklo nic.
#
# Vypisuje se proto `alias<TAB>držitel,držitel`. Klasifikace je pak čistě
# jmenná: začíná-li alias identitou tohohle nasazení, je to MŮJ alias.
# Jméno SDÍLENÉ sítě není vlastnost platformy, ale instalace. Tenhle repozitář
# ji ve svých compose deklaruje jako `coolify` (external), lokální generátor
# používá vlastní; jiný fork může mít docela jinou. Proto proměnná s tímhle
# doloženým výchozím jménem — ne předpoklad o cizím světě.
_SDILENA_SIT="${AISHA_SHARED_NETWORK:-coolify}"

_alias_dupes_on() {   # $1 = prázdno pro lokální démon, jinak ssh cíl
  local _dh=() ; [[ -n "${1:-}" ]] && _dh=(-H "ssh://$1")
  docker ${_dh[@]+"${_dh[@]}"} network inspect "$_SDILENA_SIT" >/dev/null 2>&1 || { echo "__NO_COOLIFY_NET__"; return; }
  local _c
  for _c in $(docker ${_dh[@]+"${_dh[@]}"} network inspect "$_SDILENA_SIT" -f '{{range $k,$v := .Containers}}{{$v.Name}} {{end}}' 2>/dev/null); do
    docker ${_dh[@]+"${_dh[@]}"} inspect -f "{{range \$k,\$v := .NetworkSettings.Networks}}{{if eq \$k \"${_SDILENA_SIT}\"}}{{range \$v.Aliases}}{{.}}{{println}}{{end}}{{end}}{{end}}" "$_c" 2>/dev/null \
      | grep -v '^$' | sed "s|^|${_c}\t|"
  done | awk -f "$REPO_ROOT/scripts/lib/alias-collisions.awk" | sort
}

# Identita tohohle nasazení — jediné měřítko toho, který alias je „můj".
# Prázdno tu není chyba: fáze A na nedeklarovanou identitu už selhala nahlas.
_moje_identita="${APP_NAME_PREFIX:-${AISHA_STORY:-}}"

# ── ODKUD SE MĚŘÍ: neptat se na to, co instance UŽ ŘEKLA ──────────────────────
#
# Cílové hostitele deklaruje instance ve slotech (`FRONTEND_HOSTNAME`,
# `BACKEND_HOSTNAME`, `EXPERIMENTAL_HOSTNAME`, `BUILD_HOSTNAME`) — cold-start je
# sám vyžaduje a při prvním běhu se na ně ptá. Vyžadovat je PODRUHÉ pod jiným
# jménem (`AISHA_DOCTOR_DOCKER_HOSTS="talos giah varra"`) je duplicitní vstup:
# operátor by musel opsat něco, co už jednou deklaroval, a při rozejití by
# doktor tiše měřil jiné stroje, než na které se nasazuje.
#
# Slot nese JMÉNO SERVERU V COOLIFY (např. „Talos"), kdežto `docker -H ssh://…`
# potřebuje dosažitelný SSH cíl. Obojí bývá totéž jméno v jiné velikosti, ale
# HÁDAT se to nesmí — proto se kandidáti jen NABÍDNOU a vezme se ten, který
# opravdu odpoví. Když neodpoví žádný, je to NEZMĚŘENO s uvedeným důvodem,
# nikdy tichý přeskok.
_ssh_docker_target() {   # $1 = deklarované jméno slotu → vytiskne funkční cíl, nebo nic
  local kandidat
  for kandidat in "$1" "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"; do
    [[ -n "$kandidat" ]] || continue
    if docker -H "ssh://$kandidat" version >/dev/null 2>&1; then
      printf '%s' "$kandidat"; return 0
    fi
  done
  return 1
}

# ⛔ NAMĚŘENO 2026-08-15, moje vlastní vada: tohle bylo napsané jako řetěz
# `elif`, tedy PRVNÍ-KDO-ODPOVÍ. Na vývojovém notebooku existuje síť `coolify`
# se dvěma kontejnery, takže se měření zastavilo na něm, vyhlásilo
# „✓ žádný alias si nenárokuje víc kontejnerů" — a na talos, giah ani varru,
# kde ta kolize prokazatelně je, se vůbec nepodívalo. Zelená z jiného
# stanoviště, přesně ta třída, kterou tahle kontrola má odhalovat.
#
# Správná sémantika je SJEDNOCENÍ: měř VŠUDE, kde tohle nasazení žije.
# Jediné, co smí zkratovat, je výslovný operátorský override — tam operátor
# říká přesně, co chce změřit.
_alias_targets=""
_alias_nedosazitelne=""
# ⛔ NAMĚŘENO 2026-08-17: tahle sekce SSHuje na každý deklarovaný slot a inspectuje
# tam KAŽDÝ kontejner — na naší flotile 64 s (Giah 14, Talos 24, Varra 22, tenhle
# host 4). Dělala to i pod `--no-network`, protože měla vlastní vypínač
# `AISHA_SKIP_ONLINE` a o té volbě nevěděla — táž otázka („měř offline") ve dvou
# domovech, z nichž jeden neposlouchá. Vlastní brána doktora ho pouští právě
# s `--no-network` a dává mu 120 s; rezerva vyšla jen do chvíle, než do měření
# přibyl i lokální démon. `docker -H ssh://…` je síť z definice, takže
# `--no-network` musí platit i tady.
if [[ "$NO_NETWORK" -eq 1 ]]; then
  :   # cíle zůstávají prázdné; důvod se vysloví u samotného měření níž
elif [[ -n "${AISHA_DOCTOR_DOCKER_HOSTS:-}" ]]; then
  _alias_targets="$AISHA_DOCTOR_DOCKER_HOSTS"
elif command -v docker >/dev/null 2>&1; then
  _kandidati=""

  # (a) TENHLE stroj, vidí-li sdílenou síť. Pro instalaci na jednom serveru je
  #     to jediný cíl; jinde je to jeden z mnoha — ne náhrada za ostatní.
  if docker network inspect "$_SDILENA_SIT" >/dev/null 2>&1; then
    _kandidati="__local__"
  fi

  # (b) DEKLAROVANÉ umístění. Kolik rolí instalace má a jak se jmenují, je její
  #     věc — jeden název i prázdno jsou legitimní tvary.
  #     Hodnoty se berou z DEKLARACE, ne z toho, co má zrovna kdo v prostředí.
  #     ⛔ NAMĚŘENO 2026-08-15: doktor spuštěný samostatně viděl jen
  #     `BACKEND_HOSTNAME` a `EXPERIMENTAL_HOSTNAME` (jsou v `.env.coolify`),
  #     ale `FRONTEND_HOSTNAME=Talos` žije v `.env.local`, které nečte — takže
  #     se na Talos, kde ta kolize je, vůbec nepodíval a NIC o tom neřekl.
  _deklarovany_slot() {   # $1 = jméno proměnné
    local v="${!1-}"
    [[ -n "$v" ]] && { printf '%s' "$v"; return; }
    local f
    for f in "$REPO_ROOT/.env.local" "$DOKTOR_ENV_SOUBOR"; do
      [[ -r "$f" ]] || continue
      v="$(grep -E "^$1=" "$f" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"'"' )"
      [[ -n "$v" ]] && { printf '%s' "$v"; return; }
    done
  }
  _sloty="$(printf '%s\n%s\n%s\n%s\n' \
      "$(_deklarovany_slot FRONTEND_HOSTNAME)" "$(_deklarovany_slot BACKEND_HOSTNAME)" \
      "$(_deklarovany_slot EXPERIMENTAL_HOSTNAME)" "$(_deklarovany_slot BUILD_HOSTNAME)" \
      | grep -v '^$' | sort -u)"

  # (c) ŽIVÉ umístění z orchestrátoru — doplněk, a jen je-li vůbec deklarovaný.
  #     Že my provozujeme víc instancí na sdíleném Coolify, je náš tvar; jiná
  #     instalace o něm nemusí vědět.
  _orch_prefix="${APP_NAME_PREFIX:-${AISHA_STORY:-$(_deklarovany_slot APP_NAME_PREFIX)}}"
  _orch_url="${COOLIFY_URL:-$(_deklarovany_slot COOLIFY_URL)}"
  _orch_token="${COOLIFY_API_TOKEN:-$(_deklarovany_slot COOLIFY_API_TOKEN)}"
  if [[ -z "$_orch_url" || -z "$_orch_token" || -z "$_orch_prefix" ]]; then
    # Přeskočená větev se MUSÍ ozvat: jinak vypadá „nebylo co přidat" stejně
    # jako „nezeptal jsem se".
    info "živé umístění NEDOTAZOVÁNO (chybí COOLIFY_URL / token / identita) — měří se jen deklarované sloty"
  else
    COOLIFY_URL="$_orch_url"; COOLIFY_API_TOKEN="$_orch_token"; APP_NAME_PREFIX="$_orch_prefix"
  fi
  if [[ -n "$_orch_url" && -n "$_orch_token" && -n "$_orch_prefix" ]]; then
    _zive="$(COOLIFY_URL="$COOLIFY_URL" COOLIFY_API_TOKEN="$COOLIFY_API_TOKEN" \
              AISHA_PREFIX="${APP_NAME_PREFIX:-${AISHA_STORY:-}}" node -e '
      const url = process.env.COOLIFY_URL.replace(/\/+$/, "");
      const prefix = process.env.AISHA_PREFIX + "-";
      fetch(`${url}/api/v1/applications`, {
        headers: { Authorization: `Bearer ${process.env.COOLIFY_API_TOKEN}` },
        signal: AbortSignal.timeout(60_000),
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((apps) => {
          const jmena = new Set();
          for (const a of Array.isArray(apps) ? apps : []) {
            if (!String(a?.name || "").startsWith(prefix)) continue;
            const s = a?.destination?.server?.name;
            if (s) jmena.add(s);
          }
          process.stdout.write([...jmena].sort().join("\n"));
        })
        .catch(() => {});
    ' 2>/dev/null)"
    _sloty="$(printf '%s\n%s\n' "$_sloty" "$_zive" | grep -v '^$' | sort -u)"
  fi

  for _slot in $_sloty; do
    if _cil="$(_ssh_docker_target "$_slot")"; then
      _kandidati="${_kandidati:+$_kandidati }$_cil"
    else
      _alias_nedosazitelne="${_alias_nedosazitelne:+$_alias_nedosazitelne }$_slot"
    fi
  done
  # Sjednocení bez duplicit — týž stroj se nesmí měřit dvakrát.
  _alias_targets="$(printf '%s\n' $_kandidati | grep -v '^$' | sort -u | tr '\n' ' ')"
  _alias_targets="${_alias_targets% }"
  [[ -n "$_alias_targets" ]] && info "měřit se bude na: $_alias_targets"
fi
if [[ -n "$_alias_nedosazitelne" ]]; then
  # Deklarovaný, ale odsud nedosažitelný stroj NENÍ „čisto" — je to díra
  # v měření a musí být vidět.
  info "NEZMĚŘENO na: $_alias_nedosazitelne (deklarované sloty, ale \`docker -H ssh://…\` odsud neodpověděl)"
fi

if [[ "$NO_NETWORK" -eq 1 ]]; then
  # Vlastní důvod, ne ten níž: „žádný slot neodpověděl" by tvrdil něco, co se
  # nikdo neptal — hláška nesmí předpokládat příčinu, kterou neměřila.
  info "--no-network: kolize aliasů na sdílené síti NEMĚŘENY (měřením je SSH + docker na cizí stroje)"
elif [[ "${AISHA_SKIP_ONLINE:-0}" == "1" ]]; then
  info "offline režim — kolize aliasů na sdílené síti NEMĚŘENA"
elif [[ -z "$_alias_targets" ]]; then
  info "kolize aliasů NEMĚŘENA: tenhle stroj není Coolify host a žádný deklarovaný slot (FRONTEND/BACKEND/EXPERIMENTAL/BUILD_HOSTNAME) odsud přes SSH neodpověděl"
else
  for _h in $_alias_targets; do
    _label="$_h"; _ssh="$_h"
    [[ "$_h" == "__local__" ]] && { _label="tento host"; _ssh=""; }
    _dupes="$(_alias_dupes_on "$_ssh")"
    if [[ "$_dupes" == "__NO_COOLIFY_NET__" ]]; then
      info "[$_label] síť 'coolify' nedosažitelná — kolize aliasů neměřena"
    elif [[ -n "$_dupes" ]]; then
      _moje=""; _cizi=""
      while IFS=$'\t' read -r _alias _drzitele; do
        [[ -z "$_alias" ]] && continue
        if [[ -n "$_moje_identita" && "$_alias" == "${_moje_identita}-"* ]]; then
          _moje+="      ${_alias}  ←  ${_drzitele}"$'\n'
        else
          _cizi+="      ${_alias}  ←  ${_drzitele}"$'\n'
        fi
      done <<< "$_dupes"

      if [[ -n "$_moje" ]]; then
        _n="$(printf '%s' "$_moje" | grep -c . || true)"
        fail "[$_label] $_n alias(ů) tohohle nasazení si na sdílené síti 'coolify' nárokuje víc kontejnerů — Docker DNS mezi nimi střídá, takže část spojení míří k CIZÍMU nájemníkovi"
        printf '%s' "$_moje" | head -12
        info "  náprava: držitel bez deklarované identity musí dostat APP_NAME_PREFIX (jméno na sdíleném hostiteli JE nárok na identitu)"
      fi
      if [[ -n "$_cizi" ]]; then
        _n="$(printf '%s' "$_cizi" | grep -c . || true)"
        info "[$_label] $_n kolidující(ch) alias(ů) patří JINÝM nájemníkům — tohle nasazení se jich netýká, ale na sdíleném hostiteli je to tatáž vada"
        printf '%s' "$_cizi" | head -8
      fi
    else
      ok "[$_label] žádný alias na sdílené síti 'coolify' si nenárokuje víc kontejnerů"
    fi
  done
fi

# ── Kanárek na wildcard resolver ─────────────────────────────────────────────
#
# Jméno, které resolvovat NEMÁ, resolvovat NESMÍ. Když resolvuje, je každé
# měření dosažitelnosti na tom hostu nedůvěryhodné — a to je horší než výpadek.
#
# NAMĚŘENO 2026-08-13 na VŠECH čtyřech hostech: search doména vrací pro libovolné
# neznámé jméno adresu síťové appliance, a ta na jakýkoli Host odpoví 302 s ECHEM
# toho Hostu. Řetěz, který to způsobí:
#
#   mrtvá vnitřní služba → Docker DNS jméno nezná → propadne na hostitelský
#   resolver → wildcard → appliance → 302 místo čistého 502
#
# Takhle vypadala riqi „auth posílá na <instance>-keycloak:80": keycloak
# kontejner NEEXISTOVAL, alias propadl na wildcard a appliance vrátila redirect
# se jménem upstreamu. Vypadá to jako vada konfigurace, je to mrtvá služba.
#
# Proč je to kontrola cold-startu a ne poznámka: sonda, která curluje vnitřní
# jméno, dostane odpověď VŽDY. „HTTP odpovědělo" tedy na takovém hostu NENÍ
# důkaz, že služba žije — je to továrna na falešnou zelenou. Viz
# feedback_tool_failure_read_as_data a feedback_gates_green_because_invisible.
#
# Jméno se generuje NÁHODNĚ: pevný řetězec by si někdo mohl někam zapsat a
# kanárek by přestal měřit to, co má. Žádná adresa appliance se sem nepíše —
# nález je „resolvovalo se cokoli", ne „resolvovalo se na tuhle IP".
#
# ── MĚŘÍ SE UVNITŘ KONTEJNERU, NE NA HOSTU ───────────────────────────────────
# První verze se ptala hostitele. To je INDICIE, ne důkaz: služby běží
# v kontejnerech a ty mají vlastní cestu (Docker DNS 127.0.0.11 + `search`,
# a musl místo glibc). Naměřeno 2026-08-13, že se ty dvě cesty LIŠÍ: uvnitř
# kontejneru `getent` jméno NEresolvuje, zatímco `nslookup` ano — a Caddy
# resolvuje jako nslookup, proto skončil na appliance. Kdyby kanárek měřil jen
# hostitele, popisoval by jiný stroj, než na kterém na tom záleží — přesně
# třída, kvůli které tahle kontrola vznikla.
#
# Nástroj se hledá TOLERANTNĚ: obrazy jsou různé, `nslookup` ani `getent` být
# nemusí. Chybějící nástroj (rc 126/127) NENÍ nález, jde se na další kontejner.
# Když ho nemá žádný, výsledek je NEZMĚŘENO — ne „čisto".
_wildcard_canary_on() {   # $1 = prázdno pro lokální démon, jinak ssh cíl
  local _name="aisha-doctor-canary-$RANDOM$RANDOM-nikdy-neexistuje"
  # shellcheck disable=SC2016
  local _probe='
    _n="__NAME__"; _tried=0
    for _c in $(docker ps --format "{{.Names}}" 2>/dev/null | head -25); do
      # ⛔ DVA NÁSTROJE, NE JEDEN (naměřeno 2026-08-18).
      # Komentář výš slibuje toleranci k `nslookup` I `getent`, kód zkoušel jen
      # `nslookup` — takže kontejner, který má pouze `getent`, kanárek přeskočil.
      # Přesně takový je `netbird-management`: jiná session v něm 2026-08-18
      # naměřila `getent hosts <vymyšlené-jméno>` → veřejná IP přes `search`
      # doménu, tedy nález, který tahle kontrola měla ohlásit a mlčela.
      # Obě cesty se navíc chovají RŮZNĚ podle obrazu (musl vs glibc): 08-13
      # `getent` neresolvoval a `nslookup` ano, 08-18 obráceně. Ptát se jen
      # jedné znamená měřit půlku a druhou půlku prohlásit za čistou.
      for _tool in nslookup getent; do
        case "$_tool" in
          nslookup) _o=$(docker exec "$_c" nslookup "$_n" 2>/dev/null); _rc=$? ;;
          getent)   _o=$(docker exec "$_c" getent hosts "$_n" 2>/dev/null); _rc=$? ;;
        esac
        if [ $_rc -eq 126 ] || [ $_rc -eq 127 ]; then continue; fi
        _tried=1
        [ $_rc -eq 0 ] || continue
        case "$_tool" in
          nslookup) _a=$(printf "%s" "$_o" | awk "/^Address/{print \$NF; exit}") ;;
          getent)   _a=$(printf "%s" "$_o" | awk "{print \$1; exit}") ;;
        esac
        [ -n "$_a" ] && { echo "RESOLVED"; exit 0; }
      done
    done
    [ "$_tried" = "1" ] && echo "CLEAN" || echo "UNMEASURED"
  '
  _probe="${_probe//__NAME__/$_name}"
  if [[ -z "${1:-}" ]]; then
    sh -c "$_probe" 2>/dev/null
  else
    ssh -o ConnectTimeout=15 -o BatchMode=yes "$1" "$_probe" 2>/dev/null
  fi
}

if [[ "${AISHA_SKIP_ONLINE:-0}" == "1" ]]; then
  info "offline režim — wildcard resolver NEMĚŘEN"
elif [[ -z "$_alias_targets" ]]; then
  info "wildcard resolver NEMĚŘEN: zapni AISHA_DOCTOR_DOCKER_HOSTS=\"talos giah varra\""
else
  for _h in $_alias_targets; do
    _label="$_h"; _ssh="$_h"
    [[ "$_h" == "__local__" ]] && { _label="tento host"; _ssh=""; }
    _canary="$(_wildcard_canary_on "$_ssh")"
    case "$_canary" in
      RESOLVED)
        # ⛔ BYL TO `fail`, a to bylo špatně. Wildcard je vlastnost PROSTŘEDÍ,
        # ne vada nasazení — a blokovat jím cold-start znamená zastavit
        # nasazení kvůli něčemu, co v repu opravit nejde.
        #
        # Vada byla jinde: v sondě, která brala „něco odpovědělo" jako důkaz.
        # `scripts/lib/routing-probe.mjs` teď odmítá odpověď, která jen vrací
        # otázku (přesměrování zpět na týž host = podpis odražeče), takže
        # wildcard falešnou zelenou vyrobit neumí. Víme, JAKÁ odpověď má
        # přijít, ne jen že něco přišlo.
        #
        # Zůstává jako VÝROK O PROSTŘEDÍ: operátor to má vědět, protože ruční
        # `curl` na vnitřní jméno tu pořád klame — jen už na tom nestojí
        # žádná automatická kontrola.
        warn "[$_label] WILDCARD RESOLVER: neexistující jméno se UVNITŘ KONTEJNERU resolvovalo — ruční curl na vnitřní jméno tu klame (sondy to už rozpoznají samy)"
        echo "      Důsledek: žádná sonda nad vnitřním jménem tu není důkazem života —" >&2
        echo "      dostane odpověď i pro službu, která neběží (falešná zelená)." >&2
        echo "      Náprava je na resolveru (search doména s wildcardem), ne v repu." >&2
        ;;
      CLEAN)
        ok "[$_label] neexistující jméno v kontejneru správně NEresolvuje — sondy nad vnitřními jmény mají výpovědní hodnotu"
        ;;
      *)
        # Ani jeden kontejner neměl použitelný resolver. Prázdný výsledek
        # z nespuštěného měřidla nesmí vypadat jako zelená.
        warn "[$_label] wildcard resolver NEZMĚŘEN: žádný běžící kontejner nemá nslookup — nevíme, co uvidí služby"
        ;;
    esac
  done
fi


# ── Mesh: jak se vidíme × jak nás vidí ostatní ───────────────────────────────
#
# ⛔ NAMĚŘENO 2026-08-24: o meshi máme 18 bran a po síti nesahá ANI JEDNA.
# Rozpor mezi „peer si myslí, že je v meshi" a „management ho tam vidí" tedy
# neměřil nikdo — a přitom je to typický tvar poruchy (agent běží, wt0 nemá).
#
# Sonda se ZÁMĚRNĚ neptá `netbird status`: v našich sidecarech běží netbird bez
# démona, socket neexistuje a CLI by hlásilo mrtvý mesh na živém meshi.
# Pravda je v `ip addr show wt0` uvnitř netns.
#
# Exit 2 = NEZMĚŘENO (docker/management nedostupný), což NENÍ zelená.
# Offline režim se ČTE, nedosazuje: `${AISHA_SKIP_ONLINE:-0}` by hádal fakt
# o světě. Buď je v prostředí `AISHA_SKIP_ONLINE=1`, nebo není — a to je celá
# otázka. (Týž vzor jako `PRUNE_EXTRA` v coolify-sync-envs.sh.)
if env | grep -qx 'AISHA_SKIP_ONLINE=1'; then
  info "offline režim — shoda pohledů na mesh NEMĚŘENA"
else
  _msvp="$(node "$REPO_ROOT/scripts/mesh-self-vs-peers.mjs" 2>&1)"; _msvp_rc=$?
  case "$_msvp_rc" in
    0) ok "mesh: pohled zevnitř a pohled managementu se SHODUJÍ" ;;
    1) warn "mesh: pohledy se ROZCHÁZEJÍ (npm run doctor:mesh-self-vs-peers)"
       echo "$_msvp" | grep -E "wt0|NEZNÁ|ODPOJEN|connected=" | head -8 >&2 ;;
    *)
      # ⛔ NAMĚŘENO 2026-09-13: tady stálo `head -1` — PRVNÍ řádek sloučeného
      # výstupu. Tím byl řádek, který discovery zapsala na stderr JAKO PRVNÍ
      # (u nás „sonda Keycloaku přeskočena"), ne verdikt ani příčina. Verdikt
      # mesh-self-vs-peers navíc zní „Command failed: node …", protože příčinu
      # nese stderr potomka. Hlásí se proto PŘÍČINA z discovery (`fetch failed:`),
      # jinak verdikt sondy — a pod tím všechny řádky discovery, ať je vidět celý řetěz.
      _msvp_pricina="$(printf '%s\n' "$_msvp" | bez_barev | grep -F '[netbird-peer-discover] fetch failed:' | tail -1)"
      _msvp_verdikt="$(printf '%s\n' "$_msvp" | bez_barev | grep -m1 'NEZMĚŘENO' || true)"
      if [ -n "$_msvp_pricina" ]; then
        warn "mesh: shoda pohledů NEZMĚŘENA — discovery: ${_msvp_pricina#*fetch failed: }"
      elif [ -n "$_msvp_verdikt" ]; then
        warn "mesh: shoda pohledů NEZMĚŘENA — ${_msvp_verdikt}"
      else
        warn "mesh: shoda pohledů NEZMĚŘENA — sonda skončila kódem ${_msvp_rc} bez verdiktu: $(printf '%s\n' "$_msvp" | bez_barev | head -1)"
      fi
      printf '%s\n' "$_msvp" | bez_barev | grep -F '[netbird-peer-discover]' | head -6 | sed 's/^/      /' >&2
      unset _msvp_pricina _msvp_verdikt
      ;;
  esac
fi

# ── Forwarder mesh DNS: deklarace instance, ne resolver stroje operátora ─────
# ⛔ NAMĚŘENO 2026-09-16: cold-start ho bral z /etc/resolv.conf notebooku (na
# hotspotu fe80::…%en0). Bez platného forwarderu netbird-dns-provision nezapíše
# nic a mesh DNS zůstane prázdné — doktor to řekne dřív, než to zjistí fáze F.
case "$(printf '%s' "${MESH_ENABLED:-}" | tr '[:upper:]' '[:lower:]')" in
  true|1|yes|on)
    _fwd_verdikt="$(NETBIRD_DNS_FORWARD_IP="${NETBIRD_DNS_FORWARD_IP:-}" node --input-type=module -e '
      import { overForwarder } from "'"$REPO_ROOT"'/scripts/lib/dns-forwarder.mjs";
      const v = overForwarder(process.env.NETBIRD_DNS_FORWARD_IP);
      console.log(v.ok ? `OK ${v.ip}` : `CHYBA ${v.duvod}`);
    ' 2>&1)"
    case "$_fwd_verdikt" in
      "OK "*) ok "mesh DNS forwarder: ${_fwd_verdikt#OK } (deklarace instance)" ;;
      "CHYBA "*) fail "mesh DNS forwarder: ${_fwd_verdikt#CHYBA } — bez něj fáze F mesh DNS nenaplní" ;;
      *) fail "mesh DNS forwarder NEZMĚŘEN — kontrola spadla: $(printf '%s' "$_fwd_verdikt" | head -1)" ;;
    esac
    unset _fwd_verdikt
    ;;
esac

fi  # should_run_phase N

# ── Dveře (SPA knock): umí instance vůbec někoho pustit k autorizaci? ────────
# ⛔ NAMĚŘENO 2026-08-19. `svc-knock` je fail-closed: bez rosteru operátorů
# NENASTARTUJE a drží celý edge v `restarting` — takhle spadlo pět kontejnerů
# a doktor o tom předtím nevěděl nic. Měří se proto OBĚ strany:
#   server  `SPA_OPERATORS_B64`     — bez něj edge nevydrží stát
#   klient  `SPA_KNOCK_MOBILE_KID`… — bez nich odejde build bez dveří a MLČÍ
# Verdikt je warning, ne fail: instance bez profilu `knock` dveře mít nemusí.
# Ale ticho tu být nesmí — chybějící dveře jsou dnes nejčastější důvod, proč
# „appka nejde dovnitř" a nikde k tomu není věta.
echo -e "\n${C}${BOLD}━━━ Dveře (SPA knock) ━━━${N}"
__env_soubor="$DOKTOR_ENV_SOUBOR"
if [ ! -f "$__env_soubor" ]; then
  # ⛔ NAMĚŘENO 2026-08-20: tady stálo `warn`, což doktora posunulo na exit 2 —
  # a brána `cold-start-doctor` čeká u fázi B,E nulu. V CI ten soubor NIKDY
  # není (je gitignorovaný), takže jeho nepřítomnost je NORMÁLNÍ STAV, ne nález.
  # Nepoužitelné pravidlo má MLČET, ne hlásit: `info` říká, že se neměřilo,
  # a nedělá z toho varování o instanci, o které se nic neví.
  info "Dveře: ${__env_soubor##*/} není — neměřeno (mimo instanci je to normální)"
else
  # ⛔ NAMĚŘENO 2026-09-15: tady se „používá instance dveře?" četlo z COMPOSE
  # (`grep profiles:.*"knock"`) — jenže compose profil deklaruje VŽDY, takže
  # větev „instance je nepoužívá" byla nedosažitelná a doktor hlásil chybějící
  # roster i instanci, která dveře nechce. Zapnutí určuje JEDINÁ deklarace
  # instance (EDGE_COMPOSE_PROFILES ∋ knock) a soulad s ní měří jeden domov:
  # lib/dvere-soulad.mjs (režim ↔ roster, ruční port proti .env-prod-backup,
  # adresa verdiktu s identitou, EDGE_DOOR_MODE=enforce bez dveří).
  __dvere_op=()
  [ -f "$PROD_BACKUP_FILE" ] && [ "$PROD_BACKUP_FILE" != "/dev/null" ] && __dvere_op=(--operator-file "$PROD_BACKUP_FILE")
  __dvere_rc=0
  __dvere_out="$(node "$REPO_ROOT/scripts/lib/dvere-soulad.mjs" --soulad --env-file "$__env_soubor" ${__dvere_op[@]+"${__dvere_op[@]}"} 2>&1)" || __dvere_rc=$?
  __deklarovano=0
  node "$REPO_ROOT/scripts/lib/dvere-soulad.mjs" --deklarovano --env-file "$__env_soubor" >/dev/null 2>&1 && __deklarovano=1
  dvere_soulad_verdikt "$__dvere_out" "$__dvere_rc" "${__env_soubor##*/}"
  if [ "$__deklarovano" = "1" ]; then
    __chybi_klient=""
    for __k in SPA_KNOCK_PUBLIC_HOST SPA_KNOCK_PUBLIC_PORT SPA_KNOCK_MOBILE_KID SPA_KNOCK_MOBILE_SCOPE; do
      [ -n "$(grep -m1 "^${__k}=" "$__env_soubor" | cut -d= -f2- | tr -d '"')" ] || __chybi_klient="${__chybi_klient}${__k} "
    done
    if [ -n "$__chybi_klient" ]; then
      warn "Dveře: mobilní build by odešel BEZ nich (appka nabídku mlčky skryje): ${__chybi_klient}"
      warn "  Náprava: node scripts/knock-provision.mjs   (odvodí je z identity instance; port je ruční deklarace)"
    else
      ok "Dveře: parametry pro mobilní build přítomné"
    fi
  fi
  unset __dvere_op __dvere_rc __dvere_out __deklarovano __chybi_klient
fi

# ============================================================================
echo -e "\n${C}${BOLD}━━━ SUMMARY ━━━${N}"
echo -e "  ${G}Pass:${N}     $PASS_COUNT"
echo -e "  ${Y}Warnings:${N} $WARN_COUNT"
echo -e "  ${R}Fails:${N}    $FAIL_COUNT"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo -e "\n${R}${BOLD}NOT READY for cold-start:${N}"
  for r in "${FAIL_REASONS[@]}"; do
    echo -e "  ${R}✗${N} $r"
  done
  exit 1
fi

if [[ "$WARN_COUNT" -gt 0 ]]; then
  echo -e "\n${Y}${BOLD}READY with warnings (cold-start může projít, ale s rizikem):${N}"
  for r in "${WARN_REASONS[@]}"; do
    echo -e "  ${Y}⚠${N} $r"
  done
  exit 2
fi

echo -e "\n${G}${BOLD}✓ READY — cold-start je safe spustit${N}"
echo -e "  ${DIM}bash scripts/aisha-cold-start.sh${N}"
exit 0

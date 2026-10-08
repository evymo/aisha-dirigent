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
#   G. Forgejo — git remote connectivity check
#   K. Keycloak    — servíruje instance svůj realm? (varování; --no-network = neměřeno)
#   V. Vnější expozice — uzly s firewallem hostitele (accel-hostfw) zvenku: TCP connect
#      z tohoto stanoviště, očekávání z adres správy a odchozí IP (hairpin = odmítnuto);
#      NA UZLU (docker přes SSH, jen čtení): každý port publikovaný mimo loopback
#      a deklaraci uzlu (proxy zvlášť) a měřený stav firewallu pro pravidlo UDP
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
# Jen přepínač od cold-startu (`--wipe-planned`), NE proměnná prostředí: hodnota
# v prostředí by odemkla STOP duplicitních jmen i kontroly přesunu, aniž by se jakýkoli
# wipe konal (táž třída jako plánovaný rewarmup — revize accel-1, 3. kolo).
WIPE_PLANNED=0
# Existuje stack, nad kterým se konverguje (cold-start --skip-create předá --stack-exists)?
# Jen pak má smysl ptát se, zda generate-secrets vyrobí všechno, co krok 2 potřebuje.
STACK_EXISTS="${AISHA_STACK_EXISTS:-}"
# Aplikace, které cold-start právě přestaví (--rewarmup=…): jejich přesun na jiný
# server provede tahle operace sama, takže kontrola přesunu je za STOP brát nesmí
# (fail-closed na podmínku, kterou operace ruší — revize accel-1, 10-05).
# Jen přepínač od cold-startu, NE proměnná prostředí: hodnota v prostředí by STOP
# odemkla, aniž by se jakákoli přestavba konala (revize accel-1, 2. kolo).
REWARMUP_PLANNED=""
# Týž vzor jako záměr wipu výš, pro SDÍLENÝ SERVER (typ proxy ve fázi F, uzel ve fázi V):
# doktor je krok 0 cold-startu, a stav serveru, který je společný všem projektům
# na něm, nesmí v PŘEDLETU zastavit žádný cold-start — produkční běh ho teprve
# srovná (krok 4c) a na konci ověří, ne-produkční ho měnit nesmí a neumí. Cold-start
# proto doktorovi řekne, že jde o jeho předlet, a co ten běh se serverem dělá:
#   --predlet-cold-startu=srovna   produkční ostrý běh: typ proxy nastaví, uzel na
#                                  konci změří a nález zapíše jako NEDOKONČENO,
#   --predlet-cold-startu=nemeni   ne-produkční běh: sdílený server nemění — srovná
#                                  a ověří ho produkční běh.
# S přepínačem jsou rozdíl typu proxy i nález „kontejner proxy publikuje porty"
# hlasité VAROVÁNÍ; bez něj (samostatný doktor) FAIL. NEZMĚŘENO není ok nikdy —
# a ve fázi F je bez přepínače také FAIL (nezměřený stav nesmí projít snáz než
# změřený rozdíl; proxy_serveru_verdikt).
# Jen přepínač, žádná proměnná prostředí: záměr běhu se nedědí z terminálu.
PREDLET_COLD_STARTU=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-network) NO_NETWORK=1; shift ;;
    --phase) PHASES_FILTER="$2"; shift 2 ;;
    --wipe-planned) WIPE_PLANNED=1; shift ;;
    --predlet-cold-startu=*) PREDLET_COLD_STARTU="${1#*=}"; shift ;;
    --stack-exists) STACK_EXISTS=1; shift ;;
    --rewarmup-planned=*) REWARMUP_PLANNED="${1#*=}"; shift ;;
    -h|--help) head -30 "$0" | tail -28; exit 0 ;;
    *) fail "Unknown option: $1"; exit 1 ;;
  esac
done
case "$PREDLET_COLD_STARTU" in
  ""|srovna|nemeni) ;;
  *) fail "--predlet-cold-startu='${PREDLET_COLD_STARTU}' není srovna|nemeni — neznámý záměr běhu se nevykládá"; exit 1 ;;
esac

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

# Source .env-prod-backup if exists (for FORGEJO_TOKEN, COOLIFY_API_KEY, etc.).
# Override path via AISHA_PROD_BACKUP_FILE — testy mohou nastavit na /dev/null
# aby doctor neložil real production creds.
# Bez výslovného přepisu platí záloha, kterou cold-start předává (ENV_PROD_BACKUP): doktor
# má měřit TENTÝŽ soubor, ze kterého krok 2 bere vstupy — ne záložní soubor v kořeni stromu,
# ze kterého zrovna běží (ne-produkční prostředí, běh z jiného pracovního stromu).
PROD_BACKUP_FILE="${AISHA_PROD_BACKUP_FILE:-${ENV_PROD_BACKUP:-$REPO_ROOT/.env-prod-backup}}"
# ⛔ NAMĚŘENO 2026-10-04 (fork, suchý běh nad W1): `set -a; . zaloha` holou hodnotu
# s `|` nebo mezerou zčásti VYKONAL — do logu šlo „<kus hodnoty>: command not found“
# (kus tokenu Coolify, slovo mnemoniky), a u `$`/`` ` `` by doktor četl jinou hodnotu
# než krok 2. Záloha se proto čte týmž čtenářem jako v cold-startu
# (pre_resolve_load_env → load_env_file_keys … overwrite): nic se nevykoná, hodnota
# je doslova, řídicí proměnné běhu ze souboru nepřijdou.
# shellcheck source=scripts/lib/env-file-keys.sh
. "$REPO_ROOT/scripts/lib/env-file-keys.sh"
if [[ -f "$PROD_BACKUP_FILE" ]] && [[ "$PROD_BACKUP_FILE" != "/dev/null" ]]; then
  load_env_file_keys "$PROD_BACKUP_FILE" "overwrite"
fi

# Credentials the vault does not hold: fill from the canonical chain.
#
# .env-prod-backup carries the GENERATED secrets (that is what the reverse-sync
# reconstructs). Operator credentials — the Coolify and Forgejo tokens — are not
# generated, so they legitimately live in .env.coolify and never appear there.
# Sourcing only the vault therefore reported "FORGEJO_TOKEN empty" while the
# token sat in .env.coolify, blocking a wipe on a condition that was not true.
#
# A doctor must diagnose what the toolchain will ACTUALLY see, so it reads the
# same chain every other tool now reads. Only fills what is still unset, so an
# explicit export or the vault keeps precedence.
# shellcheck source=scripts/lib/coolify-credentials.sh
if [[ -f "$REPO_ROOT/scripts/lib/coolify-credentials.sh" ]] && [[ "$PROD_BACKUP_FILE" != "/dev/null" ]]; then
  . "$REPO_ROOT/scripts/lib/coolify-credentials.sh"
  for _k in FORGEJO_TOKEN FORGEJO_API_TOKEN COOLIFY_API_TOKEN COOLIFY_API_KEY COOLIFY_URL COOLIFY_PROJECT_UUID; do
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
  # nounset off while sourcing: the overlay may reference vault vars (FORGEJO_URL)
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

  if [[ -n "${COOLIFY_URL:-}" && -n "${!url_var:-}" && "$COOLIFY_URL" != "${!url_var}" ]]; then
    fail "COOLIFY_URL conflicts with AISHA_ENV=$AISHA_ENV ($COOLIFY_URL != ${!url_var})"
    return 1
  fi
  export COOLIFY_URL="${COOLIFY_URL:-${!url_var:-}}"
  export COOLIFY_BASE_URL="${COOLIFY_BASE_URL:-$COOLIFY_URL}"
  export COOLIFY_PROJECT_UUID="${COOLIFY_PROJECT_UUID:-${!project_var:-}}"
  # Táž odpověď jako cold-start: UUID z prefixované deklarace pro KAŽDÝ slot
  # registru (lib/sloty-serveru.mjs), ne pro opsané tři.
  local _sloty _slot _cil _zdroj
  if ! _sloty="$(node "$REPO_ROOT/scripts/lib/sloty-serveru.mjs" --vsechny 2>&1)"; then
    fail "Sloty registru coolify/servers.json nejdou přečíst — UUID serverů z prostředí NEZMĚŘENA: ${_sloty}"
    return 1
  fi
  for _slot in $_sloty; do
    _cil="COOLIFY_SERVER_UUID_$(printf '%s' "$_slot" | tr '[:lower:]' '[:upper:]')"
    _zdroj="${prefix}SERVER_UUID_$(printf '%s' "$_slot" | tr '[:lower:]' '[:upper:]')"
    export "${_cil}=${!_cil:-${!_zdroj:-}}"
  done
}

resolve_target_env || true

# Profil instance pro odvození umístění (přepis z profilu — např. model forku na GPU
# slotu). Táž odpověď všude v doktoru: prostředí, jinak deklarace v souboru
# prostředí doktora. Prázdné = umístění z katalogu.
profil_instance() {
  local p="${AISHA_PROFILE:-}"
  [[ -z "$p" && -f "$DOKTOR_ENV_SOUBOR" ]] && \
    p="$(grep -E '^AISHA_PROFILE=' "$DOKTOR_ENV_SOUBOR" | head -1 | cut -d= -f2- | tr -d '"')"
  printf '%s' "$p"
}

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
  FORGEJO_TOKEN="${FORGEJO_TOKEN:-}"
  FORGEJO_API_TOKEN="${FORGEJO_API_TOKEN:-}"

  coolify_val="$COOLIFY_API_KEY"
  [[ -z "$coolify_val" ]] && coolify_val="$COOLIFY_API_TOKEN"
  if [[ -n "$coolify_val" ]]; then
    ok "COOLIFY_API_KEY present (${#coolify_val} chars)"
  else
    fail "COOLIFY_API_KEY (alias COOLIFY_API_TOKEN) empty — bez něj nelze volat Coolify API → cold-start step 1 (safety check) okamžitě failuje"
  fi

  # FORGEJO_TOKEN with FORGEJO_API_TOKEN alias fallback
  forgejo_val="$FORGEJO_TOKEN"
  [[ -z "$forgejo_val" ]] && forgejo_val="$FORGEJO_API_TOKEN"
  if [[ -n "$forgejo_val" ]]; then
    ok "FORGEJO_TOKEN present (${#forgejo_val} chars)"
  else
    fail "FORGEJO_TOKEN empty — drives git clone v Coolify; bez něj wave deploy padne na 401 a docker_compose_raw zůstane null"
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
  #
  # Které sloty: ty V PROVOZU (lib/sloty-serveru.mjs) — tytéž, které cold-start po
  # discovery vyžaduje; ne opsaný výčet tří.
  _uuid_override=0
  _hostnames=""
  _sloty_vstupu=""
  if ! _sloty_vstupu="$(node "$REPO_ROOT/scripts/lib/sloty-serveru.mjs" --v-provozu --profil "$(profil_instance)" 2>&1)"; then
    fail "Sloty v provozu nejdou odvodit — vstupy identity serverů NEZMĚŘENY: ${_sloty_vstupu}"
    _sloty_vstupu=""
  fi
  for _slot in $(printf '%s\n' "$_sloty_vstupu" | tr '[:lower:]' '[:upper:]'); do
    _uv="COOLIFY_SERVER_UUID_${_slot}"
    _hv="${_slot}_HOSTNAME"
    [[ -n "${!_uv:-}" ]] && _uuid_override=1
    [[ -n "${!_hv:-}" ]] && _hostnames="${_hostnames:+$_hostnames }${_slot}=${!_hv}"
  done
  unset _slot _uv _hv
  if [[ -n "$_hostnames" ]]; then
    ok "Server hostnames set (${_hostnames}) — Coolify server UUIDs auto-discovered from /servers (verified in Phase F)"
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

  if [[ "$STACK_EXISTS" == "1" && ! -s "$DOKTOR_ENV_SOUBOR" ]]; then
    # Nad existujícím stackem je minulý soubor VSTUP kroku 2 (kontinuita držených hodnot
    # a pinů, převzetí tajemství) — a je to vlastnost stromu, ne instance. Bez něj krok 2
    # zastaví (kontinuita-env.mjs, kód 4); doktor to má říct dřív než běh.
    fail "Existující stack, ale minulý ${DOKTOR_ENV_SOUBOR##*/} v tomto stromu chybí nebo je prázdný — kontinuita držených hodnot a pinů NEMĚŘENA, krok 2 soubor nezapíše. Konverguj ze stromu, který drží soubor z posledního běhu této instance."
  elif [[ ! -f "$DOKTOR_ENV_SOUBOR" ]]; then
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

  # ⛔ ODMÍTNUTÁ TAJEMSTVÍ (2026-10-03, konvergence existující instance). generate-secrets
  # nad existujícím stackem ODMÍTNE vyrobit stavové tajemství, pro které nemá vstup, a
  # cold-start padne až v kroku 2 — po preflightu, který hlásil „contract complete“
  # (smlouva bere klíč, který krok 2 vyrobí, za doplnitelný). Tady se generátor pustí
  # se stejnými vstupy jako v kroku 2, ale BEZ ZÁPISU: stdout (hodnoty) se zahodí,
  # měří se jen jeho verdikt.
  #
  # Lane modelového meshe (MODEL_MESH) rozhoduje, zda jsou jeho tajemství vůbec ve hře —
  # zavřená lane ("") je generátor nevyrábí ani nevyžaduje. Pod cold-startem ji doktor
  # dědí z topologie zdrojované s `set -a`; samostatný běh si ji vezme z TÉŽE derivace.
  # Bez ní generátor fail-closed odmítl NETBIRD_MODEL_* i tam, kde lane není (falešný
  # FATAL, 2026-10-06). Topologie, která řádek nevydá, nechá lane neodvozenou → odmítne.
  # ⛔ EXISTENCE STACKU MODELOVÉHO MESHE SE MĚŘÍ (naměřeno 2026-10-06, suchý běh první
  # konvergence s otevřenou lane): bez měření byla tajemství NETBIRD_MODEL_* stavová →
  # generátor je odmítl → FATAL, i když stack ještě nestojí a krok 2 je poprvé VYROBÍ
  # (cold-start existenci měří: aplikace netbird-model v rozsahu projektu). Falešný FATAL
  # by zastavil první konvergenci KAŽDÉ instance s otevřenou lane. Doktor proto klade
  # tutéž otázku jen čtením (coolify-project-scope --list-apps); nejde-li změřit (bez sítě,
  # bez API, chyba) → prázdné = nezměřeno → generátor fail-closed odmítne jako dřív.
  if [[ "$STACK_EXISTS" == "1" ]]; then
    _gs_err="$(mktemp)"
    (
      if [[ -z "${MODEL_MESH+x}" ]]; then
        _gs_mm="$(AISHA_PROFILE="$(profil_instance)" node "$REPO_ROOT/scripts/lib/derive-domains.mjs" --shell 2>/dev/null | grep -E '^MODEL_MESH=' | tail -1)"
        if [[ -n "$_gs_mm" ]]; then
          _gs_mm="${_gs_mm#MODEL_MESH=}"; _gs_mm="${_gs_mm#\'}"; export MODEL_MESH="${_gs_mm%\'}"
        fi
      fi
      _gs_mm_stack=""
      _gs_prefix="${APP_NAME_PREFIX:-${AISHA_STORY:-}}"
      _gs_token="${COOLIFY_API_KEY:-${COOLIFY_API_TOKEN:-}}"
      if [[ -n "${MODEL_MESH:-}" && "$NO_NETWORK" -eq 0 && -n "${COOLIFY_URL:-}" && -n "$_gs_token" && -n "$_gs_prefix" ]]; then
        if _gs_apps="$(COOLIFY_URL="$COOLIFY_URL" COOLIFY_API_TOKEN="$_gs_token" COOLIFY_PROJECT_UUID="${COOLIFY_PROJECT_UUID:-}" \
            node "$REPO_ROOT/scripts/lib/coolify-project-scope.mjs" --list-apps --name-re="^${_gs_prefix}-netbird-model\$" 2>/dev/null)"; then
          if [[ -n "$_gs_apps" ]]; then _gs_mm_stack=1; else _gs_mm_stack=0; fi
        fi
      fi
      node "$REPO_ROOT/scripts/generate-secrets.mjs" --env-coolify="$DOKTOR_ENV_SOUBOR" \
        --env-backup="$PROD_BACKUP_FILE" --preserve=1 --strength-floor=0 --stack-exists=1 \
        --model-mesh-stack-exists="$_gs_mm_stack"
    ) >/dev/null 2>"$_gs_err"
    _gs_rc=$?
    if [[ "$_gs_rc" -eq 0 ]]; then
      ok "generate-secrets nad existujícím stackem nic neodmítne (běh bez zápisu)"
    elif grep -q 'ODMÍTÁM' "$_gs_err"; then
      _gs_klice="$(sed -n 's/^[[:space:]]*Dotčené klíče:[[:space:]]*//p' "$_gs_err" | sed -n '1p')"
      [ -n "$_gs_klice" ] || _gs_klice="výčet klíčů generátor nevypsal"
      fail "generate-secrets ODMÍTNE stavová tajemství bez vstupu (${_gs_klice}) — cold-start by spadl v kroku 2. Klíč, na kterém nezávisí data → STATELESS_KEYS (kód); jinak hodnotu doplnit do .env-prod-backup"
    else
      warn "generate-secrets bez zápisu skončil rc=$_gs_rc — odmítnutá tajemství NEZMĚŘENA: $(grep -v '^[[:space:]]*at ' "$_gs_err" | grep -E 'FATAL|Error|⛔' | sed -n '1p' | cut -c1-160)"
    fi
    rm -f "$_gs_err"
  fi

  # Hodnoty operátora jen v živém .env.coolify (2026-10-03): druhy `external` a
  # `placeholder` se znovu vyrobit nedají. Když je záloha nenese, krok 2 je převezme
  # z minulého .env.coolify (aisha-cold-start.sh), ale jediná kopie pak leží v
  # generovaném souboru — patří do zálohy operátora. Jen jména, nikdy hodnoty.
  if [[ "$STACK_EXISTS" == "1" && -f "$DOKTOR_ENV_SOUBOR" ]]; then
    _jen_live="$(node "$REPO_ROOT/scripts/aisha-env-doctor.mjs" --print-contract-keys 2>/dev/null \
      | awk -F'\t' '$2 == "external" || $2 == "placeholder" { print $1 }' \
      | awk -F= -v zaloha="$PROD_BACKUP_FILE" '
          BEGIN { while ((getline r < zaloha) > 0) { split(r, p, "="); if (length(r) > length(p[1]) + 1) vzal[p[1]] = 1 } }
          NR == FNR { druh[$1] = 1; next }
          ($1 in druh) && length($0) > length($1) + 1 && !($1 in vzal) { print $1 }' - "$DOKTOR_ENV_SOUBOR" | sort -u | tr '\n' ' ')"
    # JWT_SECRET je bezstavový vůči svazkům, ale service JWT jím podepsané může držet
    # někdo MIMO instanci (trezor jiné instance, fork). Vyrobit ho znovu nad existujícím
    # stackem smí jen obsluha vědomě — doktor na to upozorní dřív než krok 2.
    if ! grep -qE '^JWT_SECRET=.+' "$DOKTOR_ENV_SOUBOR" 2>/dev/null && ! grep -qE '^JWT_SECRET=.+' "$PROD_BACKUP_FILE" 2>/dev/null; then
      warn "JWT_SECRET chybí v .env.coolify i v záloze — krok 2 ho vyrobí ZNOVU a service JWT držené mimo instanci přestanou platit (vědomé rozhodnutí obsluhy)"
    fi
    if [[ -n "$_jen_live" ]]; then
      warn "Hodnoty operátora jen v .env.coolify, záloha je nenese (krok 2 je převezme): ${_jen_live}— doplň je do .env-prod-backup"
    else
      ok "Hodnoty operátora (external/placeholder) z .env.coolify nese i záloha"
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
        # ⛔ ČTVRTÁ SLOŽKA KROKU 2: DISCOVERY (naměřeno 2026-10-06, suchý běh první
        # konvergence s otevřenou lane modelového meshe). Krok 2 cold-startu má před
        # generátorem ještě výstup discovery — adresu uzlu edge (PUBLIC_EDGE_HOST_ADDR),
        # ze které generátor skládá MODEL_MESH_VSTUP_ADDR. V trezoru není (pozorování,
        # ne deklarace), takže bez ní simulace vydala prázdnou adresu a doktor ohlásil
        # tvrdý fail mostu a řídicí roviny modelového meshe u běhu, který by prošel.
        # Pod cold-startem ji doktor dědí (cold-start ji po discovery exportuje);
        # samostatně si ji zjistí TOUTÉŽ discovery jen čtením (bez --env-coolify nic
        # nezapíše, COOLIFY_AUTO_CREATE_PROJECT=0 nic nezaloží). Bez sítě nebo API
        # zůstane prázdná — a fail níž pak říká pravdu: krok 2b by bez ní spadl taky.
        # Brána: discovery-dojde-do-deti.
        _fresh_edge="${PUBLIC_EDGE_HOST_ADDR:-}"
        _fresh_api_token="${COOLIFY_API_KEY:-${COOLIFY_API_TOKEN:-}}"
        if [[ -z "$_fresh_edge" && "$NO_NETWORK" -eq 0 && -n "${COOLIFY_URL:-}" && -n "$_fresh_api_token" ]]; then
          _fresh_pin=""
          pb_je_prod "${AISHA_ENV:-}" || _fresh_pin="${COOLIFY_PROJECT_UUID:-}"
          _fresh_edge="$(COOLIFY_BASE_URL="$COOLIFY_URL" COOLIFY_API_TOKEN="$_fresh_api_token" COOLIFY_AUTO_CREATE_PROJECT=0 AISHA_PROJEKT_PIN="$_fresh_pin" \
            node "$REPO_ROOT/scripts/generate-coolify-context.mjs" --preserve=0 2>/dev/null \
            | sed -n "s/^PUBLIC_EDGE_HOST_ADDR='\([^']*\)'\$/\1/p" | tail -1)" || _fresh_edge=""
          [[ -n "$_fresh_edge" ]] || info "adresa edge pro čerstvý env NEZJIŠTĚNA (discovery bez výstupu) — MODEL_MESH_VSTUP_ADDR zůstane prázdný jako v kroku 2b"
          unset _fresh_pin
        fi
        unset _fresh_api_token
        PUBLIC_EDGE_HOST_ADDR="$_fresh_edge" node "$REPO_ROOT/scripts/generate-secrets.mjs" \
          --env-coolify="$DOKTOR_ENV_SOUBOR" \
          --env-backup="${ENV_PROD_BACKUP:-}" \
          --preserve=1 \
          --netbird-mgmt-host="${NETBIRD_MGMT_HOST:-}" \
          --mesh-tld="${MESH_TLD:-}" \
          --forgejo-org="${AISHA_FORGEJO_ORG:-${APP_NAME_PREFIX:-${AISHA_STORY:-}}}" \
          --nocodb-admin-email="${NOCODB_ADMIN_EMAIL:-${SMTP_ADMIN_EMAIL:-}}" \
          >>"$_fresh_env" 2>/dev/null || true
      fi
      # Kód 3 = env-doktor WEB_FQDNS (domény webu) nezná — samostatný běh nad
      # čerstvým souborem ho bez cold-startu znát nemá; ostatní klíče zapsal a
      # compose WEB_FQDNS nečte, takže validaci compose to nebrání.
      _fresh_rc=0
      ENV_FILE="$_fresh_env" node "$REPO_ROOT/scripts/aisha-env-doctor.mjs" >/dev/null 2>&1 || _fresh_rc=$?
      if [[ "$_fresh_rc" -eq 0 || "$_fresh_rc" -eq 3 ]]; then _fresh_ok=1; fi
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

  # ⛔ UMÍSTĚNÍ manifest × profil (naměřeno 2026-10-03 při konvergenci instance forku): rozpor u 8 služeb
  # zastavil cold-start až v KROKU 4 (coolify-sync-envs) — po zápisu env do Coolify
  # a po založení nové aplikace. Tatáž kontrola (assert_placement_agrees) tady,
  # nad umístěním ČERSTVĚ odvozeným z profilu, ne ze starého .env.coolify.
  if [[ -f "$MANIFEST" ]]; then
    _um_profil="$(profil_instance)"
    # Mimo instanci (CI, čerstvý checkout) .env.coolify není — brány opt-in služeb pak
    # nejdou vyhodnotit. Neměří se nic méně, než co jde: povinné služby nad PRÁZDNOU
    # deklarací (opt-in vypadnou z mapy) a výsledek to výslovně říká.
    _um_env="$DOKTOR_ENV_SOUBOR"; _um_pozn=""
    if [[ ! -f "$_um_env" ]]; then
      _um_env="$(mktemp)"; _um_pozn=" (bez ${DOKTOR_ENV_SOUBOR##*/}: opt-in služby NEMĚŘENY)"
    fi
    _um_rc=0
    _um_out="$(AISHA_PROFILE="$_um_profil" ENV_FILE="$_um_env" bash "$REPO_ROOT/scripts/lib/umisteni-souhlasi.sh" "$MANIFEST" 2>&1)" || _um_rc=$?
    [[ -n "$_um_pozn" ]] && rm -f "$_um_env"
    case "$_um_rc" in
      0) ok "$(printf '%s' "$_um_out" | tail -1)${_um_pozn}" ;;
      1) fail "umístění: rozpor (manifest × profil, nebo služba na slotu, kam nesmí) — cold-start by se zastavil až PO zápisu env:"
         printf '%s\n' "$_um_out" | sed 's/^/      /' ;;
      *) fail "umístění manifest × profil NEMĚŘENO: $(printf '%s' "$_um_out" | tr '\n' ' ' | cut -c1-300)" ;;
    esac
    unset _um_profil _um_rc _um_out _um_env _um_pozn
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
    # Jednou, ne pro každý soubor; selže-li čtení, varianta se ohlásí jako sirotek (nahlas).
    _varianty_compose="$(node "$REPO_ROOT/scripts/lib/compose-varianty.mjs" 2>/dev/null | tr '\n' ' ')"
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
      # Varianta compose podle slotu (katalog `compose_gpu`) není aplikace: nasazuje ji aplikace
      # služby, která ji nese (lib/compose-varianty.mjs — týž výklad jako generátor manifestu).
      case " ${_varianty_compose-} " in *" $base "*) continue ;; esac
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

  # ── DEKLARACE NASAZENÍ × PROSTŘEDÍ: TÝŽ VERDIKT JAKO KROK 2b2 A STORY-INIT ──
  # ⛔ Recenze 2026-10-04: `GIT_BRANCH` v prostředí odlišný od větve manifestu znal
  # jen story-init (krok 3). Běh prošel doktorem i krokem 2b2 a zastavil se až PO
  # kroku 2c (odložený wipe) — instance smazaná, aplikace nezaložené. Rozpor proto
  # pozná vykladač sám (lib/nasazovany-repozitar.mjs čte GIT_BRANCH z prostředí)
  # a ptají se ho všichni tři: tady v kroku 0, krok 2b2 před wipem i story-init.
  #
  # Volá se `--vyklad --tvrdi-prostredi`, ne `--deklarace`: porovnání s prostředím
  # je TÁŽ funkce, ale `--deklarace` chce navíc adresu Forgeja — a tu samostatný
  # doktor mít nemusí (fáze G ji umí odvodit z remote). Chybějící adresa není
  # rozpor deklarace; zastavit na ní tenhle krok by byl nález o něčem jiném.
  if [[ -f "$MANIFEST" ]]; then
    _dn_rc=0
    _dn_chyby="$(mktemp)"
    _dn="$(node "$REPO_ROOT/scripts/lib/nasazovany-repozitar.mjs" --manifest "$MANIFEST" --vyklad --tvrdi-prostredi 2>"$_dn_chyby")" || _dn_rc=$?
    if [[ "$_dn_rc" -eq 0 ]]; then
      IFS=$'\t' read -r _dn_vetev _dn_repo <<< "$_dn"
      ok "deklarace nasazení: ${_dn_repo}, větev ${_dn_vetev} — prostředí jí neodporuje"
    else
      fail "deklarace nasazení nejde použít (kód ${_dn_rc}): $(tr '\n' ' ' < "$_dn_chyby")— cold-start by se na tom zastavil v kroku 2b2, story-init v kroku 3."
    fi
    rm -f "$_dn_chyby"
    unset _dn _dn_rc _dn_chyby _dn_vetev _dn_repo
  fi

  # ── DEPLOY VĚTEV: ODCHYLKA MUSÍ NÉST DŮVOD ────────────────────────────────
  # Výklad i měření žijí v jednom domově (brána ho spouští nad dočasnými repy).
  # shellcheck source=lib/deploy-vetev-odchylka.sh
  . "$SCRIPT_DIR/lib/deploy-vetev-odchylka.sh"
  deploy_vetev_odchylka "$REPO_ROOT" "$MANIFEST"

  # ── DEKLAROVANÉ DRŽENÍ APLIKACÍ: co studený start VYNECHÁ, a jestli to vůbec ví ──
  # ⛔ ZMĚŘENO ČTENÍM 2026-10-04: deklaraci držení (overlay instance,
  # nasazeni-drzene.json) ctilo jen nasazení z CI; studený start ji nečetl a drženou
  # aplikaci by přenasadil. Teď ji čte jako první věc — a nečitelnou nebo neplatnou
  # deklarací SKONČÍ dřív, než se čehokoli dotkne. Doktor to má říct předem:
  # držené aplikace vypíše (informace, ne nález), neplatnou deklaraci hlásí jako FAIL.
  # Čte TÝŽ domov jako cold-start (lib/nasazeni-drzene.mjs přes lib/drzeni.sh).
  #
  # Overlay si domov obstará sám — cestou z prostředí, jinak klonem (síť). S
  # --no-network se proto měří jen to, co jde bez sítě; „NEMĚŘENO“ se řekne.
  # shellcheck source=lib/drzeni.sh
  . "$SCRIPT_DIR/lib/drzeni.sh"
  if [[ "$NO_NETWORK" -eq 1 && -z "${AISHA_INSTANCE_CONFIG_DIR:-}" && -n "${AISHA_INSTANCE_DATA_GIT_URL:-}" ]]; then
    info "držení aplikací NEMĚŘENO (--no-network): overlay instance je deklarovaný a bez sítě ho nezískám — cold-start si deklaraci přečte sám"
  else
    _dr_chyby="$(mktemp)"
    if drzeni_nacti "cold-start-doctor" 2>"$_dr_chyby"; then
      if [[ -z "$DRZENI_APLIKACE" ]]; then
        ok "držení aplikací: ${DRZENI_POPIS}"
      else
        ok "držení aplikací: deklarace je platná — ${DRZENI_POPIS}"
        while IFS= read -r _dr_hlaska; do
          [[ -n "$_dr_hlaska" ]] || continue
          info "  ${_dr_hlaska}. Cold-start ji nezaloží, nesrovná, nedoručí jí env, nenasadí, nerestartuje ani nesmaže."
        done <<< "$(drzeni_vypis)"
      fi
    else
      fail "deklarace držení aplikací je NEČITELNÁ nebo NEPLATNÁ — cold-start by skončil dřív, než se čehokoli dotkne (nevíme, co je drženo = nevíme, co smíme nasadit): $(tr '\n' ' ' < "$_dr_chyby" | cut -c1-600)"
    fi
    rm -f "$_dr_chyby"
    unset _dr_chyby _dr_hlaska
  fi
fi

# ── Čeká deklarace instance měření uzlu s firewallem? (P1, re-recenze 2 d8) ────
# Ano, když je otevřená lane firewallu hostitele — provision_when_env služby
# accel-hostfw v katalogu (SLUZBA_FIREWALLU v lib/vnejsi-expozice.mjs), výklad jeden:
# lib/provision-gate.mjs --zapnuto. Pak řádek „· není co měřit“ kód 0 nedoloží.
# Nezjištěno (kód 2 nástroje) = čeká (fail-closed): nevím-li, nesmí `·` projít.
#   uzel_s_firewallem_deklarovan  → vypíše 1 | 0
uzel_s_firewallem_deklarovan() {
  local rc=0 out args=(--zapnuto accel-hostfw)
  [[ -f "$DOKTOR_ENV_SOUBOR" ]] && args+=(--env-file "$DOKTOR_ENV_SOUBOR")
  out="$(node "$REPO_ROOT/scripts/lib/provision-gate.mjs" "${args[@]}" 2>/dev/null)" || rc=$?
  # Zavřená lane = kód 1 A na stdout klíče podmínky. Kód 1 bez nich je pád nástroje
  # (Node končí kódem 1 i při chybějícím modulu) — to není „nečeká", ale „nevím".
  case "$rc" in
    0) echo 1 ;;
    1) if [[ -n "${out//[[:space:]]/}" ]]; then echo 0; else echo 1; fi ;;
    *) echo 1 ;;
  esac
}

# ── Verdikt proxy serveru z KÓDU nástroje a ze ZÁMĚRU běhu ───────────────────
# Fáze F: `coolify-server-proxy.mjs` (jen čtení) → ok/warn/fail. Rozhoduje
# návratový kód nástroje, řádky výpisu se jen přepisují.
#   0 — typ proxy v API sedí s deklarací slotu (✓); řádky `· ` nesou i upozornění,
#       že typ v API není důkaz o kontejneru (to měří fáze V na uzlu), nebo říkají,
#       proč není co měřit (žádný slot v provozu proxy nedeklaruje).
#       Kód 0 je TVRZENÍ a výpis ho musí DOLOŽIT. ⛔ NAMĚŘENO 2026-10-05 (re-recenze
#       d8, R3): nástroj, který skončil 0 a nic nevypsal, nedal ok ani varování —
#       ticho. Proto: bez jediného řádku `✓ `/`· ` (ticho), nebo s řádkem `✗ `/`? `
#       (kód a výpis si odporují) je to NEZMĚŘENO jako kód 3. `· ` se počítá jako
#       doklad, protože jím nástroj říká, PROČ není co měřit — doslovné „žádný
#       řádek ✓/✗/? = NEZMĚŘENO" by z každé instance bez slotu s proxy udělalo
#       NEZMĚŘENO, a tím (R2) FAIL samostatného doktoru.
#       ⛔ Podmínka rady (re-recenze 2 d8, P1): `· ` je doklad JEN tehdy, když deklarace
#       měření NEČEKÁ. Deklaruje-li instance uzel s firewallem (4. argument „1“ —
#       uzel_s_firewallem_deklarovan), kód 0 jen s řádky `· ` je NEZMĚŘENO: chyba, která
#       vyprázdní seznam slotů, by se jinak ukázala jako „není co měřit“ a prošla,
#   2 — rozdíl: samostatný doktor FAIL. V předletu cold-startu hlasité varování —
#       stav sdíleného serveru předlet nezastavuje: `srovna` = tenhle běh typ
#       nastaví (krok 4c), `nemeni` = ne-produkční běh, srovná ho produkční,
#   3 — NEZMĚŘENO, NIKDY ok. ⛔ NAMĚŘENO 2026-10-05 (re-recenze d8, R2): samostatný
#       doktor dával rozdílu (2) FAIL a NEZMĚŘENÉMU stavu jen varování — pořadí
#       přísnosti obrácené: nezměřený stav nesmí projít snáz než změřený rozdíl.
#       Proto samostatný doktor FAIL; v předletu cold-startu hlasité varování (krok
#       4c produkčního cold-startu typ zapíše a ověří, nebo běh skončí nedokončeně;
#       ne-produkční běh server nemění a varuje),
#   jiný — vadná deklarace nebo čtení selhalo: FAIL.
#   proxy_serveru_verdikt <výpis nástroje> <kód> <předlet: "" | srovna | nemeni> [<čeká měření: 1 | 0>]
proxy_serveru_verdikt() {
  local radek kod="$2" doklad=0 jen_info=0 rozpor=0 proc=""
  if [[ "$kod" == "0" ]]; then
    while IFS= read -r radek; do
      case "$radek" in
        "✓ "*) doklad=1 ;;
        "· "*) if [[ "${4:-}" == "1" ]]; then jen_info=1; else doklad=1; fi ;;
        "✗ "*|"? "*) rozpor=1 ;;
      esac
    done <<< "$1"
    if [[ "$rozpor" -eq 1 ]]; then
      kod=3; proc="nástroj skončil kódem 0, ale výpis nese nález nebo NEZMĚŘENO — kód a výpis si odporují"
    elif [[ "$doklad" -eq 0 && "$jen_info" -eq 1 ]]; then
      kod=3; proc="instance deklaruje uzel s firewallem, a nástroj přesto vrátil kód 0 jen s „není co měřit“ (·) — deklarace měření čeká"
    elif [[ "$doklad" -eq 0 ]]; then
      kod=3; proc="nástroj skončil kódem 0 a nevypsal jediný řádek výsledku — ticho není shoda"
    fi
  fi
  case "$kod" in
    0) while IFS= read -r radek; do
         case "$radek" in "✓ "*) ok "Proxy serveru: ${radek#✓ }" ;; "· "*) info "Proxy serveru: ${radek#· }" ;; esac
       done <<< "$1" ;;
    2) case "$3" in
         srovna) warn "Proxy serveru se liší od deklarace slotu — tenhle běh ji nastaví (krok 4c cold-startu, coolify-server-proxy.mjs --apply):" ;;
         nemeni) warn "Proxy serveru se liší od deklarace slotu — tenhle běh sdílený server nemění; srovná ho produkční běh (krok 4c cold-startu):" ;;
         *) fail "Proxy serveru se liší od deklarace slotu a nikdo ji teď nesrovná — srovná ji produkční cold-start (krok 4c) nebo: node scripts/coolify-server-proxy.mjs --apply" ;;
       esac
       printf '%s\n' "$1" | grep -E '^✗' | sed 's/^/      /' || true ;;
    3) case "$3" in
         srovna|nemeni) warn "Proxy serveru NEZMĚŘENA — to není shoda${proc:+ (${proc})}; produkční cold-start ji v kroku 4c zapíše a ověří, nebo skončí nedokončeně (ne-produkční běh sdílený server nemění):" ;;
         *) fail "Proxy serveru NEZMĚŘENA — to není shoda${proc:+ (${proc})} a samostatný doktor ji nepustí (nezměřený stav není měkčí než rozdíl) — změř znovu, nebo ji srovná produkční cold-start (krok 4c) či: node scripts/coolify-server-proxy.mjs --apply" ;;
       esac
       printf '%s\n' "$1" | grep -E '^(\?|✗) ' | sed 's/^/      /' || true ;;
    *) fail "Proxy serveru: deklarace nebo čtení selhalo (kód $2): $(printf '%s' "$1" | grep -E '^✗' | tr '\n' ' ' | cut -c1-300)" ;;
  esac
}

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
      # Měří se sloty V PROVOZU (lib/sloty-serveru.mjs), ne opsaný výčet — tytéž,
      # které cold-start po discovery vyžaduje. Volitelný slot (GPU uzel `gpu`)
      # se tak měří právě tehdy, když na něj instance něco nasazuje (lane, nebo
      # přepis umístění v profilu).
      if [[ -n "$disc" ]]; then
        if ! _sloty_v_provozu="$(node "$REPO_ROOT/scripts/lib/sloty-serveru.mjs" --v-provozu --profil "$(profil_instance)" 2>&1)"; then
          fail "Slot discovery NEZMĚŘENA — sloty v provozu nejdou odvodit: ${_sloty_v_provozu}"
          _sloty_v_provozu=""
        fi
        for slot in $(printf '%s\n' "$_sloty_v_provozu" | tr '[:lower:]' '[:upper:]'); do
          uuid=$(printf '%s\n' "$disc" | sed -n "s/^COOLIFY_SERVER_UUID_${slot}='\([^']*\)'.*/\1/p" | head -1)
          hostvar="${slot}_HOSTNAME"
          if [[ -n "$uuid" ]]; then
            ok "Slot discovery: ${slot} (${!hostvar:-name-match}) → ${uuid:0:12}…"
          else
            fail "Slot discovery: ${slot} unresolved — ${hostvar}='${!hostvar:-}' matches no Coolify server name/ip → cold-start can't place ${slot} apps"
          fi
        done
        # ── Přesun existující aplikace na jiný server (kontrakt d8 U3) ─────────
        # Změna umístění (přepis v profilu → manifest) se u EXISTUJÍCÍ aplikace
        # nepromítne: Coolify server mění jen při založení. Konvergence by prošla
        # zeleně a aplikace dál běžela jinde. Krok 0 to proto říká nahlas: držená
        # = DRŽENO (nic se nehýbe), ostatní = STOP s pojmenovanou cestou
        # (--rewarmup). Jen čtení: drift-check s UUID slotů z discovery výš.
        if [[ -f "$MANIFEST" ]]; then
          _pr_env=()
          while IFS= read -r _pr_radek; do
            [[ -n "$_pr_radek" ]] && _pr_env+=("$_pr_radek")
          done < <(printf '%s\n' "$disc" | sed -n "s/^\(COOLIFY_SERVER_UUID_[A-Z0-9_]*\)='\([^']*\)'.*/\1=\2/p")
          _pr_args=(--manifest "$MANIFEST")
          [[ "$WIPE_PLANNED" == "1" ]] && _pr_args+=(--planovany-wipe)
          [[ -n "$REWARMUP_PLANNED" ]] && _pr_args+=(--planovany-rewarmup "$REWARMUP_PLANNED")
          [[ -f "$DOKTOR_ENV_SOUBOR" ]] && _pr_args+=(--env-soubor "$DOKTOR_ENV_SOUBOR")
          _pr_rc=0
          # Token NE přes argumenty (`env VAR=…` je vidět v seznamu procesů) — exportem
          # v podprocesu. UUID slotů z discovery tajné nejsou.
          # `${a[@]+…}`: prázdné pole pod `set -u` v bash 3.2 (macOS operátora) jinak spadne.
          _pr_out="$(
            export COOLIFY_BASE_URL="$COOLIFY_URL" COOLIFY_API_TOKEN="$api_token"
            for _pr_kv in ${_pr_env[@]+"${_pr_env[@]}"}; do export "$_pr_kv"; done
            node "$REPO_ROOT/scripts/lib/presun-aplikaci.mjs" "${_pr_args[@]}" 2>&1
          )" || _pr_rc=$?
          case "$_pr_rc" in
            0) while IFS= read -r _pr_radek; do [[ -n "$_pr_radek" ]] && ok "$_pr_radek"; done <<< "$_pr_out" ;;
            1) fail "přesun aplikace čeká — konvergence by ji NEPŘESUNULA:"
               printf '%s\n' "$_pr_out" | sed -n 's/^STOP /      /p' ;;
            *) warn "přesun aplikací NEZMĚŘEN: $(printf '%s' "$_pr_out" | tr '\n' ' ' | cut -c1-300)" ;;
          esac
          unset _pr_env _pr_args _pr_rc _pr_out _pr_radek
        fi
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

      # Typ proxy SERVERU proti deklaraci slotu (`proxy` v coolify/servers.json) —
      # jen sloty v provozu, které proxy deklarují (GPU uzel `gpu`: none). Měří
      # TÝŽ nástroj, kterým cold-start před vlnami proxy srovná (--apply se zpětným
      # čtením). Verdikt dává proxy_serveru_verdikt výš: rozdíl i NEMĚŘENO (také
      # kód 0, který výpis nedoloží) jsou FAIL v samostatném doktoru a hlasité
      # varování v předletu cold-startu (--predlet-cold-startu); NEMĚŘENO nikdy ok.
      # Shoda typu v API přitom neříká, že proxy neběží — to měří fáze V.
      _px_rc=0
      _px_args=()
      [[ -f "$DOKTOR_ENV_SOUBOR" ]] && _px_args=(--env-soubor "$DOKTOR_ENV_SOUBOR")
      _px_out="$(COOLIFY_URL="$COOLIFY_URL" COOLIFY_API_TOKEN="$api_token" \
        node "$REPO_ROOT/scripts/coolify-server-proxy.mjs" ${_px_args[@]+"${_px_args[@]}"} 2>&1)" || _px_rc=$?
      proxy_serveru_verdikt "$_px_out" "$_px_rc" "$PREDLET_COLD_STARTU" "$(uzel_s_firewallem_deklarovan)"
      unset _px_rc _px_args _px_out
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

# ── Verdikt fáze V z DRUHU řádku a ze ZÁMĚRU běhu ───────────────────────────
# Výpis `vnejsi-expozice.mjs` → ok/warn/fail podle prefixu protokolu (✓ / ✗ / ? / ·).
# Jediné nálezy, o kterých rozhoduje záměr běhu, jsou nálezy NA UZLU z výpisu jeho
# kontejnerů — dva DRUHY, které vydává scripts/lib/kontejnery-uzlu.mjs (pozná se
# podle prefixu, ne podle věty za ním):
#   `✗ proxy na uzlu: `  kontejner proxy serveru publikuje porty (DRUH_NALEZU_PROXY),
#   `✗ port na uzlu: `   jiný kontejner publikuje port mimo loopback a mimo deklaraci
#                        uzlu (DRUH_NALEZU_PORTU; R1 re-recenze d8 — dřív se poznávala
#                        jen proxy podle jména).
# Oba jsou stav SDÍLENÉHO serveru, který předlet neodstraní (kontejner se nezastavuje;
# vlastní aplikace s vadným compose srovnají až vlny téhož běhu):
#   • samostatný doktor (bez záměru): FAIL,
#   • předlet cold-startu: HLASITÉ VAROVÁNÍ — `srovna` = tenhle (produkční) běh
#     uzel na konci změří znovu a skončí NEDOKONČENĚ; `nemeni` = ne-produkční běh
#     sdílený server nemění, ověří ho produkční běh.
# Všechny ostatní nálezy (otevřený port zvenku, vystavené UDP podle pravidla,
# neplatná deklarace firewallu) jsou FAIL v obou případech.
#
# Kód nástroje je TVRZENÍ a výpis ho musí doložit řádkem jeho druhu — jinak verdikt
# zůstane TICHÝ. ⛔ NAMĚŘENO 2026-10-05 (re-recenze d8, R3): nástroj, který skončil
# 0 a nic nevypsal, nedal ok ani varování. Proto po přečtení řádků:
#   0   bez jediného řádku (✓ ✗ ? ·)  → NEZMĚŘENO (varování). `· ` doklad JE: jím
#       sonda říká, proč není co měřit (lane firewallu zavřená) — ale JEN když deklarace
#       měření nečeká (P1, re-recenze 2 d8): s deklarovaným uzlem s firewallem (4. argument
#       „1“) je kód 0 bez ✓/✗/? NEZMĚŘENO,
#   1   bez řádku `✗ `                → FAIL (nález tvrzený, ale nejde posoudit, který),
#   2/3 bez řádku `? ` ani `✗ `       → NEZMĚŘENO (varování),
#   jiný                              → NEZMĚŘENO (varování) jako dosud.
#   vnejsi_expozice_verdikt <výpis nástroje> <kód> <předlet: "" | srovna | nemeni> [<čeká měření: 1 | 0>]
vnejsi_expozice_verdikt() {
  local radek co zbytek n_shoda=0 n_nalez=0 n_nezmereno=0 n_info=0
  while IFS= read -r radek; do
    case "$radek" in
      "✓ "*) ok "${radek#✓ }"; n_shoda=$((n_shoda+1)) ;;
      "✗ proxy na uzlu: "*|"✗ port na uzlu: "*)
        case "$radek" in
          "✗ proxy na uzlu: "*) co="PROXY NA UZLU PUBLIKUJE PORTY"; zbytek="${radek#✗ proxy na uzlu: }" ;;
          *) co="PORT NA UZLU PUBLIKOVANÝ MIMO DEKLARACI"; zbytek="${radek#✗ port na uzlu: }" ;;
        esac
        case "$3" in
          srovna) warn "Vnější expozice — ${co} (předlet cold-startu kvůli tomu nezastavuje; tenhle běh to na konci ověří a zapíše jako NEDOKONČENO): ${zbytek}" ;;
          nemeni) warn "Vnější expozice — ${co} (předlet cold-startu kvůli tomu nezastavuje; tenhle běh sdílený server nemění — ověří ho produkční běh): ${zbytek}" ;;
          *) fail "Vnější expozice: ${radek#✗ }" ;;
        esac
        n_nalez=$((n_nalez+1)) ;;
      "✗ "*) fail "Vnější expozice: ${radek#✗ }"; n_nalez=$((n_nalez+1)) ;;
      "? "*) warn "Vnější expozice NEMĚŘENO/varování: ${radek#\? }"; n_nezmereno=$((n_nezmereno+1)) ;;
      "· "*) info "${radek#· }"; n_info=$((n_info+1)) ;;
    esac
  done <<< "$1"
  case "$2" in
    0) if [[ "${4:-}" == "1" ]]; then
         # Deklarovaný uzel s firewallem: „není co měřit“ (·) doklad není (P1).
         [[ $((n_shoda + n_nalez + n_nezmereno)) -gt 0 ]] \
           || warn "Vnější expozice NEZMĚŘENA — instance deklaruje uzel s firewallem, a sonda přesto vrátila kód 0 bez jediného měření (jen ·); deklarace měření čeká"
       else
         [[ $((n_shoda + n_nalez + n_nezmereno + n_info)) -gt 0 ]] \
           || warn "Vnější expozice NEZMĚŘENA — sonda skončila kódem 0 a nevypsala jediný řádek výsledku; ticho není shoda"
       fi ;;
    1) [[ "$n_nalez" -gt 0 ]] \
         || fail "Vnější expozice: sonda hlásí nález (kód 1), ale výpis žádný řádek nálezu nenese — nález nejde posoudit: $(printf '%s' "$1" | tr '\n' ' ' | cut -c1-300)" ;;
    2|3) [[ $((n_nalez + n_nezmereno)) -gt 0 ]] \
         || warn "Vnější expozice NEZMĚŘENA (kód $2), ale výpis neříká, co změřit nešlo: $(printf '%s' "$1" | tr '\n' ' ' | cut -c1-300)" ;;
    *) warn "vnější expozice NEMĚŘENA (kód $2): $(printf '%s' "$1" | tr '\n' ' ' | cut -c1-300)" ;;
  esac
}

# ============================================================================
# Phase V — Vnější expozice uzlů s firewallem hostitele
# ============================================================================
#
# `ss` na uzlu neřekne, co je vidět z internetu (DNAT do kontejneru `ss` neukáže,
# naslouchající port za DROP není expozice). Měří se TCP connect odsud na IP uzlu
# z Coolify API — viz scripts/lib/vnejsi-expozice.mjs. Stanoviště musí znát svou
# ODCHOZÍ IP (AISHA_SONDA_ODCHOZI_IP, nebo AISHA_SONDA_ECHO_URL, která ji vrátí):
# z ní se odvodí, zda má být SSH 22 otevřený (CI runner odchází přes adresu správy),
# a pozná se hairpin (měření z CI VM na témže hostiteli = ne cizí síť → odmítnuto).
# Otevřený port mimo očekávání je FAIL; co změřit nešlo, je NEMĚŘENO (varování).
#
# Vnější pohled sám nestačí: firewall v `enforce` zakryje i běžící proxy serveru
# a sonda projde. Táž fáze proto měří i NA UZLU (scripts/lib/kontejnery-uzlu.mjs,
# `docker -H ssh://<hostname slotu>`, jen čtení): KAŽDÝ port publikovaný mimo
# loopback a mimo deklaraci uzlu (jediná výjimka UDP port meshe) — u kontejneru
# proxy serveru (typ `none` v API Coolify ho nezastaví) i u kteréhokoli jiného,
# TCP i UDP, v Coolify i mimo něj — je FAIL bez ohledu na režim firewallu (v předletu
# cold-startu jen hlasité varování — viz vnejsi_expozice_verdikt)
# a měřený stav firewallu rozhoduje o UDP portech, které publikují aplikace Coolify
# (MERENI/VRACENO = vystavené, FAIL; jediná výjimka je port meshe). Bez kotvy
# (kontejner firewallu ve výpisu — před jeho prvním nasazením chybí) a bez odpovědi
# dockeru je to NEMĚŘENO, nikdy ok. Port SSH do CI VM se měří z deklarace instance
# (ACCEL_CI_VM_SSH_PORT: číslo, nebo výslovné `zadna`); bez ní NEMĚŘENO.
if should_run_phase V && [[ "$NO_NETWORK" -eq 0 ]]; then
  phase V "Vnější expozice (uzly s firewallem hostitele)"
  _v_token="${COOLIFY_API_KEY:-${COOLIFY_API_TOKEN:-}}"
  _v_args=()
  [[ -f "$DOKTOR_ENV_SOUBOR" ]] && _v_args+=(--env-soubor "$DOKTOR_ENV_SOUBOR")
  [[ -n "${AISHA_SONDA_ODCHOZI_IP:-}" ]] && _v_args+=(--odchozi-ip "$AISHA_SONDA_ODCHOZI_IP")
  [[ -n "${AISHA_SONDA_ECHO_URL:-}" ]] && _v_args+=(--echo-url "$AISHA_SONDA_ECHO_URL")
  _v_rc=0
  _v_out="$(COOLIFY_URL="${COOLIFY_URL:-}" COOLIFY_API_TOKEN="$_v_token" \
    node "$REPO_ROOT/scripts/lib/vnejsi-expozice.mjs" ${_v_args[@]+"${_v_args[@]}"} 2>&1)" || _v_rc=$?
  vnejsi_expozice_verdikt "$_v_out" "$_v_rc" "$PREDLET_COLD_STARTU" "$(uzel_s_firewallem_deklarovan)"
  unset _v_token _v_args _v_rc _v_out
fi

# ============================================================================
# Phase G — Forgejo connectivity
# ============================================================================
if should_run_phase G && [[ "$NO_NETWORK" -eq 0 ]]; then
  phase G "Forgejo (git remote) connectivity"

  # Adresa Forgeja: deklarovaná má přednost; nedeklarovaná se ODVODÍ z gitového
  # původu tohohle stromu — z remote, který JE nasazovaný repozitář.
  #
  # ⛔ „DEKLAROVANÁ" MÁ JEDNO PRAVIDLO, NE DVĚ. Je to přesně to, z čeho story-init
  # skládá `git_repository`: FORGEJO_URL, jinak https://FORGEJO_DOMAIN — vydá ho
  # lib/nasazovany-repozitar.mjs --zaklad (bez údajů, jde do logu). Dokud doktor
  # znal jen FORGEJO_URL, měřil při deklarované doméně adresu odvozenou z remote,
  # zatímco story-init zapsal do Coolify doménu: dvě adresy pro touž otázku.
  #
  # PROČ ODVOZENÍ (naměřeno 2026-08-13 na instanci forku): dokud se čekala deklarace,
  # chyběla — a kontrola se „přeskočila" s warningem. Jenže Coolify staví VŠECH 37
  # aplikací té instance právě z toho Forgeja: nedosažitelnost není volitelný detail,
  # je to důvod, proč by celý cold-start postavil starý strom nebo nic. Přeskočená
  # kontrola nad povinnou závislostí je mlčení, ne úspěch — a deklarace, kterou
  # nikdo nevyplní, je ozdoba. Původ je přitom po ruce: `git remote` ho drží vždycky.
  #
  # ⛔ A PROČ NE PODLE JMÉNA REMOTE (nedůvěřivé čtení 2026-10-03, nález 3). Odvození
  # stálo na premise „původ stromu je TÁŽ adresa, ze které staví Coolify" — a bralo
  # ho z remote zvykového jména. Ve fork checkoutu ta premisa neplatí: zvykové jméno
  # tam ukazuje na upstream. Doktor pak změřil dosažitelnost a kontrakt CI CIZÍHO
  # repozitáře, napsal „má vše, co jeho CI čte" a u nálezu nabídl příkaz, který by
  # tajemství zapsal do repozitáře, ze kterého se nestaví.
  # Záměr (adresa, ze které Coolify staví) se nemění — mění se cesta k ní: remote se
  # vybírá podle IDENTITY nasazovaného repozitáře z deklarace manifestu
  # (lib/nasazovany-repozitar.mjs --remote, bez sítě), ne podle jména. Když žádný
  # remote neodpovídá, adresu zjistit nejde → FAIL, stejně jako dřív při chybějícím
  # původu. Přihlašovací údaje v URL se ořežou (nesmí do logu).
  #
  # Odpověď pomocníka je vždy stdout; chybový výstup jde zvlášť a čte se jen jako důvod.
  _forgejo_url=""; _forgejo_zdroj=""; _forgejo_duvod=""
  _zaklad_rc=0
  _zaklad_chyby="$(mktemp)"
  _zaklad="$(node "$REPO_ROOT/scripts/lib/nasazovany-repozitar.mjs" --zaklad 2>"$_zaklad_chyby")" || _zaklad_rc=$?
  case "$_zaklad_rc" in
    0) IFS=$'\t' read -r _forgejo_url _zaklad_zdroj <<< "$_zaklad"
       _forgejo_zdroj="deklarováno (${_zaklad_zdroj})" ;;
    2) : ;;  # adresa není deklarovaná — odvodí se níž z remote nasazovaného repozitáře
    *) _forgejo_duvod="výklad deklarované adresy selhal (kód ${_zaklad_rc}): $(tr '\n' ' ' < "$_zaklad_chyby")" ;;
  esac
  rm -f "$_zaklad_chyby"
  unset _zaklad _zaklad_rc _zaklad_zdroj _zaklad_chyby
  if [[ -z "$_forgejo_url" && -z "$_forgejo_duvod" ]]; then
    _nas_rc=0
    _nas_chyby="$(mktemp)"
    _nas="$(node "$REPO_ROOT/scripts/lib/nasazovany-repozitar.mjs" --manifest "$MANIFEST" --repo-root "$REPO_ROOT" --remote 2>"$_nas_chyby")" || _nas_rc=$?
    if [[ "$_nas_rc" -eq 0 ]]; then
      IFS=$'\t' read -r _nas_remote _nas_url <<< "$_nas"
      # Parsování má jeden domov — lib/git-origin.mjs. Vlastní sed výraz tady by
      # byl druhá implementace téhož, a ta se rozejde (viz identita instance, #905).
      _forgejo_url="$(node "$REPO_ROOT/scripts/lib/git-origin.mjs" "$_nas_url" 2>/dev/null || true)"
      _forgejo_zdroj="odvozeno z remote '${_nas_remote}' — podle identity nasazovaného repozitáře"
      [[ -z "$_forgejo_url" ]] && _forgejo_duvod="není deklarovaná (FORGEJO_URL / FORGEJO_DOMAIN) a adresa remote '${_nas_remote}' není rozpoznatelné URL"
    else
      _forgejo_duvod="není deklarovaná (FORGEJO_URL / FORGEJO_DOMAIN) a z remotů stromu ji odvodit nejde — $(tr '\n' ' ' < "$_nas_chyby")"
    fi
    rm -f "$_nas_chyby"
    unset _nas _nas_rc _nas_remote _nas_url _nas_chyby
  fi

  if [[ -z "$_forgejo_url" ]]; then
    fail "Forgejo adresu nelze zjistit: ${_forgejo_duvod}. Coolify staví aplikace z gitu — bez původu není z čeho stavět."
  else
    rc=$(curl -sS -o /dev/null -w "%{http_code}" -m "$API_TIMEOUT" "$_forgejo_url" 2>/dev/null || true)
    case "$rc" in
      200|301|302) ok "Forgejo reachable: $_forgejo_url (HTTP $rc, $_forgejo_zdroj)" ;;
      000) fail "Forgejo unreachable: $_forgejo_url ($_forgejo_zdroj)" ;;
      *)   warn "Forgejo returned HTTP $rc — $_forgejo_url ($_forgejo_zdroj)" ;;
    esac

    # Má repo všechno, co jeho CI čte (secrets./vars.)? Kontrakt a měření bydlí
    # v lib/ci-kontrakt.mjs; tady se jen volá. Jen JMÉNA, žádné hodnoty.
    # ⛔ Zápis (apply) sem NEPATŘÍ — mění trvalou konfiguraci repa, a to jen
    #    ručně s „ano“ majitele. Chybějící tajemství CI cold-start neblokuje,
    #    ale je to riziko prvního nasazení z CI → varování. VÝJIMKA: chybějící
    #    adresa overlaye instance je FAIL (níž) — bez ní je držení aplikací fail-open.
    #
    # ⛔ KTERÉ repo: to, ZE KTERÉHO SE STAVÍ — deklaruje ho manifest (nález 3).
    # Dřív se bralo z remote zvykového jména; ve fork checkoutu tak vyšel upstream
    # a příkaz nabídnutý u nálezu (--apply --potvrzuji) mířil na cizí repozitář.
    # Výklad deklarace má jeden domov: lib/nasazovany-repozitar.mjs --vyklad.
    _ci_repo="${CI_KONTRAKT_REPO:-}"
    _ci_zdroj="deklarováno (CI_KONTRAKT_REPO)"
    _ci_duvod=""
    if [[ -z "$_ci_repo" ]]; then
      _ci_vyklad_rc=0
      _ci_chyby="$(mktemp)"
      _ci_vyklad="$(node "$REPO_ROOT/scripts/lib/nasazovany-repozitar.mjs" --manifest "$MANIFEST" --vyklad 2>"$_ci_chyby")" || _ci_vyklad_rc=$?
      if [[ "$_ci_vyklad_rc" -eq 0 ]]; then
        IFS=$'\t' read -r _ _ci_repo <<< "$_ci_vyklad"
        _ci_zdroj="deklarováno manifestem ${MANIFEST##*/}"
      else
        _ci_duvod=": $(tr '\n' ' ' < "$_ci_chyby")"
      fi
      rm -f "$_ci_chyby"
      unset _ci_vyklad _ci_vyklad_rc _ci_chyby
    fi
    if [[ -z "$_ci_repo" || "$_ci_repo" != */* ]]; then
      warn "CI kontrakt NEMĚŘENO: repo nelze zjistit (CI_KONTRAKT_REPO ani deklarace manifestu${_ci_duvod})"
    else
      _ci_out="$(mktemp)"
      _ci_rc=0
      FORGEJO_URL="$_forgejo_url" FORGEJO_TOKEN="${FORGEJO_TOKEN:-${FORGEJO_API_TOKEN:-}}" \
        node "$REPO_ROOT/scripts/lib/ci-kontrakt.mjs" --repo "$_ci_repo" \
        --env-file "$DOKTOR_ENV_SOUBOR" >"$_ci_out" 2>&1 || _ci_rc=$?
      case "$_ci_rc" in
        0) ok "CI kontrakt: repo $_ci_repo má vše, co jeho CI čte ($_ci_zdroj)" ;;
        1) warn "CI kontrakt: repo $_ci_repo NEMÁ, co jeho CI čte, nebo lehká dráha nemá živý runner ($_ci_zdroj) — detail níž; tajemství doplnit: node scripts/lib/ci-kontrakt.mjs --repo $_ci_repo --env-file .env.coolify --apply --potvrzuji $_ci_repo (jen s „ano“ majitele)" ;;
        3) warn "CI kontrakt: $_ci_repo bez nálezu, ale část nezměřena ($_ci_zdroj)" ;;
        *) warn "CI kontrakt NEMĚŘENO pro $_ci_repo ($_ci_zdroj) — viz důvod níž" ;;
      esac
      [[ "$_ci_rc" -eq 0 ]] || sed 's/^/      /' "$_ci_out"
      # ⛔ Jediný nález CI kontraktu, který je FAIL, ne varování: instance overlay
      # deklaruje, ale CI ho nemá odkud číst. Nasazení pak řekne „nic drženo“ a nasadí
      # i aplikace, které instance drží (fail-open). Hodnota je odvoditelná — doplní ji
      # založení instance (coolify-story-init.sh) nebo `ci-kontrakt.mjs --dopln`.
      if grep -qE '✗ secret +INSTANCE_OVERLAY_REPO ' "$_ci_out"; then
        fail "CI nemá adresu overlaye instance (INSTANCE_OVERLAY_REPO) — nasazení z CI by nečetlo deklaraci držení aplikací. Doplnit: node scripts/lib/ci-kontrakt.mjs --repo $_ci_repo --env-file <trezor> --dopln --potvrzuji $_ci_repo"
      fi
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
  # Umístění se měří tam, kde instance SKUTEČNĚ nasazuje (lane + přepis profilu,
  # lib/sloty-serveru.mjs). Dřív se četl katalog bez lane: vrstva accel na GPU
  # slotu tak chtěla warmup na KAŽDÉ instanci, i bez ACCEL_ENABLED.
  _n_args=(--bez-warmupu --profil "$(profil_instance)")
  [[ -f "$DOKTOR_ENV_SOUBOR" ]] && _n_args+=(--env-soubor "$DOKTOR_ENV_SOUBOR")
  if _chybi="$(node "$REPO_ROOT/scripts/lib/sloty-serveru.mjs" "${_n_args[@]}" 2>/dev/null)"; then
    _chybi="$(printf '%s' "$_chybi" | paste -sd, -)"
  else
    _chybi="?"
  fi
  if [[ "$_chybi" == "?" ]]; then
    warn "warmup kontrakt NEZMĚŘEN — umístění instance (katalog, profil, lane) se nepodařilo odvodit"
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


# ── Schéma public: kdo v něm smí vytvářet (živá databáze) ────────────────────
#
# ⛔ ZMĚŘENO 2026-10-03: reset schématu při studeném startu dával právo CREATE
# všem rolím (PUBLIC). Funkce SECURITY DEFINER v public patří superuživateli a
# volají další funkce bez kvalifikace — kdo smí v public vytvářet, podstrčí jim
# vlastní přetížení.
#
# WARN, ne FAIL: doktor běží PŘED nasazením a právo odebírá právě nasazení
# (heals). Fail by zastavil nápravu. Natvrdo selže ověření PO nasazení
# (scripts/verify-live-instance.sh) a v CI brána cesty upgradu.
# Offline režim se ČTE, nedosazuje: `${VAR+x}` říká jen „je nastavená“.
if [[ "${AISHA_SKIP_ONLINE+x}" == "x" && "$AISHA_SKIP_ONLINE" == "1" ]]; then
  info "offline režim — práva ve schématu public NEMĚŘENA"
elif [[ -z "$_alias_targets" ]]; then
  info "práva ve schématu public NEMĚŘENA: zapni AISHA_DOCTOR_DOCKER_HOSTS (hostitelé, kde nasazení žije)"
else
  for _h in $_alias_targets; do
    _label="$_h"; [[ "$_h" == "__local__" ]] && _label="tento host"
    _vp="$(bash "$REPO_ROOT/scripts/db/verify-schema-public-live.sh" "$_h" 2>&1)"; _vp_rc=$?
    case "$_vp_rc" in
      0) ok "[$_label] schéma public: vytvářet smí jen vyjmenované role" ;;
      1) warn "[$_label] schéma public: $_vp — nasazení (heals) to dorovná; po něm musí projít scripts/verify-live-instance.sh" ;;
      *) info "[$_label] práva ve schématu public NEMĚŘENA — $_vp" ;;
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

# ── Modelový mesh forku (varianta C, C5): uzel na GPU slotu a most ───────────
# Jen ČTENÍ API managementu modelového meshe (scripts/modelovy-mesh-doktor.mjs).
# Uzel nepřipojený = modelové funkce STOJÍ (žádný návrat na CPU, MM8) → fail nahlas.
# Bez lane MODEL_MESH (instance modelový mesh nemá) se nic neměří.
if [ -n "${MODEL_MESH-}" ]; then
  if [ "${AISHA_SKIP_ONLINE-}" = "1" ]; then
    info "offline režim — modelový mesh NEMĚŘEN"
  else
    _mmd="$(node "$REPO_ROOT/scripts/modelovy-mesh-doktor.mjs" 2>&1)"; _mmd_rc=$?
    case "$_mmd_rc" in
      0) ok "modelový mesh: uzel na GPU i most připojené a připnuté, most míří na uzel, jediná politika" ;;
      1)
        _mmd_vady="$(grep '^✗' <<<"$_mmd" || true)"
        fail "modelový mesh: ${_mmd_vady%%$'\n'*}"
        printf '%s\n' "$_mmd_vady" | sed 's/^/      /' >&2
        ;;
      *)
        _mmd_nez="$(grep -F 'NEZMĚŘENO' <<<"$_mmd" || true)"
        warn "modelový mesh: ${_mmd_nez%%$'\n'*}"
        ;;
    esac
    unset _mmd _mmd_rc _mmd_vady _mmd_nez
  fi
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

# ── Balíčky, které skripty cold-startu importují SESTAVENÉ ───────────────────
# ⛔ NAMĚŘENO 2026-10-03 (konvergence instance forku): knock-roster.mjs importuje
# packages/knock-protocol/dist; v konvergenčním stromu dist nebyl a dveře padly.
# Cold-start je v kroku 0b sestaví vždy (zastaralý dist je stejná vada jako
# chybějící) — doktor tu jen čte, jestli to PŮJDE: skript `build` a jeho nástroj.
# Seznam se odvozuje z importů skriptů (lib/balicky-pro-skripty.mjs), ne vyjmenovává.
echo -e "\n${C}${BOLD}━━━ Balíčky pro skripty (sestavitelnost) ━━━${N}"
__bps_rc=0
__bps_out="$(node "$REPO_ROOT/scripts/lib/balicky-pro-skripty.mjs" --zkontroluj 2>&1)" || __bps_rc=$?
case "$__bps_rc" in
  0) ok "Balíčky pro skripty: ${__bps_out#✓ }" ;;
  2) fail "Balíčky pro skripty: měřidlo nic nenašlo (${__bps_out}) — odvození osiřelo, NEMĚŘENO" ;;
  *) fail "Balíčky pro skripty nepůjde sestavit — cold-start krok 0b skončí:"
     printf '%s\n' "$__bps_out" | sed 's/^/      /' ;;
esac
unset __bps_rc __bps_out

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

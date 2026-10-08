#!/usr/bin/env bash
# ==============================================================================
# aisha-cold-start.sh — End-to-end provisioning of fresh AISHA stack on Coolify
# ==============================================================================
#
# Orchestrates the cold-start sequence after AISHA Coolify apps were deleted:
#
#   1. Generate fresh stack-internal secrets → .env.coolify
#      (preserves 3rd-party keys from .env-prod-backup: OPENAI, ANTHROPIC,
#       GOOGLE, SENTRY, STRIPE, GITHUB_TOKEN, FORGEJO_API_TOKEN, etc.)
#   2. Create 11 Coolify applications via story-init (POST /applications/public)
#   3. Set env vars + Forgejo webhook via deploy-init
#   4. Trigger first deploy on each app (POST /restart)
#   5. Verify all apps healthy
#
# Prerequisites:
#   - jq, curl, openssl, python3
#   - age (REQUIRED for --wipe: the off-machine encrypted vault backup)
#   - .env-prod-backup with COOLIFY_API_TOKEN, FORGEJO_API_TOKEN
#   - All AISHA Coolify apps DELETED (verify with `coolify-status` script)
#
# Usage:
#   bash scripts/aisha-cold-start.sh                # Full cold-start (incl. step 0 doctor)
#   bash scripts/aisha-cold-start.sh --dry-run      # Show plan, no changes
#   bash scripts/aisha-cold-start.sh --skip-create  # Skip step 2 (apps already exist)
#   bash scripts/aisha-cold-start.sh --skip-deploy  # Skip step 4 (manual deploy later)
#   bash scripts/aisha-cold-start.sh --skip-doctor  # Skip step 0 preflight (NOT RECOMMENDED)
#   bash scripts/aisha-cold-start.sh --wipe         # Delete existing apps + volumes, then full cold-start
#   bash scripts/aisha-cold-start.sh --rewarmup=aisha-netbird  # Přestav DATASTORE jmenované aplikace (i s volumes) a postav ji znovu; zbytek platformy se nedotkne
#   bash scripts/aisha-cold-start.sh --wipe --keep-volumes  # As above but retain Docker volumes (advanced; risks crypto-state mismatch)
#   bash scripts/aisha-cold-start.sh --wipe --skip-orphan-cleanup  # --wipe but DON'T destroy apps (validate-before-destroy debugging; escape hatch for stuck apps)
#
# VALIDATE-BEFORE-DESTROY: on --wipe the destroy is DEFERRED until AFTER secrets
# are generated and every compose stack validates (Steps 2/2b). A config error
# aborts while the old platform is still intact — never wiped-but-undeployed.
#
# WARNING: This is a DESTRUCTIVE / generational operation. Existing data in
# AISHA stack is lost (PG database, Keycloak users, Langfuse traces, n8n
# workflows). Only run on intentional cold-starts.
# ==============================================================================

set -uo pipefail
# NOTE: NOT using `set -e`; sourcing .env-prod-backup may emit harmless
# stderr noise (e.g. when a value contains shell-metacharacters in legacy
# entries) but we want the script to continue. Validation is per-step.

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# Jeden domov odpovědi „produkce? prefix? env soubor? zdroj doplnění?" (PR2 izolace).
# shellcheck source=lib/prostredi-behu.sh
. "${SCRIPT_DIR}/lib/prostredi-behu.sh"

# Single source of truth for AISHA_INSTANCE_DATA_GIT_URL — the stored value carries a
# `#<ref>` fragment that git does not strip, which silently broke every clone of the
# instance-data repo (and with it the off-machine vault backup).
# shellcheck source=scripts/lib/instance-data-url.sh
. "${SCRIPT_DIR}/lib/instance-data-url.sh"
# shellcheck source=scripts/lib/env-zapis.sh
. "${SCRIPT_DIR}/lib/env-zapis.sh"
# Deklarované držení aplikací — čtenář nad jediným domovem (lib/nasazeni-drzene.mjs).
# shellcheck source=scripts/lib/drzeni.sh
. "${SCRIPT_DIR}/lib/drzeni.sh"
# Vlastnictví aplikací manifestu v prostředí — čtenář nad jediným domovem
# (lib/vlastnictvi-aplikaci.mjs). Řádky `app:` manifestu tenhle skript sám nečte.
# shellcheck source=scripts/lib/vlastnictvi.sh
. "${SCRIPT_DIR}/lib/vlastnictvi.sh"

# AISHA_STORY = name of the story being cold-started. Drives:
#   • manifest path:    coolify/manifests/${STORY}.manifest
#   • Coolify app names: ${STORY}-core, ${STORY}-keycloak, …
#                        (via story-init.sh's `app_name="${STORY_NAME}-${role}"`)
#   • DB-level default story for AI agents (set after cold-start by seeds)
#   • safety regex scope for wipe operations
#
# Default story is `aisha` (the upstream evymo-ai-orchestrator deploy) — fully
# backward compatible. Forks set AISHA_STORY to their own identifier (e.g.
# fork-name).
#
# ⛔ OPRAVENO 2026-08-19. Tady stálo, že vnitřní jména služeb (`aisha-db`,
# `aisha-keycloak`, …) zůstávají `aisha-*` bez ohledu na story.
#
# Jméno se ODVOZUJE z identity instance — vždycky, bez ohledu na to, jestli je
# infrastruktura sdílená. Sdílení je vlastnost NASAZENÍ, ne jména: pevné
# `aisha-*` mlčky předpokládá, že sdílená instance existuje a že je to zrovna
# `aisha`. RIQi je přitom instance VYHRAZENÁ, takže tam žádné `aisha-*` neběží
# a odkaz na ně nemíří nikam. Naměřeno na riqi:
#     aliasy db kontejneru nesou prefix instance; `aisha-db` mezi nimi NENÍ
#     a z n8n se nerozliší vůbec (doslovné hodnoty viz commit — do kódu
#     nepatří ani jméno instance, ani konkrétní IP)
# Ten komentář vadu PŘEDEPISOVAL — kdo se jím řídil, zapsal do SoT jméno,
# které se nerozliší.
#
# UPSTREAMABLE: story-aware multi-fork support is a universal pattern.
#
# ⚠️ Byla identita instance DEKLAROVÁNA, nebo jen dosazena? Ten rozdíl rozhoduje
# o tom, čí aplikace smí tenhle běh mazat (viz fail-closed kontrola u
# APP_NAME_PREFIX níž). Zapisuje se TEĎ, před jakýmkoli dosazením — potom už to
# nejde poznat.
INSTANCE_DECLARED=0
if [ -n "${AISHA_STORY:-}" ] || [ -n "${APP_NAME_PREFIX:-}" ]; then
  INSTANCE_DECLARED=1
fi

ENV_PROD_BACKUP="${ENV_PROD_BACKUP:-${REPO_ROOT}/.env-prod-backup}"
# ⛔ IZOLACE PROSTŘEDÍ (PR2): ne-produkční běh generuje a čte VLASTNÍ env soubor
# (`.env.<env>`, holý staging `.env.staging`). Slot `<story>-staging` dřív psal napevno
# do `.env.coolify` — produkčního zdroje pravdy na stanovišti obsluhy — a preserve_or_gen
# z něj převzal produkční tajemství. Výslovné COOLIFY_<ENV>_ENV_FILE má dál přednost
# (resolve_target_env); konečný soubor i zálohu ověřuje blok za resolve_target_env.
if ! ENV_COOLIFY="$(pb_env_soubor "$REPO_ROOT" "${AISHA_ENV:-}")"; then
  echo "✗ AISHA_ENV=${AISHA_ENV:-} není známý tvar prostředí (production, staging, <story>-{staging,prod})." >&2
  exit 1
fi

# ── Bezpečné načtení env souboru do prostředí ────────────────────────────────
# `source` necháVÁ shell hodnotu INTERPRETOVAT: nezacitovaná hodnota s mezerou
# se utne na první mezeře a zbytek se VYKONÁ jako příkaz. To je ztráta dat
# (naměřeno 9 klíčů ze 724) i únik (části tajemství se provedou a skončí
# v chybovém výstupu a shell historii).
#
# `export "$klic=$hodnota"` hodnotu neinterpretuje — žádné dělení na slova,
# žádná substituce příkazu. Proto se čte řádek po řádku, ne sourcováním.
#
# ⛔ POČET SE NEVRACÍ VÝSTUPEM. Volající by ho musel vzít přes `$(...)`, což je
# SUBSHELL — a exporty ze subshellu se k rodiči NEDOSTANOU; cold-start by pak
# běžel s PRÁZDNÝM prostředím a projevilo by se to o vrstvu dál. Málem jsem to
# tak napsal (2026-08-25) — táž třída jako KC_API_HTTP_CODE nastavovaný
# v subshellu. Proto globální NACTENO_KLICU.
NACTENO_KLICU=0
nacti_env_do_prostredi() {
  local soubor="$1" radek klic hodnota
  NACTENO_KLICU=0
  [ -f "$soubor" ] || return 0
  while IFS= read -r radek || [ -n "$radek" ]; do
    case "$radek" in
      ''|'#'*) continue ;;
      *=*) ;;
      *) continue ;;
    esac
    klic="${radek%%=*}"
    hodnota="${radek#*=}"
    # jen platné jméno proměnné; cokoli jiného je komentář nebo smetí
    case "$klic" in
      [A-Za-z_]*) ;;
      *) continue ;;
    esac
    case "$klic" in
      *[!A-Za-z0-9_]*) continue ;;
    esac
    # obalující uvozovky patří zápisu, ne hodnotě
    case "$hodnota" in
      \"*\") hodnota="${hodnota#\"}"; hodnota="${hodnota%\"}" ;;
      \'*\') hodnota="${hodnota#\'}"; hodnota="${hodnota%\'}" ;;
    esac
    export "$klic=$hodnota"
    NACTENO_KLICU=$((NACTENO_KLICU + 1))
  done < "$soubor"
}
# Operator's deployment-config overlay — non-secret things like Coolify project
# name + per-slot server mapping. Separate from .env-prod-backup (secrets-only,
# read-only). Gitignored via the `*.local` rule. Cold-start sources this BEFORE
# .env-prod-backup so secrets can override (operator wants control).
ENV_LOCAL="${REPO_ROOT}/.env.local"

# Identita smí přijít i ze souboru — a z KTERÉHOKOLI z těch, jimiž se deklaruje
# (.env.local, .env-prod-backup, .env.coolify). Tady se ale žádný z nich nečte
# přímo: řetěz kanálů má jeden domov v lib/coolify-instance-scope.mjs, protože
# vlastní kopie tady dřív znala jediný z nich (.env.local) a instance, která
# identitu drží ve vaultu, tím pro cold-start neexistovala — viz lib/instance-identity.sh.
#
# Musí to být TEĎ, před výpočtem STORY/MANIFEST pár řádků níž: deklarace, která
# dorazí po nich, se projeví jako "Missing …/.manifest" — příznak, ne příčina.
# shellcheck source=scripts/lib/instance-identity.sh
. "${SCRIPT_DIR}/lib/instance-identity.sh"
if [ "$INSTANCE_DECLARED" = "0" ]; then
  # Návratový kód se propouští beze změny: 3 = kanály si odporují, 4 = nejde to
  # změřit (chybí node). Ani jedno není „nedeklarováno" a nesmí se tak tvářit.
  declare_instance_identity || exit $?
fi

# Bez dosazení: prázdné STORY zastaví fail-closed kontrola u APP_NAME_PREFIX níž
# dřív, než se sáhne na cokoliv. Dosazené „aisha" by tenhle běh nasměrovalo na
# upstream — u WIPE nenávratně.
STORY="${AISHA_STORY:-${APP_NAME_PREFIX:-}}"
# Manifest se RESOLVUJE, nedosazuje. Inventář je instanční data (config/profiles/README.md:
# "instance data does not belong in a public repository"), takže smí ležet v privátním
# overlayi — a sdílený resolver zná pořadí --manifest → <overlay>/manifests/ → repo.
# Dosazená repo-cesta tvrdila "Missing coolify/manifests/<story>.manifest" i instanci,
# která ho korektně má v overlayi (naměřeno 2026-09-02 na <fork>). Fallback na dosazení
# zůstává jen pro případ, že by resolver nebyl k dispozici.
MANIFEST="$(node "${REPO_ROOT}/scripts/lib/coolify-instance-scope.mjs" --manifest-path 2>/dev/null \
  || echo "${REPO_ROOT}/coolify/manifests/${STORY}.manifest")"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

info()   { echo -e "${BLUE}ℹ${NC}  $*"; }
ok()     { echo -e "${GREEN}OK${NC} $*"; }
warn()   { echo -e "${YELLOW}WARN${NC}  $*"; }
err()    { echo -e "${RED}ERR${NC} $*" >&2; }

# ── NEDOKONČENO: co běh neudělal, se nesmí ztratit v logu ─────────────────────
# ⛔ NAMĚŘENO 2026-09-13 (audit cesty `--skip-create` nad guru). Selhání, které
# NEBRÁNÍ dalším krokům, končilo `exit 1` — a s ním se nespustilo nic, co přišlo
# po něm: měkká aplikace ve fázi E tak zrušila krok 6 (n8n), smoke test, embed
# kickstart, úklid warmupu i restart validaci. Jiná selhání naopak skončila jen
# `warn` a konec běhu hlásil „complete".
# Pravidlo: zastavuje se JEN tam, kde by pokračování stavělo na rozbitém
# předpokladu (identita, secrety Keycloaku, vznik meshe). Všechno ostatní se
# zapíše sem, běh dokončí, co jde, a na konci to vyjmenuje a skončí nenulou.
NEDOKONCENO=()
nedokonceno() { err "$*"; NEDOKONCENO+=("$*"); }
# Chybějící VSTUP OBSLUHY (cizí API klíč, roster) není vada běhu, ale vypíše se
# v souhrnu zvlášť — funkce, která na něm stojí, jinak spadne až za provozu.
VSTUPY_OBSLUHY=()
# Aktuální krok se DRŽÍ, ne jen tiskne: když běh zvenčí zemře, jediná
# užitečná věta je „kde to bylo". Bez toho zbyde jen `Terminated: 15`.
_AKTUALNI_KROK="(před prvním krokem)"
step()   { _AKTUALNI_KROK="$*"; echo -e "\n${BLUE}========== $* ==========${NC}"; }
banner() { echo -e "\n${CYAN}### $* ###${NC}"; }

# ── Args ──────────────────────────────────────────────────────────────────────
DRY_RUN=0
SKIP_CREATE=0
SKIP_DEPLOY=0
SKIP_DOCTOR=0
WIPE=0
# WIPE_VOLUMES=1 turns the Coolify DELETE into a destructive purge that also
# removes named Docker volumes. Default ON when --wipe is given (matches the
# "destructive cold-start" intent and avoids the stale-volume failure mode
# where new PKI_DEFAULT_SECRET can't decrypt OpenXPKI keys baked into a
# pre-existing volume). Opt out with --keep-volumes for the rare case where
# the operator wants to retain DB / langfuse / matrix data across wipes.
WIPE_VOLUMES=1
# SKIP_ORPHAN_CLEANUP=1 disables the prefix-based destroy pass (wipe_orphan_apps)
# even when --wipe is given. Escape hatch for the rare case where a stuck app
# refuses to DELETE and the operator wants to proceed past it manually, or for
# debugging the generate/validate phases without touching cloud apps. Off by
# default — a --wipe always cleans by default.
SKIP_ORPHAN_CLEANUP=0
# WIPE_PENDING is set in Step 1 once the wipe is *authorized* (apps found,
# --wipe given, pre-wipe TLD guard passed) but the actual destroy is DEFERRED
# to Step 2c — so it runs only AFTER generate+validate (Step 2/2b) succeed.
# This is the "validate-before-destroy" invariant: a config/secret/compose
# error aborts the run while the old platform is still intact, never leaving
# it wiped-but-undeployed (incident 2026-05-31).
WIPE_PENDING=0
# REWARMUP_APPS = čárkou oddělená jména aplikací, jejichž DATASTORE se má přestavět.
# Není to malý wipe: je to TÁŽ cesta zúžená na jmenovaný cíl. Aplikace se zahodí
# i s volumes, a zbytek řetězu (krok 3 založí, 4 dodá env, 5 nasadí) ji postaví
# znovu — takže se nikde nezdvojuje logika zakládání.
#
# PROČ TO VŮBEC EXISTUJE: naměřeno 2026-08-18. NetBird váže vlastnictví účtu na
# Keycloak user ID. Přeprovisionování realmu z vlastníka udělá ducha („not found
# in IDP") a náš bootstrap uvázne v `pending approval` — schválit ho může jen
# vlastník, který neexistuje. Přes API to spravit NELZE: /api/accounts vrací naší
# identitě 401, takže žádná chirurgie účtu není možná. Jediná cesta je přestavět
# datastore. Bez tohohle kroku zbýval jen `--wipe` celé platformy kvůli JEDNOMU
# svazku — tedy hodiny práce za vadu jedné aplikace.
REWARMUP_APPS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)    DRY_RUN=1; shift ;;
    --skip-create) SKIP_CREATE=1; shift ;;
    --skip-deploy) SKIP_DEPLOY=1; shift ;;
    --skip-doctor) SKIP_DOCTOR=1; shift ;;
    --wipe)       WIPE=1; shift ;;
    --rewarmup=*) REWARMUP_APPS="${1#*=}"; shift ;;
    --keep-volumes) WIPE_VOLUMES=0; shift ;;
    --skip-orphan-cleanup) SKIP_ORPHAN_CLEANUP=1; shift ;;
    --help|-h)
      sed -n '2,37p' "$0"
      exit 0
      ;;
    *) err "Unknown arg: $1"; exit 1 ;;
  esac
done

# Záměr běhu je od téhle chvíle PEVNÝ. Soubory (.env-*-backup, .env.coolify)
# ho přepsat nesmějí — `load_env_file_keys` řídicí proměnné přeskočí a tohle je
# pojistka i pro ostatní cesty (`set -a; . soubor`, eval výstupu discovery).
# WIPE_PENDING sem nepatří: nastavuje ho sám skript v kroku 1.
readonly DRY_RUN SKIP_CREATE SKIP_DEPLOY SKIP_DOCTOR WIPE WIPE_VOLUMES SKIP_ORPHAN_CLEANUP REWARMUP_APPS AISHA_ENV

# ── IZOLACE PROSTŘEDÍ: projekt ne-produkčního běhu je PŘIPNUTÝ ────────────────
# NAMĚŘENO 2026-09-24 (fork, staging na sdíleném Coolify): `--dry-run --wipe`
# skončil s COOLIFY_PROJECT_UUID PRODUKCE. Discovery (generate-coolify-context.mjs)
# hledá projekt podle JMÉNA, fork nese staging i produkci pod jedním jménem instance
# a `eval` jejího výstupu připnuté stagingové UUID přepsal. Wipe by mazal produkci.
#
# Připnuté UUID se proto bere JEN z toho, co běh dostal ZVENKU (obal
# aisha-cold-start-env.sh → AISHA_WRAPPER_PROJECT_UUID, nebo prostředí operátora),
# TEĎ — dřív, než se načte jakýkoli soubor. Ne-produkční běh se pak po discovery
# a před každým destruktivním krokem ptá, jestli pořád míří na svůj projekt, a když
# ne, zastaví (cs_over_izolaci_projektu). Produkční běh se tím nemění.
cs_je_prod_env() { pb_je_prod "${AISHA_ENV:-}"; }
_cs_pin_var="$(pb_prefix "${AISHA_ENV:-}" || true)PROJECT_UUID"
CS_PROJEKT_PIN="${AISHA_WRAPPER_PROJECT_UUID:-${COOLIFY_PROJECT_UUID:-${!_cs_pin_var:-}}}"
# Produkční projekt, jak ho běh dostal zvenku. Pozdější COOLIFY_PROD_PROJECT_UUID
# nevypovídá: pre_resolve_load_env do něj zrcadlí COOLIFY_PROJECT_UUID i ve stagingu.
CS_PROD_PROJEKT_ZVENKU="${AISHA_WRAPPER_PROD_PROJECT_UUID:-${COOLIFY_PROD_PROJECT_UUID:-}}"
readonly CS_PROJEKT_PIN CS_PROD_PROJEKT_ZVENKU
unset _cs_pin_var

# cs_over_izolaci_projektu <kde> — ne-produkční běh: cílový projekt = připnutý
# a není to produkční projekt, jinak STOP. Volat na nejvyšší úrovni skriptu nebo
# ve funkci volané z ní (ne v `$(…)` — `exit` by ukončil jen podslupku).
cs_over_izolaci_projektu() {
  cs_je_prod_env && return 0
  local kde="$1" cil="${COOLIFY_PROJECT_UUID:-}"
  if [ -z "$CS_PROJEKT_PIN" ]; then
    err "IZOLACE ($kde): ne-produkční běh AISHA_ENV=${AISHA_ENV} nemá připnuté VLASTNÍ UUID projektu."
    err "  Spusť přes scripts/aisha-cold-start-env.sh, nebo exportuj COOLIFY_PROJECT_UUID svého projektu."
    err "  Bez pinu by se projekt hledal podle jména — a fork má staging i produkci pod jedním jménem."
    exit 1
  fi
  if [ -n "$CS_PROD_PROJEKT_ZVENKU" ] && [ "$CS_PROJEKT_PIN" = "$CS_PROD_PROJEKT_ZVENKU" ]; then
    err "IZOLACE ($kde): připnutý projekt ne-produkčního běhu ${AISHA_ENV} JE produkční projekt (${CS_PROJEKT_PIN})."
    exit 1
  fi
  if [ "$cil" != "$CS_PROJEKT_PIN" ]; then
    err "IZOLACE ($kde): cílový projekt se změnil — připnuto ${CS_PROJEKT_PIN}, teď ${cil:-<prázdné>}."
    err "  Ne-produkční běh ${AISHA_ENV} smí mířit jen na svůj projekt. Zastavuji dřív, než se cokoli změní."
    exit 1
  fi
}

# ⛔ ROZPORNÉ VOLBY PADAJÍ HNED, ne až v kroku 2d. Guard umístěný za doktorem a
# generováním by operátora nechal čekat minuty na větu „to nejde" — a přesně to
# jsem si při psaní tohohle kroku vyrobil. Nesplnitelná podmínka se má ohlásit
# v okamžiku, kdy je poprvé známá: při čtení argumentů.
if [ -n "$REWARMUP_APPS" ]; then
  if [ "$WIPE" = "1" ]; then
    err "--rewarmup nelze kombinovat s --wipe: wipe stejně zahodí všechno, včetně cíle rewarmupu."
    err "  Vyber jedno: cílená přestavba (--rewarmup), nebo celá platforma (--wipe)."
    exit 1
  fi
  if [ "$SKIP_CREATE" = "1" ]; then
    err "--rewarmup nelze kombinovat s --skip-create: aplikace by se zahodila a UŽ NIKDY nezaložila."
    err "  Rewarmup se opírá o krok 3, který chybějící aplikaci vytvoří."
    exit 1
  fi
fi

# ── Environment target resolution ─────────────────────────────────────────────
# read_env_key / parse_env_soubor: hodnota jako po `source` (lib/env-soubor.sh).
# ⛔ NAMĚŘENO 2026-09-19: dřívější `sed` uvozovky jen odřízl a escapy nechal —
# `AISHA_OPERATORS` tak šel dál jako `{\"email\":…}` (neplatný JSON).
# shellcheck source=scripts/lib/env-soubor.sh
. "${SCRIPT_DIR}/lib/env-soubor.sh"

# load_env_file_keys: čte přes parse_env_soubor a řídicí proměnné běhu
# (DRY_RUN, WIPE, …) soubor přepsat nesmí — viz scripts/lib/env-file-keys.sh.
. "${SCRIPT_DIR}/lib/env-file-keys.sh"

load_env_file_keys_if_unset() {
  load_env_file_keys "$1" "if-unset"
}

load_env_key_if_unset() {
  local key="$1" value=""
  if [ -z "${!key:-}" ]; then
    value=$(read_env_key "$key" "$ENV_PROD_BACKUP")
    [ -n "$value" ] && export "$key=$value"
  fi
}

require_loaded_env() {
  local key="$1"
  [ -n "${!key:-}" ] || { err "$key not set — set it in env/.env-prod-backup or run AISHA_ENV=production bash scripts/aisha-cold-start-env.sh ..."; exit 1; }
}

pre_resolve_load_env() {
  # Iter 22a — load operator-managed env BEFORE resolve_target_env so the
  # coolify-environments.env template's `${COOLIFY_PROD_URL:-}` expansion sees
  # operator values (typically legacy single-env `COOLIFY_URL` form from
  # .env-prod-backup). Without this, template expands to empty → .example
  # fallback fires → may pick a broken placeholder hostname → cold-start fails
  # with 404 from Coolify discovery.
  #
  # .env.local first (operator's non-secret overlay — project name, hostnames),
  # then .env-prod-backup (secrets + legacy URL). Both already exist by the
  # time this runs; cold-start has guards below that abort if .env-prod-backup
  # is missing (line 356).
  if [ -f "$ENV_LOCAL" ]; then
    set -a
    # shellcheck source=/dev/null
    . "$ENV_LOCAL"
    set +a
  fi
  # Safe .env-prod-backup load. This backup is the production state vault:
  # credentials and per-deploy config/domain values must survive cold-start and
  # must win over .env.local + generated fallbacks. Do NOT `source` the whole
  # file; legacy values may contain shell metacharacters.
  load_env_file_keys "$ENV_PROD_BACKUP" "overwrite"

  # Keep the narrow list below as documentation for values needed before target
  # env/topology resolution. The broad safe load above is the actual invariant.
  for k in COOLIFY_URL COOLIFY_PROJECT_UUID \
           COOLIFY_SERVER_UUID_FRONTEND COOLIFY_SERVER_UUID_BACKEND \
           COOLIFY_SERVER_UUID_EXPERIMENTAL COOLIFY_SERVER_UUID_BUILD \
           COOLIFY_SERVER_UUID_GPU \
           FRONTEND_HOSTNAME BACKEND_HOSTNAME \
           EXPERIMENTAL_HOSTNAME BUILD_HOSTNAME GPU_HOSTNAME \
           AISHA_TARGET_SERVER COOLIFY_PROJECT_NAME \
           PUBLIC_TLD INTERNAL_TLD MESH_TLD \
           OAUTH2_COOKIE_DOMAINS OAUTH2_WHITELIST_DOMAINS \
           AISHA_PROFILE MESH_ENABLED; do
    if [ -z "${!k:-}" ] && [ -f "$ENV_PROD_BACKUP" ]; then
      v=$(read_env_key "$k" "$ENV_PROD_BACKUP")
      [ -n "$v" ] && export "$k=$v"
    fi
  done
  # Iter 22b — legacy → prefixed bridge. Operator .env-prod-backup typically
  # uses single-env naming (COOLIFY_URL, COOLIFY_PROJECT_UUID, no prefix). The
  # template wants COOLIFY_PROD_URL etc. Mirror legacy → prefixed so template
  # expansion picks them up. Only fills when prefixed form is unset (no clobber
  # of explicitly-set staging vs prod values).
  : "${COOLIFY_PROD_URL:=${COOLIFY_URL:-}}"
  : "${COOLIFY_PROD_PROJECT_UUID:=${COOLIFY_PROJECT_UUID:-}}"
  : "${COOLIFY_PROD_SERVER_UUID_FRONTEND:=${COOLIFY_SERVER_UUID_FRONTEND:-}}"
  : "${COOLIFY_PROD_SERVER_UUID_BACKEND:=${COOLIFY_SERVER_UUID_BACKEND:-}}"
  : "${COOLIFY_PROD_SERVER_UUID_EXPERIMENTAL:=${COOLIFY_SERVER_UUID_EXPERIMENTAL:-}}"
  : "${COOLIFY_PROD_SERVER_UUID_BUILD:=${COOLIFY_SERVER_UUID_BUILD:-}}"
  : "${COOLIFY_PROD_SERVER_UUID_GPU:=${COOLIFY_SERVER_UUID_GPU:-}}"
  export COOLIFY_PROD_URL COOLIFY_PROD_PROJECT_UUID \
         COOLIFY_PROD_SERVER_UUID_FRONTEND COOLIFY_PROD_SERVER_UUID_BACKEND \
         COOLIFY_PROD_SERVER_UUID_EXPERIMENTAL COOLIFY_PROD_SERVER_UUID_BUILD \
         COOLIFY_PROD_SERVER_UUID_GPU
}

resolve_target_env() {
  [ -n "${AISHA_ENV:-}" ] || return 0

  local envs_file="${REPO_ROOT}/config/coolify-environments.env"
  [ -f "$envs_file" ] || { err "AISHA_ENV=$AISHA_ENV set but $envs_file missing"; exit 1; }
  set -a
  # shellcheck source=/dev/null
  . "$envs_file"
  set +a

  # Iter 17 + 22a — live coolify-environments.env is template-only (every
  # value is `${VAR:-}` env-templated). pre_resolve_load_env above pre-loads
  # operator values (legacy or prefixed), so the template expansion typically
  # has real values. .example fallback only fires for keys the operator hasn't
  # set anywhere — for those it provides a placeholder that resolve_target_env
  # downstream will error on with a clear message.
  local envs_example="${envs_file}.example"
  if [ -f "$envs_example" ]; then
    local fell_back=0
    set -a
    while IFS='=' read -r key val; do
      case "$key" in
        ''|\#*) continue ;;
      esac
      # Only fall back if the live value is empty (operator didn't set it)
      if [ -z "${!key:-}" ] && [ -n "$val" ]; then
        export "$key=$val"
        fell_back=1
      fi
    done < <(grep -E "^[A-Z_][A-Z0-9_]*=" "$envs_example")
    set +a
    if [ "$fell_back" = 1 ]; then
      warn "coolify-environments: filling unset keys from .example (placeholder values). Set them in .env-prod-backup / .env.local to override."
    fi
  fi

  # Story-aware prefix resolution (mirrors aisha-cold-start-env.sh logic).
  # Bare production|staging keep the legacy COOLIFY_PROD_/COOLIFY_STAGING_
  # prefixes; <story>-{staging,prod} envs (e.g. acme-staging) derive prefix
  # from the env name itself (COOLIFY_ACME_STAGING_).
  #
  # When invoked through aisha-cold-start-env.sh the env wrapper has already
  # exported COOLIFY_URL + COOLIFY_PROJECT_UUID + COOLIFY_SERVER_UUID_* etc.,
  # so this function is effectively idempotent (it'd re-resolve to the same
  # values). The story-aware case prevents a spurious "Invalid AISHA_ENV"
  # exit on the inner script when the env wrapper successfully resolved a
  # story-prefixed env above.
  local prefix
  if ! prefix="$(pb_prefix "$AISHA_ENV")"; then
    err "Invalid AISHA_ENV=$AISHA_ENV (expected production, staging, or <story>-{staging,prod})"
    exit 1
  fi

  local resolved_url_var="${prefix}URL"
  local resolved_backup_var="${prefix}ENV_BACKUP"
  local resolved_project_var="${prefix}PROJECT_UUID"

  local resolved_url="${!resolved_url_var:-}"
  [ -n "$resolved_url" ] || { err "${resolved_url_var} is empty — fix config/coolify-environments.env"; exit 1; }
  if [ -n "${COOLIFY_URL:-}" ] && [ "$COOLIFY_URL" != "$resolved_url" ]; then
    err "COOLIFY_URL conflicts with AISHA_ENV=$AISHA_ENV (${COOLIFY_URL} != ${resolved_url})"
    exit 1
  fi
  export COOLIFY_URL="$resolved_url"
  export COOLIFY_BASE_URL="${COOLIFY_BASE_URL:-$resolved_url}"

  local resolved_backup="${!resolved_backup_var:-}"
  if [ -n "$resolved_backup" ] && [ -z "${ENV_PROD_BACKUP_EXPLICIT:-}" ]; then
    case "$resolved_backup" in
      /*) ENV_PROD_BACKUP="$resolved_backup" ;;
      *) ENV_PROD_BACKUP="${REPO_ROOT}/${resolved_backup}" ;;
    esac
  fi

  # DOMÉNY PROSTŘEDÍ. `COOLIFY_<ENV>_DOMAINS_FILE` je v config/coolify-environments.env
  # deklarovaný od začátku (PROD i STAGING), ale nikdo ho nečetl: DOMAINS_FILE níž je
  # natvrdo `config/domains.env`. Ten je přitom ŠABLONA (`${VAR:-}`), takže se plnil
  # z prostředí — a když v něm nic nebylo, spadl na `.example` placeholdery a nasazení
  # by dostalo cizí domény. Naměřeno 2026-09-02 na forku: běh s AISHA_ENV=production
  # načetl doménu i auth hostname STAGINGU (z `.example` placeholderů).
  # Načítá se PŘED odvozením topologie, protože z těchhle hodnot se odvozuje.
  # GENEROVANÝ ENV PROSTŘEDÍ. `.env.coolify` je VÝSTUP cold-startu (resolved env
  # + čerstvé stack-internal secrety) a zároveň jeho VSTUP při dalším běhu —
  # `preserve_or_gen` z něj recykluje klíče, aby se neosiřela databáze. To je
  # správně pro OPAKOVANÝ běh TÉHOŽ prostředí, ale cesta byla jedna pro všechna:
  # produkční běh by četl stagingové domény a stagingové secrety, a hlavně by
  # ten soubor PŘEPSAL — jediná lokální kopie secretů Varry by zmizela z disku.
  # `_env-loader.sh` `.env.staging` už preferoval, jen ho nikdo nezapisoval.
  local resolved_envfile_var="${prefix}ENV_FILE"
  local resolved_envfile="${!resolved_envfile_var:-}"
  if [ -n "$resolved_envfile" ]; then
    case "$resolved_envfile" in
      /*) ENV_COOLIFY="$resolved_envfile" ;;
      *) ENV_COOLIFY="${REPO_ROOT}/${resolved_envfile}" ;;
    esac
    export ENV_COOLIFY
  fi

  local resolved_domains_var="${prefix}DOMAINS_FILE"
  local resolved_domains="${!resolved_domains_var:-}"
  if [ -n "$resolved_domains" ]; then
    case "$resolved_domains" in
      /*) AISHA_ENV_DOMAINS_FILE="$resolved_domains" ;;
      *) AISHA_ENV_DOMAINS_FILE="${REPO_ROOT}/${resolved_domains}" ;;
    esac
    if [ -f "$AISHA_ENV_DOMAINS_FILE" ]; then
      set -a
      # shellcheck source=/dev/null
      . "$AISHA_ENV_DOMAINS_FILE"
      set +a
      export AISHA_ENV_DOMAINS_FILE
    else
      err "${resolved_domains_var}=${resolved_domains} — soubor neexistuje (${AISHA_ENV_DOMAINS_FILE})"
      exit 1
    fi
  fi
  export COOLIFY_PROJECT_UUID="${COOLIFY_PROJECT_UUID:-${!resolved_project_var:-}}"
  # UUID serveru z prefixované deklarace prostředí pro KAŽDÝ slot registru
  # (lib/sloty-serveru.mjs), ne pro opsané tři — build ani gpu tu dřív nebyly.
  local _sloty _slot _cil _zdroj
  if ! _sloty="$(node "${REPO_ROOT}/scripts/lib/sloty-serveru.mjs" --vsechny)"; then
    err "Sloty registru coolify/servers.json nejdou přečíst — nevím, která UUID serverů převzít."
    exit 1
  fi
  for _slot in $_sloty; do
    _cil="COOLIFY_SERVER_UUID_$(printf '%s' "$_slot" | tr '[:lower:]' '[:upper:]')"
    _zdroj="${prefix}SERVER_UUID_$(printf '%s' "$_slot" | tr '[:lower:]' '[:upper:]')"
    export "${_cil}=${!_cil:-${!_zdroj:-}}"
  done
}

if [ -n "${ENV_PROD_BACKUP:-}" ] && [ "$ENV_PROD_BACKUP" != "${REPO_ROOT}/.env-prod-backup" ]; then
  ENV_PROD_BACKUP_EXPLICIT=1
fi

# Iter 22a — pre-load operator env BEFORE template expansion in resolve_target_env.
# Without this, ${COOLIFY_PROD_URL:-} in coolify-environments.env expands to empty
# and the .example fallback may pick up placeholder hostnames → 404 from Coolify
# discovery.
pre_resolve_load_env

resolve_target_env

# ── IZOLACE PROSTŘEDÍ (PR2): env soubor a záloha jsou teď konečné ──────────────
# Ne-produkční běh nesmí zapisovat do produkčního `.env.coolify` (ani přes výslovné
# COOLIFY_<ENV>_ENV_FILE) a smí doplňovat jen ze zálohy SVÉHO prostředí — přímý běh
# bez obalu by jinak spadl na výchozí `.env-prod-backup`. Podřízené skripty
# (env-doctor, preflight-compose, sync-envs, deploy-init, doktor) pak dostanou TENTÝŽ
# soubor a TUTÉŽ zálohu a nerozhodují si samy. Produkční běh se nemění.
if ! cs_je_prod_env; then
  if [ "$ENV_COOLIFY" = "${REPO_ROOT}/.env.coolify" ]; then
    err "IZOLACE: ne-produkční běh AISHA_ENV=${AISHA_ENV} by zapisoval do PRODUKČNÍHO ${ENV_COOLIFY}."
    err "  Oprav COOLIFY_$(pb_prefix "$AISHA_ENV" | sed 's/^COOLIFY_//')ENV_FILE, nebo ho nenastavuj (výchozí je $(pb_env_soubor "$REPO_ROOT" "$AISHA_ENV"))."
    exit 1
  fi
  if ! pb_zdroj_doplneni "$REPO_ROOT" "$AISHA_ENV" "$ENV_PROD_BACKUP" >/dev/null; then
    err "IZOLACE: ne-produkční běh AISHA_ENV=${AISHA_ENV} by četl PRODUKČNÍ zálohu (${ENV_PROD_BACKUP})."
    err "  Spusť přes scripts/aisha-cold-start-env.sh (nastaví zálohu prostředí), nebo exportuj ENV_PROD_BACKUP."
    exit 1
  fi
fi
export ENV_FILE="$ENV_COOLIFY" ENV_PROD_BACKUP

# ── Private instance overlay, fetched BEFORE the topology resolver ────────────
# An instance's own profile is DATA — its domains, its servers, the organization
# running it — so it lives in the private overlay, not in this (public)
# repository. The resolver below needs it, which is why the fetch happens HERE:
# the overlay was already cloned for the operator roster, but ~800 lines further
# down, far too late for anything the topology depends on.
#
# One clone, several consumers: the checkout path is exported so the roster step
# later reuses it instead of cloning the same repository a second time.
#
# No URL is a community install: the templates in config/profiles/ are what it
# runs on, and that is not a failure.
#
# A DECLARED overlay that cannot be fetched is a failure, and a fatal one. It
# used to "fall back to the templates" — but for an instance with its own
# overlay a template is not less data, it is ANOTHER instance's profile. The
# topology resolver now refuses the same situation (scripts/lib/instance-overlay.mjs,
# measured 2026-09-13: a redeploy without the overlay derived SPA_DIAGNOSE=1 and
# took the knock service down); stopping here says why, before anything is derived.
AISHA_INSTANCE_CONFIG_DIR=""
_fetch_instance_overlay() {
  [ -n "${AISHA_INSTANCE_DATA_GIT_URL:-}" ] || return 0
  # ⛔ JEDEN DOMOV (2026-09-20). Klonování overlaye tu dřív žilo podruhé — a to
  # znamenalo i druhé chování při selhání. Když 2026-09-20 spadlo nasazení jádra
  # a obnovu bylo potřeba pustit `aisha-redeploy`, ten overlay získat NEUMĚL:
  # čekal, že mu cestu předá operátor. Výpadek veřejného API se tím prodloužil.
  # Získání tedy bydlí v `scripts/lib/instance-overlay.mjs` a volá ho KAŽDÝ
  # čtenář topologie; cold-start odtud jen přebírá cestu. Hlídá brána
  # `overlay-si-nastroj-obstara-sam`.
  if ! AISHA_INSTANCE_CONFIG_DIR="$(node -e '
      const m = await import(process.argv[1]);
      const d = m.ziskejDeklarovanyOverlay("aisha-cold-start");
      if (d) process.stdout.write(d);
    ' --input-type=module "${REPO_ROOT}/scripts/lib/instance-overlay.mjs" 2>&1)"; then
    err "  instance overlay unreachable (AISHA_INSTANCE_DATA_GIT_URL declared): ${AISHA_INSTANCE_CONFIG_DIR}"
    err "  refusing to fall back to the templates in config/profiles/: they describe another instance."
    exit 1
  fi
  export AISHA_INSTANCE_CONFIG_DIR
  if [ -f "$AISHA_INSTANCE_CONFIG_DIR/profiles/${AISHA_PROFILE:-}.json" ]; then
    info "  Profile '${AISHA_PROFILE:-}' resolved from the instance overlay"
  fi
}
_fetch_instance_overlay

# MANIFEST se výš (ř. ~172) resolvoval JEŠTĚ BEZ overlaye, protože ten se klonoval
# až za manifestovou bránou. Instanci, která inventář korektně drží v privátním
# overlayi, to hlásilo „Missing coolify/manifests/<story>.manifest" — příznak
# pořadí, ne chybějícího souboru (naměřeno 2026-09-02 na <fork>). Přepočítá se
# tady, kde overlay UŽ existuje; brána níž pak testuje skutečnou cestu.
MANIFEST="$(node "${REPO_ROOT}/scripts/lib/coolify-instance-scope.mjs" --manifest-path 2>/dev/null \
  || echo "${REPO_ROOT}/coolify/manifests/${STORY}.manifest")"
# Tentýž inventář pro všechny podřízené nástroje (redeploy čte z něj, co instance
# nasazuje) — story (manifest) se nemusí shodovat s prefixem aplikací.
export MANIFEST_FILE="$MANIFEST"

# ── Prereqs ───────────────────────────────────────────────────────────────────
for cmd in jq curl openssl python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Missing required command: $cmd"
    exit 1
  fi
done

# ── DEKLAROVANÉ DRŽENÍ APLIKACÍ: čte se DŘÍV, než běh na cokoli sáhne ────────
# ⛔ ZMĚŘENO ČTENÍM 2026-10-04: deklaraci držení (overlay instance,
# nasazeni-drzene.json) ctilo jen nasazení z CI. Tenhle skript ji nečetl vůbec —
# konvergence existující instance (`--skip-create`) by drženou aplikaci v kroku 3
# srovnala, v kroku 4 jí doručila env (včetně proměnných, jejichž nepřítomnost
# dnes její nasazení zastavuje) a v kroku 5 ji přenasadila: odpojení dat na
# prázdný svazek a spuštění služby, kterou provozovatel zastavil. `--wipe`
# a `--rewarmup` by ji smazaly i se svazky.
#
# Pravidla, validace a text hlášky mají JEDEN domov (lib/nasazeni-drzene.mjs);
# plniči jsou nástroje, které krok volá (story-init, deploy-init, sync-envs,
# redeploy) — každý si deklaraci čte sám, takže platí i při ručním spuštění.
# Tady se čte kvůli tomu, co dělá TENHLE skript (wipe, rewarmup, seed compose,
# souhrn), a hlavně kvůli STOPu: nečitelná nebo neplatná deklarace = nevíme, co
# smíme nasadit, a to se má říct před doktorem, ne po polovině nasazení.
# Instance bez overlaye nebo bez souboru = nic drženo — a řekne se to.
cs_nacti_drzeni() {
  # Soubor prostředí výslovně (revize cb N3): deklarace overlaye může ležet jen v něm
  # (pre_resolve_load_env načítá .env.local a zálohu) — bez něj by čtenář overlay neviděl.
  if ! drzeni_nacti "aisha-cold-start" "${ENV_COOLIFY:-}"; then
    err "Deklaraci držení aplikací nejde přečíst nebo je neplatná (důvod výš)."
    err "  Nevím, co je drženo, takže nevím, co smím nasadit — KONČÍM dřív, než se čehokoli dotknu."
    err "  „Nic drženo“ by tu bylo fail-open: držená aplikace by se přenasadila a přišla o data."
    exit 1
  fi
  if [ -z "$DRZENI_APLIKACE" ]; then
    info "Držení aplikací: ${DRZENI_POPIS}"
    return 0
  fi
  warn "Držení aplikací: ${DRZENI_POPIS}"
  while IFS= read -r _dr_hlaska; do
    [ -n "$_dr_hlaska" ] || continue
    warn "  ${_dr_hlaska}. Běh ji nezakládá, nesrovnává, nedoručuje jí env, nenasazuje, nerestartuje ani nemaže."
  done <<< "$(drzeni_vypis)"
  unset _dr_hlaska
}
cs_nacti_drzeni

# cs_role_aplikace <jméno aplikace v Coolify> — role bez prefixu instance
# (deklarace držení jmenuje role, Coolify plná jména).
cs_role_aplikace() { printf '%s' "${1#"${APP_NAME_PREFIX}"-}"; }

# cs_rewarmup_nesmi_drzenou — `--rewarmup` cíl zahodí i se svazky; u držené aplikace
# je to přesně to, čemu držení brání. Rozpor voleb = STOP, ne tiché vynechání cíle.
# Totéž EXTERNÍ služba (profil prostředí: external_domain): v tomhle prostředí není naše,
# a když v projektu přesto zbyla stará aplikace jejího jména (např. `<prefix>-keycloak`
# z doby, kdy ho prostředí vlastnilo), rewarmup by ji podle jména našel a smazal se svazky
# (revize integrátora 2026-10-04, bod 1). Úklid takové aplikace je ruční rozhodnutí.
cs_rewarmup_nesmi_drzenou() {
  [ -n "$REWARMUP_APPS" ] || return 0
  local _stary_ifs="$IFS" _cil
  IFS=','
  for _cil in $REWARMUP_APPS; do
    IFS="$_stary_ifs"
    _cil="$(printf '%s' "$_cil" | tr -d '[:space:]')"
    if [ -n "$_cil" ] && drzena "$(cs_role_aplikace "$_cil")"; then
      err "--rewarmup=${_cil}: $(drzeni_hlaska "$(cs_role_aplikace "$_cil")")."
      err "  Rewarmup by ji zahodil VČETNĚ SVAZKŮ. Držení se ruší v overlayi instance (nasazeni-drzene.json), ne přepínačem."
      exit 1
    fi
    if [ -n "$_cil" ] && externi "$(cs_role_aplikace "$_cil")"; then
      err "--rewarmup=${_cil}: $(vlastnictvi_hlaska "$(cs_role_aplikace "$_cil")")."
      err "  Rewarmup by aplikaci tohoto jména zahodil VČETNĚ SVAZKŮ — i kdyby v projektu zbyla, není to cíl rewarmupu."
      err "  Starou aplikaci odstraň ručně po ověření, čí data nese; vlastnictví se mění v profilu prostředí, ne přepínačem."
      exit 1
    fi
    IFS=','
  done
  IFS="$_stary_ifs"
}

# ── Iter 21 + 22a: deployment-config overlay + interactive prompt ─────────────
# .env.local + .env-prod-backup essentials were already loaded by
# pre_resolve_load_env() earlier (before resolve_target_env). This block is
# now solely the interactive prompt — kept here so the prompt fires after
# resolve_target_env validation (operator's COOLIFY_URL must be set first).
#
# Prompt for essentials when STDIN is a TTY (interactive run). Skip when
# called from CI / wrappers / pipes — those paths must supply env explicitly.
# Operator can also export AISHA_NO_PROMPT=1 to suppress (CI-friendly).
prompt_essentials() {
  if [ "${AISHA_NO_PROMPT:-0}" = "1" ] || [ ! -t 0 ]; then return 0; fi
  local need_save=0
  local missing=()

  # What do we still need?
  [ -z "${COOLIFY_PROJECT_NAME:-}" ] && missing+=("COOLIFY_PROJECT_NAME")
  if [ -z "${AISHA_TARGET_SERVER:-}" ]; then
    # Multi-host mode requires per-slot hostnames; check at least one
    [ -z "${FRONTEND_HOSTNAME:-}" ] && missing+=("FRONTEND_HOSTNAME")
  fi

  [ "${#missing[@]}" -eq 0 ] && return 0

  echo ""
  step "Interactive setup — operator config (writes to .env.local)"
  info "Some essential values are missing. Answer the prompts below or press Ctrl-C and"
  info "set them manually in .env.local + re-run. Skip prompts via AISHA_NO_PROMPT=1."
  echo ""

  if [ -z "${COOLIFY_PROJECT_NAME:-}" ]; then
    # Bez deklarované identity se tu NENABÍZÍ „aisha" — nabídnutá výchozí
    # hodnota je při AISHA_NO_PROMPT=1 přijata mlčky a stala by se z ní volba
    # cizí instance.
    local default_name="${APP_NAME_PREFIX:-${AISHA_STORY:-}}"
    read -r -p "  Coolify project name [${default_name}]: " ans
    COOLIFY_PROJECT_NAME="${ans:-$default_name}"
    export COOLIFY_PROJECT_NAME
    need_save=1
  fi

  if [ -z "${AISHA_TARGET_SERVER:-}" ] && [ -z "${FRONTEND_HOSTNAME:-}" ]; then
    echo ""
    echo "  Deployment variant:"
    echo "    1) Single-host  — all roles on ONE Coolify server"
    echo "    2) Multi-host   — separate frontend/backend/experimental/build servers"
    read -r -p "  Choose [1/2]: " variant
    if [ "$variant" = "1" ]; then
      read -r -p "  Single-host server name in Coolify: " AISHA_TARGET_SERVER
      export AISHA_TARGET_SERVER
      need_save=1
    else
      echo "  Server name in Coolify for each role (leave blank to skip):"
      read -r -p "    frontend (edge / web): " FRONTEND_HOSTNAME
      read -r -p "    backend  (DB / API):   " BACKEND_HOSTNAME
      read -r -p "    experimental (staging): " EXPERIMENTAL_HOSTNAME
      read -r -p "    build (CI build host):  " BUILD_HOSTNAME
      export FRONTEND_HOSTNAME BACKEND_HOSTNAME EXPERIMENTAL_HOSTNAME BUILD_HOSTNAME
      need_save=1
    fi
  fi

  # Optional capability gates — LLM providers, Sentry monitoring, etc.
  # Skippable (press enter). Stored alongside deployment config in .env.local
  # so they're available to all stacks that capability-gate on them.
  # Stays off if either: re-running (already saved before), or operator
  # exports AISHA_NO_OPTIONAL_PROMPT=1.
  if [ "${AISHA_NO_OPTIONAL_PROMPT:-0}" != "1" ] \
     && [ -z "${OPENAI_API_KEY:-}${ANTHROPIC_API_KEY:-}${GOOGLE_AI_API_KEY:-}${SENTRY_DSN:-}" ]; then
    echo ""
    echo "  Optional — capability keys (press enter to skip any):"
    echo "  These enable AI / monitoring features; deploy proceeds without them."
    read -r -p "    OPENAI_API_KEY (sk-…):     " OPENAI_API_KEY
    read -r -p "    ANTHROPIC_API_KEY (sk-…):  " ANTHROPIC_API_KEY
    read -r -p "    GOOGLE_AI_API_KEY:          " GOOGLE_AI_API_KEY
    read -r -p "    SENTRY_DSN (error tracking): " SENTRY_DSN
    if [ -n "${OPENAI_API_KEY:-}${ANTHROPIC_API_KEY:-}${GOOGLE_AI_API_KEY:-}${SENTRY_DSN:-}" ]; then
      export OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_AI_API_KEY SENTRY_DSN
      # If SENTRY_DSN was supplied, mirror to VITE_SENTRY_DSN for the web build.
      [ -n "${SENTRY_DSN:-}" ] && export VITE_SENTRY_DSN="${VITE_SENTRY_DSN:-$SENTRY_DSN}"
      need_save=1
    fi
  fi

  if [ "$need_save" = "1" ]; then
    {
      echo "# Auto-generated by scripts/aisha-cold-start.sh interactive prompt"
      echo "# $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
      echo "# Operator deployment-config overlay — gitignored via *.local."
      echo "# Add more keys here by hand; cold-start preserves them."
      echo ""
      echo "# ── Deployment target ──"
      echo "COOLIFY_PROJECT_NAME=${COOLIFY_PROJECT_NAME}"
      [ -n "${AISHA_TARGET_SERVER:-}" ] && echo "AISHA_TARGET_SERVER=${AISHA_TARGET_SERVER}"
      [ -n "${FRONTEND_HOSTNAME:-}" ]   && echo "FRONTEND_HOSTNAME=${FRONTEND_HOSTNAME}"
      [ -n "${BACKEND_HOSTNAME:-}" ]    && echo "BACKEND_HOSTNAME=${BACKEND_HOSTNAME}"
      [ -n "${EXPERIMENTAL_HOSTNAME:-}" ] && echo "EXPERIMENTAL_HOSTNAME=${EXPERIMENTAL_HOSTNAME}"
      [ -n "${BUILD_HOSTNAME:-}" ]      && echo "BUILD_HOSTNAME=${BUILD_HOSTNAME}"
      # ── Optional capability keys (only emit when set) ──
      if [ -n "${OPENAI_API_KEY:-}${ANTHROPIC_API_KEY:-}${GOOGLE_AI_API_KEY:-}${SENTRY_DSN:-}" ]; then
        echo ""
        echo "# ── Optional capability keys ──"
        [ -n "${OPENAI_API_KEY:-}" ]     && echo "OPENAI_API_KEY=${OPENAI_API_KEY}"
        [ -n "${ANTHROPIC_API_KEY:-}" ]  && echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
        [ -n "${GOOGLE_AI_API_KEY:-}" ]  && echo "GOOGLE_AI_API_KEY=${GOOGLE_AI_API_KEY}"
        [ -n "${SENTRY_DSN:-}" ]         && echo "SENTRY_DSN=${SENTRY_DSN}"
        [ -n "${VITE_SENTRY_DSN:-}" ]    && echo "VITE_SENTRY_DSN=${VITE_SENTRY_DSN}"
      fi
    } > "$ENV_LOCAL"
    chmod 600 "$ENV_LOCAL"
    ok "Saved deployment config + optional keys to $ENV_LOCAL"
    echo ""
  fi
}
prompt_essentials || true

if [ ! -f "$ENV_PROD_BACKUP" ]; then
  err "Missing $ENV_PROD_BACKUP"
  exit 1
fi

# ── Deklarovaná identita se POROVNÁVÁ s tou, kterou SoT už nese ──────────────
#
# ⛔ NAMĚŘENO 2026-08-20 na riqi. Běh spuštěný jako `AISHA_ENV=production` se
# ohlásil hlavičkou `story=aisha profile=<default> manifest=aisha.manifest`,
# přestože `.env.coolify` vedle nese `APP_NAME_PREFIX=riq`. Chyběl totiž
# `coolify-environments.env`, takže aisha-cold-start-env.sh spadl na svou
# ČTVRTOU prioritu — literál "aisha" — a tu identitu vyexportoval.
#
# Stráž níž (prázdné STORY) proto prošla: identita DEKLAROVANÁ byla, jen ne
# operátorem, nýbrž výchozí hodnotou. A běh mířil přepsat SoT instance `riq`
# jmény dárce — tedy přesně tu třídu vady, která tenhle stack už jednou
# položila (`N8N_DB_HOST=aisha-db`, hodina nedostupného n8n).
#
# ⛔ POZOR NA TVAR VÝJIMKY. První verze zněla `APP_NAME_PREFIX != _sot_prefix`,
# což vypadá jako „pusť jen výslovné přesměrování" — jenže wrapper exportuje
# APP_NAME_PREFIX ze SoT, takže se rovnala SoT a stráž se UMLČELA přesně v tom
# běhu, kvůli kterému vznikla (naměřeno 2026-08-20, SoT se stihl přepsat).
# Táž třída jako `${VAR:-${PREFIX:?…}}`: pojistka nedosažitelná právě tehdy,
# kdy je potřeba. Výjimka proto porovnává s STORY: kdo instanci opravdu
# přesměrovává, nastaví OBOJE na nové jméno.
#
# Výchozí hodnota není deklarace. Rozpor se proto NEHÁDÁ a NEOPRAVUJE — končí
# se PÁDEM, protože obě možnosti (přepsat SoT dárcem / mlčky pokračovat) jsou
# horší než zastavit. Kdo instanci opravdu přesměrovává, řekne to výslovně
# tím, že APP_NAME_PREFIX nastaví sám.
if [ -f "$ENV_COOLIFY" ]; then
  _sot_prefix="$(grep -m1 '^APP_NAME_PREFIX=' "$ENV_COOLIFY" 2>/dev/null | cut -d= -f2- | tr -d "\"' " || true)"
  if [ -n "$_sot_prefix" ] && [ -n "$STORY" ] && [ "$_sot_prefix" != "$STORY" ] \
     && [ "${APP_NAME_PREFIX:-}" != "$STORY" ]; then
    err "IDENTITA NESEDÍ — běh by přepsal SoT cizí instancí."
    err "  .env.coolify nese: APP_NAME_PREFIX=${_sot_prefix}"
    err "  tenhle běh míří na: STORY=${STORY} (manifest ${MANIFEST})"
    err ""
    err "Nejčastější příčina: chybí coolify-environments.env, takže se jméno"
    err "příběhu nedopočítalo a spadlo na výchozí hodnotu — ta ale NENÍ deklarace."
    err ""
    err "CO S TÍM: řekni identitu výslovně, např."
    err "  AISHA_STORY=${_sot_prefix} AISHA_PROFILE=${_sot_prefix} bash scripts/aisha-cold-start.sh …"
    err "NEDĚLEJ: nepřepisuj APP_NAME_PREFIX v .env.coolify, aby ta hláška zmizela —"
    err "tím se identita instance jen tiše přepne na dárcovu."
    exit 1
  fi
fi

if [ ! -f "$MANIFEST" ]; then
  if [ -z "$STORY" ]; then
    # Příčina, ne příznak: prázdné STORY vyrábí cestu ".../.manifest", a hláška
    # o chybějícím souboru pak posílala operátora hledat manifest místo identity.
    err "Identita instance NENÍ deklarovaná (prázdné AISHA_STORY i APP_NAME_PREFIX) —"
    err "proto neexistuje cesta k manifestu (${MANIFEST})."
    err "Deklaruj APP_NAME_PREFIX=<instance> v kterémkoli z kanálů, které se čtou:"
    err "  prostředí → .env.local → .env-prod-backup → .env.coolify"
  else
    err "Missing $MANIFEST"
  fi
  exit 1
fi

# ── Load tokens / target endpoint (avoid sourcing whole file) ────────────────
# Resolved through the shared canonical chain (lib/coolify-credentials.sh →
# lib/config-env-files.mjs): exported env first, then every config file this
# toolchain writes — not .env-prod-backup alone.
#
# That single file is written by cold-start only once the operator has taken a
# vault snapshot, so keying off it made the FIRST run on any stack unable to
# authenticate. The reverse-sync that builds the vault covers GENERATED secrets;
# COOLIFY_API_TOKEN is an operator credential and is not among them, so even a
# freshly reverse-synced vault does not contain it. Worse, the old line ignored
# an already-exported COOLIFY_API_TOKEN entirely (unlike COOLIFY_URL below),
# so exporting it by hand did not help either.
# shellcheck source=scripts/lib/coolify-credentials.sh
. "${REPO_ROOT}/scripts/lib/coolify-credentials.sh"
COOLIFY_API_TOKEN="$(config_env_key COOLIFY_API_TOKEN COOLIFY_API_KEY)"
COOLIFY_URL="$(config_env_key COOLIFY_URL COOLIFY_BASE_URL)"
# Both spellings of each credential are populated from the SAME resolution.
# The toolchain carries two names for one value (COOLIFY_API_TOKEN /
# COOLIFY_API_KEY, FORGEJO_API_TOKEN / FORGEJO_TOKEN) and later steps read
# whichever they were written against — step 2 checks COOLIFY_API_KEY, this
# block used to set only *_TOKEN, and the run died 1000 lines later with
# "COOLIFY_API_KEY prázdný" while the token was resolved and present.
# Filling both here means no consumer has to know which spelling it got.
export COOLIFY_API_TOKEN COOLIFY_API_KEY="$COOLIFY_API_TOKEN"
FORGEJO_TOKEN="$(config_env_key FORGEJO_TOKEN FORGEJO_API_TOKEN)"
export FORGEJO_TOKEN FORGEJO_API_TOKEN="$FORGEJO_TOKEN"

# VERDACCIO_TOKEN is needed BOTH as build-arg for 13 services that pull
# @aisha/security from npm.${INTERNAL_TLD} AND as a literal heredoc expansion in
# Step 2 (`VERDACCIO_TOKEN=${VERDACCIO_TOKEN:-}`). Without this export, the
# heredoc writes empty → every Coolify build fails with `npm error E401
# Unable to authenticate`. Source from .env-prod-backup if not already in
# the caller's shell env.
export VERDACCIO_TOKEN="$(config_env_key VERDACCIO_TOKEN)"

if [ -z "$COOLIFY_API_TOKEN" ]; then
  # Name the whole search path: "not found in <one file>" sent operators to add
  # the token to a file that is not even the one the rest of the toolchain reads.
  err "COOLIFY_API_TOKEN not found in env or any of: config/domains.env, .env.coolify, .env.local, .env-prod-backup, .env.aisha"
  exit 1
fi

if [ -z "${COOLIFY_URL:-}" ]; then
  err "COOLIFY_URL not set — set COOLIFY_URL in env/.env-prod-backup or run AISHA_ENV=production bash scripts/aisha-cold-start-env.sh ..."
  exit 1
fi

case "$COOLIFY_URL" in
  http://*|https://*) ;;
  *) err "COOLIFY_URL must be an absolute http(s) URL, got: $COOLIFY_URL"; exit 1 ;;
esac

ok "Loaded tokens (COOLIFY: ${#COOLIFY_API_TOKEN}ch, FORGEJO: ${#FORGEJO_API_TOKEN}ch)"

export COOLIFY_API_TOKEN FORGEJO_API_TOKEN COOLIFY_URL
export COOLIFY_BASE_URL="${COOLIFY_BASE_URL:-$COOLIFY_URL}"

for required_target_key in \
  COOLIFY_PROJECT_UUID \
  COOLIFY_ENVIRONMENT; do
  load_env_key_if_unset "$required_target_key"
done
# UUID serverů všech slotů registru (lib/sloty-serveru.mjs) — ne opsaný výčet.
if ! _sloty_registru="$(node "$REPO_ROOT/scripts/lib/sloty-serveru.mjs" --vsechny)"; then
  err "Sloty registru coolify/servers.json nejdou přečíst — nevím, která UUID serverů načíst."
  exit 1
fi
for _slot in $_sloty_registru; do
  load_env_key_if_unset "COOLIFY_SERVER_UUID_$(printf '%s' "$_slot" | tr '[:lower:]' '[:upper:]')"
done
unset _slot _sloty_registru

# ── Iter 19: Coolify UUID auto-discovery (project + per-server) ──────────────
# Runs after .env-prod-backup load + before require_loaded_env checks.
# Discovers any UUIDs the operator didn't pre-export, via Coolify API by-name
# lookup. Preserves existing values (no clobber). Supports:
#   - cloud-multi   — each slot mapped to its named server in Coolify
#   - cloud-single  — Coolify has 1 server → same UUID for every slot
#   - operator override — AISHA_TARGET_SERVER=frontend pins ALL slots to one
#     server's UUID even when Coolify has multiple (single-host deploy)
if [ -n "${COOLIFY_API_TOKEN:-}" ] && [ -n "${COOLIFY_URL:-}" ]; then
  step "Auto-discover Coolify UUIDs (project + servers)"
  # Záměr běhu jde do discovery prostředím: při DRY_RUN/WIPE projekt nikdy nezakládá.
  # Ne-produkční běh posílá i PIN svého projektu (PR2 izolace): discovery ho ověří
  # a hledání podle jména nic nerozhoduje. Když discovery ne-produkčního běhu selže
  # (zastaralý pin, nedostupné API), běh končí — bez ověřeného projektu se nepokračuje.
  _disc_pin=""
  cs_je_prod_env || _disc_pin="$CS_PROJEKT_PIN"
  _disc_rc=0
  _disc_tmp=$(env DRY_RUN="$DRY_RUN" WIPE="$WIPE" AISHA_PROJEKT_PIN="$_disc_pin" node "$REPO_ROOT/scripts/generate-coolify-context.mjs" \
    --env-coolify="${ENV_COOLIFY:-}" \
    --preserve=1) || _disc_rc=$?
  if [ "$_disc_rc" -ne 0 ]; then
    if cs_je_prod_env; then
      warn "Coolify discovery failed — continuing with existing/empty UUIDs"
    else
      err "IZOLACE: discovery ne-produkčního běhu AISHA_ENV=${AISHA_ENV} selhala (rc=${_disc_rc}) — výpis výš."
      err "  Bez ověřeného projektu se nepokračuje (připnuto: '${CS_PROJEKT_PIN}')."
      exit 1
    fi
  fi
  if [ -n "$_disc_tmp" ]; then
    eval "$_disc_tmp"
  fi
  # ⛔ ADRESA EDGE MUSÍ DOJÍT DO DĚTÍ (naměřeno 2026-10-06, první konvergence instance
  # s otevřenou lane modelového meshe, suchý běh). `eval` výstup discovery jen NASTAVÍ
  # (set -a tu neplatí) — jenže PUBLIC_EDGE_HOST_ADDR čte generate-secrets
  # (MODEL_MESH_VSTUP_ADDR) i simulace kroku 2 v doktoru, obojí jako DÍTĚ tohohle
  # shellu. Neexportovaná adresa = prázdný MODEL_MESH_VSTUP_ADDR = compose mostu
  # a řídicí roviny modelového meshe spadne na `:?` (doktor v kroku 0, ostrý běh v 2b).
  # V trezoru ta adresa není (je to POZOROVÁNÍ, ne deklarace), takže ji nic jiného
  # neexportuje. Brána: discovery-dojde-do-deti.
  if [ -n "${PUBLIC_EDGE_HOST_ADDR:-}" ]; then
    export PUBLIC_EDGE_HOST_ADDR
  fi
  unset _disc_tmp _disc_pin _disc_rc


  # AISHA_TARGET_SERVER override: pin every slot to one server's UUID. Used
  # when the operator wants single-host deploy even though Coolify has more
  # servers available (e.g. testing on frontend before promoting to multi-host).
  #
  # „Every slot" = každý slot, který pin smí vzít (lib/sloty-serveru.mjs
  # --pripnutelne): slot s výslovnou vazbou (has_gpu — GPU uzel i s firewallem
  # hostitele) se nepřišpendluje nikdy, jeho server musí být deklarovaný zvlášť.
  if [ -n "${AISHA_TARGET_SERVER:-}" ]; then
    _target_upper=$(printf '%s' "$AISHA_TARGET_SERVER" | tr 'a-z' 'A-Z')
    _target_key="COOLIFY_SERVER_UUID_${_target_upper}"
    _target_uuid="${!_target_key:-}"
    if ! _pripnutelne="$(node "$REPO_ROOT/scripts/lib/sloty-serveru.mjs" --pripnutelne)"; then
      err "Sloty k přišpendlení nejdou odvodit (coolify/servers.json) — AISHA_TARGET_SERVER nelze uplatnit."
      exit 1
    fi
    # ⛔ CÍL PINU MUSÍ BÝT PŘIPNUTELNÝ (revize accel-1, 10-05). `AISHA_TARGET_SERVER=gpu`
    # by vzal UUID GPU uzlu a přišpendlil na něj CELÝ hlavní stack (všechny
    # připnutelné sloty) — přesně to, co výslovná vazba slotu s GPU vylučuje.
    # Cíl mimo `--pripnutelne` (neznámý slot nebo slot s výslovnou vazbou) = STOP.
    # AISHA_TARGET_SERVER nese buď jméno SLOTU (frontend…), nebo jméno serveru v Coolify
    # (interaktivní dotaz výš). STOP tedy jen pro slot registru, který pin nesmí vzít,
    # a pro cíl, jehož UUID je server takového slotu (GPU uzel pod jiným jménem).
    _cil_slot="$(printf '%s' "$AISHA_TARGET_SERVER" | tr '[:upper:]' '[:lower:]')"
    if ! _vsechny_sloty="$(node "$REPO_ROOT/scripts/lib/sloty-serveru.mjs" --vsechny)"; then
      err "Sloty registru nejdou odvodit (coolify/servers.json) — AISHA_TARGET_SERVER nelze uplatnit."
      exit 1
    fi
    if grep -qx "$_cil_slot" <<< "$_vsechny_sloty" && ! grep -qx "$_cil_slot" <<< "$_pripnutelne"; then
      err "AISHA_TARGET_SERVER=$AISHA_TARGET_SERVER: slot s výslovnou vazbou (GPU uzel) nejde použít jako cíl jednouzlového pinu — přišpendlil by na něj celý hlavní stack. Připnutelné: $(printf '%s' "$_pripnutelne" | tr '\n' ' ')"
      exit 1
    fi
    for _vazany in $(printf '%s\n' "$_vsechny_sloty" | grep -vxF -f <(printf '%s\n' "$_pripnutelne")); do
      _vazany_key="COOLIFY_SERVER_UUID_$(printf '%s' "$_vazany" | tr '[:lower:]' '[:upper:]')"
      if [ -n "$_target_uuid" ] && [ "$_target_uuid" = "${!_vazany_key:-}" ]; then
        err "AISHA_TARGET_SERVER=$AISHA_TARGET_SERVER míří na server slotu '$_vazany' (výslovná vazba) — celý hlavní stack na GPU uzel nepatří."
        exit 1
      fi
    done
    unset _cil_slot _vsechny_sloty _vazany _vazany_key
    if [ -n "$_target_uuid" ]; then
      info "AISHA_TARGET_SERVER=$AISHA_TARGET_SERVER → pinning slots ($(printf '%s' "$_pripnutelne" | tr '\n' ' ')) to UUID ${_target_uuid:0:8}…"
      for _slot in $_pripnutelne; do
        export "COOLIFY_SERVER_UUID_$(printf '%s' "$_slot" | tr '[:lower:]' '[:upper:]')=$_target_uuid"
      done
      unset _slot _pripnutelne
    else
      warn "AISHA_TARGET_SERVER=$AISHA_TARGET_SERVER but ${_target_key} is empty — keeping per-slot UUIDs"
    fi
    unset _target_upper _target_key _target_uuid
  fi
fi

# Now enforce: every slot MUST be resolved (either from env, discovery, or
# operator override). Single-host operators set AISHA_TARGET_SERVER to make
# all slots share one UUID; cloud-multi has them per-server.
for required_target_key in \
  COOLIFY_PROJECT_UUID \
  COOLIFY_ENVIRONMENT; do
  require_loaded_env "$required_target_key"
done
# Akcelerační vrstva (GPU uzel): přepínače lane vrstvy (accel-hostfw, accel-vstup, accel-embed-<n>)
# plynou z deklarace uzlu v datech instance — načíst DŘÍV, než se odvodí sloty v provozu, jinak by
# první cold-start s novou deklarací GPU slot nevyžadoval. Vadná deklarace = STOP.
# shellcheck source=lib/accel-vrstva-env.sh
. "$REPO_ROOT/scripts/lib/accel-vrstva-env.sh"
nacti_env_vrstvy_accel "$REPO_ROOT" || {
  err "Deklaraci GPU uzlu (accel/uzel.json v datech instance) nejde vyložit — STOP dřív, než se cokoli nasadí."
  exit 1
}
# „Every slot" = každý slot V PROVOZU (lib/sloty-serveru.mjs: slot hostí aspoň
# jednu katalogovou službu s otevřenou lane), ne opsaný výčet. Povinné sloty
# vycházejí tytéž jako dřív; volitelný slot (GPU uzel `gpu`) se vyžaduje až když
# na něj instance něco nasazuje — lane vrstvy z deklarace uzlu (firewall hostitele,
# vstup lane, sloty enginů; accel-vrstva-env.sh výš), nebo přepis umístění
# v profilu (model forku) — a pak fail-closed TADY, ne až u zakládání aplikace.
# Nezměřený seznam je STOP: prázdná smyčka by nevyžadovala nic.
if ! _sloty_v_provozu="$(node "$REPO_ROOT/scripts/lib/sloty-serveru.mjs" --v-provozu --profil "${AISHA_PROFILE:-}")"; then
  err "Sloty v provozu NEODVOZENY (coolify/servers.json + config/services.json) — nevím, které servery vyžadovat."
  exit 1
fi
for _slot in $_sloty_v_provozu; do
  require_loaded_env "COOLIFY_SERVER_UUID_$(printf '%s' "$_slot" | tr '[:lower:]' '[:upper:]')"
done
unset _slot _sloty_v_provozu

# Discovery, zálohy i .env.local už proběhly — ne-produkční běh musí pořád mířit
# na svůj připnutý projekt. Hned tady, dřív než se z projektu cokoli čte.
cs_over_izolaci_projektu "po discovery a načtení souborů"

# ── Dynamic live-topology inheritance ─────────────────────────────────────────
# Topology-intent flags (MESH_ENABLED, INTRANET_ENABLED, AISHA_PROFILE) are operator
# decisions that can be flipped directly on the live Coolify apps at runtime — e.g. the
# NetBird mesh cutover set MESH_ENABLED=true on prod — WITHOUT being written back to
# .env-prod-backup. A --wipe that regenerated purely from local files would silently
# REVERT such a live change (deploy mesh=false over a mesh=true prod → mesh DNS with
# public routing → broken). To stay faithful AND fully dynamic (no hand-maintained
# flags), inherit these flags from the RUNNING prod when the operator has not set them
# locally. Precedence is preserved: operator-explicit (.env-prod-backup, loaded above)
# > live-prod-inherited (here) > profile / domains.env default (below). On a fresh
# cold-start there are no live apps to read, so nothing is inherited and the profile
# defaults apply — exactly right for a from-zero install.
inherit_live_topology_flags() {
  [ -n "${COOLIFY_URL:-}" ] && [ -n "${COOLIFY_API_TOKEN:-}" ] && [ -n "${COOLIFY_PROJECT_UUID:-}" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  local env_name apps probe envs key live
  env_name="${COOLIFY_ENVIRONMENT:-production}"
  apps=$(curl -sS --max-time 60 -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    "${COOLIFY_URL}/api/v1/projects/${COOLIFY_PROJECT_UUID}/${env_name}" 2>/dev/null | tr -d '\000-\037') || return 0
  # MESH_ENABLED / profile flags are SHARED topology env across the stack, so any
  # app carries them — prefer a core/edge app, else fall back to the first one.
  probe=$(printf '%s' "$apps" \
    | jq -r '.applications[]? | select(.name != null and (.name|test("core|edge|gateway|orchestration|ai-chat"))) | .uuid' 2>/dev/null | head -1)
  [ -n "$probe" ] && [ "$probe" != "null" ] || probe=$(printf '%s' "$apps" | jq -r '.applications[]?.uuid' 2>/dev/null | head -1)
  [ -n "$probe" ] && [ "$probe" != "null" ] || return 0
  envs=$(curl -sS --max-time 60 -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    "${COOLIFY_URL}/api/v1/applications/${probe}/envs" 2>/dev/null | tr -d '\000-\037') || return 0
  printf '%s' "$envs" | jq -e 'type=="array"' >/dev/null 2>&1 || return 0
  # ⛔ MESH_ENABLED se NEDĚDÍ z provozu (2026-08-26). Mesh je INVARIANT
  # platformy, ne stav, který se o sobě zjišťuje z běžícího nasazení.
  # Dokud tu byl, uzavíral smyčku: jednou nasazená `false` se dotáhla zpět
  # do resolveru, ten vydal slotové adresy místo meshových, edge jel
  # v režimu `public` — a další běh zdědil tutéž `false` znovu. Staré
  # nasazení tak určovalo nové odvození a nic to nepřerušilo.
  # Log to hlásil jako úspěch: „inherited MESH_ENABLED=false from live prod".
  for key in INTRANET_ENABLED AISHA_PROFILE; do
    [ -z "${!key:-}" ] || continue   # operator's explicit local value wins — never override it
    live=$(printf '%s' "$envs" | jq -r --arg k "$key" '.[] | select(.key==$k) | .value' 2>/dev/null | head -1)
    if [ -n "$live" ] && [ "$live" != "null" ]; then
      export "$key=$live"
      ok "topology: inherited ${key}=${live} from live prod (dynamic — no local override set)"
    fi
  done
}
inherit_live_topology_flags

# ── Load domain contract ──────────────────────────────────────────────────────
# Profile-driven topology (resolver) is now the DEFAULT path:
#   AISHA_PROFILE=cloud-multi (default — current production reality)
#                 cloud-single (1-server Coolify deployment)
#                 local-dev    (developer laptop with *.local domains)
#                 legacy       (skip resolver — sources config/domains.env directly)
#
# Verified by gate topology-domains-parity: cloud-multi profile produces
# byte-identical *_DOMAIN values to config/domains.env. Default flip is safe.
#
# See docs/deploy/STACK_TOPOLOGY.md for the full schema.
# ⛔ NAMĚŘENO 2026-09-01: tenhle řádek DOMAINS_FILE bezpodmínečně přepsal, takže
# per-env overlay (config/domains-<env>.env), který wrapper vyexportoval, se
# NIKDY nezdrojoval — komentář ve wrapperu (aisha-cold-start-env.sh:341) tvrdil
# opak. Následek: APP_NAME_PREFIX, WEB_FQDNS, KEYCLOAK_REALM ani veřejné hostnames
# instance se do nasazení nedostaly a Coolify si dosadil vygenerované
# `*.<server>.<tld>` hashe. Overlay se proto zachytí PŘED přepisem a aplikuje
# se níž, mezi resolverem a operátorským vaultem.
#
# ⛔ Tady se cesta JEN ZAPAMATUJE, nerozkládá. Privátní overlay se klonuje až
# o ~75 řádků níž (`_fetch_instance_overlay`), takže `AISHA_INSTANCE_CONFIG_DIR`
# je v tuhle chvíli ještě prázdný — rozklad na soubor se proto dělá až v místě
# použití, kde už checkout existuje. (Naměřeno při psaní téhle opravy: rozklad
# na tomhle řádku overlay v instance-data nikdy nenašel a tiše propadl na repo.)
# ⭐ EXPORTUJE SE (2026-10-05): env-doktor (krok 4) z něj čte deklaraci domén webu
# (WEB_FQDNS → odvozený klíč .env.coolify) přes TENTÝŽ rozklad jako níž
# (scripts/lib/domenovy-overlay.mjs) — prázdná hodnota = overlay nežádán.
export DOMAINS_OVERLAY_REQUESTED="${DOMAINS_FILE:-}"

DOMAINS_FILE="${REPO_ROOT}/config/domains.env"
if [ ! -f "$DOMAINS_FILE" ]; then
  err "Missing $DOMAINS_FILE — cannot derive domains"
  exit 1
fi

# ⛔ NAMĚŘENO 2026-08-22: tady stálo `${AISHA_PROFILE:-cloud-multi}`, zatímco
# derive-domains.mjs si na TUTÉŽ otázku dosazoval `cloud-single`. Jedna veličina,
# dvě různé vymyšlené odpovědi — a přitom je to TVAR NASAZENÍ, ze kterého se
# odvozuje celá topologie. Komentář navíc tvrdil, že cloud-multi je „the current
# production topology", což pro instanci s vlastním profilem není pravda.
#
# Profil je DEKLARACE, ne domněnka. Načítá se z .env-prod-backup (řádek ~277),
# takže sem doteče u každé instance, která ho má. Nemá-li ho, nevíme, jaký tvar
# se má postavit — a stavět náhodný tvar je horší než nepostavit nic.
if [ -z "${AISHA_PROFILE:-}" ]; then
  err "AISHA_PROFILE není deklarovaný — nevíme, jaký TVAR nasazení stavět."
  err "  Deklaruj ho v .env-prod-backup (nebo předej AISHA_PROFILE=<id>)."
  err "  Dosazený tvar by odvodil celou topologii z cizího profilu: jiné domény,"
  err "  jiné servery, jiná organizace — a nic by přitom nespadlo."
  exit 1
fi

# ── VLASTNICTVÍ APLIKACÍ V TOMHLE PROSTŘEDÍ ───────────────────────────────────
# Manifest je INVENTÁŘ instance (jeden pro všechna prostředí); co je v TOMHLE
# prostředí naše, říká efektivní profil: služba s `external_domain` běží jinde
# (např. sdílený Keycloak jiné instance) — nezakládá se, nenasazuje, nesrovnává,
# nemaže a nikdy se do ní neimportuje realm. Dřív o Keycloaku rozhodoval
# `grep '^app: *keycloak:'` nad manifestem, takže prostředí s cizím Keycloakem by
# ho „vlastnilo“. Odpověď má JEDEN domov (lib/vlastnictvi-aplikaci.mjs); tady se
# čte jednou, nahlas, a „nevím“ = konec dřív, než se čehokoli dotkneme.
cs_nacti_vlastnictvi() {
  if ! vlastnictvi_nacti "$MANIFEST"; then
    err "Vlastnictví aplikací v tomhle prostředí nejde určit (důvod výš)."
    err "  Nevím, co je tu naše, takže nevím, co smím zakládat, nasazovat a mazat — KONČÍM."
    exit 1
  fi
  info "Vlastnictví aplikací: ${VLASTNICTVI_POPIS}"
  while IFS= read -r _vl_hlaska; do
    [ -n "$_vl_hlaska" ] || continue
    warn "  ${_vl_hlaska}. Běh ji nezakládá, nesrovnává, nenasazuje, nemaže a realm do ní neimportuje."
  done <<< "$(vlastnictvi_vypis)"
  unset _vl_hlaska
}
# Volá se AŽ ZA rozkladem domén prostředí (blok topologie níž): profil může adresu externí
# služby deklarovat proměnnou (`external_domain: "${VAR}"`), kterou dodává teprve soubor
# domén z overlaye instance. Načteno dřív = proměnná ještě nenastavená = „nevím“
# (revize integrátora 2026-10-04 — dřív se tu „nevím“ tiše četlo jako „vlastní“).


if [ "$AISHA_PROFILE" != "legacy" ]; then
  step "Resolving topology via profile '${AISHA_PROFILE}' (mesh=${MESH_ENABLED:-false})"
  DERIVE_SCRIPT="${REPO_ROOT}/scripts/lib/derive-domains.mjs"
  if [ ! -f "$DERIVE_SCRIPT" ]; then
    err "AISHA_PROFILE set but $DERIVE_SCRIPT missing"
    exit 1
  fi
  # Sanity-check the topology before we use it (refuses to proceed on
  # broken depends_on / duplicate URLs / missing required services)
  #
  # ⛔ MANIFEST SE PŘEDÁVÁ, a to je celá pointa. Do 2026-09-04 se `--check`
  # volal bez něj, takže ověřoval jen VNITŘNÍ konzistenci topologie — a rozpor
  # „manifest zakládá 13 aplikací, topologie zná 12 služeb" neměřil nikdo.
  # Story-init aplikaci založí, resolver jí odmítne dát adresu a domains.env.example
  # díru zaplní věrohodným nesmyslem (`netbird.aisha.example.com`, `https://`).
  # (Doplňování z .example je od 2026-09-13 pryč — díra teď zůstane prázdná
  # a selže u spotřebitele; tahle kontrola ji pojmenuje dřív.)
  if ! node "$DERIVE_SCRIPT" --check ${MANIFEST:+--manifest="$MANIFEST"}; then
    err "Topology check failed for profile=${AISHA_PROFILE}"
    exit 1
  fi

  # Iter 14 — domains.env is template-only. The resolver fills *_DOMAIN
  # from operator env (.env-prod-backup) or profile JSON or .example fallback
  # (with stderr WARN). So we run the RESOLVER FIRST to populate *_DOMAIN
  # values, then source domains.env (whose composite refs like KEYCLOAK_URL
  # = https://${KEYCLOAK_DOMAIN} can now be expanded against the populated
  # env). This reverses the pre-iter-14 order.
  TOPOLOGY_ENV=$(mktemp -t aisha-topology.XXXXXX.env)
  trap "rm -f \"$TOPOLOGY_ENV\"" EXIT
  node "$DERIVE_SCRIPT" --shell > "$TOPOLOGY_ENV"
  set -a
  # shellcheck source=/dev/null
  . "$TOPOLOGY_ENV"
  set +a

  # Now source domains.env — composite values like KEYCLOAK_URL=https://${KEYCLOAK_DOMAIN}
  # expand against the just-populated *_DOMAIN vars. Plain assignments (which
  # are template-only / empty after iter 14) are silently overwritten by the
  # resolver output, so no value loss. For keys the operator HAS exported in
  # their .env-prod-backup, those win because they were set before this source.
  set -a
  # shellcheck source=/dev/null
  . "$DOMAINS_FILE"
  set +a

  # BUGFIX (mesh/intranet flag clobber): `. DOMAINS_FILE` with `set -a` sources the
  # committed domains.env UNCONDITIONALLY, so its hardcoded deployment-flag defaults
  # (MESH_ENABLED, INTRANET_ENABLED — the only non-empty plain scalars it carries)
  # overwrite BOTH the resolver's derived topology AND the operator's explicit
  # .env-prod-backup values — directly contradicting the comment above ("operator ...
  # those win"). Left uncorrected this silently deploys mesh=false even when the
  # operator/prod runs mesh=true (domains resolve to mesh DNS but the flag + upstream
  # selection stay public → broken routing). Restore the intended precedence
  # (domains.env template < resolver < operator). Composite URLs (only in domains.env,
  # absent from the two files below) already expanded, so nothing is un-resolved.
  load_env_file_keys "$TOPOLOGY_ENV" "overwrite"     # resolver topology (already read operator MESH_ENABLED)

  # Instanční doménový overlay — DEKLARACE instance bije obecné odvození
  # resolverem, ale operátorský vault níž má pořád poslední slovo. Sourcuje se
  # (ne load_env_file_keys), protože nese kompozity typu
  # PUBLIC_SITE_URL=https://${APP_DOMAIN}, které se musí expandovat; ty se v něm
  # definují až ZA svými skaláry, takže se rozvinou proti jeho vlastním hodnotám.
  # Base domains.env se pak přesourcuje, aby se jeho kompozity (KEYCLOAK_URL,
  # API_URL, …) přepočítaly proti doménám instance — je sebe-zachovávající
  # (`${VAR:-}`), takže skaláry instance přežijí; jediné, co vrací, jsou jeho
  # natvrdo psané deployment flagy, které hned poté znovu srovná resolver.
  # Rozklad cesty AŽ TADY: privátní overlay je v tuhle chvíli už naklonovaný
  # (`_fetch_instance_overlay` výš), takže `AISHA_INSTANCE_CONFIG_DIR` míří na
  # checkout. Hledá se ve dvou domovech, v tomhle pořadí: instance-data (kam
  # instanční deklarace PATŘÍ — viz derive-domains.mjs:251), teprve pak repo.
  # Rozklad má JEDEN domov: scripts/lib/domenovy-overlay.mjs (`--soubor`) — týž,
  # kterým env-doktor overlay najde i mimo cold-start (redeploy). Kód 3 =
  # nenalezeno; jiný nenulový kód = selhání nástroje, ne „overlay není".
  DOMAINS_OVERLAY_FILE=""
  if [ -n "${DOMAINS_OVERLAY_REQUESTED:-}" ]; then
    _dov_rc=0
    DOMAINS_OVERLAY_FILE="$(node "${REPO_ROOT}/scripts/lib/domenovy-overlay.mjs" --soubor "$DOMAINS_OVERLAY_REQUESTED")" || _dov_rc=$?
    if [ "$_dov_rc" -ne 0 ] && [ "$_dov_rc" -ne 3 ]; then
      err "  Rozklad doménového overlaye '${DOMAINS_OVERLAY_REQUESTED}' selhal (kód ${_dov_rc}) — NEPOKRAČUJU"
      exit 1
    fi
    # ⛔ VYŽÁDANÝ A NENALEZENÝ OVERLAY = KONEC (revize 2026-10-05, bod D). Dřív tu
    # bylo jen varování a běh pokračoval s doménami ze šablony: WEB_FQDNS ze shellu
    # pak byl PRÁZDNÝ („jedna značka") a krok 4 (doktor domén --apply) by web zúžil
    # a smazal routy značek. Bez deklarace instance se nepokračuje.
    if [ -z "$DOMAINS_OVERLAY_FILE" ]; then
      err "  Domain overlay '${DOMAINS_OVERLAY_REQUESTED}' requested but not found (instance-data ani repo) — instance domains would NOT be applied"
      err "  NEPOKRAČUJU: bez doménového overlaye by krok 4 zapsal domény ze šablony (web jen s APP_DOMAIN) a smazal routy značek."
      err "  Zpřístupni overlay instance (AISHA_INSTANCE_DATA_GIT_URL / AISHA_INSTANCE_CONFIG_DIR) nebo oprav COOLIFY_<ENV>_DOMAINS_FILE."
      exit 1
    fi
    unset _dov_rc
  fi

  if [ -n "${DOMAINS_OVERLAY_FILE:-}" ]; then
    info "  Domain overlay: $(basename "$DOMAINS_OVERLAY_FILE")"
    set -a
    # shellcheck source=/dev/null
    . "$DOMAINS_OVERLAY_FILE"
    set +a
    set -a
    # shellcheck source=/dev/null
    . "$DOMAINS_FILE"
    set +a
    load_env_file_keys "$TOPOLOGY_ENV" "overwrite"
    set -a
    # shellcheck source=/dev/null
    . "$DOMAINS_OVERLAY_FILE"
    set +a
  fi

  load_env_file_keys "$ENV_PROD_BACKUP" "overwrite"  # operator has the final say

  # ⛔ DOPLŇOVÁNÍ Z domains.env.example ODSTRANĚNO (naměřeno 2026-09-13).
  #
  # Tady stála smyčka „Iter 14 + 22": každý klíč, který po resolveru, šabloně
  # a operátorském vaultu zůstal PRÁZDNÝ, se exportoval s hodnotou z `.example`
  # a skončilo to jen varováním „filled unset keys from domains.env.example
  # (placeholder)". To je fallback na referenční hodnotu — `netbird.aisha.example.com`,
  # `web,corp` jako značkové aliasy — a přesně tudy prošel 2026-09-04 do produkce
  # forku `NETBIRD_DOMAIN=netbird.aisha.example.com` (manifest-ma-adresu-v-topologii).
  #
  # Změřeno na nasazené instanci (derive-domains --shell s prostředím z .env-prod-backup +
  # instance-data, pak config/domains.env, pak .env-prod-backup — pořadí téhle
  # sekce): smyčka doplňovala PŘESNĚ pět klíčů — CORE_MESH_HOST, EDGE_MESH_HOST,
  # LEDGER_MESH_HOST, INTEGRATION_MESH_HOST, BACKEND_MESH_HOST — a ty nečte žádný
  # kód. Po jejich odstranění z `.example` nedoplňovala nic. Kontrola „klíč
  # z .example po načtení chybí = chyba" by přitom nebyla pravdivá: část klíčů
  # je prázdná LEGITIMNĚ (AISHA_WEB_PUBLIC_ALIASES: „Empty → only the canonical
  # web host"). Povinnost klíče proto hlídá jeho SPOTŘEBITEL — `${X:?}` v compose
  # (krok 2b preflight-compose) a kontrakt env-doktora — ne vzorový soubor.
  #
  # `.example` je dokumentace tvaru, ne zdroj hodnot. Drží brána
  # src/tests/gates/example-neni-zdroj-hodnot.gate.test.ts.

  ok "Topology loaded: profile=${AISHA_PROFILE} mesh=${MESH_ENABLED:-false} (KEYCLOAK=${KEYCLOAK_DOMAIN:-?}, N8N=${N8N_DOMAIN:-?})"

  # ── MESH JMÉNO MUSÍ BÝT V DEKLAROVANÉ MESH ZÓNĚ ───────────────────────────
  #
  # ⛔ NAMĚŘENO 2026-08-25. `NETBIRD_MESH_HOST` byl v .env-prod-backup ukotvený
  # na `netbird.mesh.<veřejná TLD instance>` — zóně, kterou profil 2026-08-16 opustil
  # (přesun na `.internal`, protože ta veřejná se rozřešila wildcardem a mesh
  # tím neměla failure mode). Šablona ho umí dopočítat
  # (`${NETBIRD_MESH_HOST:-netbird.${MESH_TLD}}`), jenže `:-` se ptá jen když je
  # hodnota PRÁZDNÁ. Jednou zapsaná operátorská hodnota tak přežila zdroj,
  # ze kterého měla být odvozená.
  #
  # Projevilo se to o čtyři kroky dál a v cizí doméně: pki-bridge správně
  # odmítl vydat certifikát (`Forbidden: requested SAN(s) not in allowed
  # patterns`, forbidden=[netbird.mesh.<veřejná TLD>], allowed=[*.mesh.
  # <fork>.internal, …]) → pki-init exit 1 → netbird exited:unhealthy →
  # vlna 5 zastavena → mesh nevznikla → api 502, extranet 404. Hláška mluvila
  # o certifikátu, příčinou bylo jméno z jiné zóny.
  #
  # Kontrola je proto obecná: KAŽDÉ `*_MESH_HOST` musí končit deklarovanou
  # `MESH_TLD`. Fail-closed — dosadit správnou zónu by znamenalo tiše přepsat
  # operátorovu deklaraci, a ta může být záměrná (jiná zóna = jiná mesh).
  if [ "${MESH_ENABLED:-false}" = "true" ] && [ -n "${MESH_TLD:-}" ]; then
    _mesh_zone_bad=0
    while IFS='=' read -r _mh_key _; do
      [ -n "$_mh_key" ] || continue
      _mh_val="${!_mh_key:-}"
      [ -n "$_mh_val" ] || continue
      case "$_mh_val" in
        *".${MESH_TLD}") continue ;;
      esac
      if [ "$_mesh_zone_bad" -eq 0 ]; then
        err "Mesh jméno mimo deklarovanou zónu (MESH_TLD=${MESH_TLD}):"
      fi
      err "    ${_mh_key} = ${_mh_val}"
      _mesh_zone_bad=$((_mesh_zone_bad + 1))
    done < <(grep -oE '^[A-Z0-9_]+_MESH_HOST=' "$ENV_COOLIFY" 2>/dev/null | sort -u)
    if [ "$_mesh_zone_bad" -gt 0 ]; then
      err "  Tahle jména se odvozují z MESH_TLD, ale ukotvená hodnota přebíjí šablonu"
      err "  (\${VAR:-default} se ptá jen na PRÁZDNOU hodnotu). Zóna se přestěhovala,"
      err "  jméno zůstalo — a pki-bridge pak odmítne vydat certifikát pro cizí SAN."
      err "  Smaž ty klíče z .env-prod-backup a nech je dopočítat, nebo srovnej MESH_TLD."
      exit 1
    fi
    unset _mesh_zone_bad _mh_key _mh_val
  fi
else
  # Legacy fallback (opt-in via AISHA_PROFILE=legacy) — equivalent to the
  # pre-resolver world. Should only be needed if the resolver has a bug
  # operators need to bypass while a fix is on the way.
  warn "AISHA_PROFILE=legacy — bypassing topology resolver. Sourcing config/domains.env directly."
  set -a
  # shellcheck source=/dev/null
  . "$DOMAINS_FILE"
  set +a
  ok "Loaded domain contract from config/domains.env (APP=${APP_DOMAIN}, API=${API_DOMAIN}, STUDIO=${STUDIO_DOMAIN}, NOCODB=${NOCODB_DOMAIN})"
fi
# Vlastnictví aplikací — teď, když je profil i soubor domén prostředí rozložený (viz výš).
cs_nacti_vlastnictvi

# ── Verdaccio publish token — auto-mint from stored credentials ──────────────
# The static VERDACCIO_TOKEN read above from .env-prod-backup is a Verdaccio JWT
# that the registry signs with `jwt.sign.expiresIn: 30d` — once it expires every
# @aisha/* publish AND every Docker build's `npm install` of @aisha/* fails with
# `npm error E401` (incident 2026-06-13: a stale token blocked the whole deploy).
# If the vault carries VERDACCIO_USER + VERDACCIO_PASSWORD, mint a FRESH token
# here so it is never stale — generated each cold-start, never hardcoded.
# VERDACCIO_URL is now resolved (topology block above). Empty user/pass → keep
# the static token (back-compat). Soft: a mint failure keeps the static token
# and only warns (never aborts the cold-start).
export VERDACCIO_USER="${VERDACCIO_USER:-$(read_env_key "VERDACCIO_USER" "$ENV_PROD_BACKUP")}"
export VERDACCIO_PASSWORD="${VERDACCIO_PASSWORD:-$(read_env_key "VERDACCIO_PASSWORD" "$ENV_PROD_BACKUP")}"
if [ -n "${VERDACCIO_USER}" ] && [ -n "${VERDACCIO_PASSWORD}" ]; then
  _vmint="$(VERDACCIO_URL="${VERDACCIO_URL}" VERDACCIO_USER="${VERDACCIO_USER}" VERDACCIO_PASSWORD="${VERDACCIO_PASSWORD}" node "${REPO_ROOT}/scripts/verdaccio-mint-token.mjs" --check 2>/dev/null || true)"
  if [ -n "${_vmint}" ]; then
    export VERDACCIO_TOKEN="${_vmint}"
    ok "Verdaccio token auto-minted fresh (user=${VERDACCIO_USER}) — no 30-day expiry drift"
  else
    warn "Verdaccio token mint failed (VERDACCIO_USER set) — keeping existing VERDACCIO_TOKEN; @aisha/* publish/builds may E401 if it is stale"
  fi
  unset _vmint
fi

# ── App-name prefix (per-fork Coolify namespace) ─────────────────────────────
# Defaults to `aisha` (upstream evymo). Forks override via their
# config/domains-<env>.env overlay (e.g. a fork's staging overlay sets APP_NAME_PREFIX=acme).
# Used by resolve_uuid() to find existing Coolify apps and by `startswith()`
# jq filters so the cold-start operates on the fork's namespace, not upstream's.
# Default the app-name prefix to the STORY being cold-started (e.g. acme),
# NOT the literal "aisha" — otherwise a fork deploy that never set
# APP_NAME_PREFIX silently targets the upstream aisha-* apps. STORY already
# resolves AISHA_STORY (falling back to "aisha" for the upstream stack itself),
# so this stays backward-compatible. Exported so downstream scripts
# (coolify-deploy-init.sh, generate-coolify-context.mjs) inherit the same value.
if [ -n "${APP_NAME_PREFIX:-}" ]; then
  INSTANCE_DECLARED=1   # přišel z prostředí nebo z .env.coolify — to je deklarace
fi
APP_NAME_PREFIX="${APP_NAME_PREFIX:-${STORY}}"
export APP_NAME_PREFIX

# ── fail-closed: bez deklarované identity se dál nejde ───────────────────────
# Tady je jediný uzel, přes který teče VŠECHNO ostatní — cíl nasazení, jmenný
# prostor NetBirdu a hlavně rozsah WIPE. Když sem instance dorazí nedeklarovaná,
# dosadí se „aisha" a fork začne mířit na aplikace UPSTREAMU: 2026-08-04 takhle
# deploy z forku nasadil upstream `<upstream>-core`, tedy produkci jiného zákazníka. Že se
# nic nerozbilo, byla náhoda — build spadl dřív, než došlo na výměnu kontejnerů.
# U wipe by taková náhoda nepřišla.
#
# Dosazená hodnota se proto nepovažuje za odpověď. Upstream deklaruje svou
# identitu stejně jako kdokoli jiný (APP_NAME_PREFIX=aisha v .env.coolify);
# „nevím" je chyba, ne výchozí zákazník.
if [ "${INSTANCE_DECLARED}" != "1" ]; then
  err "Identita instance NENÍ deklarovaná: prázdné AISHA_STORY i APP_NAME_PREFIX."
  err "Dosazení výchozí hodnoty by z tohohle běhu udělalo zásah do cizí instance"
  err "(prefix by byl 'aisha-*'), včetně rozsahu WIPE. Deklaruj identitu:"
  err "  APP_NAME_PREFIX=<instance>   (nebo AISHA_STORY=<instance>)"
  err "v kterémkoli z těchto kanálů (v tomhle pořadí se čtou):"
  err "  prostředí → .env.local → .env-prod-backup → .env.coolify"
  err "Upstream stack deklaruje 'aisha' taky — „nevím\" není výchozí zákazník."
  exit 2
fi
# Provenance patří k odpovědi: u wipe rozhoduje, čí aplikace se smažou, a
# „odkud to víme" je pak stejně důležité jako sama hodnota.
ok "Using app-name prefix: ${APP_NAME_PREFIX}-* (story \"${STORY}\"; deklarováno v: ${AISHA_IDENTITY_SOURCE:-prostředí/.env.coolify})"
# Rozporné volby padají hned, jak je znám prefix (jména v --rewarmup jsou plná).
cs_rewarmup_nesmi_drzenou

# ── Zámek běhu — klíčovaný IDENTITOU INSTANCE, ne strojem ─────────────────────
#
# ⛔ NENÍ GLOBÁLNÍ, A TO JE PODSTATA. Na jednom operátorském stroji běží souběžně
# víc instancí (naměřeno 2026-09-02: vedle tohohle běhu jel deploy jiného forku
# proti témuž Coolify, v jeho vlastním projektu). Sahají na JINÉ aplikace v JINÉM
# projektu, takže si běžet legitimně smějí — globální zámek by z toho udělal
# frontu a zbytečně brzdil cizí nájemníky.
#
# Zakázat se musí jen dva běhy TÉŽE instance: ty si přepisují .env.coolify,
# spouštějí nasazení téže aplikace proti sobě a přetahují se o týž projekt.
# Klíč je proto tatáž dynamicky odvozená identita, na které stojí i rozsah wipe.
_ZAMEK_KLIC="${COOLIFY_PROJECT_UUID:-${APP_NAME_PREFIX}}"
_ZAMEK="${TMPDIR:-/tmp}/aisha-cold-start.${_ZAMEK_KLIC}.lock"
# `mkdir` je atomický — na rozdíl od `[ -e ] && touch`, kam se mezi kontrolu
# a zápis vejde druhý běh.
if mkdir "$_ZAMEK" 2>/dev/null; then
  printf '%s\n' "$$" > "$_ZAMEK/pid"
  date '+%Y-%m-%d %H:%M:%S' > "$_ZAMEK/od"
else
  _drzitel="$(cat "$_ZAMEK/pid" 2>/dev/null || true)"
  if [ -n "$_drzitel" ] && kill -0 "$_drzitel" 2>/dev/null; then
    err "Pro instanci '${_ZAMEK_KLIC}' už běh probíhá (PID ${_drzitel}, od $(cat "$_ZAMEK/od" 2>/dev/null || echo '?'))."
    err "  Dva souběžné běhy TÉŽE instance si přepisují .env.coolify a spouštějí"
    err "  nasazení téže aplikace proti sobě. Počkej na něj, nebo ho ukonči."
    err "  Zámek: ${_ZAMEK}"
    exit 1
  fi
  # Mrtvý držitel není držitel. Přebíráme — a nahlas, protože to znamená, že
  # předchozí běh skončil nečistě.
  warn "Zámek instance '${_ZAMEK_KLIC}' držel PID ${_drzitel:-?}, který už neběží — přebírám."
  warn "  Předchozí běh tedy skončil nečistě (zabit nebo spadl bez úklidu)."
  printf '%s\n' "$$" > "$_ZAMEK/pid"
  date '+%Y-%m-%d %H:%M:%S' > "$_ZAMEK/od"
fi

# ── Úklid a ZÁZNAM SIGNÁLU ───────────────────────────────────────────────────
#
# ⛔ NAMĚŘENO 2026-09-02: běh dvakrát zemřel s `Terminated: 15` uprostřed vlny 2
# a v logu po něm nezbylo NIC — ani který signál, ani kde to bylo. Bez toho se
# příčina nedá hledat, jen hádat; dvě zabití bez důkazu jsou korelace, ne nález.
#
# EXIT trap zároveň PŘEBÍRÁ úklid dočasného TOPOLOGY_ENV, který si výš
# registroval vlastní `trap ... EXIT`: bash drží na EXIT jen JEDEN handler,
# takže tenhle ten dřívější nahrazuje a musí jeho práci udělat taky.
_uklid() {
  if [ -n "${TOPOLOGY_ENV:-}" ]; then rm -f "$TOPOLOGY_ENV" 2>/dev/null || true; fi
  if [ -n "${_ZAMEK:-}" ] && [ "$(cat "$_ZAMEK/pid" 2>/dev/null || true)" = "$$" ]; then
    # Jmenovitě dva vlastní soubory + `rmdir`, žádné rekurzivní mazání: když by
    # cesta zámku kdy ukázala jinam, `rmdir` neprázdný adresář nesmaže.
    rm -f "$_ZAMEK/pid" "$_ZAMEK/od" 2>/dev/null || true
    rmdir "$_ZAMEK" 2>/dev/null || true
  fi
}
_zaznam_signal() {
  err "SIGNÁL ${1} — běh ukončen zvenčí."
  err "  krok:     ${_AKTUALNI_KROK}"
  err "  instance: ${_ZAMEK_KLIC}   PID: $$   čas: $(date '+%H:%M:%S')"
  err "  Tohle NENÍ vada nasazení — proces dostal signál. Hledej odesílatele."
  _uklid
  exit $((128 + ${2:-15}))
}
trap '_uklid' EXIT
trap '_zaznam_signal TERM 15' TERM
trap '_zaznam_signal INT 2' INT
trap '_zaznam_signal HUP 1' HUP


# ── Load image versions (single source of truth for IMAGE_* vars) ────────────
# Bez source-ování by compose fallback (`${IMAGE_X:-default}`) skončil v Coolify
# s defaulty z compose souborů. Source-ujeme aby env-doctor + sync-envs mohly
# propagovat aktuální verze do Coolify a lokální warmup používal stejné.
IMAGE_VERSIONS_FILE="${REPO_ROOT}/config/image-versions.env"
if [ -f "$IMAGE_VERSIONS_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$IMAGE_VERSIONS_FILE"
  set +a
  ok "Loaded image-versions.env (IMAGE_NETBIRD=${IMAGE_NETBIRD}, IMAGE_SYNAPSE=${IMAGE_SYNAPSE})"
else
  warn "config/image-versions.env missing — compose fallbacks will be used (deploy reproducibility weakened)"
fi

# ── Load timeout config (per-env tunable for slow networks/big stacks) ──────
TIMEOUTS_FILE="${REPO_ROOT}/config/cold-start-timeouts.env"
if [ -f "$TIMEOUTS_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$TIMEOUTS_FILE"
  set +a
  ok "Loaded cold-start-timeouts.env (WAVE_TIMEOUT=${AISHA_WAVE_TIMEOUT_S}s, STABLE_POLLS=${AISHA_STABLE_POLLS})"
fi

# ── Coolify target identity (explicit env contract; no code fallback) ───────
export COOLIFY_SERVER_UUID_FRONTEND
export COOLIFY_SERVER_UUID_BACKEND
export COOLIFY_SERVER_UUID_EXPERIMENTAL
export COOLIFY_SERVER_UUID_BUILD="${COOLIFY_SERVER_UUID_BUILD:-}"
export COOLIFY_SERVER_UUID_GPU="${COOLIFY_SERVER_UUID_GPU:-}"
export COOLIFY_PROJECT_UUID
export COOLIFY_ENVIRONMENT

# ── Coolify API helper ───────────────────────────────────────────────────────
# NOTE on --max-time: the `/applications` list endpoint serialises every app's
# embedded docker_compose_raw and can exceed 800 KB once the full stack exists.
# At 30 s the safety-check fetch timed out mid-body (curl 28) and returned an
# empty string — which the Step-1 caller mis-read as "Coolify is clean" and so
# SKIPPED the wipe entirely (incident 2026-06-03). 120 s gives that large body
# room while still bounding genuine hangs.
# ── JEDNA BRÁNA ZÁPISŮ DO COOLIFY (PR2 izolace, incident 2026-09-24) ──────────
# Kontroly izolace (cs_over_izolaci_projektu) stojí na vyjmenovaných místech běhu.
# Nová cesta, která by mezi nimi zapsala, by je obešla. Proto se ne-produkční běh
# ptá ZNOVU před KAŽDÝM zápisem, a to tady — coolify_api je jediná cesta, kudy
# cold-start do Coolify píše (brána `cold-start-izolace-prostredi` měří mutace
# celého běhu). Coolify v4 mutuje i přes GET: /deploy, /applications/*/start|stop|restart.
# Varianta bez `exit`: coolify_api běží i v `$(…)` a na pozadí — zápis tam NEODEJDE
# a volající dostane nenulu (97); nejbližší cs_over_izolaci_projektu běh zastaví.
cs_coolify_je_zapis() {
  case "$1" in POST|PUT|PATCH|DELETE) return 0 ;; esac
  case "${2%%\?*}" in
    /deploy|/applications/*/start|/applications/*/stop|/applications/*/restart) return 0 ;;
  esac
  return 1
}
cs_zapis_povolen() {
  cs_je_prod_env && return 0
  if [ -n "$CS_PROJEKT_PIN" ] && [ "${COOLIFY_PROJECT_UUID:-}" = "$CS_PROJEKT_PIN" ] \
    && { [ -z "$CS_PROD_PROJEKT_ZVENKU" ] || [ "$CS_PROJEKT_PIN" != "$CS_PROD_PROJEKT_ZVENKU" ]; }; then
    return 0
  fi
  err "IZOLACE (zápis do Coolify: $1): ne-produkční běh ${AISHA_ENV} nemíří na svůj připnutý projekt" \
    "(pin '${CS_PROJEKT_PIN}', cíl '${COOLIFY_PROJECT_UUID:-}') — požadavek NEODEŠEL."
  return 1
}

coolify_api() {
  local method="$1" endpoint="$2"
  shift 2
  if cs_coolify_je_zapis "$method" "$endpoint" && ! cs_zapis_povolen "$method $endpoint"; then
    return 97
  fi
  # ⛔ NAMĚŘENO 2026-09-13 (audit nad guru): bez `-f` končil curl nulou i na
  # HTTP 4xx/5xx, takže `coolify_api PATCH … && ok "Seeded"` hlásilo úspěch nad
  # odpovědí 422 — a reset sítí stejně. `--fail-with-body` vrátí nenulu a tělo
  # nechá na stdout (volající, kteří čtou JSON, ho pořád dostanou).
  # `--retry` opakuje přechodné chyby včetně HTTP 429 (rozpočet API je sdílený
  # s dalšími instancemi); bez `--retry-delay` curl ctí `Retry-After` serveru.
  curl -sS --max-time 120 --fail-with-body --retry 4 --retry-max-time 600 \
    -X "$method" \
    -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "${COOLIFY_URL}/api/v1${endpoint}" \
    "$@"
}

# ── Robust application-list fetch (fail-CLOSED) ──────────────────────────────
# Echoes a (control-char-stripped) JSON ARRAY of applications on success.
# Returns non-zero if every attempt fails or never yields a JSON array.
#
# WHY the project-scoped endpoint: the GLOBAL `GET /applications` serialises the
# embedded docker_compose_raw of EVERY app across EVERY project on the Coolify
# instance. Once the full AISHA stack exists that body grows past what the
# backend can stream inside curl's --max-time (observed: 120 s timeouts mid-body,
# curl 28 / 18, with the cold-start unable to ever list the apps — incident
# 2026-06-03 run6). The PROJECT-ENVIRONMENT-scoped endpoint
# `GET /projects/{uuid}/{environment}` returns only THIS project's apps and
# completes in ~32 s for the same stack. We prefer it and keep the global list
# as a fallback only when the project/environment identity is unknown.
#
# WHY fail-closed: both the Step-1 safety check and wipe_orphan_apps() decide
# "are there apps to wipe?" from this list. A transient API failure that yields
# an empty/garbage body must NOT be mis-read as "no apps" — that silently skips a
# requested wipe (incident 2026-06-03). Callers MUST abort when this returns
# non-zero rather than proceeding as if Coolify were empty.
coolify_list_apps_json() {
  local attempt raw env_name
  env_name="${COOLIFY_ENVIRONMENT:-production}"
  for attempt in 1 2 3 4 5 6; do
    # Preferred: project-environment-scoped list (small, completes reliably).
    if [ -n "${COOLIFY_PROJECT_UUID:-}" ]; then
      raw=$(coolify_api GET "/projects/${COOLIFY_PROJECT_UUID}/${env_name}" \
        | tr -d '\000-\037' \
        | jq -c '.applications // empty' 2>/dev/null)
      if [ -n "$raw" ] && echo "$raw" | jq -e 'type == "array"' >/dev/null 2>&1; then
        echo "$raw"
        return 0
      fi
    fi
    # Fallback: global list (slower, may time out — last resort).
    raw=$(coolify_api GET "/applications" | tr -d '\000-\037')
    if [ -n "$raw" ] && echo "$raw" | jq -e 'type == "array"' >/dev/null 2>&1; then
      echo "$raw"
      return 0
    fi
    [ "$attempt" -lt 6 ] && sleep $((attempt * 2))
  done
  return 1
}

# ── Project-scoped app enumeration (fail-loud) ───────────────────────────────
# coolify_scoped_apps <name-regex> — echo "<name>\t<uuid>" for every application
# in the DECLARED project's environments whose name matches <name-regex>
# (case-insensitive; omitted = all in-project apps).
#
# The project-scope boundary lives in ONE place — scripts/lib/coolify-project-
# scope.mjs, the SAME fail-loud filter the #605/#606 .mjs orchestration uses —
# so this never re-implements environment-id filtering in bash. On a shared
# Coolify host that runs many AISHA-based tenants, this is what guarantees a
# story/tenant wipe can only ever touch apps in ITS OWN project, never another
# tenant's aisha-* stack.
#
# Returns NON-ZERO (fail-loud) when the scope can't be resolved — no
# COOLIFY_PROJECT_UUID, the project owns 0 environments, or the list fetch fails.
# Destructive callers MUST abort on non-zero rather than fall back to a global
# name-prefix enumeration (which could delete a foreign tenant's stack).
coolify_scoped_apps() {
  local name_re="${1:-}"
  local -a scope_args=(--list-apps)
  [ -n "$name_re" ] && scope_args+=(--name-re="$name_re")
  COOLIFY_URL="${COOLIFY_URL:-}" \
  COOLIFY_API_TOKEN="${COOLIFY_API_TOKEN:-}" \
  COOLIFY_PROJECT_UUID="${COOLIFY_PROJECT_UUID:-}" \
    node "${REPO_ROOT}/scripts/lib/coolify-project-scope.mjs" "${scope_args[@]}"
}

# coolify_app_healthy <exact-app-name> — TRUE when the app's Coolify container status
# is running:healthy. MESH-INTEGRAL verification of INTERNAL (mesh-only) services: the
# operator (off-mesh) trusts each container's OWN healthcheck (which runs inside the
# mesh), read via the Coolify control plane — never an off-mesh HTTP probe to the
# service's *.mesh.<tld> domain (unreachable; that is what public edge faces are for).
coolify_app_healthy() {
  local name="$1" line
  line="$(COOLIFY_URL="${COOLIFY_URL:-}" COOLIFY_API_TOKEN="${COOLIFY_API_TOKEN:-}" COOLIFY_PROJECT_UUID="${COOLIFY_PROJECT_UUID:-}" \
    node "${REPO_ROOT}/scripts/lib/coolify-project-scope.mjs" --list-apps --with-status --name-re="^${name}$" 2>/dev/null | head -1)"
  printf '%s' "$line" | awk -F'\t' '{print $3}' | grep -q "running:healthy"
}

# aplikace_podle_compose <compose-soubor> — jméno aplikace (s prefixem instance),
# kterou manifest nasazuje z daného compose souboru. Návrat 1, když ho manifest
# nenasazuje.
#
# ⛔ NAMĚŘENO 2026-09-13 (dry-run nad guru): krok 6 čekal na zdraví aplikace
# `aisha-n8n`, jenže manifest nasazuje n8n jako `orchestration` → aplikace se jmenuje
# `<prefix>-orchestration`. Jméno napevno nesedělo na žádnou aplikaci, takže čekání
# 5 minut dotazovalo NIC a skončilo `exit 1` („n8n not ready") — a s ním se nespustil
# ani smoke test, kontrola domén, embed kickstart, úklid warmupu a restart validace.
# Napevno psané jméno navíc nese cizí prefix (fork `<fork>-*` by selhal stejně).
#
# Aplikaci proto určuje TO, CO SE NASAZUJE (compose soubor), a jméno dodává manifest
# instance — týž zdroj, podle kterého ji story-init založil.
aplikace_podle_compose() {
  local compose="$1" role
  # Jen VLASTNÍ aplikace (domov vlastnictví): na externí službu se nečeká.
  role="$(awk -F'\t' -v c="$compose" '$3 == c { print $1; exit }' <<< "$(vlastni_aplikace)")"
  [ -n "$role" ] || return 1
  printf '%s-%s' "$APP_NAME_PREFIX" "$role"
}

# ── Stack list (must match coolify/manifests/aisha.manifest) ─────────────────
# Phase 2 autopilot additions (llm-gateway, openclaw) are tier=optional and
# only deployed when their dependencies are configured (provider API keys,
# OpenClaw channel tokens). aisha-cold-start.sh resolves their UUIDs in
# Step 4 — if they're missing in Coolify the deploy-init loop simply skips.
# source-broker (federation RPC) is tier=optional too: coolify-story-init.sh
# provisions its Coolify app ONLY when SOURCE_API_URL is set, so for a
# non-federated fork its UUID stays empty and deploy-init skips it.
# local-ingest + potok (verified ingestion + flow-runtime loop) follow the
# same opt-in contract: provisioned ONLY when INGEST_BUNDLE_GIT_URL /
# POTOK_ENABLED are set, otherwise their UUIDs stay empty and deploy-init skips.
STACKS="core keycloak web extranet langfuse admin n8n matrix livekit pki ledger integration llm-gateway openclaw source-broker local-ingest potok"

# Odpovídá TENHLE běh za sdílený server (typ proxy v Coolify, proxy běžící na uzlu)?
# Jen produkční běh naostro: server je společný všem projektům na něm, ne-produkční
# běh ani dry-run ho měnit nesmí. JEDNA odpověď pro všechna místa — krok 4c podle ní
# zapisuje typ proxy (`coolify-server-proxy.mjs --apply`) a rozhoduje, jestli rozdíl
# nebo NEMĚŘENO končí nedokončeně, nebo varováním (proxy_serveru_krok_verdikt),
# závěrečné ověření podle ní měří kontejner proxy na uzlu (overeni_proxy_na_uzlu)
# a krok 0 podle ní říká doktorovi, co tenhle běh se serverem dělá
# (`--predlet-cold-startu=srovna|nemeni`).
# Víc kopií podmínky by se rozešlo: doktor by sliboval ověření, které se nespustí.
cs_beh_odpovida_za_sdileny_server() { [ "$DRY_RUN" != "1" ] && cs_je_prod_env; }

# ─────────────────────────────────────────────────────────────────────────────
step "0. PREFLIGHT DOCTOR (cold-start-doctor.sh)"
# ─────────────────────────────────────────────────────────────────────────────
# Read-only check všech preflight gates (env vars, files, manifest, API conn.).
# Bez něj cold-start může selhat až ve step 5 s nejasnou chybou. Doctor odhalí
# missing FORGEJO_TOKEN / COOLIFY_API_KEY / config drift v 5 sekundách.
#
# --skip-doctor je dovoleno pro emergency runs, ale ne doporučeno.

if [ "$SKIP_DOCTOR" = "1" ]; then
  warn "Skipped doctor (--skip-doctor) — letíš naslepo, dobře si rozmysli"
else
  # ⛔ SUCHÝ BĚH DOKTORA SPOUŠTÍ (2026-10-03). Dřív tu pro --dry-run stálo jen „Would run“ —
  # jenže doktor je jen čtení a právě jeho fatální nálezy (fáze D compose, odmítnutá
  # tajemství) ostrý běh zastaví. Suchý běh, který je nevidí, hlásil zelenou nad během,
  # který pak v okně nasazení spadl.
  if [ -x "${REPO_ROOT}/scripts/cold-start-doctor.sh" ]; then
    info "Running cold-start-doctor.sh (preflight readiness check)..."
    # ZÁMĚR BĚHU SE PŘEDÁVÁ. Bez něj doktor blokoval `--wipe` kvůli dvěma
    # aplikacím téhož jména — tedy kvůli stavu, který ten wipe sám odstraní
    # (smaže všechny aplikace projektu, manifest založí jednu). Fail-closed na
    # podmínku, kterou právě spuštěná operace ruší. Kolize s CIZÍM nájemníkem
    # zůstává blokující i s wipem — tam náš wipe nesahá.
    # Totéž pro SDÍLENÝ SERVER: jeho stav (typ proxy ve fázi F, kontejner proxy
    # na uzlu ve fázi V) nesmí v předletu zastavit žádný cold-start — produkční běh
    # ho teprve srovná a na konci ověří, ne-produkční ho měnit nesmí. Doktor se
    # proto VŽDY dozví, že jde o předlet cold-startu, a co tenhle běh se serverem
    # dělá; nálezy pak hlásí jako hlasité varování (samostatný doktor: FAIL).
    _doctor_args=()
    [ "$WIPE" = "1" ] && _doctor_args+=(--wipe-planned)
    if cs_beh_odpovida_za_sdileny_server; then _doctor_args+=(--predlet-cold-startu=srovna); else _doctor_args+=(--predlet-cold-startu=nemeni); fi
    # Konvergence existujícího stacku: doktor ověří, že krok 2 vyrobí všechna tajemství.
    [ "$SKIP_CREATE" = "1" ] && _doctor_args+=(--stack-exists)
    # Plánovaný rewarmup: přesun jmenovaných aplikací na jiný server provede sám.
    [ -n "${REWARMUP_APPS:-}" ] && _doctor_args+=("--rewarmup-planned=${REWARMUP_APPS}")
    set +e
    bash "${REPO_ROOT}/scripts/cold-start-doctor.sh" ${_doctor_args[@]+"${_doctor_args[@]}"}
    DOCTOR_RC=$?
    set +e
    case "$DOCTOR_RC" in
      0) ok "Doctor: READY" ;;
      2) warn "Doctor: READY with warnings — pokračuju, ale prohlédni si výpis výš" ;;
      *) if [ "$DRY_RUN" = "1" ]; then
           nedokonceno "Doctor: FATAL (exit $DOCTOR_RC) — ostrý běh by tady skončil (výpis výš)"
         else
           err "Doctor reported FATAL issues (exit $DOCTOR_RC) — opravu před spuštěním cold-startu."
           err "  Bypass: bash scripts/aisha-cold-start.sh --skip-doctor"
           exit 1
         fi ;;
    esac
  else
    warn "scripts/cold-start-doctor.sh nenalezen nebo není executable — skipping preflight"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "0b. BALÍČKY, KTERÉ SKRIPTY COLD-STARTU IMPORTUJÍ SESTAVENÉ"
# ─────────────────────────────────────────────────────────────────────────────
# ⛔ NAMĚŘENO 2026-10-03 (konvergence instance forku, krok 4): knock-provision → knock-roster.mjs
# importuje packages/knock-protocol/dist. dist je gitignorovaný a cold-start ho
# nikdy nesestavoval — v čerstvém (konvergenčním) stromu dveře padly; ve starém
# by tiše běžel ZASTARALÝ. Sestavuje se proto VŽDY a před prvním skriptem;
# seznam se odvozuje z importů skriptů (lib/balicky-pro-skripty.mjs).
if [ "$DRY_RUN" = "1" ]; then
  warn "[DRY RUN] Would build: $(node "${REPO_ROOT}/scripts/lib/balicky-pro-skripty.mjs" --seznam 2>&1 | tr '\n' ' ')"
elif node "${REPO_ROOT}/scripts/lib/balicky-pro-skripty.mjs" --sestav; then
  ok "Balíčky pro skripty sestavené z tohoto stromu"
else
  err "Sestavení balíčků pro skripty selhalo (výpis výše) — skripty cold-startu by je neměly, nebo staré."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
step "1. SAFETY CHECK — verify no AISHA apps exist on Coolify"
cs_over_izolaci_projektu "krok 1"
# ─────────────────────────────────────────────────────────────────────────────

# Allowlist of pre-existing infra apps that survive wipes (registry pull-through cache).
# App-name scope for the safety check + destroy. This is only the SECONDARY
# belt-and-braces filter: the PRIMARY boundary is the declared Coolify project
# (coolify_scoped_apps → coolify-project-scope.mjs, fail-loud), so this pattern
# never has to be safe on its own. It is derived from the STORY so a fork/tenant
# wipe targets ITS OWN <prefix>-* apps — the upstream stack keeps its legacy
# aisha-owned names (bare aisha, n8n, the evymo- era). Single source of truth —
# used by both the Step 1 safety check and wipe_orphan_apps (Step 2c). The
# preserved pull-through registry cache is likewise per-story.
# APP_NAME_PREFIX je tu VŽDY neprázdný — fail-closed kontrola výš běh zastaví
# dřív, než se sem dojde. `:-aisha` by tady bylo obzvlášť zrádné: vybírá regex,
# podle kterého se MAŽE.
if [ "${APP_NAME_PREFIX}" = "aisha" ]; then
  APP_NAME_PREFIX_RE='^aisha-|^evymo-|^aisha$|^n8n$'
  PRESERVED_APPS_REGEX='^(aisha-registry)$'
else
  APP_NAME_PREFIX_RE="^${APP_NAME_PREFIX}-"
  PRESERVED_APPS_REGEX="^(${APP_NAME_PREFIX}-registry)\$"
fi

# ── backup_vault_before_wipe ──────────────────────────────────────────────────
# refuse-wipe-unless-backed-up. The destroy below DELETEs apps WITH their Coolify
# env (delete_configurations) + volumes — that is the ONLY server-side copy of the
# stack secrets. Before destroying it we (1) REVERSE-SYNC the live secrets back into
# the vault (coolify-pull-envs.mjs — recovers any that live only in Coolify), (2)
# write a durable LOCAL snapshot of the complete vault, and (3) — when an age
# recipient is configured — push an age-ENCRYPTED snapshot to the private
# instance-data repo (off-machine DR). Returns non-zero → the caller REFUSES to
# wipe (mirrors the validate-before-destroy + placeholder guards). Escape hatch:
# AISHA_WIPE_SKIP_VAULT_BACKUP=1 (operator asserts they hold their own backup).
# EVERY failure below is a REFUSAL. Configuring a recipient means the operator asked
# for a copy that survives losing this machine; "kept LOCAL" is not a degraded
# success, it is the DR case failing silently — the exact class this function exists
# to prevent. Measured 2026-07-18, before this rewrite: `vault/` in the instance-data
# repo was EMPTY, i.e. the off-machine copy had never once been written, while every
# run reported success. Three independent causes, each returning 0:
#   - `age` was not installed (and is not in the script's Prerequisites list)
#   - the recipient was unset, so the whole branch was skipped with a warning
#   - AISHA_INSTANCE_DATA_GIT_URL carries a `#main` fragment which git does not
#     strip, so the clone could not have succeeded anyway (see lib/instance-data-url.sh)
backup_vault_age_to_instance_data() {
  local snap="$1" ts="$2" tmp verify rc=0
  command -v age >/dev/null 2>&1 || {
    err "  age not installed — cannot produce the off-machine encrypted backup."
    err "    brew install age    (or: apk add age)"
    return 1
  }

  # The identity is REQUIRED alongside the recipient: `age -r` accepts ANY well-formed
  # age1… string, so a typo'd, rotated or colleague's key encrypts cleanly and is
  # undecryptable forever. A backup nobody has proven they can open is not a backup,
  # so we round-trip it below — which needs the private key.
  if [ -z "${AISHA_VAULT_BACKUP_AGE_KEY_FILE:-}" ] || [ ! -f "${AISHA_VAULT_BACKUP_AGE_KEY_FILE}" ]; then
    err "  AISHA_VAULT_BACKUP_AGE_KEY_FILE is required alongside AISHA_VAULT_BACKUP_AGE_RECIPIENT."
    err "    The snapshot is round-trip verified (encrypt -> decrypt -> list) before any destroy,"
    err "    which needs the matching identity file. Point it at your age private key."
    return 1
  fi

  local enc="${snap}.age"
  if ! age -r "$AISHA_VAULT_BACKUP_AGE_RECIPIENT" -o "$enc" "$snap"; then
    err "  age encryption failed — check AISHA_VAULT_BACKUP_AGE_RECIPIENT (expects an age1... recipient)"; return 1
  fi
  chmod 600 "$enc"

  # ROUND-TRIP 1 — the ciphertext opens with the identity we hold, and what comes
  # out is a tarball carrying the vault.
  if ! age -d -i "$AISHA_VAULT_BACKUP_AGE_KEY_FILE" "$enc" 2>/dev/null \
       | tar -tz 2>/dev/null | grep -q '\./\.env-prod-backup$'; then
    err "  age ROUND-TRIP FAILED: the ciphertext does not decrypt to a tarball containing .env-prod-backup."
    err "    The recipient and the identity file do not match, or the archive is damaged."
    err "    REFUSING to wipe behind an unverifiable backup."
    return 1
  fi
  ok "  age-encrypted vault snapshot verified locally: $enc"

  if [ -z "${AISHA_INSTANCE_DATA_GIT_URL:-}" ]; then
    err "  AISHA_INSTANCE_DATA_GIT_URL is not set, but an age recipient IS configured."
    err "    Off-machine DR was requested and cannot be delivered. A local-only snapshot does"
    err "    not survive losing this machine — which is the whole DR case. REFUSING."
    return 1
  fi

  tmp="$(mktemp -d)"
  if ! clone_instance_data "$tmp/instance-data"; then
    rm -rf "$tmp"
    err "  clone of the instance-data repo FAILED — cannot publish the encrypted snapshot."
    err "    Check AISHA_INSTANCE_DATA_GIT_URL (token expired? repo unreachable? ref wrong?)."
    err "    REFUSING to wipe with no off-machine copy."
    return 1
  fi

  mkdir -p "$tmp/instance-data/vault"
  cp "$enc" "$tmp/instance-data/vault/vault-${ts}.age"
  cp "$enc" "$tmp/instance-data/vault/vault-latest.age"
  ( cd "$tmp/instance-data" \
    && git add vault/ \
    && git -c user.email="coldstart@aisha" -c user.name="aisha-cold-start" \
         commit -q -m "vault: encrypted snapshot ${ts} (pre-wipe)" \
    && git push -q origin HEAD ) || rc=$?
  rm -rf "$tmp"
  if [ "$rc" != "0" ]; then
    err "  push of the encrypted snapshot to instance-data FAILED (rc=$rc)."
    err "    REFUSING to wipe with no off-machine copy."
    return 1
  fi

  # ROUND-TRIP 2 — re-fetch what the REMOTE actually holds and decrypt THAT. A
  # successful push is not proof the object is retrievable (wrong branch, a
  # server-side hook rejection swallowed by -q, a partial pack).
  verify="$(mktemp -d)"
  if ! clone_instance_data "$verify/instance-data"; then
    rm -rf "$verify"
    err "  verification re-clone of instance-data FAILED — cannot prove the push landed. REFUSING."
    return 1
  fi
  if ! age -d -i "$AISHA_VAULT_BACKUP_AGE_KEY_FILE" \
        "$verify/instance-data/vault/vault-${ts}.age" 2>/dev/null \
       | tar -tz 2>/dev/null | grep -q '\./\.env-prod-backup$'; then
    rm -rf "$verify"
    err "  REMOTE VERIFY FAILED: vault/vault-${ts}.age is missing on the remote or does not decrypt."
    err "    REFUSING to wipe — the off-machine backup is not provably retrievable."
    return 1
  fi
  rm -rf "$verify"
  ok "  off-machine backup PROVEN: re-fetched vault/vault-${ts}.age and decrypted it"
  return 0
}

backup_vault_before_wipe() {
  # A dry run must not mutate the vault, must not write snapshots, and must not push
  # to a shared remote. Mirrors the guard in wipe_orphan_apps. This was missing:
  # verified 2026-07-18, two `--wipe --dry-run` invocations each wrote a real
  # .vault-backups/vault-*.tgz — a "show me the plan" run was reverse-syncing live
  # secrets and writing files.
  if [ "$DRY_RUN" = "1" ]; then
    info "  [dry-run] would reverse-sync, snapshot, verify and publish the vault — no state changed."
    return 0
  fi

  if [ "${AISHA_WIPE_SKIP_VAULT_BACKUP:-0}" = "1" ]; then
    warn "  AISHA_WIPE_SKIP_VAULT_BACKUP=1 — skipping pre-wipe vault backup (operator asserts an own backup)"
    return 0
  fi
  local ts backup_dir snap
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_dir="${REPO_ROOT}/.vault-backups"
  mkdir -p "$backup_dir" && chmod 700 "$backup_dir"

  # 1. Reverse-sync: complete the local vault from the live (about-to-be-wiped)
  #    Coolify store so the snapshot captures EVERY managed secret. Best-effort:
  #    a partially-down stack still lets us snapshot the existing local vault.
  # ⛔ VÝSTUP SE NEUMLČUJE. Do 2026-08-25 tu bylo `>/dev/null 2>&1` a nezdar
  # spadl do jediného žlutého řádku. Jenže tenhle krok je to JEDINÉ, co srovná
  # trezor se živým stackem PŘED zničením — a trezor má vyšší přednost než
  # `.env.coolify`, takže jeho zastaralá kopie se po wipu vnutí zpátky.
  # Naměřeno: mrtvé setup klíče (`setup key is invalid`) a starý bootstrap
  # secret (401) přežily přesně takhle. Co ten krok udělal (co doplnil, co
  # přerazil, co vyhodil — vše jen otiskem, nikdy hodnotou), musí být VIDĚT.
  #
  # BEZ ROURY ZÁMĚRNĚ: `node … | tee` by testovalo exit kód `tee`, ne nodu.
  # Zachránil by to `pipefail` (nastavený o 1300 řádků výš), ale tahle větev
  # nemá viset na nastavení, které je jinde a dá se omylem vypnout. Výstup
  # jde do souboru a vypíše se z něj.
  _reverse_sync_log="$(mktemp)"
  if node "${REPO_ROOT}/scripts/coolify-pull-envs.mjs" --out="$ENV_PROD_BACKUP" >"$_reverse_sync_log" 2>&1; then
    sed 's/^/      /' "$_reverse_sync_log"
    ok "  Reverse-synced managed secrets from live Coolify into the vault"
  else
    # Stack může být rozebraný a část tajemství pak z Coolify nepřečteme. To je
    # snesitelné — nesnesitelné je jít dál a NEVĚDĚT o tom.
    warn "  Reverse-sync from Coolify FAILED — trezor NEBYL srovnán se živým stackem."
    warn "  Wipe by pak obnovil hodnoty, se kterými stack neběžel. Výstup nástroje:"
    sed 's/^/      /' "$_reverse_sync_log" >&2
  fi
  rm -f "$_reverse_sync_log"

  # 2. Local snapshot (always-on floor; no key). Complete vault = .env-prod-backup
  #    (secrets) + .env.coolify (resolved env). mode 600. This is the recoverable
  #    copy that must exist before the destroy. Staged via a temp dir because the
  #    two files may live in DIFFERENT directories (ENV_PROD_BACKUP is operator-
  #    overridable — e.g. a worktree run pointing at the primary checkout's vault).
  snap="${backup_dir}/vault-${ts}.tgz"
  local stage had_any=0
  stage="$(mktemp -d)"
  if [ -f "$ENV_PROD_BACKUP" ]; then cp "$ENV_PROD_BACKUP" "${stage}/.env-prod-backup" && had_any=1; fi
  if [ -f "$ENV_COOLIFY" ]; then cp "$ENV_COOLIFY" "${stage}/.env.coolify" && had_any=1; fi
  if [ "$had_any" != "1" ]; then rm -rf "$stage"; err "  No vault files to snapshot (.env-prod-backup / .env.coolify absent) — cannot back up before wipe"; return 1; fi
  if ! tar -czf "$snap" -C "$stage" . 2>/dev/null; then rm -rf "$stage"; err "  Failed to write vault snapshot $snap"; return 1; fi
  rm -rf "$stage"
  chmod 600 "$snap"

  # 2b. PROVE the snapshot. A written file is not a backup until it has been re-read.
  #     Cheap: re-open the archive, assert both members are present, and assert the
  #     secrets file carries a plausible number of keys (a truncated or empty tar
  #     lists fine but restores nothing).
  local members keycount
  members="$(tar -tzf "$snap" 2>/dev/null)" || { err "  Vault snapshot is unreadable immediately after writing: $snap"; return 1; }
  printf '%s\n' "$members" | grep -q '\./\.env-prod-backup$' || { err "  Vault snapshot is missing .env-prod-backup — REFUSING to wipe."; return 1; }
  printf '%s\n' "$members" | grep -q '\./\.env\.coolify$'    || { err "  Vault snapshot is missing .env.coolify — REFUSING to wipe."; return 1; }
  keycount="$(tar -xzOf "$snap" ./.env-prod-backup 2>/dev/null | grep -cE '^[A-Z][A-Z0-9_]*=' || true)"
  if [ "${keycount:-0}" -lt 20 ]; then
    err "  Vault snapshot holds only ${keycount:-0} keys in .env-prod-backup — implausibly small."
    err "    REFUSING to wipe behind a snapshot that cannot restore the platform."
    return 1
  fi
  ok "  Vault snapshot written AND verified: $snap ($(wc -c <"$snap" | tr -d ' ') bytes, ${keycount} keys)"

  # 3. Off-machine layer (age → instance-data). REQUIRED for a wipe: a local-only
  #    snapshot dies with the machine, which is precisely the disaster it is meant to
  #    survive. Opting out is possible but must be an explicit, auditable assertion
  #    (AISHA_WIPE_SKIP_VAULT_BACKUP=1 above) rather than the silent default it was.
  if [ -n "${AISHA_VAULT_BACKUP_AGE_RECIPIENT:-}" ]; then
    backup_vault_age_to_instance_data "$snap" "$ts" || { err "  off-machine encrypted backup FAILED — REFUSING to wipe."; return 1; }
  else
    err "  AISHA_VAULT_BACKUP_AGE_RECIPIENT is not set — no off-machine backup is possible."
    err ""
    err "  A LOCAL snapshot alone does not survive losing this machine, so a --wipe behind it"
    err "  is not recoverable in the disaster it exists for. Verified 2026-07-18: the vault/"
    err "  directory in the instance-data repo was EMPTY — an off-machine copy had never once"
    err "  been written, while every run reported success."
    err ""
    err "  Bootstrap off-machine DR (once):"
    err "    brew install age                       # or: apk add age"
    err "    age-keygen -o ~/.aisha-vault-age.key   # PRIVATE key — store it in your password"
    err "                                           # manager, NOT only on this machine"
    err "    export AISHA_VAULT_BACKUP_AGE_RECIPIENT=<the age1... PUBLIC key it printed>"
    err "    export AISHA_VAULT_BACKUP_AGE_KEY_FILE=~/.aisha-vault-age.key"
    err ""
    err "  Or, if you hold your own verified backup, assert it explicitly:"
    err "    AISHA_WIPE_SKIP_VAULT_BACKUP=1 bash scripts/aisha-cold-start.sh --wipe"
    return 1
  fi
  return 0
}

# ── wipe_orphan_apps ──────────────────────────────────────────────────────────
# Destroy every Coolify application whose name matches $APP_NAME_PREFIX_RE
# (case-insensitive) except those matching $PRESERVED_APPS_REGEX. Re-enumerates
# live at call time, fires all DELETEs in parallel, then polls per-UUID until each
# is gone. Honours $WIPE_VOLUMES (purge named volumes + configs + connected
# networks) and $DRY_RUN (preview only — no state change). Idempotent: a no-op when
# nothing matches. Returns 0 on success.
#
# Called from Step 2c — AFTER generate (Step 2) + validate (Step 2b) — never from
# Step 1. That ordering is the validate-before-destroy invariant: a failed
# secret-gen or compose preflight aborts the run while the OLD platform is still
# intact, so it is never left wiped-but-undeployed (incident 2026-05-31).
wipe_orphan_apps() {
  local scoped uuid name i
  cs_over_izolaci_projektu "wipe_orphan_apps"
  # Fail-CLOSED + PROJECT-SCOPED: enumerate ONLY apps in the declared project
  # (coolify_scoped_apps → coolify-project-scope.mjs, fail-loud). A non-zero exit
  # (undeclared project / 0 environments / list failure) MUST abort the wipe: we
  # never fall back to a global name filter, which on a shared host could delete
  # another tenant's aisha-* stack (incident 2026-07-05). A failed list must also
  # never be mis-read as "no apps" and silently skip a requested wipe (incident
  # 2026-06-03).
  if ! scoped=$(coolify_scoped_apps "$APP_NAME_PREFIX_RE"); then
    err "wipe_orphan_apps: could not resolve the project scope (COOLIFY_PROJECT_UUID)"
    err "  or list its apps — REFUSING to wipe. A destructive wipe must stay confined to a"
    err "  declared project; a global name-prefix fallback could delete a foreign tenant's stack."
    exit 1
  fi

  local _uuids=() _names=()
  while IFS=$'\t' read -r name uuid; do
    [ -z "$uuid" ] && continue
    # PRESERVE guard — belt-and-braces on top of the project scope.
    printf '%s\n' "$name" | grep -qiE "$PRESERVED_APPS_REGEX" && continue
    # DRŽENÁ aplikace se NEMAŽE: wipe by ji zahodil i se svazky — tedy přesně ta
    # ztráta dat, které držení brání. Zůstává, jak je (i se svým starým env);
    # zbytek projektu se smaže.
    if drzena "$(cs_role_aplikace "$name")"; then
      warn "wipe_orphan_apps: $(drzeni_hlaska "$(cs_role_aplikace "$name")"). NEMAŽU ji ani její svazky (${uuid}); nová tajemství platformy NEDOSTANE."
      continue
    fi
    # EXTERNÍ služba (profil prostředí: external_domain) není v tomhle prostředí naše —
    # nikdy kandidát ke smazání, ani když aplikace jejího jména v projektu je.
    if externi "$(cs_role_aplikace "$name")"; then
      warn "wipe_orphan_apps: $(vlastnictvi_hlaska "$(cs_role_aplikace "$name")"). NEMAŽU ${name} (${uuid})."
      continue
    fi
    _names+=("$name")
    _uuids+=("$uuid")
  done <<< "$scoped"

  # bash 3.2 (macOS) errors on "${arr[@]}" when the array is empty under set -u,
  # so guard on the count before any [@] expansion.
  if [ "${#_uuids[@]}" -eq 0 ]; then
    ok "wipe_orphan_apps: no in-project apps to destroy."
    return 0
  fi

  # Build query string for destructive purge (volumes + configurations). Without
  # these flags Coolify retains named Docker volumes whose encrypted keys/state the
  # freshly-bootstrapped stack cannot decrypt (PKI_DEFAULT_SECRET regenerated,
  # OpenXPKI workflow hangs; Keycloak SCRAM mismatch; n8n encryption_key mismatch).
  # --keep-volumes opts out.
  local delete_qs=""
  if [ "$WIPE_VOLUMES" = "1" ]; then
    delete_qs="?delete_volumes=true&delete_configurations=true&delete_connected_networks=true"
  fi

  # DRY-RUN SAFETY: --dry-run MUST NOT destroy state. Preview, then return.
  # (Earlier a missing gate let `--wipe --dry-run` wipe 15/16 apps — incident
  # 2026-05-26. Don't repeat that.)
  if [ "$DRY_RUN" = "1" ]; then
    warn "[DRY RUN] Would DELETE ${#_uuids[@]} app(s) via Coolify API."
    for i in "${!_names[@]}"; do
      info "    - ${_names[$i]} (${_uuids[$i]})"
    done
    if [ "$WIPE_VOLUMES" = "1" ]; then
      info "  Volumes WOULD be purged (delete_qs=${delete_qs})"
    else
      info "  --keep-volumes set: volumes WOULD be retained"
    fi
    ok "[DRY RUN] Skipping actual DELETE — no state changed."
    return 0
  fi

  warn "wipe_orphan_apps: DELETE ${#_uuids[@]} app(s) via Coolify API (parallel)..."
  if [ "$WIPE_VOLUMES" = "1" ]; then
    info "  Volumes will be purged (set --keep-volumes to retain)."
  else
    warn "  --keep-volumes: Docker volumes retained (may cause crypto-state mismatch after secret rotation)."
  fi
  for uuid in "${_uuids[@]}"; do
    coolify_api DELETE "/applications/${uuid}${delete_qs}" >/dev/null 2>&1 &
  done
  wait  # počkej než se všechny DELETE requesty vrátí

  # Per-UUID verify: poll until each app disappears from the API (the list
  # endpoint is cache-stale for ~30s after DELETE; per-UUID GET is authoritative).
  # Each app prints its ✓ line exactly ONCE (on the poll where it's confirmed
  # gone) + a periodic remaining-count heartbeat. No cursor-up redraw: in-place
  # rewriting garbles output whenever a line wraps (cursor math under-shoots and
  # names overprint foreign rows — observed on the 2026-06-11 wipe).
  #
  # Lhůta, ne `while true`. Poll bez konce nemůže dojít k závěru „Coolify to
  # nedokáže" — jen čeká. 2026-08-13 se takhle u riqu točil 185 kol nad jedinou
  # aplikací, jejíž kontejnery byly dávno pryč; nesmazatelný byl jen její záznam,
  # protože Coolifymu přerostla tabulka logů nasazení strop paměti PHP a padal mu
  # i vlastní úklid zaseknutých úloh. Operátor viděl „still present" a nedozvěděl
  # se nic o příčině.
  info "Čekám na potvrzení smazání z Coolify API (per-UUID verify)..."
  # ⛔ ROZPOČET SE MĚŘÍ NA STÁNÍ, NE NA CELKOVÉM ČASE.
  #
  # NAMĚŘENO 2026-08-25: `--wipe` se vzdal po 300 s s hláškou „Coolify nepotvrdil
  # smazání 1 z 33" — a Coolify přitom pracoval SPRÁVNĚ. Jeho `DeleteResourceJob`
  # běží SÉRIOVĚ, jedna úloha po druhé, každá 30 s až 1 m 35 s. 33 aplikací tedy
  # trvá ~25 minut. Strop na celkový čas utnul frontu, která se poctivě hýbala:
  # po pádu skriptu domazala zbytek sama (10 → 7 → 4 → 2 → 1 během čtyř minut).
  #
  # Hypotéza o paměti PHP níž se přitom NEPOTVRDILA (`grep -c "memory size"` = 0),
  # takže hláška posílala operátora na špatnou stopu.
  #
  # Dokud počet zbývajících KLESÁ, čeká se dál — vzdát se smí jen tehdy, když se
  # nic nepohnulo. Týž tvar má čekání na místo ve frontě nasazení
  # (lib/coolify-http.mjs::waitForDeploymentSlot) i čekání na zdraví vlny.
  local _done=() all_gone remaining poll=0
  local _stall_s="${AISHA_WIPE_CONFIRM_TIMEOUT_S:-300}"
  # Absolutní strop se ODVOZUJE ze stání (dvanáctinásobek), ne z další
  # proměnné: je to pojistka proti nekonečnu, ne samostatné rozhodnutí.
  local _wipe_hard_cap_s=$(( _stall_s * 12 ))
  local _wipe_started=$(date +%s)
  local _wipe_deadline=$(( _wipe_started + _stall_s ))
  local _last_remaining=-1
  for i in "${!_uuids[@]}"; do _done[$i]=0; done
  while true; do
    all_gone=1
    remaining=0
    for i in "${!_uuids[@]}"; do
      [ "${_done[$i]}" = "1" ] && continue
      uuid="${_uuids[$i]}"
      name="${_names[$i]}"
      if coolify_api GET "/applications/$uuid" 2>/dev/null | jq -e '.uuid' >/dev/null 2>&1; then
        all_gone=0
        remaining=$((remaining + 1))
      else
        _done[$i]=1
        printf "  %b✓%b %s\n" "$GREEN" "$NC" "$name"
      fi
    done
    [ "$all_gone" = "1" ] && break
    # Ubylo? Pak se fronta hýbe a stání začíná znovu od nuly.
    if [ "$_last_remaining" -lt 0 ] || [ "$remaining" -lt "$_last_remaining" ]; then
      _last_remaining="$remaining"
      _wipe_deadline=$(( $(date +%s) + _stall_s ))
    fi
    if [ $(( $(date +%s) - _wipe_started )) -ge "$_wipe_hard_cap_s" ]; then
      err "wipe_orphan_apps: absolutní strop ${_wipe_hard_cap_s}s vyčerpán, zbývá ${remaining} z ${#_uuids[@]}."
      err "  KONČÍM: nasazovat přes zpola smazanou platformu je horší než nenasadit."
      return 1
    fi
    if [ "$(date +%s)" -ge "$_wipe_deadline" ]; then
      err "wipe_orphan_apps: ${remaining} z ${#_uuids[@]} aplikací se NEHNULO ${_stall_s}s (celkem čekáno $(( ($(date +%s) - _wipe_started) / 60 )) min)."
      for i in "${!_uuids[@]}"; do
        [ "${_done[$i]}" = "1" ] || err "    zůstává: ${_names[$i]} (${_uuids[$i]})"
      done
      err "  Kontejnery už zmizet mohly — nemizí ZÁZNAM, tedy úloha na straně Coolify."
      err "  Coolify maže SÉRIOVĚ (DeleteResourceJob, 30s–1m35s na aplikaci), takže"
      err "  „pomalu\" je normální — tahle hláška znamená, že se ${_stall_s}s nehnulo NIC."
      err "  Kolik úloh mazání ještě běží:"
      err "    ssh <coolify-host> 'docker logs --since 10m coolify 2>&1 | grep -c DeleteResourceJob'"
      err "  Další možná příčina (naměřeno 2026-08-13): řídicí rovina Coolify nedokončuje úlohy,"
      err "  protože jí tabulka logů nasazení přerostla strop paměti PHP. Pozná se takhle:"
      err "    ssh <coolify-host> 'docker logs --since 10m coolify 2>&1 | grep -c \"memory size\"'"
      err "  Nenulový výsledek = padá i Coolifyho vlastní cleanup:stucked-resources, takže"
      err "  se ten stav sám nespraví. Náprava je na straně Coolify (pročistit logy nasazení,"
      err "  zvednout PHP_MEMORY_LIMIT), pak spusť --wipe znovu."
      err "  KONČÍM: nasazovat přes zpola smazanou platformu je horší než nenasadit."
      return 1
    fi
    poll=$((poll + 1))
    if [ $((poll % 5)) -eq 0 ]; then
      info "  … ${remaining}/${#_uuids[@]} app(s) still present (poll ${poll})"
    fi
    sleep 2
  done
  ok "wipe_orphan_apps: all matching apps destroyed."
  return 0
}

EXISTING_SCOPED=$(coolify_scoped_apps "$APP_NAME_PREFIX_RE") || {
  # Fail-CLOSED + PROJECT-SCOPED: if we can't resolve the project scope and list
  # its apps we must NOT conclude "clean" and skip the wipe (incident 2026-06-03 —
  # a timeout on the ~884 KB /applications body made the safety check declare an
  # empty platform and the requested --wipe never ran). The scope resolution is
  # also fail-loud (no global fallback), so the safety check can never inspect —
  # nor a later --wipe destroy — a foreign tenant's stack (incident 2026-07-05).
  err "SAFETY CHECK: could not resolve the project scope (COOLIFY_PROJECT_UUID) or list its apps."
  err "  REFUSING to proceed — a transient failure or missing project must never be read as"
  err "  'no apps to wipe', nor allow a global-prefix wipe that could hit another tenant."
  exit 1
}
# Names only, minus the preserved pull-through cache — the same PRESERVE guard the
# destroy applies. awk (not grep -v) so an all-preserved result never trips set -e.
EXISTING=$(printf '%s\n' "$EXISTING_SCOPED" | awk -F'\t' -v keep="$PRESERVED_APPS_REGEX" 'NF && $1 !~ keep {print $1}' | sort)
if [ -n "$EXISTING" ]; then
  warn "Found existing in-project apps (excluding preserved infra):"
  echo "$EXISTING" | sed 's/^/    /'
  if [ "$WIPE" = "1" ]; then
    # ── PRE-WIPE GUARD (2026-05-31) — never destroy if domains can't resolve ──
    # A wipe is generational. The cloud-multi profile ships NULL TLDs; if
    # PUBLIC_TLD / INTERNAL_TLD / MESH_TLD aren't supplied by operator env, the
    # topology resolver yields empty edge-proxy upstreams and step-2b preflight
    # aborts — which (on the 2026-05-31 run) left the platform WIPED and
    # undeployed because the wipe ran BEFORE that validation. Validate the
    # required TLDs are present BEFORE deleting anything; refuse otherwise so the
    # platform is never left wiped-but-undeployed.
    # TLDs may live in .env-prod-backup (the production state vault), so load
    # it safely here too. This guard must never reject a valid prod backup and
    # must never source arbitrary shell from the backup.
    if ! (
      set -a
      [ -f "$DOMAINS_FILE" ] && . "$DOMAINS_FILE" 2>/dev/null
      [ -f "$ENV_LOCAL" ]    && . "$ENV_LOCAL"    2>/dev/null
      set +a
      load_env_file_keys "$ENV_PROD_BACKUP" "overwrite"
      [ -n "${PUBLIC_TLD:-}" ] && [ -n "${INTERNAL_TLD:-}" ] && [ -n "${MESH_TLD:-}" ]
    ); then
      err "PRE-WIPE GUARD: PUBLIC_TLD / INTERNAL_TLD / MESH_TLD are not all set."
      err "  The cloud-multi profile ships null TLDs — the operator must supply them."
      err "  Set them in .env.local (or .env-prod-backup), e.g.:"
      err "    PUBLIC_TLD=<public-edge-tld>  INTERNAL_TLD=<per-server-tld>  MESH_TLD=<mesh-tld>"
      err "  REFUSING TO WIPE — platform left intact (prevents wiped-but-undeployed)."
      exit 1
    fi
    ok "Pre-wipe guard: topology TLDs present (PUBLIC/INTERNAL/MESH) ✓"

    # ── DEFER THE DESTROY (validate-before-destroy) ───────────────────────────
    # The actual DELETE used to run HERE — before secret-gen (Step 2) and compose
    # preflight (Step 2b). A failure in those later steps then left the platform
    # WIPED-but-undeployed (incident 2026-05-31). We now only AUTHORISE the wipe
    # here and DEFER the destroy to Step 2c, after generate+validate succeed.
    # Bonus: Step 2's per-app contract check + Step 2b preflight now run while the
    # OLD apps still exist, so they validate against something real instead of
    # passing vacuously against an already-emptied Coolify.
    # The destroy itself lives in wipe_orphan_apps() (defined above) — it
    # re-enumerates by $APP_NAME_PREFIX_RE, honours --dry-run / --keep-volumes,
    # and verifies per-UUID.
    if [ "$SKIP_ORPHAN_CLEANUP" = "1" ]; then
      warn "--skip-orphan-cleanup with --wipe: existing apps will NOT be destroyed."
      warn "  Step 3 create may then conflict with the surviving apps — debugging / escape-hatch only."
    else
      WIPE_PENDING=1
      info "--wipe authorised — destroy DEFERRED to Step 2c (runs after secrets + compose validation)."
    fi
  elif [ -n "$REWARMUP_APPS" ]; then
    # REWARMUP je TŘETÍ legitimní tvar běhu vedle „čerstvá instalace" a „--wipe".
    # Existující aplikace tu nejsou překážkou — jsou ZÁMĚREM: přestavuje se jen
    # jmenovaný cíl (krok 2d) a zbytek platformy zůstává, jak je. Bez téhle větve
    # by rewarmup spadl v kroku 1 dřív, než se ke kroku 2d vůbec dostane, protože
    # `--skip-create` mít NESMÍ (to by cíl nikdo nezaložil). Vlastní vada návrhu,
    # naměřená při prvním ověřovacím běhu 2026-08-18.
    info "Existující aplikace jsou pro rewarmup v pořádku — přestavuje se jen: ${REWARMUP_APPS}"
    info "  Krok 2d cíl zahodí i s volumes, krok 3 ho založí znovu; ostatních se nedotkne."
  elif [ "$SKIP_CREATE" = "0" ] && [ "$DRY_RUN" = "0" ]; then
    err "Refusing to recreate. Either DELETE these first, use --skip-create, --rewarmup=<app>, or use --wipe"
    exit 1
  fi
else
  ok "Coolify is clean — no AISHA apps present (preserved: registry)"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "2. GENERATE FRESH SECRETS"
# ─────────────────────────────────────────────────────────────────────────────

# ── Konvergence existující instance: trezor nesmí být starší než živý stack ──
# ⛔ NAMĚŘENO 2026-10-04 (předlet forku nad W1): krok 2 bere spravovaná tajemství
# z trezoru a krok 4 je pošle do Coolify. Hodnota změněná v Coolify po poslední
# záloze (rotace, ruční oprava) se tak TIŠE přetočí zpátky — u hesla DB nebo
# šifrovacího klíče proti datům, která už nesou tu novou. Zpětná synchronizace
# (coolify-pull-envs.mjs) běží jen před wipem; konvergence ji neměla vůbec.
# Proto tady KONTROLA (nic nezapisuje): rozchod i „nevím“ = STOP před prvním zápisem.
# Srovnání je vědomý krok obsluhy (převzít živé hodnoty, nebo vysvětlit rozdíl),
# ne tichý zásah nástroje.
if [ "$SKIP_CREATE" = "1" ]; then
  info "Trezor × živý stack (spravovaná tajemství, jen otisky)…"
  _zive_log="$(mktemp)"
  _zive_rc=0
  node "${REPO_ROOT}/scripts/coolify-pull-envs.mjs" --check --out="$ENV_PROD_BACKUP" >"$_zive_log" 2>&1 || _zive_rc=$?
  sed 's/^/      /' "$_zive_log"
  rm -f "$_zive_log"
  case "$_zive_rc" in
    0) ok "  Trezor odpovídá živým hodnotám spravovaných tajemství" ;;
    3)
      err "STOP: trezor ($ENV_PROD_BACKUP) neodpovídá živému stacku — krok 2 by tajemství výš přetočil."
      err "  Živé hodnoty převezmi do trezoru: node scripts/coolify-pull-envs.mjs --out=\"$ENV_PROD_BACKUP\""
      err "  (před zásahem uloží .pred-reverse-sync), nebo rozdíl vysvětli — a spusť konvergenci znovu."
      exit 1
      ;;
    *)
      err "STOP: shodu trezoru se živým stackem nejde změřit (kód ${_zive_rc}) — bez ní konvergenci nespouštím."
      exit 1
      ;;
  esac
  unset _zive_log _zive_rc
fi

# Helper: generate base64 secret of N bytes
gen_secret() {
  # URL-safe base64 secret. Retry pokud první znak je `-` — řada CLI nástrojů
  # (mc, gh, kubectl, ...) parsuje leading `-` jako flag → 'flag provided but
  # not defined: -<rest>'. Stripping by zkrátil entropy → retry je čistší.
  local s
  while :; do
    s=$(openssl rand -base64 "$1" | tr -d '\n=' | tr '/+' '_-')
    [ "${s:0:1}" != "-" ] && { printf '%s' "$s"; return; }
  done
}

# Helper: generate AISHA JWT (anon or service_role) signed by JWT_SECRET
# Note: iss="aisha"; PostgREST honours the `role` claim and doesn't validate
# iss unless PGRST_JWT_AUD is set, so we can switch the issuer safely.
gen_aisha_jwt() {
  local role="$1" jwt_secret="$2"
  python3 - <<PY
import base64, hmac, hashlib, json, time
secret = "$jwt_secret".encode()
header = {"alg": "HS256", "typ": "JWT"}
payload = {
  "role": "$role",
  "iss": "aisha",
  "iat": int(time.time()),
  "exp": int(time.time()) + 60*60*24*365*15  # 15 years
}
def b64u(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
h = b64u(json.dumps(header, separators=(',', ':')).encode())
p = b64u(json.dumps(payload, separators=(',', ':')).encode())
sig = b64u(hmac.new(secret, f"{h}.{p}".encode(), hashlib.sha256).digest())
print(f"{h}.{p}.{sig}")
PY
}

# Preserve selected stateful DB credentials by default to avoid auth breakage
# on existing volumes (e.g., Keycloak SCRAM mismatch after secret rotation).
existing_env_value() {
  local key="$1"
  [ -f "$ENV_COOLIFY" ] || return 0
  grep -E "^${key}=" "$ENV_COOLIFY" | head -1 | cut -d= -f2-
}

# preserve_or_gen — pokud PRESERVE_STATEFUL_SECRETS=1 a KEY už je v .env.coolify
# s neprázdnou hodnotou, vrátí ji. Jinak spustí generator (zbytek argumentů)
# a vrátí jeho stdout. Idempotentní napříč cold-start runs (mimo --wipe scenario,
# kdy chceme úplnou rotaci — to operátor řeší smazáním .env.coolify před runem).
#
# Reason: stateful DB volumes + JWT-signed credentials + OIDC client secrets se
# nesmí ztratit jen proto, že někdo spustil cold-start podruhé. Bez tohoto hint
# helperu by každý cold-start invalidoval všechny existující access tokeny,
# rozbil by Keycloak realm imports, langfuse trace history, n8n workflow creds atd.
preserve_or_gen() {
  local key="$1"; shift
  if [ "${PRESERVE_STATEFUL_SECRETS:-1}" = "1" ] && [ -f "$ENV_COOLIFY" ]; then
    local existing
    existing="$(grep -E "^${key}=" "$ENV_COOLIFY" | head -1 | cut -d= -f2-)"
    if [ -n "$existing" ]; then
      printf '%s' "$existing"
      return
    fi
  fi
  "$@"
}

PRESERVE_STATEFUL_SECRETS="${PRESERVE_STATEFUL_SECRETS:-1}"
if [ "$PRESERVE_STATEFUL_SECRETS" = "1" ] && [ -f "$ENV_COOLIFY" ]; then
  KEEP_KEYCLOAK_DB_PASSWORD="$(existing_env_value KEYCLOAK_DB_PASSWORD)"
  KEEP_N8N_DB_PASSWORD="$(existing_env_value N8N_DB_PASSWORD)"
  KEEP_LANGFUSE_DB_PASSWORD="$(existing_env_value LANGFUSE_DB_PASSWORD)"
  KEEP_SYNAPSE_DB_PASSWORD="$(existing_env_value SYNAPSE_DB_PASSWORD)"
  # Stateful identity / rotation history — NIKDY přepisovat existující hodnoty:
  # COSMOS_SIGNER_MNEMONIC = validator identity (chain state je vázaný na tuto seed)
  # MINIO_ROOT_USER/PASSWORD_OLD = previous credentials pro rotation flow
  # REGISTRY_PROXY_PASSWORD = Docker Hub auth (ručně nastavený)
  KEEP_COSMOS_SIGNER_MNEMONIC="$(existing_env_value COSMOS_SIGNER_MNEMONIC)"
  KEEP_MINIO_ROOT_USER_OLD="$(existing_env_value MINIO_ROOT_USER_OLD)"
  KEEP_MINIO_ROOT_PASSWORD_OLD="$(existing_env_value MINIO_ROOT_PASSWORD_OLD)"
  KEEP_REGISTRY_PROXY_USERNAME="$(existing_env_value REGISTRY_PROXY_USERNAME)"
  KEEP_REGISTRY_PROXY_PASSWORD="$(existing_env_value REGISTRY_PROXY_PASSWORD)"
  KEEP_RESEND_API_KEY="$(existing_env_value RESEND_API_KEY)"
  KEEP_NETBIRD_API_TOKEN="$(existing_env_value NETBIRD_API_TOKEN)"
  KEEP_TELEGRAM_API_HASH="$(existing_env_value TELEGRAM_API_HASH)"
  KEEP_TELEGRAM_API_ID="$(existing_env_value TELEGRAM_API_ID)"
  KEEP_TELEGRAM_BOT_TOKEN="$(existing_env_value TELEGRAM_BOT_TOKEN)"
  KEEP_MATRIX_BRIDGE_PROFILES="$(existing_env_value MATRIX_BRIDGE_PROFILES)"
else
  KEEP_KEYCLOAK_DB_PASSWORD=""
  KEEP_N8N_DB_PASSWORD=""
  KEEP_LANGFUSE_DB_PASSWORD=""
  KEEP_SYNAPSE_DB_PASSWORD=""
  KEEP_COSMOS_SIGNER_MNEMONIC=""
  KEEP_MINIO_ROOT_USER_OLD=""
  KEEP_MINIO_ROOT_PASSWORD_OLD=""
  KEEP_REGISTRY_PROXY_USERNAME=""
  KEEP_REGISTRY_PROXY_PASSWORD=""
  KEEP_RESEND_API_KEY=""
  KEEP_NETBIRD_API_TOKEN=""
  KEEP_TELEGRAM_API_HASH=""
  KEEP_TELEGRAM_API_ID=""
  KEEP_TELEGRAM_BOT_TOKEN=""
  KEEP_MATRIX_BRIDGE_PROFILES=""
fi

# Aliases pro existující hodnoty v .env-prod-backup pod jiným názvem.
# Compose contracty používají _KEY/_TOKEN bez prefixu API_, my máme historicky
# `*_API_TOKEN` v backupu → mapujeme aby se dostalo do .env.coolify pro Coolify apps.
backup_env_value() {
  [ -f "$ENV_PROD_BACKUP" ] || return 0
  grep -E "^${1}=" "$ENV_PROD_BACKUP" | head -1 | cut -d= -f2- | tr -d '"'
}
# Both were UNCONDITIONAL reassignments from the vault, which silently undid the
# resolution done at the top of this script: the vault holds GENERATED secrets,
# and these two are operator credentials that are never generated, so
# backup_env_value returns empty for them and the good value was overwritten
# with nothing. The failure surfaced 50 lines later as "COOLIFY_API_KEY prázdný"
# while the token was resolved, present and exported — the check was right and
# the value had been erased between.
#
# Keep the vault as a FALLBACK (an operator may legitimately pin them there),
# but never let an empty read clobber an already-resolved credential.
COOLIFY_API_KEY="${COOLIFY_API_KEY:-$(backup_env_value COOLIFY_API_TOKEN)}"
FORGEJO_TOKEN="${FORGEJO_TOKEN:-$(backup_env_value FORGEJO_API_TOKEN)}"

# Generátor BIP39 mnemonic (24 words, 256-bit entropy) — Cosmos validator identity.
# Používá node + bip39 npm balek (instalace on-demand do node_modules pokud chybí).
gen_bip39_mnemonic() {
  if ! node -e 'require("bip39")' >/dev/null 2>&1; then
    (cd "$REPO_ROOT" && npm install --no-save --prefer-offline bip39 >/dev/null 2>&1) || true
  fi
  node -e 'console.log(require("bip39").generateMnemonic(256))' 2>/dev/null || {
    err "gen_bip39_mnemonic: node+bip39 nedostupné — nainstaluj přes 'npm i bip39'"
    return 1
  }
}

if [ "$DRY_RUN" = "1" ]; then
  warn "[DRY RUN] Would generate fresh secrets to $ENV_COOLIFY"
else
  # Single-process secret generation — replaces ~60 openssl/python3 subprocess
  # forks with ONE node invocation. Saves ~2-3s on --wipe runs.
  # Matches preserve_or_gen semantics: reads .env.coolify for existing values
  # when PRESERVE_STATEFUL_SECRETS=1 (default). On --wipe, all are fresh.
  #
  # --strength-floor: on --wipe runs (volumes will be purged this run → no
  # stateful volume can depend on the old values) preserved secrets below the
  # strength floor are DISCARDED and re-keyed instead of recycled forever.
  # Incident 2026-06-12: a legacy 20-char JWT_SECRET preserved across a wipe
  # crashlooped PostgREST (hard-requires >= 32 chars) → core never healthy,
  # cold-start aborted. --keep-volumes (WIPE_VOLUMES=0) keeps stateful volumes
  # → floor stays off for stateful keys (generator only WARNs); the stateless
  # JWT trio is always floored inside generate-secrets.mjs regardless.
  _strength_floor="${AISHA_SECRET_STRENGTH_FLOOR:-0}"
  if [ "$WIPE" = "1" ] && [ "$WIPE_VOLUMES" = "1" ]; then
    _strength_floor=1
  fi
  # ── Stráže NAD výsledkem ────────────────────────────────────────────────────
  # `${A:-${B:-literál}}` NENÍ pojistka, je to dosazení, které se pozná až podle
  # chování nasazené služby. Obě hodnoty tu dřív měly literál:
  #   · `host-gateway` je Dockerí jméno HOSTITELE — pro mesh v produkci to není
  #     adresa managementu, jen tichá náhrada, se kterou se peer nikam nepřipojí;
  #   · `admin@example.invalid` je z téhož rodu jako `idp.example.invalid`
  #     (2026-08-22): referenční adresa, se kterou služba naběhne a mlčí.
  # ── ADRESA MANAGEMENTU SE ZJIŠŤUJE, NEZAPÉKÁ ──────────────────────────────
  #
  # ⛔ NAMĚŘENO 2026-08-25. Agenti si `netbird.mesh.<instance>.internal` mapují
  # přes `extra_hosts` na `NETBIRD_MGMT_HOST`. Ta hodnota byla operátorská
  # deklarace držená přes `preservedValue`, takže jednou zapsaná přebíjela
  # každou čerstvě zjištěnou. V nasazení tak stála adresa, která nepatřila
  # ŽÁDNÉMU z registrovaných serverů; management mezitím bydlel
  # jinde. Agenti tedy mířili tam, kde nikdo neposlouchá, a mlčky se
  # nepřipojili: mesh zůstala prázdná, CORE_MESH_IP prázdné, api 502,
  # extranet 404. Chybu nehlásil nikdo — peer se prostě neobjevil.
  #
  # Discovery výš už tu správnou hodnotu vydává: profil váže ROLI na jméno
  # serveru, Coolify k tomu jménu vydá ip, a generate-coolify-context z toho
  # emituje `<SLUŽBA>_HOST_ADDR`. Odvozuje se při KAŽDÉM běhu a do repa se
  # nezapisuje, takže přežije i přestěhování služby nebo re-provisioning uzlu.
  #
  # Tady se ta hodnota jen dosadí do jména, které compose už čte.
  #
  # ⛔ MÍSTO JE ZÁMĚRNÉ. Napoprvé to stálo hned za discovery — jenže mezi tím
  # a zápisem env se ještě SOURCUJÍ deklarační soubory se `set -a`, a ty
  # zjištěnou hodnotu přepsaly zpátky na tu zapsanou. Derivace proto patří AŽ
  # za všechno sourcování a PŘED pojistku i generate-secrets, jinak se tiše
  # ztratí (týž clobber, jaký je zaznamenaný u DOMAINS_FILE výš).
  if [ -n "${NETBIRD_HOST_ADDR:-}" ]; then
    if [ -n "${NETBIRD_MGMT_HOST:-}" ] && [ "${NETBIRD_MGMT_HOST}" != "${NETBIRD_HOST_ADDR}" ]; then
      warn "NETBIRD_MGMT_HOST=${NETBIRD_MGMT_HOST} neodpovídá uzlu služby (${NETBIRD_HOST_ADDR}) — přebírám zjištěnou adresu"
    fi
    NETBIRD_MGMT_HOST="${NETBIRD_HOST_ADDR}"
    export NETBIRD_MGMT_HOST
  fi

  if [ "$(echo "${MESH_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')" = "true" ] \
     && [ -z "${NETBIRD_MGMT_HOST:-}" ]; then
    err "MESH_ENABLED=true, ale NETBIRD_MGMT_HOST není deklarovaný."
    err "  Dosadit sem Dockerí 'host-gateway' by peery nasměrovalo na hostitele"
    err "  místo na management — mesh by se postavil a nespojil."
    exit 1
  fi
  # Řetěz DEKLARACÍ (ne literálů): vlastní adresa administrátora NocoDB, jinak
  # společná adresa pro poštu. Není-li ani jedna, nevíme — a končíme.
  _nocodb_admin="${NOCODB_ADMIN_EMAIL:-${SMTP_ADMIN_EMAIL:-}}"
  if [ -z "$_nocodb_admin" ]; then
    err "Není deklarovaná adresa administrátora: NOCODB_ADMIN_EMAIL ani SMTP_ADMIN_EMAIL."
    err "  Doplň ji do .env-prod-backup; dosazená referenční adresa by vyrobila"
    err "  účet, na který se nikdo nedostane, a NIC by přitom nespadlo."
    exit 1
  fi
  # Modelový mesh forku (varianta C): tajemství NETBIRD_MODEL_* jsou stavová jen tam, kde
  # stack modelového meshe UŽ STOJÍ. Lanu vykládá derivace (MODEL_MESH ze zdrojované
  # topologie: slot, nebo "" = zavřená); existenci stacku MĚŘÍ Coolify — aplikace
  # netbird-model podle manifestu. Nezměřeno = prázdné → generate-secrets fail-closed.
  _mm_stack=""
  if [ -n "${MODEL_MESH:-}" ] && [ "$SKIP_CREATE" = "1" ]; then
    if _mm_app="$(aplikace_podle_compose docker-compose.coolify-netbird-model.yml)" \
       && _mm_apps="$(coolify_scoped_apps "^${_mm_app}\$")"; then
      if [ -n "$_mm_apps" ]; then _mm_stack=1; else _mm_stack=0; fi
    else
      warn "Modelový mesh: aplikaci netbird-model nešlo změřit (manifest/Coolify) — tajemství NETBIRD_MODEL_* zůstávají stavová (fail-closed)"
    fi
  fi
  _gen_tmp=$(node "$REPO_ROOT/scripts/generate-secrets.mjs" \
    --env-coolify="${ENV_COOLIFY:-}" \
    --env-backup="${ENV_PROD_BACKUP:-}" \
    --preserve="${PRESERVE_STATEFUL_SECRETS:-1}" \
    --strength-floor="$_strength_floor" \
    --stack-exists="$SKIP_CREATE" \
    --model-mesh-stack-exists="$_mm_stack" \
    --netbird-mgmt-host="${NETBIRD_MGMT_HOST:-}" \
    --mesh-tld="${MESH_TLD:-}" \
    --forgejo-org="${AISHA_FORGEJO_ORG:-${APP_NAME_PREFIX:-${AISHA_STORY:-}}}" \
    --nocodb-admin-email="${_nocodb_admin}") || {
    err "generate-secrets.mjs failed — cannot proceed without secrets"
    exit 1
  }
  unset _strength_floor _nocodb_admin _mm_stack _mm_app _mm_apps
  eval "$_gen_tmp"
  unset _gen_tmp
  # COOLIFY_API_KEY a FORGEJO_TOKEN jsou aliasy z .env-prod-backup
  # (nastaveno výše před PRESERVE_STATEFUL_SECRETS blokem). Pouze warn pokud chybí.
  if [ -z "$COOLIFY_API_KEY" ]; then
    err "COOLIFY_API_KEY prázdný — bez něj nelze volat Coolify API. Doplň do .env-prod-backup nebo exportuj před spuštěním."
    exit 1
  fi

  # Iter 19 — Coolify UUID auto-discovery already happened earlier (right after
  # the load-from-env block, before require_loaded_env). COOLIFY_PROJECT_UUID +
  # COOLIFY_SERVER_UUID_* are already populated here.

  if [ -z "$FORGEJO_TOKEN" ]; then
    err "FORGEJO_TOKEN prázdný — Coolify by sice apps vytvořil, ale git clone selže (401 unauthorized) → docker_compose_raw zůstane null → wave deploy selže s nejasnou chybou."
    err "  Doplň FORGEJO_API_TOKEN do .env-prod-backup nebo exportuj FORGEJO_TOKEN před spuštěním."
    exit 1
  fi

  if [ "$PRESERVE_STATEFUL_SECRETS" = "1" ] && [ -f "$ENV_COOLIFY" ]; then
    ok "Generated fresh stack-internal secrets (stateful DB secrets preserved)"
  else
    ok "Generated fresh stack-internal secrets"
  fi
fi

# ── Compose .env.coolify (preserves 3rd-party from .env-prod-backup) ─────────
if [ "$DRY_RUN" = "0" ]; then
  TMP_ENV=$(mktemp)
  # ── Operator roster: the instance-data overlay is the single source of truth ──
  # A fork keeps its roster in ONE place — operators.json at the top level of the
  # PRIVATE aisha-instance-data repo (the same file the migrate hook and
  # scripts/instance-rollout.sh consume). cold-start pulls it host-side HERE so a
  # single roster drives BOTH provisioning paths a fresh/wiped install needs:
  #   • AISHA_OPERATORS (appended to .env.coolify below) → the migrate-entrypoint's
  #     provision-operators --apply resolves each KC sub by email → DB roles.
  #   • the Phase B host-side auto-create pass (below) → creates any MISSING KC
  #     account. That needs KC admin creds, which exist ONLY host-side (never in
  #     the migrate container — that separation is why this can't move into the
  #     compose, and why cold-start, not the container, owns account creation).
  # config/operators.json (PII, gitignored) stays a FALLBACK for installs without
  # a private overlay. The overlay clone is soft: any failure falls back to
  # config/operators.json and never aborts cold-start. Empty when neither exists
  # (clean/community install) → nothing provisioned. Appended AFTER the heredoc
  # with printf (raw) so JSON quotes/braces survive. Never committed to this repo.
  _roster_json() { node -e 'try{const c=require(process.argv[1]);if((c.operators||[]).length){process.stdout.write(JSON.stringify(c))}}catch(e){}' "$1" 2>/dev/null || true; }
  OPERATORS_COMPACT=""
  OPERATORS_ROSTER_SRC=""
  # ⛔ JEDEN DOMOV I PRO ROSTER (nalezeno při revizi 2026-09-20). Tady stál DRUHÝ
  # klon TÉŽE `AISHA_INSTANCE_DATA_GIT_URL` — vlastní mktemp, vlastní volání
  # `klonuj`, a hlavně VLASTNÍ chování při selhání: `if` prostě neprošlo, roster
  # zůstal prázdný a tiše se sáhlo po `config/operators.json`. Instance, která
  # overlay DEKLARUJE, tak mohla dostat operátory odjinud, aniž by se cokoli
  # ohlásilo. Profil se přitom o pár set řádků výš při témže selhání zastaví.
  #
  # Dva domovy pro tentýž pojem znamenají dvě různá chování při selhání — a to
  # druhé si nikdo nevybral, jen zbylo. Roster-only běh (cesta ještě není) proto
  # volá TÝŽ `_fetch_instance_overlay`, ne svoji kopii.
  if [ -z "${AISHA_INSTANCE_CONFIG_DIR:-}" ]; then
    _fetch_instance_overlay
    # Overlay dorazil až teď (deklarace vznikla během běhu) → deklarace držení se
    # čte ZNOVU: první čtení řeklo „nic drženo“ o instanci, jejíž overlay ještě neznalo.
    if [ -n "${AISHA_INSTANCE_CONFIG_DIR:-}" ]; then
      cs_nacti_drzeni
      # Totéž vlastnictví: profil prostředí bydlí v overlayi, který dorazil až teď.
      cs_nacti_vlastnictvi
    fi
  fi
  if [ -n "${AISHA_INSTANCE_CONFIG_DIR:-}" ] && [ -f "${AISHA_INSTANCE_CONFIG_DIR}/operators.json" ]; then
    OPERATORS_COMPACT="$(_roster_json "${AISHA_INSTANCE_CONFIG_DIR}/operators.json")"
    if [ -n "$OPERATORS_COMPACT" ]; then OPERATORS_ROSTER_SRC="instance-data overlay"; fi
  fi
  if [ -z "$OPERATORS_COMPACT" ]; then
    OPERATORS_COMPACT="$(_roster_json "${REPO_ROOT}/config/operators.json")"
    if [ -n "$OPERATORS_COMPACT" ]; then OPERATORS_ROSTER_SRC="config/operators.json"; fi
  fi
  if [ -n "$OPERATORS_ROSTER_SRC" ]; then info "  Operator roster source: ${OPERATORS_ROSTER_SRC}"; fi

  # ── Per-instance mesh isolation (derived from the instance namespace) ───────
  # Multiple independent AISHA instances can share one physical host. Their
  # NetBird control-plane endpoint is published on a HOST port, so two instances
  # must not both grab the same port. We derive a unique host port per namespace
  # (APP_NAME_PREFIX); the primary `aisha` instance keeps the historical 33073.
  # NETBIRD_MESH_HOST stays as the topology resolver set it — the unique PORT is
  # what isolates the endpoint (host:port is unique even when the mesh hostname
  # resolves to the same shared physical host IP). Operator-overridable.
  NETBIRD_NS="${NETBIRD_NS:-${APP_NAME_PREFIX}}"
  if [ "$NETBIRD_NS" = "aisha" ]; then
    NETBIRD_MESH_PORT="${NETBIRD_MESH_PORT:-33073}"
  else
    # Deterministic host port in 33074..33873 (800 slots) — unique per namespace,
    # never the primary's 33073. cksum is stable across runs for the same NS.
    _nb_mesh_off="$(printf '%s' "$NETBIRD_NS" | cksum | awk '{print ($1 % 800) + 1}')"
    NETBIRD_MESH_PORT="${NETBIRD_MESH_PORT:-$((33073 + _nb_mesh_off))}"
  fi
  export NETBIRD_NS NETBIRD_MESH_PORT

  # Iter 22f (May 2026): disable `set -u` during heredoc — the body references
  # 200+ vars from many sources (generate-secrets, resolve_target_env,
  # derive-domains, image-versions.env, .env-prod-backup), and adding `:-`
  # defaults to every single one would clutter the heredoc beyond readability.
  # Without this guard, ANY unbound var would abort the whole heredoc, leaving
  # TMP_ENV empty — that's exactly what hit iter 22d (INSIGHT_OPENAI_ENDPOINT)
  # and iter 22f (MAESTRO_URL). Restored after the mv.
  # Cachebusty overlay klonů se odvozují TADY, ne uvnitř heredocu: v generátoru
  # env nemá co dělat subshell ani bare ${VAR} (viz brána
  # cold-start-heredoc-bindings — pod set -u by utnul zápis v půlce).
  # BuildKit kešuje vrstvu podle TEXTU příkazu, a ten se mezi nasazeními nemění,
  # takže bez proměnné hodnoty se klon overlaye provede JEDNOU a pak už nikdy:
  # obraz veze obsah overlay repa ze dne prvního buildu a build hlásí úspěch.
  # SHA vzdálené větve se změní právě tehdy, když se změnil obsah.
  KC_THEME_OVERLAY_GIT_URL="${KC_THEME_OVERLAY_GIT_URL:-}"
  KC_THEME_OVERLAY_CACHEBUST="${KC_THEME_OVERLAY_CACHEBUST:-}"
  if [ -z "$KC_THEME_OVERLAY_CACHEBUST" ] && [ -n "$KC_THEME_OVERLAY_GIT_URL" ]; then
    KC_THEME_OVERLAY_CACHEBUST="$("${REPO_ROOT}/scripts/deploy/overlay-cachebust.sh" \
      "$KC_THEME_OVERLAY_GIT_URL" "${KC_THEME_OVERLAY_REF:-}" 2>/dev/null || true)"
    [ -n "$KC_THEME_OVERLAY_CACHEBUST" ] \
      || warn "KC theme overlay: HEAD instančního repa se nepodařilo přečíst — build KC by nasadil staré téma"
  fi
  # Zdrojové adaptéry brokeru: repo JE deklarovaný overlay instance. URL a ref
  # jako klíče odvozuje env-doktor (bez tokenu, kvůli build ARGu); tady je třeba
  # jen SHA pro cachebust — a ten se čte z deklarace samotné, s jejím tokenem.
  SOURCE_ADAPTER_OVERLAY_CACHEBUST="${SOURCE_ADAPTER_OVERLAY_CACHEBUST:-}"
  if [ -z "$SOURCE_ADAPTER_OVERLAY_CACHEBUST" ] && [ -n "${AISHA_INSTANCE_DATA_GIT_URL:-}" ]; then
    SOURCE_ADAPTER_OVERLAY_CACHEBUST="$(
      eval "$(parse_instance_data_url "$AISHA_INSTANCE_DATA_GIT_URL")"
      "${REPO_ROOT}/scripts/deploy/overlay-cachebust.sh" "$IDATA_URL" "$IDATA_REF" 2>/dev/null
    )" || SOURCE_ADAPTER_OVERLAY_CACHEBUST=""
    [ -n "$SOURCE_ADAPTER_OVERLAY_CACHEBUST" ] \
      || warn "zdrojové adaptéry: HEAD instančního repa se nepodařilo přečíst — build brokeru na prázdném cachebustu SPADNE"
  fi
  # ⭐ JEDNO DESIGNOVÉ REPO = JEDNA ADRESA. Když instance drží grafiku, šablony
  # i obsah webu pohromadě (`web/`, `rdl/`, `brand/`), nemá smysl vypisovat tutéž
  # URL dvakrát. `AISHA_WEB_DESIGN_GIT_URL` se proto odvodí z `AISHA_DESIGN_GIT_URL`,
  # pokud není řečena zvlášť — a kdo má web v samostatném repu (AISHA), ji zvlášť
  # řekne a nic se pro něj nemění.
  AISHA_WEB_DESIGN_GIT_URL="${AISHA_WEB_DESIGN_GIT_URL:-${AISHA_DESIGN_GIT_URL:-}}"
  # ⛔ NAMĚŘENO 2026-09-19: sentinel „vypnuto" má DVA ČTENÁŘE, ne jednoho.
  # `generate-secrets.mjs` ho překládá na prázdno do .env.coolify, jenže tenhle
  # shell si hodnotu bere z trezoru (ENV_PROD_BACKUP se načítá s přepisem —
  # „operátor má poslední slovo"), takže sem dorazí SYROVÁ. Bez téhle normalizace
  # se `design-disabled.invalid` protlačilo až do build ARG a Dockerfile
  # svc-web-artifact ho vyhodnotil jako „URL je nastavená" → vyžádal CACHEBUST →
  # prázdný → fail-loud → build `core` mrtvý a s ním vlna 3 i 15 dalších aplikací.
  # ⚠ DLUH: ten řetězec je teď na DVOU místech (tady a v generate-secrets.mjs).
  # Do upstreamu patří jako JEDNA deklarace, kterou čtou oba — viz ADR-004,
  # tatáž třída jako „hodnota má víc domovů".
  [ "$AISHA_WEB_DESIGN_GIT_URL" = "design-disabled.invalid" ] && AISHA_WEB_DESIGN_GIT_URL=""
  AISHA_WEB_DESIGN_SUBDIR="${AISHA_WEB_DESIGN_SUBDIR:-}"
  AISHA_WEB_DESIGN_CACHEBUST="${AISHA_WEB_DESIGN_CACHEBUST:-}"
  if [ -z "$AISHA_WEB_DESIGN_CACHEBUST" ] && [ -n "${AISHA_WEB_DESIGN_GIT_URL:-}" ]; then
    AISHA_WEB_DESIGN_CACHEBUST="$("${REPO_ROOT}/scripts/deploy/overlay-cachebust.sh" \
      "$AISHA_WEB_DESIGN_GIT_URL" 2>/dev/null || true)"
    [ -n "$AISHA_WEB_DESIGN_CACHEBUST" ] \
      || warn "web design overlay: HEAD design repa se nepodařilo přečíst — build by nasadil starý design"
  fi
  # Designový SYSTÉM (tokeny), ne web. Sourozenec výše: web je stránka, tohle je
  # jazyk — vlastní release cyklus, vlastní repo, fan-out pro CSS/RN/Swift.
  # Bez cachebustu by BuildKit klonoval jen jednou a v obrazu by zůstal vzhled
  # ze dne prvního buildu (naměřeno 2026-08-02 na Dockerfile.keycloak).
  AISHA_DESIGN_CACHEBUST="${AISHA_DESIGN_CACHEBUST:-}"
  if [ -z "$AISHA_DESIGN_CACHEBUST" ] && [ -n "${AISHA_DESIGN_GIT_URL:-}" ]; then
    AISHA_DESIGN_CACHEBUST="$("${REPO_ROOT}/scripts/deploy/overlay-cachebust.sh" \
      "$AISHA_DESIGN_GIT_URL" "${AISHA_DESIGN_REF:-}" 2>/dev/null || true)"
    [ -n "$AISHA_DESIGN_CACHEBUST" ] \
      || warn "design systém: HEAD design repa se nepodařilo přečíst — build by nasadil staré tokeny"
  fi

  set +u
  # PKI_BRIDGE_URL is a MESH-TRUST bootstrap address, and every mesh peer's pki-init
  # (core/edge/integration) treats a NON-EMPTY value as "this deployment has a bridge":
  # it then polls for 300s and exits 1 when nothing answers — which fails the entire
  # core stack even though db/redis/gateway/web are healthy (verified live on a
  # fork deploy). The resolver already omits it for a story that excludes pki,
  # but the domains.env / env-doctor fallback resurrects it, so gate on what the story
  # actually DEPLOYS — the manifest, same authority the wave gates and the compose
  # preflight use. Empty is the documented contract in infra/pki/assemble-ca-bundle.sh
  # ("no mesh trust to establish" → exit 0).
  # Otázku „nasazuje příběh pki?" tu NEODPOVÍDÁ grep, ale
  # scripts/lib/derive-pki-bundle-required.mjs — JEDEN domov, který na cestě
  # redeploye volá i env-doktor. ⛔ NAMĚŘENO 2026-09-12: 18 compose čte
  # `${PKI_BUNDLE_REQUIRED:?}`, zapisovatelem byl JEN heredoc níž, a instance
  # nasazené z base fcd9156c1 (compose ještě `:-true`, heredoc klíč nepsal) by
  # každý `npm run redeploy` před dalším cold-startem shodily na interpolaci:
  # env-sync posílá jen to, co v .env.coolify leží, a env-doktor klíč neznal.
  PKI_BUNDLE_REQUIRED_Z_MANIFESTU="$(node "$REPO_ROOT/scripts/lib/derive-pki-bundle-required.mjs" --manifest "$MANIFEST")" || {
    err "Nepodarilo se odvodit PKI_BUNDLE_REQUIRED z manifestu '${MANIFEST}'."
    err "  Dosadit hodnotu rucne znamena bud cekat 600 s na bundle, ktery nikdo nevyda,"
    err "  nebo nasadit core bez duvery v mesh. Manifest musi existovat a byt citelny."
    exit 1
  }
  if [ "$PKI_BUNDLE_REQUIRED_Z_MANIFESTU" = "false" ]; then
    if [ -n "${PKI_BRIDGE_URL:-}" ]; then
      info "pki not deployed by story '${STORY}' — emitting empty PKI_BRIDGE_URL (was: ${PKI_BRIDGE_URL})"
    fi
    PKI_BRIDGE_URL=""
    # ⛔ NAMĚŘENO 2026-09-04 na produkci <fork>: vyprázdnit adresu NESTAČÍ.
    # `pki-init` v docker-compose.coolify.yml čte `PKI_BUNDLE_REQUIRED: ${PKI_BUNDLE_REQUIRED:?…}`
    # (tehdy ještě `:-true`), takže i bez nasazené PKI trval na CA bundlu:
    # `assemble-ca-bundle.sh` čeká PKI_BUNDLE_WAIT_S (600 s) a skončí exit 1.
    # `migrate` na něm visí přes `condition: service_completed_successfully`,
    # takže padá celý core — a s ním gate pro všech 8 aplikací ve vlnách 4+.
    # Devatenáct minut buildu do koše.
    #
    # Tuhle proměnnou tehdy nenastavoval NIKDO (ani skripty, ani .env.coolify),
    # takže výchozí `true` platilo vždy: KAŽDÝ profil bez PKI na tomhle spadl.
    # Třetí výskyt téhož vzorce za den (KEYCLOAK_INTERNAL_URL, LLM_GATEWAY_DOMAIN):
    # profil službu vyloučí, ale závislá výchozí hodnota ji dál vyžaduje. Proto
    # compose dnes nese `:?` a hodnotu ODVOZUJE tahle větev — bez PKI se `true`
    # nedá zapnout ani operátorsky (čekat na bundle, který nikdo nevydá, není volba).
    PKI_BUNDLE_REQUIRED="false"
  else
    # PKI nasazená ⇒ bundle je POŽADAVEK. Operátorská deklarace má přednost
    # (týž vzor jako AISHA_DESIGN_CACHEBUST výš); jinak se odvodí z manifestu —
    # heredoc níž ji pak vyžaduje stráží, žádný dosazený literál.
    [ -n "${PKI_BUNDLE_REQUIRED:-}" ] || PKI_BUNDLE_REQUIRED="true"
  fi
  # Kdo po rotaci koorene CA musi znovu stahnout trust bundle. ODVOZUJE se
  # z katalogu + compose souboru, NEPISE se rucne: pki-renewer.sh mel tenhle
  # seznam natvrdo (6 roli) a nikdo ho nikdy nenastavoval, takze ten vychozi
  # BYL tou hodnotou. Odvozeni jich najde 21 -- vcetne `pki`, ktery je TVRDA
  # brana. Chybel-li v seznamu, jeho mesh agent po rotaci nikdy nedostal nove
  # koreny a zastavil 27 aplikaci vcetne databaze (naměřeno 2026-08-22).
  # ⛔ NAMĚŘENO 2026-09-03 na <fork>. `INSIGHT_OPENAI_ENDPOINT` se v heredocu níž
  # odvozovalo jako `${INSIGHT_OPENAI_ENDPOINT:-https://${LLM_GATEWAY_DOMAIN:?...}/v1}`.
  # Lean profil `llm-gateway` NENASAZUJE, doména tedy prázdná JE — a pojistka `:?`
  # uvnitř heredocu shodila expanzi, `cat` nezapsal NIC a `.env.coolify` vzniklo
  # prázdné. Táž třída jako PKI_BRIDGE_URL o pár řádků výš, jen řešená na špatném
  # místě: co je podmíněné manifestem, patří PŘED heredoc, ne dovnitř.
  if vlastni llm-gateway; then
    INSIGHT_OPENAI_ENDPOINT="${INSIGHT_OPENAI_ENDPOINT:-https://${LLM_GATEWAY_DOMAIN:?LLM_GATEWAY_DOMAIN chybi, ale manifest llm-gateway nasazuje — INSIGHT_OPENAI_ENDPOINT z ni odvozuje adresu LLM brany}/v1}"
  else
    [ -z "${LLM_GATEWAY_DOMAIN:-}" ] && [ -n "${INSIGHT_OPENAI_ENDPOINT:-}" ] \
      && info "llm-gateway not deployed by story '${STORY}' — INSIGHT_OPENAI_ENDPOINT ponechán z prostředí"
    LLM_GATEWAY_DOMAIN="${LLM_GATEWAY_DOMAIN:-}"
    INSIGHT_OPENAI_ENDPOINT="${INSIGHT_OPENAI_ENDPOINT:-}"
  fi

  # Akcelerační vrstva (GPU uzel): ACCEL_* z deklarace uzlu (lib/accel-vrstva-env.sh →
  # derive-accel-uzel.mjs, týž domov jako env-doktor). Znovu TADY, protože záloha prostředí
  # obsluhy se výš načítá s přepisem: odvozená hodnota musí vyhrát nad zastaralou ze zálohy.
  nacti_env_vrstvy_accel "$REPO_ROOT" || {
    err "Vrstvu bez platné deklarace GPU uzlu nenasazuji: sítě, enginy i klíče nájemců plynou jen z ní."
    exit 1
  }

  BUNDLE_CONSUMER_ROLES="$(node "$REPO_ROOT/scripts/lib/derive-bundle-consumers.mjs")" || {
    err "Nepodarilo se odvodit konzumenty CA bundlu z katalogu."
    err "  Dosadit seznam rucne znamena, ze cast stacku po rotaci koorene CA"
    err "  zustane u starych kotev a jejich mesh agent prestane verit vsemu."
    exit 1
  }
  # ⛔ NAMĚŘENO 2026-09-27 (brána izolace, PR2): odvozovač skončil 0 a NEVYPSAL nic —
  # stráž CLI v něm porovnávala cestu bez symlinků (macOS /var → /private/var).
  # Heredoc pak spadl na ${BUNDLE_CONSUMER_ROLES:?} a vznikl PRÁZDNÝ env soubor.
  # Prázdný výstup je chyba, ne „nula konzumentů" (ta má vlastní exit 1).
  [ -n "$BUNDLE_CONSUMER_ROLES" ] || {
    err "Odvození konzumentů CA bundlu vrátilo PRÁZDNÝ výstup (exit 0) — derive-bundle-consumers.mjs neběžel jako CLI."
    exit 1
  }
  cat > "$TMP_ENV" <<HEADER
# ==============================================================================
# .env.coolify — Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by aisha-cold-start.sh
# ==============================================================================
# Stack-internal secrets are FRESH (regenerated this cold-start).
# 3rd-party API keys are inherited from .env-prod-backup.
#
# DO NOT commit this file. It is referenced by coolify-deploy-init.sh which
# pushes values to Coolify per-stack via PATCH /applications/{uuid}/envs.
# ==============================================================================

# ── Stack-internal: FRESH per cold-start ─────────────────────────────────────
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
VAULT_ENCRYPTION_KEY=${VAULT_ENCRYPTION_KEY}

KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=${KEYCLOAK_ADMIN_PASSWORD}
KEYCLOAK_DB_PASSWORD=${KEYCLOAK_DB_PASSWORD}
KEYCLOAK_CLIENT_ID=aisha-app
KEYCLOAK_CLIENT_SECRET=${KEYCLOAK_CLIENT_SECRET}

# ── Platform admin identity (realm-import template user) ─────────────────────
# render-realm-and-start.sh substitutes __PLATFORM_ADMIN_{EMAIL,USERNAME,PASSWORD}__
# into the one-time realm import from these CONTAINER env vars. The KC compose
# REFERENCES PLATFORM_ADMIN_* (docker-compose.coolify-keycloak.yml:44-46), but
# sync-envs only delivers keys that exist in .env.coolify — so without these
# lines the vars reach the container empty and render-realm falls back to
# admin@${PUBLIC_TLD}/changeme (verified on a live instance 2026-07-17: a fresh realm import
# created the wrong admin identity, requiring a manual post-boot reset). Same
# class as AISHA_INSTANCE_DATA_GIT_URL below. EMAIL cascades to the operator
# vault's ADMIN_EMAIL (resolved host-side here — the container never receives a
# bare ADMIN_EMAIL, only PLATFORM_ADMIN_*); USERNAME/PASSWORD stay empty for
# installs that don't pin them, preserving render-realm's changeme default.
PLATFORM_ADMIN_EMAIL=${PLATFORM_ADMIN_EMAIL:-${ADMIN_EMAIL:-}}
PLATFORM_ADMIN_USERNAME=${PLATFORM_ADMIN_USERNAME:-}
PLATFORM_ADMIN_PASSWORD=${PLATFORM_ADMIN_PASSWORD:-}

# ── Per-implementation data fill (platform + implementation + private users) ─
# AISHA is the platform; each implementation fills it with its own content/users.
#   AISHA_SEED_PROFILE  : which data layers the migrate seeds. 'instance' (prod
#                         default) = platform + selected implementation +
#                         private overlay; demo showcase excluded. Forks can use
#                         'platform' for a clean public install.
#   AISHA_IMPLEMENTATION: implementation seed segment (default follows STORY).
#   AISHA_PRIMARY_ADMIN_EMAIL : optional primary admin (also triggers provision).
#   AISHA_IMPLEMENTATION_HOOK : optional per-implementation private-data hook.
#   AISHA_TENANT_HOOK   : legacy alias for AISHA_IMPLEMENTATION_HOOK.
#   AISHA_OPERATORS     : this install's operator roster (JSON) — appended below
#                         from the instance-data overlay's operators.json (single
#                         source of truth; config/operators.json is the fallback)
#                         so the migrate-entrypoint's provision-operators step
#                         (post-realm core re-migrate) restores users (KC sub by
#                         email → DB roles) on every wipe. PII → never committed;
#                         injected via env.
#   AISHA_INSTANCE_DATA_GIT_URL : private overlay clone URL consumed by the
#                         migrate hook (scripts/deploy/instance-data-hook.sh)
#                         + configure-realms.sh instance KC clients. Value comes
#                         from the eval'd generate-secrets output (priority:
#                         .env-prod-backup > process env > existing .env.coolify
#                         > derived from FORGEJO_API_TOKEN+FORGEJO_URL > empty).
#                         MUST be written here — without this line the derived
#                         URL existed only as an unexported shell var, never
#                         reached .env.coolify, and sync-envs (payload =
#                         .env.coolify ∩ compose refs) silently never delivered
#                         it to aisha-core → post-wipe overlay never applied.
#                         Empty = community install, hook no-ops.
AISHA_SEED_PROFILE=${AISHA_SEED_PROFILE:-instance}
# Dědí se APP_NAME_PREFIX, ne zadrátované „aisha". Právě APP_NAME_PREFIX (a ne
# STORY) proto, že tenhle řádek je uvnitř HEREDOCu, který píše .env.coolify:
# brána cold-start-heredoc-bindings vyžaduje, aby každá reference měla známý
# zdroj vazby, a APP_NAME_PREFIX emituje generate-secrets.mjs. V tomhle bodě
# jsou obě hodnoty stejně tak jako tak — fail-closed kontrola výš zaručuje, že
# je deklarovaná.
AISHA_IMPLEMENTATION=${AISHA_IMPLEMENTATION:-${APP_NAME_PREFIX}}
AISHA_PRIMARY_ADMIN_EMAIL=${AISHA_PRIMARY_ADMIN_EMAIL:-}
AISHA_IMPLEMENTATION_HOOK=${AISHA_IMPLEMENTATION_HOOK:-scripts/deploy/instance-data-hook.sh}
AISHA_TENANT_HOOK=${AISHA_TENANT_HOOK:-}
AISHA_INSTANCE_DATA_GIT_URL=${AISHA_INSTANCE_DATA_GIT_URL:-}
# Drop-replay lane of svc-source-broker (li-driver → li_*). SAME sync-envs
# contract as AISHA_INSTANCE_DATA_GIT_URL above, and the failure it guards was
# found the same way (2026-07-20): the operator sets these in .env.local and
# cold-start exports them in-shell — so coolify-story-init.sh's provisioning gate
# sees them and creates the app — but without these heredoc lines they never land
# in .env.coolify, so Coolify injects nothing and the container comes up with the
# lane silently disarmed. HOST_DIR is the bind-mount source on the server,
# DROP_DIR the in-container path (docker-compose.coolify-source-broker.yml mounts
# HOST_DIR → DROP_DIR :ro).
LOCAL_INGEST_DROP_HOST_DIR=${LOCAL_INGEST_DROP_HOST_DIR:-}
LOCAL_INGEST_DROP_DIR=${LOCAL_INGEST_DROP_DIR:-}
# Federation-lane webhook HMAC. generate-secrets.mjs ALWAYS produces it (pg), but
# it was emitted only into the shell — never written here, so it never reached
# .env.coolify and the broker's app came up with the key present and EMPTY. That
# is not "the lane is off", it is a delivery failure wearing the same clothes;
# the compose fail-fast below now says so out loud. Same contract as the two lines
# above, and the third instance of this class found on 2026-07-20.
SOURCE_WEBHOOK_HMAC_SECRET=${SOURCE_WEBHOOK_HMAC_SECRET:-}
# Klíč trezoru relací federovaného zdroje (ADR-004) — týž kontrakt jako řádek výš:
# generate-secrets ho emituje, TENHLE řádek ho dostane do .env.coolify, deploy-init
# a sync-envs ho doručí aplikaci brokeru; doručení ověří zpětné čtení sync-envs
# (kontrakt env-doktora, druh hex), ne fail-closed v compose.
FEDERATION_VAULT_KEY=${FEDERATION_VAULT_KEY:-}
# Deterministic doc/contract ingest bundle (svc-local-ingest). URL + subdir feed
# docker-compose.coolify-local-ingest.yml:74-75 (BUNDLE_GIT_URL / BUNDLE_GIT_PATH).
# SAME sync-envs contract as AISHA_INSTANCE_DATA_GIT_URL above: without these
# heredoc lines the operator's INGEST_BUNDLE_GIT_PATH (the repo subdir, e.g.
# "ingest") never reaches the container, so on a fresh wipe local-ingest silently
# runs the BAKED example self-test bundle instead of the real instance-data one
# (verified on a live instance 2026-07-17: BUNDLE_GIT_PATH empty → "impl.json nenalezen → example
# bundle"). URL is emitted explicitly here too so a from-zero wipe is not reliant
# on env-doctor preserving a prior .env.coolify.
INGEST_BUNDLE_GIT_URL=${INGEST_BUNDLE_GIT_URL:-}
INGEST_BUNDLE_GIT_PATH=${INGEST_BUNDLE_GIT_PATH:-}
# Opt-in provision flags (services.json provision_when_env) — every one of these
# MUST be written here or a fresh wipe loses the operator's opt-in and the
# service silently never provisions (the coldstart-provision-flags gate pins
# the full set from the catalog: federation broker, potok).
#
# Fleet connectors are NOT here any more: T-cars is a plugin and Webdispečink
# is retired (Eurowag is its newer version, also a plugin). A plugin's
# credentials are env vars classified in aisha-env-doctor.mjs (TC_*/EW_*), not
# provision gates — there is no app to conditionally create.
SOURCE_API_URL=${SOURCE_API_URL:-}
POTOK_ENABLED=${POTOK_ENABLED:-}
# Extranet (zákaznický povrch) — opt-in stejně jako potok/local-ingest.
# Prázdné = instance extranet nenasazuje; služba se pak neprovisionuje
# a edge dostane .invalid sentinel místo veřejného hostu.
EXTRANET_ENABLED=${EXTRANET_ENABLED:-}
# Akcelerační vrstva (GPU uzel): VŠECHNO odvozeno z deklarace uzlu výš (derive-accel-uzel.mjs,
# jeden domov i pro env-doktora). Prázdné = instance vrstvu nevlastní; lane accel-hostfw,
# accel-vstup a accel-embed-<n> se pak nezakládají (provision_when_env).
ACCEL_OWNER_PREFIX=${ACCEL_OWNER_PREFIX:-}
ACCEL_FW_NODE_OWNER=${ACCEL_FW_NODE_OWNER:-}
ACCEL_FW_MODE=${ACCEL_FW_MODE:-}
ACCEL_FW_SSH=${ACCEL_FW_SSH:-}
ACCEL_FW_ADMIN_CIDRS=${ACCEL_FW_ADMIN_CIDRS:-}
ACCEL_FW_CONFIRM_S=${ACCEL_FW_CONFIRM_S:-}
ACCEL_FW_INTERVAL_S=${ACCEL_FW_INTERVAL_S:-}
ACCEL_FW_UDP_MESH_PORT=${ACCEL_FW_UDP_MESH_PORT:-}
ACCEL_JADRO_PODSIT=${ACCEL_JADRO_PODSIT:-}
ACCEL_JADRO_VSTUP_IP=${ACCEL_JADRO_VSTUP_IP:-}
ACCEL_NAJEMCE_1=${ACCEL_NAJEMCE_1:-}
ACCEL_NAJEMCE_1_PODSIT=${ACCEL_NAJEMCE_1_PODSIT:-}
ACCEL_NAJEMCE_1_ROZSAH=${ACCEL_NAJEMCE_1_ROZSAH:-}
ACCEL_NAJEMCE_1_IP=${ACCEL_NAJEMCE_1_IP:-}
ACCEL_NAJEMCE_2=${ACCEL_NAJEMCE_2:-}
ACCEL_NAJEMCE_2_PODSIT=${ACCEL_NAJEMCE_2_PODSIT:-}
ACCEL_NAJEMCE_2_ROZSAH=${ACCEL_NAJEMCE_2_ROZSAH:-}
ACCEL_NAJEMCE_2_IP=${ACCEL_NAJEMCE_2_IP:-}
ACCEL_NAJEMCE_3=${ACCEL_NAJEMCE_3:-}
ACCEL_NAJEMCE_3_PODSIT=${ACCEL_NAJEMCE_3_PODSIT:-}
ACCEL_NAJEMCE_3_ROZSAH=${ACCEL_NAJEMCE_3_ROZSAH:-}
ACCEL_NAJEMCE_3_IP=${ACCEL_NAJEMCE_3_IP:-}
ACCEL_NAJEMCE_4=${ACCEL_NAJEMCE_4:-}
ACCEL_NAJEMCE_4_PODSIT=${ACCEL_NAJEMCE_4_PODSIT:-}
ACCEL_NAJEMCE_4_ROZSAH=${ACCEL_NAJEMCE_4_ROZSAH:-}
ACCEL_NAJEMCE_4_IP=${ACCEL_NAJEMCE_4_IP:-}
ACCEL_NAJEMCE_5=${ACCEL_NAJEMCE_5:-}
ACCEL_NAJEMCE_5_PODSIT=${ACCEL_NAJEMCE_5_PODSIT:-}
ACCEL_NAJEMCE_5_ROZSAH=${ACCEL_NAJEMCE_5_ROZSAH:-}
ACCEL_NAJEMCE_5_IP=${ACCEL_NAJEMCE_5_IP:-}
ACCEL_NAJEMCE_6=${ACCEL_NAJEMCE_6:-}
ACCEL_NAJEMCE_6_PODSIT=${ACCEL_NAJEMCE_6_PODSIT:-}
ACCEL_NAJEMCE_6_ROZSAH=${ACCEL_NAJEMCE_6_ROZSAH:-}
ACCEL_NAJEMCE_6_IP=${ACCEL_NAJEMCE_6_IP:-}
ACCEL_NAJEMCE_7=${ACCEL_NAJEMCE_7:-}
ACCEL_NAJEMCE_7_PODSIT=${ACCEL_NAJEMCE_7_PODSIT:-}
ACCEL_NAJEMCE_7_ROZSAH=${ACCEL_NAJEMCE_7_ROZSAH:-}
ACCEL_NAJEMCE_7_IP=${ACCEL_NAJEMCE_7_IP:-}
ACCEL_NAJEMCE_8=${ACCEL_NAJEMCE_8:-}
ACCEL_NAJEMCE_8_PODSIT=${ACCEL_NAJEMCE_8_PODSIT:-}
ACCEL_NAJEMCE_8_ROZSAH=${ACCEL_NAJEMCE_8_ROZSAH:-}
ACCEL_NAJEMCE_8_IP=${ACCEL_NAJEMCE_8_IP:-}
ACCEL_EMBED_1_REPO=${ACCEL_EMBED_1_REPO:-}
ACCEL_EMBED_1_REVIZE=${ACCEL_EMBED_1_REVIZE:-}
ACCEL_EMBED_1_SOUBOR_VAH=${ACCEL_EMBED_1_SOUBOR_VAH:-}
ACCEL_EMBED_1_FORMAT_VAH=${ACCEL_EMBED_1_FORMAT_VAH:-}
ACCEL_EMBED_1_SHA256=${ACCEL_EMBED_1_SHA256:-}
ACCEL_EMBED_1_MAX_MODEL_LEN=${ACCEL_EMBED_1_MAX_MODEL_LEN:-}
ACCEL_EMBED_1_PODIL_GPU=${ACCEL_EMBED_1_PODIL_GPU:-}
ACCEL_EMBED_2_REPO=${ACCEL_EMBED_2_REPO:-}
ACCEL_EMBED_2_REVIZE=${ACCEL_EMBED_2_REVIZE:-}
ACCEL_EMBED_2_SOUBOR_VAH=${ACCEL_EMBED_2_SOUBOR_VAH:-}
ACCEL_EMBED_2_FORMAT_VAH=${ACCEL_EMBED_2_FORMAT_VAH:-}
ACCEL_EMBED_2_SHA256=${ACCEL_EMBED_2_SHA256:-}
ACCEL_EMBED_2_MAX_MODEL_LEN=${ACCEL_EMBED_2_MAX_MODEL_LEN:-}
ACCEL_EMBED_2_PODIL_GPU=${ACCEL_EMBED_2_PODIL_GPU:-}
ACCEL_CHAT_1_REPO=${ACCEL_CHAT_1_REPO:-}
ACCEL_CHAT_1_REVIZE=${ACCEL_CHAT_1_REVIZE:-}
ACCEL_CHAT_1_SOUBOR_VAH=${ACCEL_CHAT_1_SOUBOR_VAH:-}
ACCEL_CHAT_1_FORMAT_VAH=${ACCEL_CHAT_1_FORMAT_VAH:-}
ACCEL_CHAT_1_SHA256=${ACCEL_CHAT_1_SHA256:-}
ACCEL_CHAT_1_MAX_MODEL_LEN=${ACCEL_CHAT_1_MAX_MODEL_LEN:-}
ACCEL_CHAT_1_PODIL_GPU=${ACCEL_CHAT_1_PODIL_GPU:-}
ACCEL_CHAT_1_MAX_LORAS=${ACCEL_CHAT_1_MAX_LORAS:-}
ACCEL_CHAT_1_MAX_LORA_RANK=${ACCEL_CHAT_1_MAX_LORA_RANK:-}
ACCEL_VAHY_B64=${ACCEL_VAHY_B64:-}
ACCEL_DEKLARACE_B64=${ACCEL_DEKLARACE_B64:-}
# Port SSH do CI VM na hostiteli uzlu, nebo výslovné slovo zadna (žádná CI VM) — vstup
# obsluhy z trezoru pro vnější sondu doktora; prázdné = sonda hlásí NEZMĚŘENO.
ACCEL_CI_VM_SSH_PORT=${ACCEL_CI_VM_SSH_PORT:-}
# Modelový mesh forku (varianta C) — lane NEDEKLARUJE operátor: odvozuje ji topologie
# (derive-domains, model forku na slotu s has_gpu). Tady se jen přenese do .env.coolify,
# aby ji story-init a env sync viděly stejně jako ostatní lane. Prázdné = bez meshe.
MODEL_MESH=${MODEL_MESH:-}
# Brána extranetu: 1 = veřejný provoz smí JEN přes oauth2-proxy (služba
# extranet-auth v edge stacku), takže nepřihlášený nedostane ani JS bundle.
# Výchozí 1, protože otevřený povrch nemá být tichá výchozí hodnota — kdo ho
# chce mít veřejný, musí to vyhlásit. Edge je fail-closed: když je brána
# vyhlášená a neodpovídá, extranet se NEZVEŘEJNÍ (radši nedostupné než otevřené).
EXTRANET_AUTH_GATE=${EXTRANET_AUTH_GATE:-1}
AISHA_WEB_DESIGN_GIT_URL=${AISHA_WEB_DESIGN_GIT_URL:-}
# Podadresar designoveho repa, ktery JE webovou sablonou. Prazdny = koren repa
# (web v samostatnem repu, jako ma AISHA). Instance s jednim designovym repem
# sem da napr. web/, aby se do runtime obrazu nevezly zdrojaky jazyka a nahledy.
AISHA_WEB_DESIGN_SUBDIR=${AISHA_WEB_DESIGN_SUBDIR:-}
# Build-stage folder name the svc-web-artifact design overlay clones into
# (domains/templates/<AISHA_SEED_DOMAIN>/ → /seed-default → web_pages). Exported
# in-shell from config/domains.env (=${PUBLIC_TLD}) but must be WRITTEN here so it
# reaches aisha-core as a Docker build ARG — else the web-design ingest can't
# resolve its template root and the aisha+corp pages never populate.
AISHA_SEED_DOMAIN=${AISHA_SEED_DOMAIN:-${PUBLIC_TLD:-}}
AISHA_WEB_PUBLIC_ALIASES=${AISHA_WEB_PUBLIC_ALIASES:-}
# Cachebusty overlay klonů — odvozené výše, před heredocem (viz komentář tam).
# Dockerfily na prázdnou hodnotu při zapnutém overlayi padnou schválně.
AISHA_WEB_DESIGN_CACHEBUST=${AISHA_WEB_DESIGN_CACHEBUST:-}
# Designový SYSTÉM (tokeny) — sourozenec webového designu, ne totéž: web je
# stránka, tohle je jazyk. Vlastní repo, vlastní release cyklus, fan-out pro
# CSS / RN-Expo / Swift. Prázdné = OSS instalace → staví se z tokenů v repu.
AISHA_DESIGN_GIT_URL=${AISHA_DESIGN_GIT_URL:-}
AISHA_DESIGN_REF=${AISHA_DESIGN_REF:-}
AISHA_DESIGN_CACHEBUST=${AISHA_DESIGN_CACHEBUST:-}
KC_THEME_OVERLAY_GIT_URL=${KC_THEME_OVERLAY_GIT_URL:-}
KC_THEME_OVERLAY_REF=${KC_THEME_OVERLAY_REF:-}
KC_THEME_OVERLAY_CACHEBUST=${KC_THEME_OVERLAY_CACHEBUST:-}
SOURCE_ADAPTER_OVERLAY_CACHEBUST=${SOURCE_ADAPTER_OVERLAY_CACHEBUST:-}
KC_REGISTRATION_ALLOWED=${KC_REGISTRATION_ALLOWED:-}

LANGFUSE_DB_PASSWORD=${LANGFUSE_DB_PASSWORD}
LANGFUSE_OIDC_SECRET=${LANGFUSE_OIDC_SECRET}
LANGFUSE_NEXTAUTH_SECRET=${LANGFUSE_NEXTAUTH_SECRET}
LANGFUSE_SALT=${LANGFUSE_SALT}
LANGFUSE_ENCRYPTION_KEY=${LANGFUSE_ENCRYPTION_KEY}
LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY}
LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY}
LANGFUSE_ADMIN_EMAIL=${LANGFUSE_ADMIN_EMAIL}
LANGFUSE_ADMIN_PASSWORD=${LANGFUSE_ADMIN_PASSWORD}

N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
N8N_OIDC_SECRET=${N8N_OIDC_SECRET}
N8N_DB_PASSWORD=${N8N_DB_PASSWORD}
N8N_BASIC_AUTH_PASSWORD=${N8N_BASIC_AUTH_PASSWORD}
N8N_WEBHOOK_AUTH_TOKEN=${N8N_WEBHOOK_AUTH_TOKEN}
N8N_BOOTSTRAP_OWNER_PASSWORD=${N8N_BOOTSTRAP_OWNER_PASSWORD}
N8N_DB_HOST=${APP_NAME_PREFIX}-db
N8N_DB_PORT=5432
N8N_DB_NAME=postgres
N8N_DB_USER=n8n_app

REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_PASSWORD_CORE=${REDIS_PASSWORD_CORE}
REDIS_PASSWORD_LANGFUSE=${REDIS_PASSWORD_LANGFUSE}
REDIS_PASSWORD_N8N=${REDIS_PASSWORD_N8N}
REDIS_PASSWORD_ADMIN=${REDIS_PASSWORD_ADMIN}
RABBITMQ_DEFAULT_PASS=${RABBITMQ_DEFAULT_PASS}

LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
LIVEKIT_TURN_PASSWORD=${LIVEKIT_TURN_PASSWORD}

MATRIX_REGISTRATION_SHARED_SECRET=${MATRIX_REGISTRATION_SHARED_SECRET}
MATRIX_MACAROON_SECRET_KEY=${MATRIX_MACAROON_SECRET_KEY}
STORAGE_UPLOAD_TOKEN_SECRET=${STORAGE_UPLOAD_TOKEN_SECRET}
MATRIX_FORM_SECRET=${MATRIX_FORM_SECRET}
SYNAPSE_DB_PASSWORD=${SYNAPSE_DB_PASSWORD}
SYNAPSE_OIDC_CLIENT_SECRET=${SYNAPSE_OIDC_CLIENT_SECRET}
SYNAPSE_SERVER_NAME=${SYNAPSE_SERVER_NAME}

REALTIME_SECRET_KEY_BASE=${REALTIME_SECRET_KEY_BASE}
LOGFLARE_API_KEY=${LOGFLARE_API_KEY}
RAGNAROK_API_KEY=${RAGNAROK_API_KEY}
ELASTIC_PASSWORD=${ELASTIC_PASSWORD}
# ── Insight backend providers (per Ragnarok upstream LLMFactory schema) ──
# Mapping na ModelProvider enum (packages/insight/common/.../enums.py): OpenAI | vLLM | Cohere
INSIGHT_LLM_PROVIDER=${INSIGHT_LLM_PROVIDER:-OpenAI}
INSIGHT_LLM_MODEL=${INSIGHT_LLM_MODEL:-gpt-4o-mini}
INSIGHT_LLM_BASE_URL=${INSIGHT_LLM_BASE_URL:-}
INSIGHT_EMB_PROVIDER=${INSIGHT_EMB_PROVIDER:-OpenAI}
INSIGHT_EMB_MODEL=${INSIGHT_EMB_MODEL:-text-embedding-3-small}
INSIGHT_EMB_BASE_URL=${INSIGHT_EMB_BASE_URL:-}
INSIGHT_OPENAI_TYPE=${INSIGHT_OPENAI_TYPE:-OpenAI}
# Odvozeno z už resolvované adresy LLM brány, ne prázdné. Compose si tuhle
# proměnnou vynucuje (:? bez defaultu), takže PRÁZDNÁ hodnota shodí interpolaci
# CELÉHO integration stacku — a prázdný klíč je horší než chybějící: env-doctor ho pak
# „vidí" jako přítomný a svůj CONTRACT template nedoplní. Naměřeno 2026-08-08:
# 29/30 stacků OK, integration jediný FAIL, doctor zastavil deploy před destroyem.
INSIGHT_OPENAI_ENDPOINT=${INSIGHT_OPENAI_ENDPOINT}
INSIGHT_RERANK_PROVIDER=${INSIGHT_RERANK_PROVIDER:-Cohere}
COSMOS_VALIDATOR_PASSWORD=${COSMOS_VALIDATOR_PASSWORD}
COSMOS_SIGNER_MNEMONIC=${COSMOS_SIGNER_MNEMONIC}
CHAIN_ID=${CHAIN_ID}
MONIKER=${MONIKER}

# ── S3 / MinIO (langfuse + storage shared) ───────────────────────────────────
MINIO_ROOT_USER=${MINIO_ROOT_USER}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
MINIO_ROOT_USER_OLD=${MINIO_ROOT_USER_OLD}
MINIO_ROOT_PASSWORD_OLD=${MINIO_ROOT_PASSWORD_OLD}
S3_ACCESS_KEY=${S3_ACCESS_KEY}
S3_SECRET_KEY=${S3_SECRET_KEY}

# ── Internal API + cross-stack tokens (resolved aliases, no nested fallback) ─
INTERNAL_API_KEY=${INTERNAL_API_KEY}
BROKER_TOKEN_SECRET=${BROKER_TOKEN_SECRET}
POSTGREST_SERVICE_TOKEN=${POSTGREST_SERVICE_TOKEN}
NOCODB_DB_PASSWORD=${NOCODB_DB_PASSWORD}
AISHA_SERVICE_KEY=${SERVICE_ROLE_KEY}
AISHA_API_URL=${AISHA_API_URL}
AISHA_ANON_KEY=${ANON_KEY}
AISHA_BACKEND_URL=${AISHA_BACKEND_URL}
AISHA_BACKEND_ANON_KEY=${ANON_KEY}
AISHA_BACKEND_SERVICE_KEY=${SERVICE_ROLE_KEY}
AISHA_DB_FORCE_BASELINE_RESET=0
# n8n workflows reference AISHA_POSTGREST_URL (40+ workflows incl. WF_DIRIGENT_AGENT).
# Alias to backend gateway so n8n env-resolution succeeds on every workflow node.
AISHA_POSTGREST_URL=${AISHA_API_URL}

# ── ClickHouse (langfuse analytics) ──────────────────────────────────────────
CLICKHOUSE_USER=${CLICKHOUSE_USER}
CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD}

# ── Admin apps (NocoDB + Appsmith) ───────────────────────────────────────────
NOCODB_JWT_SECRET=${NOCODB_JWT_SECRET}
NOCODB_OIDC_SECRET=${NOCODB_OIDC_SECRET}
NOCODB_ADMIN_EMAIL=${NOCODB_ADMIN_EMAIL}
NOCODB_ADMIN_PASSWORD=${NOCODB_ADMIN_PASSWORD}
APPSMITH_OIDC_SECRET=${APPSMITH_OIDC_SECRET}
APPSMITH_INTRANET_OIDC_SECRET=${APPSMITH_INTRANET_OIDC_SECRET}
APPSMITH_ENCRYPTION_PASSWORD=${APPSMITH_ENCRYPTION_PASSWORD}
APPSMITH_ENCRYPTION_SALT=${APPSMITH_ENCRYPTION_SALT}
APPSMITH_ADMIN_EMAIL=${APPSMITH_ADMIN_EMAIL}
APPSMITH_ADMIN_PASSWORD=${APPSMITH_ADMIN_PASSWORD}

# ── PKI (OpenXPKI: CA + OAuth2 proxy) ────────────────────────────────────────
PKI_DB_ROOT_PASSWORD=${PKI_DB_ROOT_PASSWORD}
PKI_DB_PASSWORD=${PKI_DB_PASSWORD}
PKI_SVAULT_KEY=${PKI_SVAULT_KEY}
PKI_DEFAULT_SECRET=${PKI_DEFAULT_SECRET}
OPENXPKI_RPC_HMAC=${OPENXPKI_RPC_HMAC}
PKI_OIDC_SECRET=${PKI_OIDC_SECRET}
PKI_COOKIE_SECRET=${PKI_COOKIE_SECRET}
PKI_CLIENT_KEY_B64=${PKI_CLIENT_KEY_B64}

# ── NetBird control plane (mgmt + signal + dashboard + relay) ────────────────
NETBIRD_DOMAIN=${NETBIRD_DOMAIN}
NETBIRD_OIDC_CLIENT_ID=${NETBIRD_OIDC_CLIENT_ID}
NETBIRD_OIDC_SECRET=${NETBIRD_OIDC_SECRET}
NETBIRD_MGMT_SECRET=${NETBIRD_MGMT_SECRET}
NETBIRD_RELAY_SECRET=${NETBIRD_RELAY_SECRET}
NETBIRD_DATASTORE_ENC_KEY=${NETBIRD_DATASTORE_ENC_KEY}
NETBIRD_DB_PASSWORD=${NETBIRD_DB_PASSWORD}
NETBIRD_TURN_USERNAME=${NETBIRD_TURN_USERNAME}
NETBIRD_TURN_PASSWORD=${NETBIRD_TURN_PASSWORD}
NETBIRD_API_URL=${NETBIRD_API_URL}
NETBIRD_AUTH_SCHEME=${NETBIRD_AUTH_SCHEME}
NETBIRD_SANDBOX_GROUP=${NETBIRD_SANDBOX_GROUP}
NETBIRD_DNS_IP=${NETBIRD_DNS_IP}

# ── Modelový mesh forku (varianta C): druhá instance stacku NetBird ─────────
# Jména vydá topologie jen s MODEL_MESH (jinak prázdná); tajemství vydá
# generate-secrets vždy (jako u hlavní instance) — bez meshe je nikdo nečte.
NETBIRD_MODEL_DOMAIN=${NETBIRD_MODEL_DOMAIN:-}
NETBIRD_MODEL_DNS_DOMAIN=${NETBIRD_MODEL_DNS_DOMAIN:-}
MODEL_MESH_MANAGEMENT_URL=${MODEL_MESH_MANAGEMENT_URL:-}
MODEL_MESH_MOST_PEER=${MODEL_MESH_MOST_PEER:-}
MODEL_MESH_GPU_PEER=${MODEL_MESH_GPU_PEER:-}
MODEL_MESH_PORT=${MODEL_MESH_PORT:-}
# Vlastník GPU uzlu, v jehož prostoru jmen je síť nájemce (<vlastník>-lane-<prefix>; profil lane_gpu.vlastnik).
LANE_VLASTNIK=${LANE_VLASTNIK:-}
NETBIRD_MODEL_OIDC_CLIENT_ID=${NETBIRD_MODEL_OIDC_CLIENT_ID}
NETBIRD_MODEL_OIDC_SECRET=${NETBIRD_MODEL_OIDC_SECRET}
NETBIRD_MODEL_MGMT_SECRET=${NETBIRD_MODEL_MGMT_SECRET}
NETBIRD_MODEL_RELAY_SECRET=${NETBIRD_MODEL_RELAY_SECRET}
NETBIRD_MODEL_DATASTORE_ENC_KEY=${NETBIRD_MODEL_DATASTORE_ENC_KEY}
NETBIRD_MODEL_DB_PASSWORD=${NETBIRD_MODEL_DB_PASSWORD}
NETBIRD_MODEL_BOOTSTRAP_SECRET=${NETBIRD_MODEL_BOOTSTRAP_SECRET}
# Rozsah peerů (CGNAT). Edge-proxy si přes něj staví routu do mesh přes
# mesh-router — bez ní vnitřní jméno sice přeloží, ale nemá kudy jít.
NETBIRD_PEER_CIDR=${NETBIRD_PEER_CIDR}
MESH_DNS_NETWORK=${MESH_DNS_NETWORK}
# Doruceni pro compose :?-required klice (2026-08-05): realm konstanty a
# instancni hodnoty, ktere driv compose DOSAZOVAL fallbackem :-aisha-*.
# Vydava je generate-secrets (preservedValue), tudy se replayuji do .env.coolify.
OIDC_APP_CLIENT_ID=${OIDC_APP_CLIENT_ID}
WS_JWT_AUDIENCE=${WS_JWT_AUDIENCE}
KC_ADMIN_CLIENT_ID=${KC_ADMIN_CLIENT_ID}
AGENT_RUNS_DIR=${AGENT_RUNS_DIR}
N8N_BOOTSTRAP_OWNER_EMAIL=${N8N_BOOTSTRAP_OWNER_EMAIL}
AISHA_DB_IMAGE=${AISHA_DB_IMAGE}
MESH_DNS_SUBNET=${MESH_DNS_SUBNET}
MESH_DNS_RESOLVER_IP=${MESH_DNS_RESOLVER_IP}
# Netseg sítě + subnety — instanční, odvozené z identity (generate-secrets:deriveSubnets).
# Compose overlay (docker-compose.coolify.netseg.yml) i create-netseg.sh je čtou odsud.
NETSEG_FRONTEND_NET=${NETSEG_FRONTEND_NET}
NETSEG_BACKEND_NET=${NETSEG_BACKEND_NET}
NETSEG_DATA_NET=${NETSEG_DATA_NET}
NETSEG_FRONTEND_SUBNET=${NETSEG_FRONTEND_SUBNET}
NETSEG_BACKEND_SUBNET=${NETSEG_BACKEND_SUBNET}
NETSEG_DATA_SUBNET=${NETSEG_DATA_SUBNET}
NETBIRD_MGMT_HOST=${NETBIRD_MGMT_HOST}
MODEL_MESH_VSTUP_ADDR=${MODEL_MESH_VSTUP_ADDR}
NETBIRD_MESH_HOST=${NETBIRD_MESH_HOST}
# Per-instance mesh isolation (derived from APP_NAME_PREFIX above): unique host
# port + service-name alias namespace so co-located instances never collide.
NETBIRD_MESH_PORT=${NETBIRD_MESH_PORT}
NETBIRD_NS=${NETBIRD_NS}
MESH_TLD=${MESH_TLD}
NETBIRD_STACK_KEY_FRONTEND=${NETBIRD_STACK_KEY_FRONTEND}
NETBIRD_STACK_KEY_BACKEND=${NETBIRD_STACK_KEY_BACKEND}
NETBIRD_STACK_KEY_INTEGRATION=${NETBIRD_STACK_KEY_INTEGRATION}
NETBIRD_STACK_KEY_EXPERIMENTAL=${NETBIRD_STACK_KEY_EXPERIMENTAL}
# Klíč a jeho identifikátor jsou PÁR. Replayovat jen jednu půlku znamená, že
# netbird-bootstrap.sh při dalším běhu nepozná, KTERÝ klíč drží, přerazí ho
# a strhne redeploy celé flotily (naměřeno 2026-08-15 u všech čtyř).
# (Bez zpětných apostrofů: tenhle heredoc není uvozený, takže by se jméno
#  skriptu SPUSTILO — hlídá to brána shell-heredoc-metachar.)
NETBIRD_STACK_KEY_FRONTEND_ID=${NETBIRD_STACK_KEY_FRONTEND_ID}
NETBIRD_STACK_KEY_BACKEND_ID=${NETBIRD_STACK_KEY_BACKEND_ID}
NETBIRD_STACK_KEY_INTEGRATION_ID=${NETBIRD_STACK_KEY_INTEGRATION_ID}
NETBIRD_STACK_KEY_EXPERIMENTAL_ID=${NETBIRD_STACK_KEY_EXPERIMENTAL_ID}
TURN_REALM=${TURN_REALM}

# ── Extranet (oauth2-proxy před povrchem) ────────────────────────────────────
# Musí být TADY, ne jen v kontraktu env-doctoru. Kdyby se sem hodnota nezapsala,
# cold start by se nerozbil hlučně, ale ROZEŠEL BY SE V HODNOTĚ: generate-secrets
# vyrobí tajemství do prostředí shellu, provision-sso.sh ho nastaví Keycloaku,
# a env-doctor by pak do .env.coolify dogeneroval JINÉ. Compose by dostal druhé,
# Keycloak by znal první — obě strany zeleně a proxy se nepřihlásí.
EXTRANET_OIDC_SECRET=${EXTRANET_OIDC_SECRET}
EXTRANET_COOKIE_SECRET=${EXTRANET_COOKIE_SECRET}

# ── Studio (pgAdmin OAuth2 proxy + default admin) ────────────────────────────
STUDIO_OIDC_SECRET=${STUDIO_OIDC_SECRET}
STUDIO_COOKIE_SECRET=${STUDIO_COOKIE_SECRET}
PGADMIN_EMAIL=${PGADMIN_EMAIL}
PGADMIN_PASSWORD=${PGADMIN_PASSWORD}

# ── n8n + admin (appsmith) OAuth2 proxy cookie secrets (hex-16 = 32 bytes) ──
N8N_COOKIE_SECRET=${N8N_COOKIE_SECRET}
OAUTH2_PROXY_COOKIE_SECRET=${OAUTH2_PROXY_COOKIE_SECRET}
# Iter 22l: OAUTH2_COOKIE_DOMAINS — comma-separated cookie scope for OAuth2 Proxy
# (e.g. ".backend.${INTERNAL_TLD},.${PUBLIC_TLD}"). Operator-provided via .env-prod-backup
# or domains.env fallback. Empty placeholder so .env.coolify always has the key
# (validator at line 1590 expects it present).
OAUTH2_COOKIE_DOMAINS=${OAUTH2_COOKIE_DOMAINS:-}
OAUTH2_COOKIE_DOMAINS_FRONTEND=${OAUTH2_COOKIE_DOMAINS_FRONTEND:-}
OAUTH2_WHITELIST_DOMAINS=${OAUTH2_WHITELIST_DOMAINS:-}

# ── RabbitMQ ─────────────────────────────────────────────────────────────────
RABBITMQ_DEFAULT_USER=${RABBITMQ_DEFAULT_USER}
RABBITMQ_USER=${RABBITMQ_USER}
RABBITMQ_PASS=${RABBITMQ_PASS}
# RABBITMQ_HOST/PORT odvozuje katalog a doručuje env-doktor (druh derived).

# ─────────────────────────────────────────────────────────────────────────────
# OPTIONAL EXTERNAL KEYS — PRESET FOR EDIT
# ─────────────────────────────────────────────────────────────────────────────
# Tyto klíče GENERATOR neumí vyrobit (vyžadují účet u 3rd-party služby nebo
# manuální setup po prvním deployi). Cold-start je sem PŘEDPLNÍ ze stávajícího
# .env.coolify (idempotence — pokud jsi je už doplnil, zůstanou). Pokud je
# nepotřebuješ, nech prázdné — appy přesto naběhnou (jen feature nebude funkční).
#
#  REGISTRY_PROXY_USERNAME/PASSWORD  → Docker Hub login (https://hub.docker.com/settings/security)
#                                       Bez něj registry funguje anonymně, ale narazí na 100 pull/6h limit.
#  RESEND_API_KEY                    → https://resend.com/api-keys (transactional email z edge functions)
#  NETBIRD_API_TOKEN                 → vygeneruj v NetBird UI po prvním deploy: Settings → API Tokens
#  TELEGRAM_API_HASH / TELEGRAM_API_ID → https://my.telegram.org/apps (Telegram bot integration)
#  TELEGRAM_BOT_TOKEN                → @BotFather na Telegramu → /newbot
#  COOLIFY_API_KEY                   → automaticky alias z COOLIFY_API_TOKEN v .env-prod-backup
#  FORGEJO_TOKEN                     → automaticky alias z FORGEJO_API_TOKEN v .env-prod-backup
#  MINIO_ROOT_USER_OLD / _PASSWORD_OLD → automaticky se naplní při rotation flow (NEVYPLŇOVAT ručně)
#  COSMOS_SIGNER_MNEMONIC            → AUTOMATICKY VYGENEROVÁN (BIP39, 24 slov) — NIKDY NEPŘEPISUJ!
# ─────────────────────────────────────────────────────────────────────────────

# ── Registry proxy (Docker Hub pull-through cache) ───────────────────────────
REGISTRY_PROXY_USERNAME=${REGISTRY_PROXY_USERNAME}
REGISTRY_PROXY_PASSWORD=${REGISTRY_PROXY_PASSWORD}

# ── Resend (transactional email — edge functions) ────────────────────────────
RESEND_API_KEY=${RESEND_API_KEY}

# ── NetBird (mesh API token — vygenerovat v UI po deploy) ────────────────────
NETBIRD_API_TOKEN=${NETBIRD_API_TOKEN}

# ── Telegram bot (API_HASH/ID z my.telegram.org, BOT_TOKEN z @BotFather) ───────
TELEGRAM_API_HASH=${TELEGRAM_API_HASH}
TELEGRAM_API_ID=${TELEGRAM_API_ID}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
MATRIX_BRIDGE_PROFILES=${MATRIX_BRIDGE_PROFILES}

# ── Coolify + Forgejo API aliases (admin app + git push) ───────────────────────
COOLIFY_API_KEY=${COOLIFY_API_KEY}
FORGEJO_TOKEN=${FORGEJO_TOKEN}

# ── Domains (sourced from config/domains.env — single source of truth) ───────
# Zone TLDs (operator SoT via .env-prod-backup; resolver self-heals *_DOMAIN)
PUBLIC_TLD=${PUBLIC_TLD}
# PUBLIC zone *.${PUBLIC_TLD}:
APP_DOMAIN=${APP_DOMAIN}
API_DOMAIN=${API_DOMAIN}
KEYCLOAK_DOMAIN=${KEYCLOAK_DOMAIN}
AUTH_DOMAIN=${AUTH_DOMAIN}
KEYCLOAK_PUBLIC_DOMAIN=${KEYCLOAK_PUBLIC_DOMAIN}
AUTH_PUBLIC_DOMAIN=${AUTH_PUBLIC_DOMAIN}
KEYCLOAK_DOMAIN_PUBLIC=${KEYCLOAK_DOMAIN_PUBLIC}
AUTH_DOMAIN_PUBLIC=${AUTH_DOMAIN_PUBLIC}
# Mesh-INDEPENDENT KC host (edge auth upstream + KC Traefik direct router);
# equals KEYCLOAK_DOMAIN when mesh is off. See derive-domains.mjs (auth
# cannot depend on mesh — chicken-and-egg).
# ⛔ POŘADÍ OPRAVENO 2026-08-24. Dosazoval se tu ${KEYCLOAK_DOMAIN}, tedy jméno
# MESH/INTERNAL — u proměnné, jejímž celým smyslem je „cesta, kterou se dovolá
# OPERÁTOR MIMO MESH". Dosazení tedy popíralo účel proměnné.
#
# Naměřeno při wipu: fáze B (import realmu, provision-sso, bootstrap uživatel)
# sondovala https://<fork>-auth.backend.<internal> a dostávala 000 v nekonečné
# smycce, zatimco Keycloak bezel ZDRAVY a realm aisha odpovidal 200 — jen
# o jeden skok dal, na vnitrni adrese, kterou operator neprelozi.
#
# Preference je proto: výslovná deklarace → VEŘEJNÁ tvář → až nakonec vnitřní.
# Veřejnou tvář obsluhuje edge, který proto vstává už ve vlně 4 (viz WAVES:
# „Auth + dveře pro bootstrap"). Auth je ta zapsaná výjimka z „vše meshem“.
KEYCLOAK_DOMAIN_DIRECT=${KEYCLOAK_DOMAIN_DIRECT:-${KEYCLOAK_DOMAIN_PUBLIC:-${KEYCLOAK_DOMAIN}}}
# DRUHE jmeno Keycloaku pro extra_hosts (pki, llm-gateway, monitoring, openclaw
# ho vyzaduji strazi bez dosazeni): ZARUCENE ruzne od KEYCLOAK_DOMAIN_PUBLIC,
# jinak compose spadne na "extra_hosts must be a mapping" (namereno 2026-09-04
# na produkci <fork>, vyklad v derive-domains.mjs).
# NAMERENO 2026-09-12: resolver hodnotu vydaval VZDY (sourcovany TOPOLOGY_ENV vys
# ji do prostredi dostal), ale tenhle heredoc ji jako jediny z rodiny
# KEYCLOAK_DOMAIN_* NEZAPISOVAL - do .env.coolify ji dorucoval az heal pass
# env-doktora (nefatalni, jen varuje). Klic vyzadovany compose ma mit
# zapisovatele TADY, jako jeho sourozenci. (Bez zpetnych apostrofu a dolaru:
# tohle je telo heredocu, shell ho ROZVIJI - viz brana shell-heredoc-metachar.)
KEYCLOAK_EXTRA_HOST_ALIAS=${KEYCLOAK_EXTRA_HOST_ALIAS:?vydava derive-domains --shell vzdy; prazdno znamena, ze se resolver nenasourcoval}
LANGFUSE_DOMAIN=${LANGFUSE_DOMAIN}
N8N_DOMAIN=${N8N_DOMAIN}
MATRIX_DOMAIN=${MATRIX_DOMAIN}
ELEMENT_DOMAIN=${ELEMENT_DOMAIN}
ELEMENT_CALL_DOMAIN=${ELEMENT_CALL_DOMAIN}
LIVEKIT_DOMAIN=${LIVEKIT_DOMAIN}
LIVEKIT_TURN_USER=aisha
TURN_DOMAIN=${TURN_DOMAIN}
PKI_DOMAIN=${PKI_DOMAIN}
PKI_BRIDGE_DOMAIN=${PKI_BRIDGE_DOMAIN}
REGISTRY_DOMAIN=${REGISTRY_DOMAIN}
MATRIX_WEBHOOK_URL=${MATRIX_WEBHOOK_URL}
LIVEKIT_WEBHOOK_URL=${LIVEKIT_WEBHOOK_URL}
# INTERNAL zone <svc>.<server>.${INTERNAL_TLD}:
INTERNAL_TLD=${INTERNAL_TLD}
STUDIO_DOMAIN=${STUDIO_DOMAIN}
NOCODB_DOMAIN=${NOCODB_DOMAIN}
APPSMITH_DOMAIN=${APPSMITH_DOMAIN}
DOZZLE_DOMAIN=${DOZZLE_DOMAIN}

# ── Public site URLs (build-time for Vite bundle) ────────────────────────────
VITE_PUBLIC_SITE_URL=${VITE_PUBLIC_SITE_URL}
PUBLIC_SITE_URL=${PUBLIC_SITE_URL}
VITE_API_URL=${VITE_API_URL}
VITE_WS_URL=${VITE_WS_URL:-}
VITE_AISHA_BACKEND_URL=${VITE_AISHA_BACKEND_URL}
VITE_AISHA_BACKEND_ANON_KEY=${ANON_KEY}
VITE_AISHA_BACKEND_PUBLISHABLE_KEY=${ANON_KEY}
VITE_AISHA_GATEWAY_URL=${VITE_AISHA_GATEWAY_URL}
VITE_AISHA_GATEWAY_KEY=${ANON_KEY}
VITE_REQUIRE_AISHA_BACKEND_ENV=true
VITE_KC_URL=${VITE_KC_URL}
VITE_KC_AUTHORITY=${VITE_KC_AUTHORITY}
VITE_KC_CLIENT_ID=aisha-app
VITE_AUTH_REDIRECT_URI=${VITE_AUTH_REDIRECT_URI}
VITE_AUTH_POST_LOGOUT_URI=${VITE_AUTH_POST_LOGOUT_URI}

# ── Veřejná značka (SEO + social cards, pečené do index.html při buildu) ─────
# ⛔ CHYBĚJÍCÍ ČLÁNEK (naměřeno 2026-08-25). Klíče dokumentuje
# .env.coolify.example, předává je docker-compose.coolify-prebuilt.yml jako
# build args a exportuje Dockerfile.web — ale NIKDO je sem nezapisoval, takže se
# k aplikaci nikdy nedostaly. Compose je pak rozvinul na prázdno a web šel ven
# s prázdným titulkem, prázdným popisem a prázdnou social card.
#
# Prázdné nechat SMÍ: nedeklarovaná značka znamená, že brandPlaceholderPlugin
# dosadí default šablony (viditelná, opravitelná identita). Prázdný řetězec je
# ale to jediné, co dosadit nesmí — proto ho plugin od 2026-08-25 bere jako
# nedeklarovaný (enforce: pre, aby se k němu placeholder vůbec dostal).
VITE_PUBLIC_BRAND_LANG=${VITE_PUBLIC_BRAND_LANG:-}
VITE_PUBLIC_BRAND_TITLE=${VITE_PUBLIC_BRAND_TITLE:-}
VITE_PUBLIC_BRAND_DESCRIPTION=${VITE_PUBLIC_BRAND_DESCRIPTION:-}
VITE_PUBLIC_BRAND_AUTHOR=${VITE_PUBLIC_BRAND_AUTHOR:-}
VITE_PUBLIC_BRAND_PRIMARY=${VITE_PUBLIC_BRAND_PRIMARY:-}
# ⛔ ODVOZENO Z PRIMARY, NE DEKLAROVÁNO VEDLE NÍ. Barva lišty prohlížeče na
# mobilu (theme-color) je táž barva jako primary, jen zabalená do hsl().
# Dokud to byly dvě nezávislé deklarace, rozešly se: 2026-08-31 stálo
# PRIMARY na 213 82% 50% (modrá podle předlohy) a THEME_COLOR pořád na
# hsl(100 53% 46%) (zelená Studio) — paleta se opravila na třech místech
# a tohle čtvrté o tom nevědělo.
#
# Není to dosazený literál: nic se nehádá, jen se vyjadřuje vztah mezi dvěma
# hodnotami. Výslovná deklarace má dál přednost (kdo chce jinou barvu lišty,
# nastaví ji), a když PRIMARY chybí, zůstává prázdno — ne vymyšlená barva.
#
# ⛔ ŽÁDNÉ ZPĚTNÉ APOSTROFY V TOMHLE ODSTAVCI. Jsme uvnitř NEKVOTOVANÉHO
# heredocu, kde zpětný apostrof spouští příkaz — i na řádku začínajícím
# křížkem, protože ten je pro shell obyčejný text, ne komentář. Zvýraznění
# jmen proměnných by se tu tedy vykonalo. Hlídá brána shell-heredoc-metachar.
VITE_PUBLIC_BRAND_THEME_COLOR=${VITE_PUBLIC_BRAND_THEME_COLOR:-${VITE_PUBLIC_BRAND_PRIMARY:+hsl(${VITE_PUBLIC_BRAND_PRIMARY:-})}}
VITE_PUBLIC_BRAND_OG_LOCALE=${VITE_PUBLIC_BRAND_OG_LOCALE:-}
VITE_PUBLIC_BRAND_OG_SITE_NAME=${VITE_PUBLIC_BRAND_OG_SITE_NAME:-}
VITE_PUBLIC_BRAND_OG_DESCRIPTION=${VITE_PUBLIC_BRAND_OG_DESCRIPTION:-}
VITE_PUBLIC_BRAND_OG_IMAGE=${VITE_PUBLIC_BRAND_OG_IMAGE:-}

# ── Stack-internal config (deploy-init expects these; sensible defaults) ─────
JWT_EXP=3600
PGRST_DB_SCHEMAS=public,storage,graphql_public
# no anon schema enumeration; platform is RPC-only. NOTE: value line carries NO
# quotes and NO inline comment — coolify-sync-envs pushes the raw text after '='
# verbatim, so a trailing '# …' (or wrapping quotes) becomes part of the value
# and PostgREST FatalErrors on 'Invalid openapi-mode' (live instance 2026-07-19). The only
# such offender in the whole .env.coolify; keep this the bare token.
PGRST_OPENAPI_MODE=${PGRST_OPENAPI_MODE:-disabled}
# Pool sized for production burst load. PostgreSQL pg17 + PostgREST defaults
# under-provisioned for autonomous agents that fan out parallel queries
# (gateway → autopilot → multiple svc-ai-chat reflection nodes). 20 saturated
# at ~13/80 concurrent under realistic deploy patterns. 100 sustains 80/80.
# Pool tuning defaults below prevent connection exhaustion during cold-start
# and high-cardinality migrations. All upstreamable to evymo-ai-orchestrator.
PGRST_DB_POOL=100
PGRST_DB_POOL_ACQUISITION_TIMEOUT=30
PGRST_DB_POOL_MAX_LIFETIME=1800
PGRST_DB_POOL_MAX_IDLETIME=600
PGRST_DB_MAX_ROWS=1000
STORAGE_FILE_SIZE_LIMIT=52428800
STORAGE_REGION=eu-central
IMGPROXY_ENABLE_WEBP_DETECTION=true
IMGPROXY_KEY=${IMGPROXY_KEY}
IMGPROXY_SALT=${IMGPROXY_SALT}
DISABLE_SIGNUP=false
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
ENABLE_ANONYMOUS_SIGN_INS=false
ENABLE_PHONE_SIGNUP=false
ENABLE_KEYCLOAK=true
ENABLE_GOOGLE_OAUTH=true
ENABLE_APPLE_OAUTH=true
# ⛔ NAMĚŘENO 2026-08-20: vlajky výš tu byly, POVĚŘENÍ ne. Bez těchto řádků
# wipe přepíše .env.coolify a federované přihlášení zmizí — vlajka zůstane
# svítit a přihlašovací stránka nabídne jen heslo. Vydává je generate-secrets
# přes preservedValue (.env-prod-backup > prostředí > stávající .env.coolify),
# takže se sem replayují; prázdno je legitimní (poskytovatel se prostě nenabídne).
# APPLE_* je materiál klíče, ne secret — ten se razí (mint-apple-secret.py).
OAUTH_GOOGLE_CLIENT_ID=${OAUTH_GOOGLE_CLIENT_ID:-}
OAUTH_GOOGLE_CLIENT_SECRET=${OAUTH_GOOGLE_CLIENT_SECRET:-}
OAUTH_APPLE_CLIENT_ID=${OAUTH_APPLE_CLIENT_ID:-}
OAUTH_APPLE_CLIENT_SECRET=${OAUTH_APPLE_CLIENT_SECRET:-}
APPLE_TEAM_ID=${APPLE_TEAM_ID:-}
APPLE_KEY_ID=${APPLE_KEY_ID:-}
APPLE_AUTH_KEY_B64=${APPLE_AUTH_KEY_B64:-}
# ── Money přes VPN (svc-money, compose profil "money") ───────────────────────
# Táž lekce jako u Apple o pár řádků výš: bez těchto řádků wipe přestaví
# .env.coolify a stahování dodacích listů zmizí, aniž by kdekoli vznikla chyba.
# Vydává je generate-secrets přes preservedValue; prázdno = profil se nezapne.
# ── Nextcloud: dokumentové zdroje (druhá vstupní dráha ingestu) ──────────────
# Táž lekce jako u Money o pár řádků níž: bez těchto řádků wipe přestaví
# .env.coolify a synchronizace dokumentů zmizí, aniž by kdekoli vznikla chyba.
# Vydává je generate-secrets přes preservedValue; prázdno = lane se nezapne.
NEXTCLOUD_URL=${NEXTCLOUD_URL:-}
NEXTCLOUD_USER=${NEXTCLOUD_USER:-}
NEXTCLOUD_APP_PASSWORD_OBSCURED=${NEXTCLOUD_APP_PASSWORD_OBSCURED:-}
DOCS_SYNC_INTERVAL=${DOCS_SYNC_INTERVAL}
DOCS_SYNC_OFFSET=${DOCS_SYNC_OFFSET}
# Vzory generuje <fork>-instance-data/scripts/nextcloud-sync-env.py z deklarací
# zdrojů — sem se jen doručují, aby přežily wipe.
DOCS_SYNC_INCLUDE_SMLOUVY=${DOCS_SYNC_INCLUDE_SMLOUVY:-}
DOCS_SYNC_INCLUDE_DOKUMENTY=${DOCS_SYNC_INCLUDE_DOKUMENTY:-}
MONEY_HOST=${MONEY_HOST:-}
MONEY_AGENDAS=${MONEY_AGENDAS:-}
VPN_ENABLED=${VPN_ENABLED:-true}
VPN_PROFILE_B64=${VPN_PROFILE_B64:-}
VPN_AUTH_USER=${VPN_AUTH_USER:-}
VPN_AUTH_PASS=${VPN_AUTH_PASS:-}
VPN_KEY_PASSPHRASE=${VPN_KEY_PASSPHRASE:-}
# Výchozí hodnotu vydává generate-secrets; tady se jen předává, aby default
# neměl dva domovy.
VPN_IDLE_MS=${VPN_IDLE_MS}
SVC_MONEY_API_TOKEN=${SVC_MONEY_API_TOKEN:-}
RATE_LIMIT_EMAIL_SENT=10
ADDITIONAL_REDIRECT_URLS=${ADDITIONAL_REDIRECT_URLS}
MAILER_SUBJECTS_CONFIRMATION=Potvrďte registraci na AISHA
MAILER_SUBJECTS_RECOVERY=Obnovení hesla AISHA
MAILER_SUBJECTS_MAGIC_LINK=Přihlášení do AISHA
MAILER_SUBJECTS_EMAIL_CHANGE=Změna emailu AISHA
MAILER_SUBJECTS_INVITE=Pozvánka do AISHA
MAILER_TEMPLATES_CONFIRMATION=
MAILER_TEMPLATES_RECOVERY=
MAILER_TEMPLATES_MAGIC_LINK=
MAILER_TEMPLATES_EMAIL_CHANGE=
MAILER_TEMPLATES_INVITE=

KEYCLOAK_URL=${KEYCLOAK_URL}
# Realm is per-INSTANCE, not the platform name: a story on a shared Keycloak owns its
# own realm (config/domains-<story>.env → KEYCLOAK_REALM). Hardcoding
# 'aisha' shipped every fork's containers pointing at the donor's realm — they then
# validate tokens against the wrong issuer. Default keeps upstream byte-identical.
KEYCLOAK_REALM=${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}
LOGFLARE_RELEASE_COOKIE=${JWT_SECRET}
REALTIME_DB_ENC_KEY=${LOGFLARE_API_KEY}

STUDIO_DEFAULT_ORG=AISHA
STUDIO_DEFAULT_PROJECT=production

# ── Deployment identity + operator-supplied inputs ───────────────────────────
# generate-secrets.mjs emits these, but its output is only EVAL'd into shell
# variables — .env.coolify is written by THIS heredoc, so a key that is not
# listed here never reaches the artifact that compose is interpolated against.
#
# Every one of these was emitted and still absent after a wipe. It stayed
# invisible because the values had been appended to .env.coolify by hand while
# developing them: the file looked right, and only a real wipe — which rebuilds
# the file from scratch — showed that the pipeline never produced them.
#
# Concretely, without these lines a wipe loses: the app namespace (every
# ${APP_NAME_PREFIX:-aisha} silently falls back to the donor's), the Coolify
# control-plane URL, the whole operator identity (pki-init hard-fails on the
# AISHA_OPERATOR_ORG guard, so the PKI stack does not come up at all), and the
# pinned model weights.
APP_NAME_PREFIX=${APP_NAME_PREFIX:-}
AISHA_COOLIFY_API_URL=${AISHA_COOLIFY_API_URL:-}
AISHA_OPERATOR_ORG=${AISHA_OPERATOR_ORG:-}
AISHA_OPERATOR_LEGAL_NAME=${AISHA_OPERATOR_LEGAL_NAME:-}
AISHA_OPERATOR_COUNTRY=${AISHA_OPERATOR_COUNTRY:-}
AISHA_CA_NAME=${AISHA_CA_NAME:-}
# svc-model weights — empty is a valid state (service is opt-in on CHAT_GGUF_URL).
CHAT_GGUF_URL=${CHAT_GGUF_URL:-}
CHAT_GGUF_SHA256=${CHAT_GGUF_SHA256:-}
EMBED_GGUF_URL=${EMBED_GGUF_URL:-}
EMBED_GGUF_SHA256=${EMBED_GGUF_SHA256:-}
EMBED2_GGUF_URL=${EMBED2_GGUF_URL:-}
EMBED2_GGUF_SHA256=${EMBED2_GGUF_SHA256:-}
# Jména lan svc-model — deklarace instance, platforma žádné nedosazuje (prázdné = nedeklarováno;
# zapnutou lane bez aliasu odmítne entrypoint svc-model — svc-model-aliasy.sh).
MODEL_ALIAS=${MODEL_ALIAS:-}
EMBED_ALIAS=${EMBED_ALIAS:-}
EMBED2_ALIAS=${EMBED2_ALIAS:-}
STUDIO_BASIC_AUTH=
# Plné URL včetně fresh POSTGRES_PASSWORD — cross-stack přístup k aisha-db přes aisha-network.
# aisha_admin je PG superuser, používán pro migrace.
AISHA_DB_URL=postgresql://aisha_admin:${POSTGRES_PASSWORD}@${APP_NAME_PREFIX}-db:5432/postgres
EDGE_RUNTIME_MODE=oneshot
EDGE_VERIFY_JWT=true
ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
RAGNAROK_URL=${RAGNAROK_URL:-}
# Vnitřní adresa gatewaye pro služby v JINÝCH stacích (playwright-runner).
# Interní adresu gateway sem NEPATŘÍ dosazovat: vydává ji derive-domains jako
# topologický primitiv AISHA_GATEWAY_URL (a alias GATEWAY_URL) z internal_url
# služby v config/services.json, a do .env.coolify se dostane běžnou cestou.
# Dřív tu stál AISHA_GATEWAY_INTERNAL_URL s hádaným literálem — třetí jméno
# téže hodnoty, navíc s JINÝM obsahem, bez položky v kontraktu env-doktora.
# Doktor (fáze D) na tom 2026-08-12 zastavil nasazení: compose ten klíč vyžadoval
# tvrdě, čerstvý .env.coolify ho neobsahoval, preflight padal.
# (Bez zpětných apostrofů: tenhle komentář žije v NEUZAVŘENÉM heredocu, kde by
#  spustily substituci příkazu — hlídá shell-heredoc-metachar.gate.)
# Maestro běží na Backend (mesh-only) — edge functions na Talosu k němu přistupují přes mesh DNS.
MAESTRO_URL=${MAESTRO_URL}
# ⛔ NAMĚŘENO 2026-08-20: tyhle čtyři řádky tu stály BEZ ${VAR:-}, tedy jako
# natvrdo PRÁZDNÉ přiřazení. Cold-start tím operátorem dodaný token pokaždé
# PŘEPSAL prázdnem — proto byl SENTRY_AUTH_TOKEN prázdný ve všech místech
# najednou (.env.coolify, oba řádky u edge aplikace v Coolify) a nikdo nechápal proč.
#
# Není to „chybí hodnota", je to AKTIVNÍ MAZÁNÍ. Projeví se tím, že archiv iOS
# spadne na nahrávání dSYM: Xcode krok od @sentry/react-native jde bez tokenu,
# self-hosted Sentry vrátí 500, krok vypíše error: a Xcode archiv zabije.
#
# Token je OPERÁTORSKÝ vstup (generate-secrets ho nevyrábí) a podle #920 je
# runtime-only — do build-time allowlistu nepatří.
SENTRY_URL=${SENTRY_URL:-}
SENTRY_ORG=${SENTRY_ORG:-}
SENTRY_PROJECT=${SENTRY_PROJECT:-}
SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN:-}
# ⛔ NAMĚŘENO 2026-08-20: tyhle dva klíče tu CHYBĚLY ÚPLNĚ.
# Vyrábí je aisha-bootstrap-user-init.sh a zapisuje přes upsert_env, jenže
# tenhle soubor se staví OD NULY. Klíč, který tu nemá řádek, není „prázdný" —
# on se při každém přegenerování AKTIVNĚ ZAHODÍ.
#
# Následek se neprojeví tady, ale o tři vrstvy níž: netbird-bootstrap pak
# přeskočí nárok na vlastnictví účtu (jeho vlastní komentář to označuje za
# „known broken") a vlastníkem zůstane servisní účet mesh backendu. Servisní
# účty ale Keycloak do výpisu uživatelů NEDÁVÁ, takže mesh management hlásí
# „not found in IDP" a překládá si to na „user is pending approval".
# Peer discovery pak dostane 403, CORE_MESH_IP zůstane prázdné, mesh-router
# nemá cíl pro DNAT a api odpovídá 502. Vypadá to jako čekání na schválení,
# přitom schvalovat není co — ten uživatel je pro IdP neviditelný.
#
# Druhá polovina páru je emit(preservedValue(...)) v generate-secrets.mjs —
# bez ní hodnota nepřežije wipe a klíč se neobjeví v --print-keys, takže si
# ho reverzní sync do trezoru nevezme.
# Dveře na edge — druhá polovina páru k emit(preservedValue(...)) v
# generate-secrets.mjs. Bez tohohle řádku by se enforce po wipu ztratil a
# edge by se tiše otevřel; otevřený edge přitom vypadá jako fungující edge.
# (Bez zpětných apostrofů: tenhle komentář leží v NEUVOZENÉM heredocu, kde by
#  se obsah mezi nimi VYKONAL jako příkaz — chytila to brána na metaznaky.)
EDGE_DOOR_MODE=${EDGE_DOOR_MODE:-}
AISHA_BOOTSTRAP_PASSWORD=${AISHA_BOOTSTRAP_PASSWORD:-}
AISHA_BOOTSTRAP_CLIENT_SECRET=${AISHA_BOOTSTRAP_CLIENT_SECRET:-}
VITE_SENTRY_DSN=
VITE_REQUIRE_AISHA_ENV=true
VITE_WEB_PUSH_VAPID_PUBLIC_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
FIREBASE_SERVICE_ACCOUNT_JSON=

# ── Exec runner / mesh runtime ───────────────────────────────────────────────
# Derived from the per-instance MESH_TLD (heredoc resolves it here) so a FORK's
# exec-runner / plugin-broker / PostgREST mesh calls hit ITS mesh, not the donor's
# backend.mesh.aisha.internal. These keys are REGEN-owned (heredoc value wins) —
# deriving here is what makes them fork-correct without needing an override.
PLUGIN_SYSTEM_URL=http://backend.${MESH_TLD}:3029
PLUGIN_BROKER_URL=http://backend.${MESH_TLD}:3029
POSTGREST_URL=http://backend.${MESH_TLD}:3000
KATA_DEFAULT_RUNTIME=kata-dragonball

# ── Blue/Green slot defaults ─────────────────────────────────────────────────
# Compose soubory s bluegreen=on (např. keycloak) referencují BG_ACTIVE_HOST a
# BG_SLOT s defaulty (\${BG_ACTIVE_HOST:-}, \${BG_SLOT:-blue}). Per-app skutečná
# hodnota se nastavuje v Coolify env (deploy-init nebo blue-green-deploy.sh):
#   • BG_ACTIVE_HOST="" → traefik router disabled (idle slot)
#   • BG_ACTIVE_HOST="auth.${PUBLIC_TLD}" → router routuje na tento host (active slot)
#   • BG_SLOT="blue"|"green" → identifikuje slot v traefik router rule names
# Globální defaulty zde uspokojí compose contract validation; Coolify per-app
# overrideuje při deploy-init.
# Single-instance mode (no B/G yet): set ACTIVE_HOST to KC's public domain
# so traefik.enable=true (compose uses ${BG_ACTIVE_HOST:+true} pattern).
# Without this, KC container is healthy but auth.backend.${INTERNAL_TLD} returns 404
# (no Traefik route → OIDC apps ve fázi C can't OIDC-discover).
# Bez čísla vlny SCHVÁLNĚ: tenhle komentář se renderuje DO .env.coolify, tedy
# dřív, než se hranice fází načtou — odkaz na proměnnou by se tu rozvinul na
# prázdno, nebo pod set -u shodil heredoc uprostřed zápisu. Fáze mají jména
# právě proto. (Ani zpětné apostrofy sem nepatří: v nekótovaném heredocu
# spouštějí substituci příkazu — hlídá shell-heredoc-metachar.gate.)
BG_ACTIVE_HOST=${KEYCLOAK_DOMAIN}
BG_SLOT=blue

# ── Image versions (pinned per config/image-versions.env) ───────────────────
# Compose souborů referencují přes \${IMAGE_X:-fallback} pattern. Tyto hodnoty
# zde slouží jako primary source — sourceváno na začátku cold-start z
# config/image-versions.env (single source of truth pro pinning).
# Bumpování verzí: edit config/image-versions.env, NE tento HEREDOC.
# REGISTRY_PROXY: prefix obrazů přes CENTRÁLNÍ pull-through cache. Hodnotu už
# rozlišil sourcovaný config/image-versions.env (domov; výslovně prázdná deklarace
# z .env-prod-backup = cache vypnutá pro nouzi). Tady se jen ZAPISUJE, neodvozuje:
# dřívější odvození z REGISTRY_DOMAIN nikdy neproběhlo, protože sourcování
# nastavilo prázdno (naměřeno 2026-09-14). Must be in .env.coolify so compose
# ${REGISTRY_PROXY}image expands properly on Coolify deploy.
# The dash form WITHOUT a colon is deliberate: config/image-versions.env
# documents an explicitly-empty REGISTRY_PROXY as "images pull directly from
# upstream registries", which is the only escape hatch when the pull-through
# cache is unreachable. The colon-dash form treats empty as UNSET and silently
# re-derived the proxy from REGISTRY_DOMAIN, so that documented value could never
# actually be selected -- and REGISTRY_DOMAIN cannot be cleared either
# (deploy-init marks it required), leaving no way to bypass a broken cache. The
# bare dash honours an explicit empty value while still auto-deriving when the
# variable is genuinely unset.
# Second measured failure mode (measured on a fork): on servers with no edge routing
# for the cache host, the re-derived proxy makes every image pull unreachable,
# so the story cannot start at all.
# (No backticks in this comment: it lives inside an unquoted HEREDOC, where a
# backtick would trigger command substitution at render time -- shell-heredoc-
# metachar.gate.)
REGISTRY_PROXY=${REGISTRY_PROXY}
IMAGE_NETBIRD=${IMAGE_NETBIRD:-netbirdio/netbird:0.30.6}
IMAGE_NETBIRD_MANAGEMENT=${IMAGE_NETBIRD_MANAGEMENT:-netbirdio/management:0.30.6}
IMAGE_NETBIRD_SIGNAL=${IMAGE_NETBIRD_SIGNAL:-netbirdio/signal:0.30.6}
IMAGE_NETBIRD_DASHBOARD=${IMAGE_NETBIRD_DASHBOARD:-netbirdio/dashboard:v2.10.1}
IMAGE_NETBIRD_RELAY=${IMAGE_NETBIRD_RELAY:-netbirdio/relay:0.30.6}
IMAGE_SYNAPSE=${IMAGE_SYNAPSE}
IMAGE_LK_JWT_SERVICE=${IMAGE_LK_JWT_SERVICE:-ghcr.io/element-hq/lk-jwt-service:0.2.1}
IMAGE_MAUTRIX_TELEGRAM=${IMAGE_MAUTRIX_TELEGRAM:-dock.mau.dev/mautrix/telegram:v0.15.3}
IMAGE_MAUTRIX_WHATSAPP=${IMAGE_MAUTRIX_WHATSAPP:-dock.mau.dev/mautrix/whatsapp:v0.13.0}
IMAGE_MAUTRIX_SIGNAL=${IMAGE_MAUTRIX_SIGNAL:-dock.mau.dev/mautrix/signal:v0.7.6}
IMAGE_MAUTRIX_DISCORD=${IMAGE_MAUTRIX_DISCORD:-dock.mau.dev/mautrix/discord:v0.7.4}
IMAGE_MAUTRIX_SLACK=${IMAGE_MAUTRIX_SLACK:-dock.mau.dev/mautrix/slack:v0.2.0}
IMAGE_MAUTRIX_META=${IMAGE_MAUTRIX_META:-dock.mau.dev/mautrix/meta:v0.5.6}
IMAGE_POSTMOOGLE=${IMAGE_POSTMOOGLE:-registry.gitlab.com/etke.cc/postmoogle:v0.9.7}
IMAGE_N8N=${IMAGE_N8N}
IMAGE_NOCODB=${IMAGE_NOCODB}
IMAGE_APPSMITH=${IMAGE_APPSMITH}
# Doprava balíků ingest-drop a SBOM zrcadlo (rclone). MinIO a mc se staví ze zdroje (docker/minio).
IMAGE_RCLONE=${IMAGE_RCLONE}
IMAGE_PGADMIN=${IMAGE_PGADMIN:-dpage/pgadmin4:8.13}
# Iter 22i (May 2026): each unbound IMAGE_NAME compose reference needs a
# binding here. Without these defaults, deploy fails with "service X has
# neither image nor build context". Defaults pinned per config/image-versions.env.
# (IMAGE_PGBOUNCER removed 2026-07-06 — the unused WP-1.3 pooler was deleted.)
IMAGE_LIVEKIT=${IMAGE_LIVEKIT:-livekit/livekit-server:v1.7.2}
IMAGE_COTURN=${IMAGE_COTURN:-coturn/coturn:4.6.2-r10}
IMAGE_DOZZLE=${IMAGE_DOZZLE:-amir20/dozzle:v8.7.0}
IMAGE_LOKI=${IMAGE_LOKI:-grafana/loki:3.0.0}
IMAGE_PROMETHEUS=${IMAGE_PROMETHEUS:-prom/prometheus:v2.50.1}
IMAGE_NODE_EXPORTER=${IMAGE_NODE_EXPORTER:-prom/node-exporter:v1.7.0}
IMAGE_CADVISOR=${IMAGE_CADVISOR:-gcr.io/cadvisor/cadvisor:v0.49.1}
IMAGE_POSTGRES_EXPORTER=${IMAGE_POSTGRES_EXPORTER:-prometheuscommunity/postgres-exporter:v0.15.0}
IMAGE_GRAFANA=${IMAGE_GRAFANA:-grafana/grafana:11.0.0}
IMAGE_OAUTH2_PROXY=${IMAGE_OAUTH2_PROXY:-quay.io/oauth2-proxy/oauth2-proxy:v7.6.0}
# EMBEDDING_MODEL se sem do 2026-09-13 psal s literálem „text-embedding-3-small"
# (1536 do sloupců vector(1024)). Embedding model vybírá resolver prostoru
# (svc-mcp-knowledge lib/embed-query-in-space.ts), ne proměnná nasazení.

# ── Integration / Maestro / Insight LLM (Ragnarok stack) ─────────────────────
INSIGHT_LLM_BACKEND=${INSIGHT_LLM_BACKEND:-OpenAI}
# Default jazyk pro Insight (Maestro + kronos-shim). cs-CZ je AISHA primary.
INSIGHT_DEFAULT_LANG=${INSIGHT_DEFAULT_LANG:-cs-CZ}
MAESTRO_API_KEY=${MAESTRO_API_KEY:-}
KRONOS_API_KEY=${KRONOS_API_KEY:-}
# COHERE_API_KEY = optional rerank backend (Maestro/Ragnarok). Bez něj reranking off,
# stack běží na vector-only retrieval. Externí provider klíč — uživatel doplní v
# .env-prod-backup pro povolení. Empty placeholder uspokojí compose contract validaci.
COHERE_API_KEY=${COHERE_API_KEY:-}

# ── Compose-contract gap fillers (referenced by docker-compose.coolify*.yml) ──
# These keys MUST be present in .env.coolify (with empty values OK) for the
# compose-contract validation to pass. Most are runtime-resolved (set inside
# containers, by mesh-discover, or by post-deploy bootstraps) but the contract
# check requires their presence as keys.

# Domain shortcuts (generated by topology resolver; no compose fallback)
API_DOMAIN_PUBLIC=${API_DOMAIN_PUBLIC}
MCP_DOMAIN=${MCP_DOMAIN}
DIRIGENT_DOMAIN=${DIRIGENT_DOMAIN}
INTRANET_DOMAIN=${INTRANET_DOMAIN}
STUDIO_DOMAIN_DIRECT=${STUDIO_DOMAIN_DIRECT}
# Apex routing mode is resolver-derived. redirect = edge-proxy answers 308 →
# https://${APP_DOMAIN}; serve = Coolify routes the apex to the web container
# and DB branding_hostname_mapping resolves the GrapesJS page.
AISHA_WEB_APEX_MODE=${AISHA_WEB_APEX_MODE}
# Resolver emits PUBLIC_TLD only when the edge redirect rule applies; otherwise
# it emits the unroutable sentinel apex-redirect-disabled.invalid so the static
# apex Traefik router in docker-compose.coolify-prebuilt.yml never matches.
EDGE_APEX_DOMAIN=${EDGE_APEX_DOMAIN}
# live.${PUBLIC_TLD} (ws-gateway realtime fabric, tier:optional). LIVE_DOMAIN is
# the canonical internal host (backend Traefik → ws-gateway:3002; empty when
# realtime is filtered out of the profile); LIVE_DOMAIN_PUBLIC is the edge-fronted
# public host — real value, or the unroutable live-disabled.invalid sentinel.
LIVE_DOMAIN=${LIVE_DOMAIN}
LIVE_DOMAIN_PUBLIC=${LIVE_DOMAIN_PUBLIC}
# gateway.${PUBLIC_TLD} (LLM gateway IDE-proxy face) + companion.${PUBLIC_TLD}
# (OpenClaw) — same optional edge-fronted contract as live: real hostname when
# the service is in the profile, unroutable .invalid sentinel otherwise.
GATEWAY_DOMAIN_PUBLIC=${GATEWAY_DOMAIN_PUBLIC}
COMPANION_DOMAIN_PUBLIC=${COMPANION_DOMAIN_PUBLIC}
INGEST_DOMAIN_PUBLIC=${INGEST_DOMAIN_PUBLIC}
POTOK_DOMAIN_PUBLIC=${POTOK_DOMAIN_PUBLIC}
# extra.${PUBLIC_TLD} (customer extranet surface) — same optional edge-fronted
# contract as live/gateway. The extranet is its OWN container/compose; edge
# only ROUTES this host. AISHA_INSTANCE names the overlay its image builds —
# adresar instances/<jmeno>, NE profil (tvar behu). Dosazeny profil vyrobil
# instances/cloud-multi, ktery neexistuje, a build extranetu spadl na ENOENT.
EXTRANET_DOMAIN_PUBLIC=${EXTRANET_DOMAIN_PUBLIC}
# Canonical internal host belongs to the extranet app; only the public alias
# belongs to edge-proxy. Keep the resolver value when the service is present.
EXTRANET_DOMAIN=${EXTRANET_DOMAIN:-${EXTRANET_DOMAIN_PUBLIC}}
AISHA_INSTANCE=${AISHA_INSTANCE:?identita instance neni deklarovana. Vydava ji derive-domains z retezu identity (lib/coolify-instance-scope.mjs); dosadit sem vychozi jmeno by povrch TISE postavilo z referencni sablony, tedy s cizim IdP a cizim client_id.}
# SURFACE_OVERLAY_GIT_URL / _PATH / _REF se sem NEVYDAVAJI: instance povrch mit
# nemusi a prazdny radek je tise dosazena hodnota. Pripoji se nize, podminene,
# jen kdyz derive-domains povrch skutecne nasel a overil proti instancnimu repu.

# Caddy reverse_proxy operator overrides. Empty = derive from MESH_ENABLED and
# the generated *_UPSTREAM_PUBLIC / *_UPSTREAM_MESH values below.
API_UPSTREAM=${API_UPSTREAM:-}
MCP_UPSTREAM=${MCP_UPSTREAM:-}
DIRIGENT_UPSTREAM=${DIRIGENT_UPSTREAM:-}
EXTRANET_UPSTREAM=${EXTRANET_UPSTREAM:-}
AUTH_UPSTREAM=${AUTH_UPSTREAM:-}
LIVE_UPSTREAM=${LIVE_UPSTREAM:-}
GATEWAY_UPSTREAM=${GATEWAY_UPSTREAM:-}
COMPANION_UPSTREAM=${COMPANION_UPSTREAM:-}
INGEST_UPSTREAM=${INGEST_UPSTREAM:-}
POTOK_UPSTREAM=${POTOK_UPSTREAM:-}

# Image versions (Caddy variant not in image-versions.env yet)
IMAGE_CADDY=${IMAGE_CADDY}
IMAGE_NGINX=${IMAGE_NGINX}
IMAGE_DOCKER_CLI=${IMAGE_DOCKER_CLI}
# GPU uzel (vrstva accel): pin vLLM enginů a proxy socketu hlídače (config/image-versions.env).
IMAGE_VLLM=${IMAGE_VLLM}
IMAGE_DOCKER_SOCKET_PROXY=${IMAGE_DOCKER_SOCKET_PROXY}
IMAGE_BUSYBOX=${IMAGE_BUSYBOX}

# NetBird agent runtime variables (set inside containers; placeholders for contract)
NB_CONFIG_FILE=
NB_FORCE_REENROLL=
NB_HOSTNAME=
# NB_MANAGEMENT_URL is derived directly in the compose environment as
# https://${NETBIRD_MESH_HOST}:33073 (single substitution — never empty),
# matching the cosmos/integration mesh composes; no env placeholder needed.
NB_PID=
NB_SETUP_KEY=
NB_SSL_TRUST_BUNDLE=

# Mesh discovery runtime (filled by scripts/coolify-mesh-sync.mjs after netbird is up)
CORE_MESH_IP=

# Matrix → n8n webhook (filled by KC bootstrap; placeholder until)
MATRIX_WEBHOOK_SECRET=
N8N_MATRIX_WEBHOOK_URL=${N8N_MATRIX_WEBHOOK_URL:-https://${N8N_DOMAIN}/webhook/matrix}

# OpenXPKI RPC HMAC is generated above as a stack-internal secret.

# PKI bootstrap static defaults. AISHA_PKI_BOOTSTRAP_CLIENT_SECRET / _PASSWORD tu
# nejsou: vyrobí je env-doktor (druh secret) a od 2026-09-05 teče hodnota
# Z env DO Keycloaku (realm-sync ji vnutí a zpětně přečte), ne obráceně. Přepis
# .env.coolify je proto převezme z minula (průchod níž) — nová hodnota při každém
# běhu by znamenala přenastavení KC klienta a restart keycloaku bez důvodu.
PKI_BOOTSTRAP_CLIENT_ID=${PKI_BOOTSTRAP_CLIENT_ID:-aisha-pki-bootstrap}
PKI_BOOTSTRAP_USERNAME=${PKI_BOOTSTRAP_USERNAME:-aisha-pki-bootstrap}
PKI_BRIDGE_LOG_LEVEL=${PKI_BRIDGE_LOG_LEVEL:-info}
PKI_BRIDGE_URL=${PKI_BRIDGE_URL}
# Bez nasazené PKI se vypíná POŽADAVEK na CA bundle, ne jen jeho adresa —
# jinak pki-init čeká 600 s a skončí exit 1, což strhne migrate i celý core.
# Odvozeno výš z manifestu (app: pki ⇒ true, jinak false), nikdy dosazeno.
PKI_BUNDLE_REQUIRED=${PKI_BUNDLE_REQUIRED:?odvozeni z manifestu pribehu selhalo}
# Odvozeno vyse z katalogu (scripts/lib/derive-bundle-consumers.mjs), nikdy rucne.
BUNDLE_CONSUMER_ROLES=${BUNDLE_CONSUMER_ROLES:?odvozeni konzumentu CA bundlu selhalo}
# Kolokace je vlastnost DVOJICE (konzument, pki) — ne světa. Resolver vydá
# sloty bydlící s pki a přímou adresu; sync-envs pak aplikacím na těch slotech
# PŘEPNE PKI_BRIDGE_URL na přímý hop po warmup síti (žádný Traefik interně).
# Globální PKI_BRIDGE_URL zůstává bezpečný cross-host tvar pro všechny ostatní.
PKI_COLOCATED_SLOTS=${PKI_COLOCATED_SLOTS-}
PKI_BRIDGE_URL_COLOCATED=${PKI_BRIDGE_URL_COLOCATED-}
# Veřejná jména, která na svém uzlu vlastní edge (resolver, edgeOwnedHosts).
# Cold-start je doktorovi a deploy-initu předá prostředím; tady se ukládá kvůli
# SAMOSTATNÝM během doktora nad .env.coolify — bez něj by viděl kontrakt, kde
# backend jméno pořád chce, a hlásil konflikt s edge, který ho právem drží.
EDGE_OWNED_HOSTS=${EDGE_OWNED_HOSTS-}

# ── Outbound fetch allowlist (platform-wide SSRF control) ─────────────────────
# Every service that reaches an operator-supplied endpoint filters through
# packages/security/src/ssrf.ts against this list. Empty = deny non-allowlisted
# hosts, which is the safe default; an instance widens it via its own overlay.
#
# A CONNECTOR that talks to an external system (a commerce backend, a registry
# cube) declares its OWN endpoint/secret variables in the instance's overlay,
# never here — the platform template must not carry any one integration's keys.
# Measured on a fork's first live deploy: the connector was in the manifest and
# the compose, but had no heredoc line and no env-doctor contract entry, so it
# fail-closed on its required endpoint and its container exited on every wave.
# The lesson is the CONTRACT (declare it where it is delivered), not the keys.
SSRF_HOST_ALLOWLIST=${SSRF_HOST_ALLOWLIST:-}


# ── Mesh on/off switch (single global toggle for edge backend strategy) ──
# Defaults to 'false' so cold-start brings the platform up via public Backend
# TLS without waiting for NetBird+OpenXPKI bootstrap. Flip to 'true' via
# scripts/aisha-mesh-toggle.mjs --on once mesh has been validated.
MESH_ENABLED=${MESH_ENABLED}

# *_UPSTREAM_PUBLIC: edge-proxy upstream URLs when MESH_ENABLED=false.
# These are the Backend public TLS endpoints (Frontend→Backend cross-server reach
# without mesh). Explicitly declared here (and pushed to Coolify by
# coolify-deploy-init.sh) so the entrypoint switch resolves reliably even
# when Coolify v4 drops compose-time ':-default' substitution.
MCP_UPSTREAM_PUBLIC=${MCP_UPSTREAM_PUBLIC}
API_UPSTREAM_PUBLIC=${API_UPSTREAM_PUBLIC}
DIRIGENT_UPSTREAM_PUBLIC=${DIRIGENT_UPSTREAM_PUBLIC}
AUTH_UPSTREAM_PUBLIC=${AUTH_UPSTREAM_PUBLIC}
# Optional edge-fronted faces (resolver emits these only when the service is
# in the profile — soft refs so a filtered-out service leaves them empty and
# the edge entrypoint's conditional block guards disable the route).
LIVE_UPSTREAM_PUBLIC=${LIVE_UPSTREAM_PUBLIC:-}
GATEWAY_UPSTREAM_PUBLIC=${GATEWAY_UPSTREAM_PUBLIC:-}
COMPANION_UPSTREAM_PUBLIC=${COMPANION_UPSTREAM_PUBLIC:-}

# *_UPSTREAM_MESH: edge-proxy upstream URLs when MESH_ENABLED=true.
# These point at mesh-router:port — iptables DNAT in mesh-router rewrites
# destination to \${CORE_MESH_IP}:port, kernel routes via wt0 → core peer.
MCP_UPSTREAM_MESH=${MCP_UPSTREAM_MESH}
API_UPSTREAM_MESH=${API_UPSTREAM_MESH}
DIRIGENT_UPSTREAM_MESH=${DIRIGENT_UPSTREAM_MESH}
AUTH_UPSTREAM_MESH=${AUTH_UPSTREAM_MESH}
# live/gateway/companion declare no mesh-router port → mesh == public upstream.
LIVE_UPSTREAM_MESH=${LIVE_UPSTREAM_MESH:-}
GATEWAY_UPSTREAM_MESH=${GATEWAY_UPSTREAM_MESH:-}
COMPANION_UPSTREAM_MESH=${COMPANION_UPSTREAM_MESH:-}

# ⛔ NETBIRD_INTERNAL_CERT_B64 / NETBIRD_INTERNAL_KEY_B64 sem NEPATŘÍ. Píše je
# za běhu pki-renewer (infra/pki/pki-renewer.sh, consumer_for) přímo do env
# aisha-netbird; trezor jejich hodnotu nezná. Prázdný řádek tady sync poslal
# jako „klíč přítomný v trezoru" a každá konvergence přepsala doručený
# certifikát prázdnem → renewer ho doručil znovu a restartoval řídicí rovinu
# meshe (naměřeno 2026-09-19, guru9). Klíč, který trezor nemá, sync neposílá
# (build_app_payload: compose ∩ trezor). Hlídá klice-renewera-mimo-trezor.gate.

# PKI cert renewal (cron config)
RENEW_INTERVAL_HOURS=${RENEW_INTERVAL_HOURS:-24}
RENEW_SERVICES=${RENEW_SERVICES:-netbird-internal-tls}
RENEW_THRESHOLD_DAYS=${RENEW_THRESHOLD_DAYS:-7}

# Coolify API access (token + URL from explicit env contract)
COOLIFY_URL=${COOLIFY_URL}
COOLIFY_BASE_URL=${COOLIFY_BASE_URL}
COOLIFY_API_TOKEN=${COOLIFY_API_TOKEN:-}

# Coolify infra UUIDs (auto-discovered by generate-coolify-context.mjs; persist
# here so subsequent runs skip the API roundtrip via PRESERVE_STATEFUL_SECRETS).
COOLIFY_PROJECT_UUID=${COOLIFY_PROJECT_UUID:-}
COOLIFY_SERVER_UUID_FRONTEND=${COOLIFY_SERVER_UUID_FRONTEND:-}
COOLIFY_SERVER_UUID_BACKEND=${COOLIFY_SERVER_UUID_BACKEND:-}
COOLIFY_SERVER_UUID_EXPERIMENTAL=${COOLIFY_SERVER_UUID_EXPERIMENTAL:-}
COOLIFY_SERVER_UUID_BUILD=${COOLIFY_SERVER_UUID_BUILD:-}
COOLIFY_SERVER_UUID_GPU=${COOLIFY_SERVER_UUID_GPU:-}

# ── Phase 2 autopilot — LLM Gateway (theopenco/llmgateway) ───────────────────
# Auto-generated on first cold-start; preserved across re-runs via REGEN_KEYS
# regex above. Reuse anywhere by exporting AISHA_LLM_GATEWAY_KEY in IDEs.
LLM_GATEWAY_DOMAIN=${LLM_GATEWAY_DOMAIN}
GATEWAY_DOMAIN=${GATEWAY_DOMAIN}
AISHA_LLM_GATEWAY_URL=https://${LLM_GATEWAY_DOMAIN}
LLM_GW_UPSTREAM_URL=${LLM_GW_UPSTREAM_URL:-}
LLM_GATEWAY_DB_PASSWORD=${LLM_GATEWAY_DB_PASSWORD}
LLM_GATEWAY_SECRET=${LLM_GATEWAY_SECRET}
LLM_GATEWAY_OIDC_CLIENT_ID=${LLM_GATEWAY_OIDC_CLIENT_ID:-llm-gateway}
LLM_GATEWAY_OIDC_SECRET=${LLM_GATEWAY_OIDC_SECRET}
# Service-side bearer — devs put this in ANTHROPIC_API_KEY in their IDE so the
# IDE → gateway proxy authenticates. Also registered in ai_provider_registry
# (auth_env_var=AISHA_LLM_GATEWAY_KEY) for clow backends that pick the gateway.
AISHA_LLM_GATEWAY_KEY=${AISHA_LLM_GATEWAY_KEY}
# Provider keys — operator supplies these in .env-prod-backup (BYOK).
# Empty placeholders satisfy the compose contract validator; gateway falls
# back to "provider not configured" runtime error if a clow picks them.
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
GOOGLE_AI_API_KEY=${GOOGLE_AI_API_KEY:-}
IMAGE_LLM_GATEWAY=${IMAGE_LLM_GATEWAY}

# ── Private npm registry — 23 services depend on @aisha/security from Verdaccio ─
# (services/svc-pki-bridge/Dockerfile, services/svc-ai-chat/Dockerfile, …)
# Token comes from operator's .env-prod-backup. Synced as is_build_time=true to
# every Coolify app whose compose has 'args: VERDACCIO_TOKEN: \${VERDACCIO_TOKEN}'
# (auth happens at 'npm install' during the Docker build stage, never at runtime).
VERDACCIO_TOKEN=${VERDACCIO_TOKEN:-}
VERDACCIO_URL=${VERDACCIO_URL}

# ── Phase 2 autopilot — OpenClaw (agent-mesh advisory ops channel) ───────────
# OpenClaw drains AISHA's approval queue when autonomy thresholds are met,
# pushes notifications to Discord/Slack/Matrix/Telegram. Channel tokens are
# operator-supplied (BYOK in .env-prod-backup); empty = channel disabled.
OPENCLAW_DOMAIN=${OPENCLAW_DOMAIN}
COMPANION_DOMAIN=${COMPANION_DOMAIN}
# Note: MCP_KNOWLEDGE_DOMAIN is intentionally NOT exported. openclaw consumes
# MCP from the AISHA backend via numbered dependency (openclaw → core), so its
# compose file hard-wires AISHA_MCP_URL=https://\${API_DOMAIN}/mcp directly.
# See docs/architecture/CAPABILITY_GATES.md (vestigial-defaults audit).
OPENCLAW_API_KEY=${OPENCLAW_API_KEY}
# B6/B4: internal topology URL (sourced derive-domains env) + adapter enable flag —
# svc-ai-chat's openclaw adapter self-registers is_enabled the moment URL+key resolve.
OPENCLAW_URL=${OPENCLAW_URL:-}
LANGGRAPH_ENABLE_OPENCLAW=${LANGGRAPH_ENABLE_OPENCLAW:-true}
OPENCLAW_DB_PASSWORD=${OPENCLAW_DB_PASSWORD}
OPENCLAW_SECRET=${OPENCLAW_SECRET}
OPENCLAW_OIDC_CLIENT_ID=${OPENCLAW_OIDC_CLIENT_ID:-openclaw}
OPENCLAW_OIDC_SECRET=${OPENCLAW_OIDC_SECRET}
OPENCLAW_COOKIE_SECRET=${OPENCLAW_COOKIE_SECRET}
OPENCLAW_MAX_PARALLEL_AGENTS=${OPENCLAW_MAX_PARALLEL_AGENTS:-3}
OPENCLAW_SANDBOX_CPU_LIMIT=${OPENCLAW_SANDBOX_CPU_LIMIT:-0.5}
OPENCLAW_SANDBOX_MEM_LIMIT=${OPENCLAW_SANDBOX_MEM_LIMIT:-512m}
OPENCLAW_MATRIX_HOMESERVER=${OPENCLAW_MATRIX_HOMESERVER:-https://${MATRIX_DOMAIN}}
OPENCLAW_MATRIX_TOKEN=${OPENCLAW_MATRIX_TOKEN:-}
OPENCLAW_DISCORD_TOKEN=${OPENCLAW_DISCORD_TOKEN:-}
OPENCLAW_SLACK_TOKEN=${OPENCLAW_SLACK_TOKEN:-}
OPENCLAW_TELEGRAM_TOKEN=${OPENCLAW_TELEGRAM_TOKEN:-}

# ── 3rd-party keys (inherited from .env-prod-backup) ─────────────────────────
HEADER
  # ⛔ Skript má `set -uo pipefail`, ALE NE `set -e`. Selže-li expanze uvnitř
  # heredocu (nenastavená proměnná, `${VAR:?}`), `cat` nezapíše nic a běh
  # POKRAČUJE — chyba se pak vynoří o tisíc řádků dál jako „chybí 4 klíče,
  # doplň je do CONTRACT", což míří úplně jinam. Naměřeno 2026-09-03: kvůli
  # jediné pojistce vzniklo `.env.coolify` o jednom řádku a diagnóza ukazovala
  # na env-doktora. Tady je to místo, kde se to pozná.
  # `grep -c` při nule VYPÍŠE 0 a skončí 1 — dřívější `|| echo 0` dal „0\n0" a test
  # `[ … -lt 100 ]` spadl na „integer expression expected", takže pojistka právě
  # prázdný výstup PROPUSTILA (naměřeno 2026-09-27, brána izolace PR2).
  _gen_klicu="$(grep -cE '^[A-Z_][A-Z0-9_]*=' "$TMP_ENV" 2>/dev/null || true)"
  case "$_gen_klicu" in ''|*[!0-9]*) _gen_klicu=0 ;; esac   # soubor chybí = 0 klíčů = STOP
  if [ "$_gen_klicu" -lt 100 ]; then
    err "Generování .env.coolify selhalo — heredoc vydal jen $(wc -l < "$TMP_ENV" 2>/dev/null || echo 0) řádků."
    err "  Příčina je VÝŠ v tomhle výpisu: hledej řádek 'aisha-cold-start.sh: line ...:'"
    err "  s nenastavenou proměnnou. Pokračovat by znamenalo nasadit prázdné prostředí."
    exit 1
  fi

  # Append all 3rd-party keys (anything NOT in our regenerated set)
  # ONE TOP-LEVEL PATTERN PER LINE — diff-reviewable (the former single-line
  # ~4.5k-char alternation hid typos: one misplaced | silently reclassified
  # keys, leaking stale .env-prod-backup values over freshly generated ones,
  # or dropping operator-supplied keys from .env.coolify entirely).
  # Sync contract: every key the generate-secrets/heredoc layer above OWNS
  # (generates or derives) must be listed here; anything NOT listed is treated
  # as a 3rd-party/operator key and inherited verbatim from .env-prod-backup.
  REGEN_KEY_PATTERNS=(
    'POSTGRES_PASSWORD'
    'POSTGRES_EXPORTER_PASSWORD'
    'JWT_SECRET'
    'JWT_EXP'
    'ANON_KEY'
    'SERVICE_ROLE_KEY'
    'AISHA_(SERVICE_KEY|API_URL|ANON_KEY|BACKEND_URL|BACKEND_ANON_KEY|BACKEND_SERVICE_KEY|DB_URL|OPERATORS|PRIMARY_ADMIN_EMAIL|SEED_PROFILE|IMPLEMENTATION|IMPLEMENTATION_HOOK|TENANT_HOOK|INSTANCE_DATA_GIT_URL)'
    'VAULT_ENCRYPTION_KEY'
    # Web push: pár vyrábí generate-secrets. Bez téhle řádky by se klíče braly
    # za cizí a zdědily se ze zálohy — starý veřejný vedle nového soukromého
    # je přesně ta půlka páru, po které push tiše přestane chodit.
    'WEB_PUSH_VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)'
    'KEYCLOAK_(ADMIN|ADMIN_PASSWORD|DB_PASSWORD|CLIENT_ID|CLIENT_SECRET|URL|REALM)'
    'LANGFUSE_(DB_PASSWORD|OIDC_SECRET|NEXTAUTH_SECRET|SALT|ENCRYPTION_KEY|PUBLIC_KEY|SECRET_KEY|ADMIN_EMAIL|ADMIN_PASSWORD)'
    'N8N_(ENCRYPTION_KEY|OIDC_SECRET|BASIC_AUTH_PASSWORD|DB_PASSWORD|DB_HOST|DB_PORT|DB_NAME|DB_USER|COOKIE_SECRET|WEBHOOK_AUTH_TOKEN)'
    'REDIS_PASSWORD(_(CORE|LANGFUSE|N8N|ADMIN))?'
    'RABBITMQ_(DEFAULT_PASS|DEFAULT_USER|USER|PASS|HOST|PORT)'
    'LIVEKIT_(API_KEY|API_SECRET|TURN_PASSWORD|WEBHOOK_URL|TURN_USER)'
    'MATRIX_(REGISTRATION_SHARED_SECRET|MACAROON_SECRET_KEY|FORM_SECRET|WEBHOOK_URL)'
    'SYNAPSE_(DB_PASSWORD|OIDC_CLIENT_SECRET|SERVER_NAME)'
    'MINIO_(ROOT_USER|ROOT_PASSWORD|ROOT_USER_OLD|ROOT_PASSWORD_OLD)'
    'MINIO_USER_(CORE|LANGFUSE)_PASSWORD'
    'S3_(ACCESS_KEY|SECRET_KEY)'
    'INTRANET_API_KEY'
    'INTERNAL_API_KEY'
    'BROKER_TOKEN_SECRET'
    'POSTGREST_(SERVICE_TOKEN|URL)'
    'NOCODB_(DB_PASSWORD|JWT_SECRET|OIDC_SECRET|ADMIN_EMAIL|ADMIN_PASSWORD)'
    'APPSMITH_(OIDC_SECRET|INTRANET_OIDC_SECRET|ENCRYPTION_PASSWORD|ENCRYPTION_SALT|ADMIN_EMAIL|ADMIN_PASSWORD)'
    'CLICKHOUSE_(USER|PASSWORD)'
    'PKI_(DB_ROOT_PASSWORD|DB_PASSWORD|SVAULT_KEY|OIDC_SECRET|COOKIE_SECRET|CLIENT_KEY_B64)'
    'NETBIRD_(DOMAIN|OIDC_CLIENT_ID|OIDC_SECRET|MGMT_SECRET|RELAY_SECRET|DB_PASSWORD|TURN_USERNAME|TURN_PASSWORD|API_URL|AUTH_SCHEME|SANDBOX_GROUP|DNS_IP|MGMT_HOST|MESH_HOST|STACK_KEY_(FRONTEND|BACKEND|INTEGRATION|EXPERIMENTAL))'
    'MESH_TLD'
    # generate-secrets DERIVES both from the instance identity (deriveSubnets),
    # so by this file's own sync contract they belong here. They were missing,
    # which made them "3rd-party/operator keys inherited verbatim" — and a stale
    # resolver address in .env-prod-backup then outlived the range it belonged
    # to. Its twin NETBIRD_DNS_IP was listed (via the NETBIRD_ pattern above) and
    # got the fresh value, so one derived-together pair landed in .env.coolify
    # disagreeing with itself; the mesh-router pinned the stale half and Docker
    # refused the endpoint. Measured 2026-08-12.
    'MESH_DNS_(SUBNET|RESOLVER_IP)'
    'OAUTH2_COOKIE_DOMAINS(_FRONTEND)?'
    'OAUTH2_WHITELIST_DOMAINS'
    'TURN_REALM'
    'STUDIO_(OIDC_SECRET|COOKIE_SECRET)'
    'PGADMIN_(EMAIL|PASSWORD)'
    'REALTIME_(SECRET_KEY_BASE|DB_ENC_KEY)'
    'LOGFLARE_(API_KEY|RELEASE_COOKIE)'
    'RAGNAROK_(API_KEY|URL)'
    'ELASTIC_PASSWORD'
    'COSMOS_(VALIDATOR_PASSWORD|SIGNER_MNEMONIC)'
    'CHAIN_ID'
    'MONIKER'
    'REGISTRY_PROXY'
    'REGISTRY_PROXY_(USERNAME|PASSWORD)'
    'RESEND_API_KEY'
    'NETBIRD_API_TOKEN'
    'TELEGRAM_(API_HASH|API_ID|BOT_TOKEN)'
    'COOLIFY_(API_KEY|API_TOKEN|URL|BASE_URL|PROJECT_UUID|SERVER_UUID_(FRONTEND|BACKEND|EXPERIMENTAL|BUILD|GPU))'
    'FORGEJO_TOKEN'
    'APP_DOMAIN'
    'API_DOMAIN'
    'STUDIO_DOMAIN'
    'KEYCLOAK_DOMAIN'
    'LANGFUSE_DOMAIN'
    'NOCODB_DOMAIN'
    'APPSMITH_DOMAIN'
    'N8N_DOMAIN'
    'MATRIX_DOMAIN'
    'ELEMENT_DOMAIN'
    'ELEMENT_CALL_DOMAIN'
    'LIVEKIT_DOMAIN'
    'TURN_DOMAIN'
    'PKI_DOMAIN'
    'PKI_BRIDGE_DOMAIN'
    'REGISTRY_DOMAIN'
    'PUBLIC_TLD'
    'INTERNAL_TLD'
    'GATEWAY_DOMAIN'
    'COMPANION_DOMAIN'
    'VITE_(API_URL|PUBLIC_SITE_URL|AISHA_BACKEND_URL|AISHA_BACKEND_ANON_KEY|AISHA_BACKEND_PUBLISHABLE_KEY|AISHA_GATEWAY_URL|AISHA_GATEWAY_KEY|SENTRY_DSN|REQUIRE_AISHA_ENV|REQUIRE_AISHA_BACKEND_ENV|WEB_PUSH_VAPID_PUBLIC_KEY|KC_URL|KC_AUTHORITY|KC_CLIENT_ID|AUTH_REDIRECT_URI|AUTH_POST_LOGOUT_URI)'
    'PUBLIC_SITE_URL'
    'PGRST_DB_(SCHEMAS|POOL|MAX_ROWS)'
    'STORAGE_(FILE_SIZE_LIMIT|REGION)'
    'IMGPROXY_(ENABLE_WEBP_DETECTION|KEY|SALT)'
    'DISABLE_SIGNUP'
    'ENABLE_(EMAIL_SIGNUP|EMAIL_AUTOCONFIRM|ANONYMOUS_SIGN_INS|PHONE_SIGNUP|KEYCLOAK|GOOGLE_OAUTH|APPLE_OAUTH)'
    'RATE_LIMIT_EMAIL_SENT'
    'ADDITIONAL_REDIRECT_URLS'
    'MAILER_(SUBJECTS|TEMPLATES)_(CONFIRMATION|RECOVERY|MAGIC_LINK|EMAIL_CHANGE|INVITE)'
    'STUDIO_(DEFAULT_ORG|DEFAULT_PROJECT|BASIC_AUTH)'
    'EDGE_(RUNTIME_MODE|VERIFY_JWT)'
    'ALLOWED_ORIGINS'
    'SENTRY_(URL|ORG|PROJECT|AUTH_TOKEN)'
    'STRIPE_(SECRET_KEY|WEBHOOK_SECRET)'
    'FIREBASE_SERVICE_ACCOUNT_JSON'
    'PLUGIN_(SYSTEM_URL|BROKER_URL)'
    'KATA_DEFAULT_RUNTIME'
    'IMAGE_(NETBIRD|NETBIRD_MANAGEMENT|NETBIRD_SIGNAL|NETBIRD_DASHBOARD|NETBIRD_RELAY|SYNAPSE|LK_JWT_SERVICE|MAUTRIX_TELEGRAM|MAUTRIX_WHATSAPP|MAUTRIX_SIGNAL|MAUTRIX_DISCORD|MAUTRIX_SLACK|MAUTRIX_META|POSTMOOGLE|N8N|NOCODB|APPSMITH|MINIO|MINIO_PUBLIC|PGADMIN|OAUTH2_PROXY)'
    'INSIGHT_LLM_(BACKEND|PROVIDER|MODEL|BASE_URL)'
    'INSIGHT_EMB_(PROVIDER|MODEL|BASE_URL)'
    'INSIGHT_OPENAI_(TYPE|ENDPOINT)'
    'INSIGHT_RERANK_PROVIDER'
    'INSIGHT_DEFAULT_LANG'
    'MAESTRO_API_KEY'
    'KRONOS_API_KEY'
    'LLM_GW_UPSTREAM_URL'
    'LLM_GATEWAY_(DB_PASSWORD|SECRET|OIDC_SECRET|OIDC_CLIENT_ID|DOMAIN)'
    'AISHA_LLM_GATEWAY_(KEY|URL)'
    'OPENCLAW_(API_KEY|DB_PASSWORD|SECRET|DOMAIN|OIDC_CLIENT_ID|OIDC_SECRET|MAX_PARALLEL_AGENTS|SANDBOX_CPU_LIMIT|SANDBOX_MEM_LIMIT|MATRIX_HOMESERVER|MATRIX_TOKEN|DISCORD_TOKEN|SLACK_TOKEN|TELEGRAM_TOKEN)'
    'ANTHROPIC_API_KEY'
    'OPENAI_API_KEY'
    'GOOGLE_AI_API_KEY'
    'IMAGE_(LLM_GATEWAY|OPENCLAW)'
    'VERDACCIO_(TOKEN|URL)'
  )
  REGEN_KEYS="^($(IFS="|"; printf "%s" "${REGEN_KEY_PATTERNS[*]}"))="

  # Průchod zbylých klíčů z .env-prod-backup stojí AŽ POSLEDNÍ, těsně před `mv` níž —
  # filtruje se proti tomu, co už je zapsané (heredoc + printf dodatky).


  # Operator roster (computed above from config/operators.json) appended RAW via
  # printf so the JSON value survives intact (the heredoc above would mangle
  # backslashes/`$`; load_env_file in coolify-deploy-init splits on the first
  # `=`, and set_coolify_env JSON-escapes the value via jq → Coolify-safe).
  if [ -n "${OPERATORS_COMPACT:-}" ]; then
    printf 'AISHA_OPERATORS=%s\n' "$OPERATORS_COMPACT" >> "$TMP_ENV"
    ok "  AISHA_OPERATORS appended → provision-operators (post-realm core re-migrate) restores users on wipe"
  fi

  # ── Overlay POVRCHU ────────────────────────────────────────────────────────
  # Odkud si build vezme app.config.json: IdP, client_id, adresa API.
  #
  # NAMERENO 2026-08-22 v prohlizeci majitele: dokud se tyhle radky nevydavaly,
  # stavel se povrch z instances/_default -- z REFERENCNI SABLONY -- a extranet
  # posilal uzivatele na cizi IdP. Nic pritom nespadlo; vada se pozna az ocima,
  # na prihlasovaci obrazovce.
  #
  # Radky vznikaji jen kdyz instance povrch MA. Cestu vydava derive-domains
  # z identity instance a overuje ji proti stromu instancniho repa, takze
  # prazdna hodnota se sem nedostane. Zadna vychozi hodnota: nevime-li, nevydame
  # nic a build skonci na strazi v Dockerfilu -- hlasite, ne cizim povrchem.
  if [ -n "${SURFACE_OVERLAY_PATH:+deklarovano}" ]; then
    # Overlay bydli v TEMZE instancnim repu jako zbytek instancnich dat. URL nese
    # fragment #ref, ktery git clone neprijme -- rozdeli ho hotovy parser
    # (lib/instance-data-url.sh), aby to nebyla ctvrta kopie teze logiky.
    eval "$(parse_instance_data_url "${AISHA_INSTANCE_DATA_GIT_URL:?povrch instance je deklarovany, ale URL instancniho repa chybi -- odkud se ma overlay vzit}")"
    # ⛔ BEZ POVERENI (namereno 2026-09-13): URL instancniho repa nese
    # `oauth2:<token>@` a SURFACE_OVERLAY_GIT_URL je BUILD ARG povrchu -- tedy
    # zapis do `docker history` naporad. Token do buildu jde BuildKit secretem
    # forgejo_token (docker-compose.coolify-extranet.yml), tataz draha jako
    # svc-web-artifact. Dockerfile povrchu URL s poverenim odmitne; host-side
    # `overlay-cachebust.sh` si token doplni z FORGEJO_TOKEN sam.
    printf 'SURFACE_OVERLAY_GIT_URL=%s\n' "$(printf '%s' "$IDATA_URL" | sed -E 's|^([A-Za-z][A-Za-z0-9+.-]*://)[^@/]*@|\1|')" >> "$TMP_ENV"
    printf 'SURFACE_OVERLAY_PATH=%s\n' "$SURFACE_OVERLAY_PATH" >> "$TMP_ENV"
    # Vydat VZDY (i prazdny): heredoc uz tenhle klic nevydava, takze prazdna
    # hodnota tady zastarale pripnuti v Coolify SMAZE. Nevydat ho by ho tam
    # nechalo viset. CACHEBUST do teto trojice nepatri -- vyrabi ho
    # aisha-redeploy.mjs primo na aplikaci tesne pred deployem.
    printf 'SURFACE_OVERLAY_REF=%s\n' "${IDATA_REF:-}" >> "$TMP_ENV"
    ok "  Overlay povrchu: ${SURFACE_OVERLAY_PATH} z instancniho repa (ref=${IDATA_REF:+$IDATA_REF})"
  fi

  # ── Průchod operátorských klíčů z .env-prod-backup — POSLEDNÍ zapisovatel ────
  #
  # ⛔ NAMĚŘENO 2026-09-13 na nasazené instanci. REGEN_KEY_PATTERNS výš je RUČNÍ seznam „co vlastní
  # heredoc" — a rozešel se s heredocem: z .env-prod-backup by průchodem prošlo
  # 38 klíčů, které heredoc UŽ zapsal (APP_NAME_PREFIX, NETBIRD_PEER_CIDR,
  # EXTRANET_OIDC_SECRET, PLATFORM_ADMIN_EMAIL, CHAT_GGUF_URL, …). Zálohy env-doktora
  # (.backup/env.coolify.bak-*, stav PŘED jeho slučováním) to potvrzují: do 2026-09-02
  # nesly až 34 zdvojených klíčů, 5 s ODLIŠNOU hodnotou (hash). Soubor pak držel
  # jeden řádek na klíč jen díky tomu, že env-doktor duplicity sloučil (ponechá
  # POSLEDNÍ = zálohu) — a to jen když měl co doplnit. Konzumenti se přitom
  # neshodnou: coolify-deploy-init `load_env_file` i config-env-files berou poslední
  # neprázdný, coolify-sync-envs pošle do Coolify OBA řádky (payload) a jeho
  # `read_env_key` čte PRVNÍ, aisha-redeploy (`val()`) taky PRVNÍ — změřeno nad
  # souborem se zdvojeným klíčem. Která hodnota se nasadí, rozhodovalo pořadí čtení.
  #
  # ⭐ PRIORITA VÝSLOVNĚ: co zapsal heredoc nebo printf dodatek, VYHRÁVÁ. Heredoc
  # zapisuje výstup generate-secrets, který zálohu sám čte jako PRVNÍ zdroj
  # (firstNonEmpty: backup → env → .env.coolify), takže zachované hodnoty jsou
  # tytéž; liší se jen ODVOZENÉ (NETBIRD_PEER_CIDR) — a tam má vyhrát čerstvé
  # odvození, ne ozvěna starého výstupu (táž třída jako MESH_DNS_* 2026-08-12).
  # Průchod nese jen klíče, které heredoc nezná; když je v záloze klíč víckrát,
  # bere se POSLEDNÍ výskyt (tak ho načetl `load_env_file_keys … overwrite`).
  # Vlastnictví se tu NEODVOZUJE ze seznamu, ale z toho, co je v souboru zapsané.
  _klice_zapsane="$(mktemp)"
  grep -oE '^[A-Z_][A-Z0-9_]*=' "$TMP_ENV" | tr -d '=' | sort -u > "$_klice_zapsane"
  # ── Vygenerovaná tajemství z minula ──────────────────────────────────────────
  # ⛔ NAMĚŘENO 2026-09-16 (tři běhy --skip-create, hash hodnot): 11 tajemství
  # dostalo při KAŽDÉM běhu novou hodnotu — AISHA_AS/HS_TOKEN, AISHA_PKI_BOOTSTRAP_*,
  # GRAFANA_ADMIN_PASSWORD, INGEST_DROP_*, INTRANET_API_KEY, POSTGRES_EXPORTER_PASSWORD.
  # Heredoc je nezapisuje, záloha je nenese (nebo je REGEN_KEYS vyřadí), takže
  # nový .env.coolify je ztratil a env-doktor je vyrobil znovu. Rotace rozbíjí stav,
  # který hodnotu drží: Appsmith datasource (provision přeskočí existující → 401),
  # admin Grafany (heslo jen při založení DB), a každý běh přidal do MinIO dalšího
  # rw uživatele bucketu. Záměr všude jinde je opačný (pg(): „preserve mode").
  #
  # Převezme se jen DRUH TAJEMSTVÍ podle kontraktu doktora (secret/hex/b64std) —
  # náhodná hodnota, kterou nejde znovu vyrobit. Odvozené hodnoty se NEPŘEVÁDĚJÍ:
  # to by byla ozvěna starého výstupu (MESH_DNS_*, subnety — viz výš). Pořadí
  # vstupu do awk: minulý .env.coolify PŘED zálohou, awk bere poslední výskyt →
  # hodnota ze zálohy vyhraje (jako v pg(): backup → env → .env.coolify).
  # Zapsané heredocem vyhrává vždy (filtr NR == FNR). Bez preserve (rotace na
  # přání) se nepřevádí nic.
  _tajne_z_minula="$(mktemp)"
  # PRESERVE_STATEFUL_SECRETS je nastavený výš (před generate-secrets) — tady se čte.
  if [ "$PRESERVE_STATEFUL_SECRETS" = "1" ] && [ -f "$ENV_COOLIFY" ]; then
    _kontrakt_doktora="$(node "$REPO_ROOT/scripts/aisha-env-doctor.mjs" --print-contract-keys)" || _kontrakt_doktora=""
    # here-string, ne `printf | grep -q`: grep -q skončí u shody, printf dostane
    # SIGPIPE a s pipefail je výsledek 141 = „nenačetl se" (2026-09-11).
    if ! grep -qE '^__CONTRACT_END__'$'\t''[0-9]+$' <<<"$_kontrakt_doktora"; then
      err "Kontrakt env-doktora se nenačetl celý (chybí __CONTRACT_END__) — nevím, která tajemství zachovat."
      err "  Přepsat .env.coolify teď by vygenerovaná tajemství tiše ROTOVALO. .env.coolify se NEPŘEPISUJE."
      rm -f "$TMP_ENV" "$_klice_zapsane" "$_tajne_z_minula"
      exit 1
    fi
    printf '%s\n' "$_kontrakt_doktora" \
      | awk -F'\t' '$2 == "secret" || $2 == "hex" || $2 == "b64std" || $2 == "external" || $2 == "placeholder" { print $1 }' \
      | awk -F= 'NR == FNR { tajne[$1] = 1; next } ($1 in tajne) && length($0) > length($1) + 1' - "$ENV_COOLIFY" \
      > "$_tajne_z_minula"
    unset _kontrakt_doktora
    # ⛔ ŽIVÉ HODNOTY OPERÁTORA SE NEVYPRAZDŇUJÍ (2026-10-03, konvergence existující
    # instance). Druhy `external` (hodnota operátora) a `placeholder` (doplní ji nástroj
    # PO nasazení — roster dveří, adresy peerů) se znovu vyrobit nedají. Když je záloha
    # nenese, heredoc je zapsal PRÁZDNÉ a sync je v Coolify přepsal prázdnem; u rosteru
    # dveří šel knock-provision cestou „vygeneruj nový“ a zařízení by přišla o dveře.
    # Prázdný řádek heredocu se proto nahradí neprázdnou hodnotou z minulého
    # .env.coolify; neprázdná hodnota heredocu (záloha, odvození) vyhrává dál.
    if [ -s "$_tajne_z_minula" ]; then
      _prevzate="$(mktemp)"
      awk -F= 'NR == FNR { minule[$1] = $0; next }
               ($0 == $1 "=") && ($1 in minule) { print minule[$1]; prevzato[$1] = 1; next }
               { print }
               END { for (k in prevzato) print k > "/dev/stderr" }' "$_tajne_z_minula" "$TMP_ENV" \
        > "${TMP_ENV}.prevzate" 2> "$_prevzate" && env_zapis_atomicky "${TMP_ENV}.prevzate" "$TMP_ENV"
      if [ -s "$_prevzate" ]; then
        warn "Krok 2: převzato z minulého .env.coolify (záloha je nenese, heredoc je zapsal prázdné): $(sort "$_prevzate" | tr '\n' ' ')"
        warn "  Doplň je do .env-prod-backup — převzetí chrání běh, záloha patří operátorovi."
      fi
      rm -f "$_prevzate"; unset _prevzate
    fi
  fi
  { cat "$_tajne_z_minula"
    grep -E "^[A-Z][A-Z0-9_]+=" "$ENV_PROD_BACKUP" 2>/dev/null \
    | grep -vE "$REGEN_KEYS" \
    | grep -vE "^(API_DOMAIN_PUBLIC|MCP_DOMAIN|DIRIGENT_DOMAIN|AUTH_DOMAIN|KEYCLOAK_PUBLIC_DOMAIN|AUTH_PUBLIC_DOMAIN|KEYCLOAK_DOMAIN_PUBLIC|KEYCLOAK_DOMAIN_DIRECT|AUTH_DOMAIN_PUBLIC|PUBLIC_TLD|INTERNAL_TLD|MESH_TLD|PKI_BRIDGE_DOMAIN|GATEWAY_DOMAIN|COMPANION_DOMAIN|OAUTH2_COOKIE_DOMAINS|OAUTH2_COOKIE_DOMAINS_FRONTEND|OAUTH2_WHITELIST_DOMAINS|MESH_ENABLED|MCP_UPSTREAM|API_UPSTREAM|DIRIGENT_UPSTREAM|AUTH_UPSTREAM|MCP_UPSTREAM_PUBLIC|API_UPSTREAM_PUBLIC|DIRIGENT_UPSTREAM_PUBLIC|AUTH_UPSTREAM_PUBLIC|MCP_UPSTREAM_MESH|API_UPSTREAM_MESH|DIRIGENT_UPSTREAM_MESH|AUTH_UPSTREAM_MESH|LIVE_DOMAIN|LIVE_DOMAIN_PUBLIC|LIVE_UPSTREAM|LIVE_UPSTREAM_PUBLIC|LIVE_UPSTREAM_MESH|GATEWAY_DOMAIN_PUBLIC|GATEWAY_UPSTREAM|GATEWAY_UPSTREAM_PUBLIC|GATEWAY_UPSTREAM_MESH|COMPANION_DOMAIN_PUBLIC|COMPANION_UPSTREAM|COMPANION_UPSTREAM_PUBLIC|COMPANION_UPSTREAM_MESH|INGEST_DOMAIN_PUBLIC|INGEST_UPSTREAM|POTOK_DOMAIN_PUBLIC|POTOK_UPSTREAM)=" \
    | grep -vE "^(COOLIFY_API_TOKEN|FORGEJO_API_TOKEN)="
  } | awk -F= 'NR == FNR { zapsano[$1] = 1; next }
               ($1 in zapsano) { next }
               { if (!($1 in radek)) poradi[++n] = $1; radek[$1] = $0 }
               END { for (i = 1; i <= n; i++) print radek[poradi[i]] }' "$_klice_zapsane" - \
    >> "$TMP_ENV" || true
  rm -f "$_klice_zapsane" "$_tajne_z_minula"
  unset _klice_zapsane _tajne_z_minula

  # ── Zavřená opt-in lane: její adresy se vydají VÝSLOVNĚ PRÁZDNÉ ───────────────
  # ⛔ NAMĚŘENO 2026-10-04 (vypnutí lokálního modelu na nasazené instanci): operátor lane
  # zavřel (`CHAT_GGUF_URL=`), resolver službu vynechal — a její adresa
  # (`VLLM_GENERATION_URL`, čte ji core i ai-chat) v novém souboru jen CHYBĚLA. Chybějící
  # čtený klíč kontinuita níž převezme z minula: migrace by dostala adresu služby, která
  # se nenasazuje, a provider lokálního modelu by ZAPNULA; v Coolify by stará adresa
  # visela dál, protože sync klíče nemaže. Zavřít lane je rozhodnutí, ne zapomenutí —
  # adresa se proto vydá prázdná (týž tvar jako SURFACE_OVERLAY_REF výš): kontinuita
  # prázdnou nepřebíjí a sync zastaralou hodnotu přepíše.
  # Až ZA průchodem zálohy: adresu, kterou operátor připnul (cizí služba místo vlastní),
  # průchod už zapsal a tady se nemění. Které klíče to jsou, říká katalog — jediný domov
  # je lib/provision-gate.mjs (tatáž odpověď „zapnuto?“ jako story-init a resolver).
  if ! node "$REPO_ROOT/scripts/lib/provision-gate.mjs" --dopln-adresy-zavrenych "$TMP_ENV"; then
    err "Krok 2: adresy zavřených lanes nejdou určit (výpis výš) — .env.coolify se NEPŘEPISUJE."
    rm -f "$TMP_ENV"
    exit 1
  fi

  # ── Jeden zápis na klíč: měří se VÝSLEDEK, ne jen emitory ────────────────────
  # Brána kontrakt-nema-dva-domovy měří heredoc + printf; průchod závisí na obsahu
  # zálohy, takže vlastnost se ověřuje tady, nad souborem, který se právě zapíše.
  _dvakrat="$(grep -oE '^[A-Z_][A-Z0-9_]*=' "$TMP_ENV" | sort | uniq -d | tr -d '=' | tr '\n' ' ')"
  if [ -n "$_dvakrat" ]; then
    err "Generování .env.coolify vydalo klíč VÍCKRÁT: ${_dvakrat}"
    err "  Každý čtenář by vzal jiný výskyt (deploy-init poslední neprázdný, sync-envs pošle oba)."
    err "  Nasadit to znamená, že o hodnotě rozhoduje pořadí čtení, ne kód — .env.coolify se NEPŘEPISUJE."
    rm -f "$TMP_ENV"
    exit 1
  fi
  unset _dvakrat

  # ── Kontinuita existující instance: nový soubor nesmí ztratit, co drží provoz ──
  # ⛔ NAMĚŘENO 2026-10-03 (výpadek ~7 h): soubor vyrobený nanovo ztratil DRŽENÝ klíč
  # (POSTGRES_MAJOR 17 → doktor doplnil domov 18 → obraz 18 nad daty 17 odmítl start),
  # pin operátora (KEYCLOAK_URL → `https://`) a 12 klíčů, které compose čte. Hlídat to
  # simulací vedle běhu nestačilo (viděla jen vyprázdnění) — rozhoduje se proto TADY,
  # nad souborem, který se právě zapíše. Pravidla a důvody: scripts/lib/kontinuita-env.mjs.
  # Jen nad existujícím stackem; wipe a první založení berou hodnoty z domova.
  # ⛔ BEZ podmínky na existenci minulého souboru (revize 2026-10-03): ten je vlastnost
  # STROMU, ne instance — z čerstvého klonu nebo jiného stroje chybí a kontrola se s
  # podmínkou `-s` tiše přeskočila. Že není s čím srovnat, řekne nástroj sám (kód 4).
  if [ "$SKIP_CREATE" = "1" ]; then
    _kont_rc=0
    node "$REPO_ROOT/scripts/lib/kontinuita-env.mjs" --minule "$ENV_COOLIFY" --nove "$TMP_ENV" --koren "$REPO_ROOT" || _kont_rc=$?
    if [ "$_kont_rc" -ne 0 ]; then
      if [ "$_kont_rc" -eq 4 ]; then
        err "Krok 2: kontinuita NEMĚŘENA (výpis výš) — .env.coolify se NEZAPISUJE."
      else
        err "Krok 2: nový .env.coolify by nasadil rozbitou hodnotu (výpis výš) — .env.coolify se NEPŘEPISUJE."
      fi
      rm -f "$TMP_ENV"
      exit 1
    fi
    unset _kont_rc
  fi

  env_zapis_atomicky "$TMP_ENV" "$ENV_COOLIFY"
  # Re-enable strict unbound-var check (off during heredoc expansion above).
  set -u
  # Hodnoty se ukládají raw — generované secrets z gen_secret() neobsahují `$`.
  # set_coolify_env() warní, pokud user-supplied hodnota obsahuje literal `$`
  # (Coolify build-time parser by ji rozbil).
  ok "Wrote $ENV_COOLIFY ($(wc -l < "$ENV_COOLIFY") lines)"

  # Kód env-doktora: 0 = hotovo; 3 = WEB_FQDNS (domény webu) NEZNÁ — ostatní klíče
  # doplnil, ale deklaraci domén nemá (vadný odkaz v overlayi apod.). Krok 4 by pak
  # srovnal domény hodnotou ze shellu, kterou env-doktor odmítl — proto KONEC.
  # Jiný nenulový kód = chybějící externí hodnoty / dílčí vada, jako dosud nefatální.
  vyhodnot_env_doktora() {
    case "${1:-0}" in
      0) : ;;
      3)
        err "env-doctor: WEB_FQDNS (domény webu) NEZNÁ — klíč nezapsán, ostatní doplněny (příčina ve výpisu výše)"
        err "  NEPOKRAČUJU: krok 4 by srovnal domény webu hodnotou, kterou env-doktor jako deklaraci nepřijal."
        exit 1
        ;;
      *) warn "env-doctor skončil kódem ${1} — chybějící externí hodnoty nebo dílčí vada (non-fatal, výpis výše)" ;;
    esac
  }

  # ── Heal pass: env-doctor doplní jakýkoli klíč z compose contractu, který by
  # zde chyběl (idempotentní, neporuší existující hodnoty). Single source of
  # truth pro contract: scripts/aisha-env-doctor.mjs (CONTRACT array).
  if command -v node >/dev/null 2>&1; then
    info "Running aisha-env-doctor (heal pass)..."
    _env_doktor_rc=0
    node "${REPO_ROOT}/scripts/aisha-env-doctor.mjs" || _env_doktor_rc=$?
    vyhodnot_env_doktora "$_env_doktor_rc"
  else
    warn "node not found; skipping env-doctor heal pass"
  fi

  # ── Per-app contract validation: porovnej .env.coolify proti reálným klíčům
  # extrahovaným z docker-compose.coolify-*.yml přes manifest. Jediná otázka:
  # je každý klíč přítomen v .env.coolify? Prázdná hodnota je OK — preset
  # pro uživatele, který si ji doplní podle potřeby (Telegram, Resend...).
  # Pokud klíč v souboru úplně chybí, gen sekce je broken — fail fast.
  banner "Validace .env.coolify proti compose contractům"
  # MANIFEST_FILE explicitně: sync-envs defaultuje manifest z APP_NAME_PREFIX,
  # ale story (manifest) ≠ prefix (jména aplikací) — u story-scoped deploye
  # by default hledal neexistující <prefix>.manifest.
  VALIDATE_TMP="$(mktemp)"
  MANIFEST_FILE="$MANIFEST" SKIP_ENV_PREFLIGHT=1 VALIDATE_ONLY=1 bash "${REPO_ROOT}/scripts/coolify-sync-envs.sh" >"$VALIDATE_TMP" 2>&1 || true

  # `grep | sed | awk | sort` pipeline — grep exits 1 pokud žádný "MISSING:"
  # match → s `set -uo pipefail` to pipefail-uje a silently abortuje skript
  # bez error message. `|| true` zajistí 0-exit pokud žádný drift.
  MISSING_KEYS=$(grep "MISSING:" "$VALIDATE_TMP" 2>/dev/null | sed 's/.*MISSING: //' | awk '{print $1}' | sort -u || true)
  rm -f "$VALIDATE_TMP"
  MISSING_COUNT=$(echo "$MISSING_KEYS" | grep -c . || true)

  if [ "$MISSING_COUNT" -gt 0 ]; then
    warn "Chybí ${MISSING_COUNT} klíčů — druhý heal pass env-doctoru…"
    echo "$MISSING_KEYS" | sed 's/^/   - /'
    if command -v node >/dev/null 2>&1; then
      _env_doktor_rc=0
      node "${REPO_ROOT}/scripts/aisha-env-doctor.mjs" || _env_doktor_rc=$?
      vyhodnot_env_doktora "$_env_doktor_rc"
    fi
    VALIDATE_TMP="$(mktemp)"
    MANIFEST_FILE="$MANIFEST" SKIP_ENV_PREFLIGHT=1 VALIDATE_ONLY=1 bash "${REPO_ROOT}/scripts/coolify-sync-envs.sh" >"$VALIDATE_TMP" 2>&1 || true
    MISSING_KEYS=$(grep "MISSING:" "$VALIDATE_TMP" 2>/dev/null | sed 's/.*MISSING: //' | awk '{print $1}' | sort -u || true)
    rm -f "$VALIDATE_TMP"
    MISSING_COUNT=$(echo "$MISSING_KEYS" | grep -c . || true)
  fi

  if [ "$MISSING_COUNT" -gt 0 ]; then
    err "Chybí ${MISSING_COUNT} klíčů v .env.coolify i po env-doctor heal pass:"
    echo "$MISSING_KEYS" | sed 's/^/   - /'
    err "Doplň je do CONTRACT v scripts/aisha-env-doctor.mjs (topo/dom/static) nebo HEREDOC gen sekce"
    err "Diagnostika: node scripts/aisha-env-doctor.mjs --report"
    [ "${IGNORE_MISSING_REQUIRED:-0}" = "1" ] || exit 1
    warn "IGNORE_MISSING_REQUIRED=1 — pokračuji navzdory chybám"
  else
    ok "Všechny compose klíče přítomny v .env.coolify (prázdné hodnoty = uživatelské placeholdery)"
  fi
fi

# ── Dveře (SPA knock): odvodit, co odvodit umíme ─────────────────────────────
# ⛔ NAMĚŘENO 2026-08-19: chybělo to na OBOU stranách naráz a jen jedna křičela.
# Server: prázdný `SPA_OPERATORS_B64` → svc-knock je fail-closed, nenastartuje
# a drží celý edge v restartu. Klient: `EXPO_PUBLIC_KNOCK_*` nikdo nevyráběl,
# takže build 13 odešel do TestFlightu bez dveří a appka je MLČKY skryla.
#
# Host/port/kid/scope jsou odvoditelné z identity instance — odvodí se tedy tady
# a týmiž hodnotami je pak bere i mobilní build (`build-ios.sh`), takže shoda
# `kid` plyne z konstrukce, ne ze dvou nezávislých zápisů.
#
# KÓD se nedá odvodit, ale DÁ SE VYGENEROVAT: `svc-knock` je fail-closed, takže
# čekat na člověka znamená nechat dveře i edge dole neomezeně dlouho. Roster se
# proto založí sám a kód se VYPÍŠE (týž provisioning jako PLATFORM_ADMIN_PASSWORD);
# tichý default to není. Kdo chce vlastní kód: `knock-provision.mjs --operator`.
#
# ⛔ JEN PRO INSTANCI, KTERÁ DVEŘE DEKLARUJE (naměřeno 2026-09-15): bezpodmínečný
# provision vyrobil roster všude a deploy-init podle něj zapnul `knock` i tam, kde
# ho nikdo nechtěl — v měřicím režimu, se kterým svc-knock s rosterem nenaběhne.
# O zapnutí rozhoduje jediná deklarace (lib/dvere-soulad.mjs). Selhání u instance,
# která dveře deklaruje, je NEDOKONČENÝ běh, ne varování: bez rosteru nebo v rozporu
# s režimem svc-knock nenastartuje a stáhne s sebou edge.
_dvere_rc=0
node scripts/lib/dvere-soulad.mjs --deklarovano --env-file "$ENV_COOLIFY" || _dvere_rc=$?
case "$_dvere_rc" in
  0)
    if AISHA_INSTANCE_ENV="$ENV_COOLIFY" AISHA_STACK_EXISTS="$SKIP_CREATE" node scripts/knock-provision.mjs; then
      ok "Dveře: deklarované — parametry odvozeny, roster podle režimu (výpis výše)"
    else
      nedokonceno "Dveře: deklarované, ale knock-provision.mjs selhal (výpis výše) — svc-knock nenastartuje a shodí edge"
    fi
    _dvere_operator=()
    [ -f "$ENV_PROD_BACKUP" ] && _dvere_operator=(--operator-file "$ENV_PROD_BACKUP")
    if ! node scripts/lib/dvere-soulad.mjs --soulad --env-file "$ENV_COOLIFY" ${_dvere_operator[@]+"${_dvere_operator[@]}"}; then
      nedokonceno "Dveře: deklarace, režim a roster v .env.coolify nejsou v souladu (výpis výše) — svc-knock by nenaběhl"
    fi
    ;;
  1) ok "Dveře: instance je nedeklaruje (EDGE_COMPOSE_PROFILES bez „knock“) — provision se nespouští" ;;
  *) nedokonceno "Dveře: deklaraci nejde přečíst z ${ENV_COOLIFY} (kód ${_dvere_rc}) — NEMĚŘENO, provision se nespustil" ;;
esac
unset _dvere_rc _dvere_operator

# ─────────────────────────────────────────────────────────────────────────────
step "2b. PREFLIGHT — validate every docker-compose.coolify*.yml"
# ─────────────────────────────────────────────────────────────────────────────
# Catches `${VAR:?...}` placeholder failures, malformed YAML, missing keys.
# Runs against .env.coolify with `docker compose config -q`.
#
# STORY-SCOPED: validate only the compose files the story's manifest actually
# deploys. A lean story's .env.coolify legitimately lacks the excluded tier's
# `${X:?}` vars (generate-secrets mints only what the topology includes), so
# validating the full catalog turns "excluded on purpose" into a false FATAL.
# Non-manifest compose files are validated by the full-profile CI runs instead.
PREFLIGHT_COMPOSE_FILES="$(vlastni_aplikace | cut -f3 | sort -u | tr '\n' ' ')"
if [ "$DRY_RUN" = "1" ]; then
  warn "[DRY RUN] Would run: scripts/preflight-compose.sh (manifest scope: ${PREFLIGHT_COMPOSE_FILES:-full catalog})"
else
  if COMPOSE_FILES="${PREFLIGHT_COMPOSE_FILES}" bash "${REPO_ROOT}/scripts/preflight-compose.sh" </dev/null; then
    ok "All manifest compose stacks validate against .env.coolify"
  else
    err "Preflight compose validation FAILED — fix env or compose before proceeding"
    exit 1
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "2b2. NASAZUJE SE TO, CO BYLO PRÁVĚ ZVALIDOVÁNO?"
# ─────────────────────────────────────────────────────────────────────────────
# Krok 2b ověřil compose soubory v PRACOVNÍM STROMĚ. Coolify je ale nikdy
# nevidí — klonuje si repo sám a staví z větve deklarované v manifestu
# (`branch:`, čte ji coolify-story-init.sh). Když se strom od té větve liší,
# validuje se jeden kód a nasazuje druhý — a celý běh to odhlásí zeleně.
#
# Naměřeno 2026-08-19: oprava Traefik labelu ležela v necommitnuté větvi,
# `--wipe` postavil starý `main` a následné ověření „opravy" měřilo neopravený
# stack. Dvanáct požadavků vrátilo 200/401 dál a hledala se šestá příčina —
# přitom oprava na server nikdy nedorazila. Nic v cestě se na to nezeptalo:
# aisha-cold-start.sh dosud neobsahoval JEDINÉ volání gitu nad vlastním repem.
#
# Táž třída jako #79 a #159: výstup vypadá jako měření, ale odpovídá na jinou
# otázku — tady na „co dělá stack" místo „co dělá stack S TOU OPRAVOU".
#
# Stojí PŘED krokem 2c (odloženým wipem) ze stejného důvodu jako celý
# validate-before-destroy: nesrovnalost musí padnout, dokud stará platforma
# ještě žije.
#
# Měří se VLASTNOST („nasadím, co jsem validoval"), ne konkrétní větev — jméno
# si bere z manifestu, takže fork s vlastní deploy větví projde touž cestou.
#
# ⛔ A NE PODLE JMÉNA REMOTE (naměřeno 2026-10-03 při konvergenci instance forku): `ls-remote origin`
# ve fork checkoutu četl UPSTREAM, zatímco Coolify staví z repozitáře forku →
# „Nasadil by se JINÝ kód“ nad stromem, který souhlasil. Repozitář i větev dává
# týž vstup, ze kterého story-init skládá `git_repository` (FORGEJO_URL + repo:
# + branch:); remote se vybírá podle identity URL — scripts/lib/nasazovany-repozitar.mjs.
# Story-init se ptá TÉHOŽ režimu (--deklarace): výklad je jeden, ne dva podobné.
#
# ⛔ ROZPOR DEKLARACE S PROSTŘEDÍM PADÁ TADY, PŘED KROKEM 2c (recenze 2026-10-04).
# `GIT_BRANCH` v prostředí odlišný od větve manifestu znal jen story-init (krok 3):
# běh prošel doktorem i tímhle krokem a zastavil se až PO odloženém wipu — instance
# smazaná, aplikace nezaložené. Režim --deklarace proto čte GIT_BRANCH z prostředí
# sám a rozpor vrací nenulou; prostředí tohohle volání se nesmí měnit (žádné
# `GIT_BRANCH=…` ani `env -u` před příkazem), jinak by krok o rozporu nevěděl.
if ! _deploy_dekl="$(node "${REPO_ROOT}/scripts/lib/nasazovany-repozitar.mjs" --manifest "$MANIFEST" --deklarace)"; then
  err "Deklaraci nasazení nejde použít (důvod ve výpisu výše) — nevím, ze kterého repozitáře a větve Coolify staví,"
  err "  nebo jí odporuje prostředí. Zastavuji PŘED wipem: story-init (krok 3) by na témže skončil až po něm."
  exit 1
fi
# Třetí sloupec (cesta `org/repo`) tenhle krok nepotřebuje — čte ho story-init.
IFS=$'\t' read -r _deploy_branch _deploy_repo _ <<< "$_deploy_dekl"

if [ "$DRY_RUN" = "1" ]; then
  warn "[DRY RUN] Would verify: pracovní strom == ${_deploy_repo} ${_deploy_branch} (Coolify staví odtud)"
else
  # --ignore-submodules=dirty: špinavý pracovní strom submodulu není změna
  # obsahu, který se nasazuje; posunutý SHA submodulu ANO a ten se nahlásí.
  _strom_zmeny="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no --ignore-submodules=dirty 2>/dev/null || true)"
  if [ -n "$_strom_zmeny" ]; then
    err "Pracovní strom má necommitnuté změny — Coolify je nikdy neuvidí."
    err "  Krok 2b validoval TENTO strom; nasadí se ale obsah větve '${_deploy_branch}'."
    printf '%s\n' "$_strom_zmeny" | sed 's/^/    /' >&2
    err "  Náprava: dostaň změny do '${_deploy_branch}' (commit → push → PR → merge), nebo je zahoď."
    exit 1
  fi

  _head_lokal="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
  if [ -z "$_head_lokal" ]; then
    err "Nepodařilo se přečíst HEAD pracovního stromu (${REPO_ROOT}) — nemám co porovnat."
    err "  Prázdno není shoda; bez něj nevím, co jsem právě validoval."
    exit 1
  fi

  # Prázdná odpověď NENÍ shoda — buď větev neexistuje, nebo je Forgejo nedostupné.
  # Obojí znamená, že nevím, co Coolify postaví; číst to jako „v pořádku" je
  # přesně ta vada, kterou tenhle krok zavírá.
  _head_vzdal=""
  _deploy_pres="-"
  if _deploy_cteni="$(node "${REPO_ROOT}/scripts/lib/nasazovany-repozitar.mjs" --manifest "$MANIFEST" --repo-root "$REPO_ROOT" --cti)"; then
    IFS=$'\t' read -r _head_vzdal _ _ _deploy_pres <<< "$_deploy_cteni"
  fi
  if [ -z "$_head_vzdal" ]; then
    err "Větev '${_deploy_branch}' z ${_deploy_repo} se nepodařilo přečíst (git ls-remote, výpis výše)."
    err "  Coolify z ní bude stavět. Bez přečtení nevím, co nasadím — a nepokračuji."
    err "  Důvod od gitu je ve výpisu výš. Nejčastěji je to PŘÍSTUP: soukromý repozitář a git na tomto"
    err "  stroji pro něj nemá přihlašovací údaje (jinde je dodá správce pověření)."
    err "  Remote přidávej jen tehdy, když na tenhle repozitář žádný remote stromu neukazuje:"
    err "    git remote add <jméno> ${_deploy_repo}"
    exit 1
  fi

  if [ "$_head_lokal" != "$_head_vzdal" ]; then
    err "Nasadil by se JINÝ kód, než jaký krok 2b zvalidoval."
    err "  pracovní strom : ${_head_lokal}"
    err "  ${_deploy_repo} ${_deploy_branch} : ${_head_vzdal}  ← odtud staví Coolify (remote: ${_deploy_pres})"
    err "  Náprava: dostaň své commity do '${_deploy_branch}' (push → PR → merge),"
    err "           nebo v ${MANIFEST} přepiš 'branch:' na větev, kterou chceš nasadit."
    exit 1
  fi

  ok "Nasazuje se přesně zvalidovaný strom (${_deploy_repo} ${_deploy_branch} @ $(printf '%s' "$_head_lokal" | cut -c1-9), remote: ${_deploy_pres})"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "2c. EXECUTE DEFERRED WIPE (validate-before-destroy)"
cs_over_izolaci_projektu "krok 2c"
# ─────────────────────────────────────────────────────────────────────────────
# The destroy was DEFERRED from Step 1 to HERE so that secret generation (Step 2)
# and compose validation (Step 2b) ran while the OLD platform was still intact.
# Reaching this line means generate + validate BOTH succeeded — only now is it
# safe to destroy. Any earlier failure exited above with the old platform
# untouched, so the cold-start can never leave it wiped-but-undeployed.
# ── PLACEHOLDER GUARD (2026-06-30) — never destroy if the RESOLVED deploy env
# carries a placeholder/example VALUE. The TLD-presence pre-wipe guard (Step 1)
# only checks non-empty; the 2026-06-30 incident wiped prod and then failed
# every image pull because REGISTRY_PROXY resolved to cache.aisha.example.com
# (derive-domains fell back to the .json.example when operator TLDs were absent —
# non-empty, so the presence guard passed). This scans the fully-resolved
# .env.coolify (REGISTRY_PROXY + every *_DOMAIN/*_UPSTREAM) for placeholder
# values and REFUSES the destroy while the old apps still exist. Kept as a
# SEPARATE block so the WIPE_PENDING→wipe_orphan_apps adjacency that the
# cold-start-hardening regression gate asserts stays intact.
if [ "$WIPE_PENDING" = "1" ]; then
  if ! node "$REPO_ROOT/scripts/lib/placeholder-scan.mjs" "$ENV_COOLIFY"; then
    err "PRE-WIPE PLACEHOLDER GUARD: resolved .env.coolify carries placeholder/example value(s) (above)."
    err "  A wipe would leave prod DOWN — every image pull fails against an example registry."
    err "  Set real operator TLDs / registry / domains (.env-prod-backup) and re-run."
    err "  REFUSING TO WIPE — platform left intact."
    exit 1
  fi
  ok "Pre-wipe placeholder guard: resolved deploy env has no example/placeholder values ✓"
fi
# ── PRE-WIPE VAULT BACKUP GUARD (refuse-wipe-unless-backed-up) ──────────────────
# Runs AFTER validation + the placeholder guard, immediately BEFORE the destroy.
# Kept a SEPARATE block so the WIPE_PENDING→wipe_orphan_apps adjacency the
# cold-start-hardening regression gate asserts stays intact.
if [ "$WIPE_PENDING" = "1" ]; then
  info "Pre-wipe vault backup (reverse-sync + snapshot — the destroy removes the only server-side copy)..."
  if ! backup_vault_before_wipe; then
    err "PRE-WIPE VAULT BACKUP FAILED — REFUSING TO WIPE."
    err "  The credential vault is the only recoverable copy of the stack secrets;"
    err "  wiping now risks losing them (encryption keys, validator identity)."
    err "  Fix the backup and re-run, or pass AISHA_WIPE_SKIP_VAULT_BACKUP=1 if you"
    err "  already hold your own backup. Platform left intact."
    exit 1
  fi
  ok "Pre-wipe vault backup complete — safe to destroy ✓"
fi
if [ "$WIPE_PENDING" = "1" ]; then
  # Výsledek destroy se KONZUMUJE. Bez toho se volal naprázdno: nedokončené
  # mazání běh nezastavilo a pokračoval na vytváření aplikací nad zpola smazanou
  # platformou (naměřeno 2026-08-13). Návratový kód, který nikdo nečte, je totéž
  # jako žádný — a tady rozhoduje o tom, jestli se staví na čistém základu.
  wipe_orphan_apps || exit 1
else
  info "No deferred wipe pending (not a --wipe run, no existing apps, or --skip-orphan-cleanup)."
fi

# ─────────────────────────────────────────────────────────────────────────────
step "2d. REWARMUP — přestavba datastore jmenovaných aplikací"
# ─────────────────────────────────────────────────────────────────────────────
# Rewarmup NENÍ malý wipe. Je to TÁŽ cesta zúžená na jmenovaný cíl: aplikace se
# zahodí i s volumes a zbytek řetězu ji postaví znovu (3 založí → 4 dodá env →
# 5 nasadí). Proto tu není ani řádek zakládací logiky — zdvojit ji by znamenalo
# druhý domov pro tutéž otázku.
# Držení se mohlo načíst až v kroku 2 (pozdní overlay) — rozpor se měří i tady,
# těsně před mazáním.
cs_rewarmup_nesmi_drzenou
if [ -z "$REWARMUP_APPS" ]; then
  info "Žádný rewarmup nevyžádán (--rewarmup=<jméno[,jméno]> ho zapíná)."
else
  # Projektový rozsah, fail-CLOSED — týž strážce jako u wipe. Selhání výpisu se
  # NESMÍ přečíst jako „nic k přestavbě": na sdíleném hostiteli by globální filtr
  # podle jména mohl sáhnout na cizího nájemníka.
  _rw_scoped=""
  if ! _rw_scoped=$(coolify_scoped_apps "$APP_NAME_PREFIX_RE"); then
    err "rewarmup: nepodařilo se rozřešit projektový rozsah ani vypsat jeho aplikace — ODMÍTÁM mazat."
    exit 1
  fi

  _rw_uuids=(); _rw_names=()
  _stary_ifs="$IFS"
  IFS=','
  for _pozadovana in $REWARMUP_APPS; do
    IFS="$_stary_ifs"
    _pozadovana="$(printf '%s' "$_pozadovana" | tr -d '[:space:]')"
    [ -z "$_pozadovana" ] && continue
    _nalezeno=""
    while IFS=$'\t' read -r _n _u; do
      [ -z "$_u" ] && continue
      [ "$_n" = "$_pozadovana" ] && { _nalezeno="$_u"; break; }
    done <<< "$_rw_scoped"
    # Nenalezená aplikace je NÁLEZ, ne prázdno k přeskočení: buď má operátor
    # překlep, nebo míří do jiného projektu — obojí musí zastavit, protože
    # „nic jsem nenašel" vypadá k nerozeznání od „nic nebylo potřeba".
    if [ -z "$_nalezeno" ]; then
      # NENALEZENÍ MÁ DVĚ RŮZNÉ PŘÍČINY a splynout nesmějí:
      #
      #   a) jméno JE role v manifestu, jen aplikace v Coolify není → cíl už je
      #      přestavěný (nebo předchozí běh skončil mezi 2d a 3). To je ŽÁDANÝ
      #      koncový stav kroku 2d, ne chyba — krok 3 ji založí. Rewarmup tím
      #      zůstává IDEMPOTENTNÍ, což je u operace, která se pouští po havárii,
      #      podmínka spolehlivosti. Naměřeno 2026-08-18: první ostrý běh smazal
      #      netbird a spadl na vlastním ověření; opakování pak padalo TADY, na
      #      zábradlí, které stav po vlastní práci pokládalo za překlep.
      #
      #   b) jméno v manifestu NENÍ → překlep, nebo míří do cizího projektu.
      #      Tam se pokračovat nesmí.
      _role="${_pozadovana#${APP_NAME_PREFIX}-}"
      if vlastni "$_role"; then
        ok "rewarmup: '$_pozadovana' už v Coolify není — cíl je přestavěný, krok 3 ho založí."
        IFS=','
        continue
      fi
      err "rewarmup: '$_pozadovana' není v projektovém rozsahu ANI role v manifestu — ODMÍTÁM pokračovat."
      err "  Buď je to překlep, nebo jméno míří do jiného projektu."
      err "  Aplikace v rozsahu:"
      printf '%s\n' "$_rw_scoped" | awk -F'\t' 'NF{printf "    %s\n",$1}' >&2
      exit 1
    fi
    _rw_names+=("$_pozadovana"); _rw_uuids+=("$_nalezeno")
    IFS=','
  done
  IFS="$_stary_ifs"

  # Prázdný výběr po idempotentním přeskočení NENÍ vada — znamená „všechny cíle
  # už jsou přestavěné". Vada vstupu se chytila výš (jméno mimo manifest).
  if [ "${#_rw_uuids[@]}" -eq 0 ]; then
    ok "Rewarmup: není co zahazovat — všechny jmenované cíle už v Coolify nejsou. Krok 3 je založí."
  else

  warn "REWARMUP zahodí ${#_rw_uuids[@]} aplikaci(e) VČETNĚ JEJICH VOLUMES:"
  _i=0
  while [ "$_i" -lt "${#_rw_names[@]}" ]; do
    warn "    ${_rw_names[$_i]}  (${_rw_uuids[$_i]})"
    _i=$(( _i + 1 ))
  done
  warn "  Data v těch volumes jsou NEVRATNĚ pryč. Krok 3 aplikaci založí znovu, prázdnou."

  if [ "$DRY_RUN" = "1" ]; then
    ok "[DRY RUN] Přeskakuji skutečný DELETE — stav se nemění."
  else
    cs_over_izolaci_projektu "rewarmup DELETE"
    _rw_qs="?delete_volumes=true&delete_configurations=true&delete_connected_networks=true"
    _i=0
    while [ "$_i" -lt "${#_rw_uuids[@]}" ]; do
      coolify_api DELETE "/applications/${_rw_uuids[$_i]}${_rw_qs}" >/dev/null 2>&1 || true
      _i=$(( _i + 1 ))
    done

    # Smazání se OVĚŘUJE, nepředpokládá. Coolify frontuje: 200 na DELETE znamená
    # „přijato", ne „hotovo" — a stavět na zpola smazané aplikaci je přesně ta
    # vada, kterou 2026-08-13 zaplatil běh pokračující nad polovičním wipem.
    _rw_deadline=$(( $(date +%s) + ${AISHA_REWARMUP_CONFIRM_TIMEOUT_S:-300} ))
    _i=0
    while [ "$_i" -lt "${#_rw_uuids[@]}" ]; do
      _u="${_rw_uuids[$_i]}"; _n="${_rw_names[$_i]}"
      while :; do
        # ⛔ PTÁM SE NA STAV, NE NA NÁVRATOVÝ KÓD. `coolify_api` je holé `curl -sS`
        # bez `-f`, takže na 404 skončí ÚSPĚŠNĚ — požadavek se přece povedl.
        # Podmínka `if ! coolify_api GET …` proto nenastala nikdy a smyčka dojela
        # do stropu, přestože aplikace byla smazaná už dávno (naměřeno 2026-08-18
        # při prvním ostrém běhu: 300 s čekání na stav, který platil od začátku).
        # Táž třída jako #79 — návratový kód odpovídá na jinou otázku než tu, na
        # kterou se ptám.
        #
        # 000 = síť selhala. To NENÍ „smazáno" — čte se dál, protože přečíst
        # výpadek sítě jako potvrzení by pustilo krok 3 přes možná živou aplikaci.
        # ⛔ HODNOTA A DIAGNOSTIKA ODDĚLENĚ (2026-08-19).
        # Dřív tu stálo `… || echo 000)` — tedy fallback nalepený rovnou na
        # zachytávaný status. Záměr byl správný (000 = síť selhala, NE „smazáno"),
        # ale tvar je ta třída, kterou tenhle repo zakazuje: jedním kanálem tekla
        # naměřená hodnota i informace o poruše, takže se z výsledku nedalo
        # poznat, jestli `000` přišlo od curlu, nebo od fallbacku. Návratový kód
        # se proto čte ZVLÁŠŤ. Hlídá brána curl-http-code-capture-integrity.
        _kod="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 60 \
          -X GET -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
          "${COOLIFY_URL}/api/v1/applications/${_u}" 2>/dev/null)"
        [ -n "$_kod" ] || _kod="000"
        if [ "$_kod" = "404" ]; then
          ok "  ${_n}: smazání potvrzeno (HTTP 404) ✓"
          break
        fi
        if [ "$(date +%s)" -ge "$_rw_deadline" ]; then
          err "rewarmup: Coolify do ${AISHA_REWARMUP_CONFIRM_TIMEOUT_S:-300}s nepotvrdil smazání '${_n}'."
          err "  Nepokračuji — krok 3 by ji zakládal přes ještě existující aplikaci."
          exit 1
        fi
        sleep 5
      done
      _i=$(( _i + 1 ))
    done
    ok "Rewarmup hotov — ${#_rw_uuids[@]} aplikace(í) zahozeno i s daty; krok 3 je postaví načisto."
  fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "3. CREATE COOLIFY APPLICATIONS"
cs_over_izolaci_projektu "krok 3"
# ─────────────────────────────────────────────────────────────────────────────

if [ "$SKIP_CREATE" = "1" ]; then
  warn "Skipped create (--skip-create) — reconciling existing apps' config"

  # ⛔ ZDE BÝVAL „reset docker_compose_networks → coolify" pro každou aplikaci.
  # NAMĚŘENO 2026-09-16 (Coolify 4.3.16 na talosu): pole `docker_compose_networks`
  # v Coolify NEEXISTUJE — není v kódu aplikace, v migracích ani v povolených
  # polích API (ApplicationsController::$allowedFields), takže každý PATCH vrátil
  # 422 „This field is not allowed". Krok nikdy nic neresetoval: dokud curl běžel
  # bez `-f`, hlásil úspěch nad 422; s `--fail-with-body` (2026-09-13) se ukázal
  # u všech aplikací jako nedokončený. Třídu „network … declared as external"
  # dnes drží warmup (docker-compose.coolify-netinit.yml zakládá externí sítě
  # na každém hostu před vlnami), ne tenhle krok.
  if [ "$DRY_RUN" = "1" ]; then
    warn "[DRY RUN] Would run: scripts/coolify-story-init.sh --manifest $MANIFEST --story $APP_NAME_PREFIX (reconcile-only path)"
  else
    # ── Reconcile git_repository + docker_compose_raw via story-init ─────────
    # story-init is now idempotent: on each iteration it detects existing
    # apps and calls reconcile_app_config() which PATCHes git settings +
    # docker_compose_raw to the manifest's desired state. This heals partial
    # state from a prior aborted cold-start (e.g., Coolify POST returned
    # UUID but corrupted git_repository, follow-up PATCH was killed by
    # transient API stall, leaving the app stuck mid-config).
    info "Reconciling git config + compose raw for all manifest apps (idempotent)..."
    if ! bash "${REPO_ROOT}/scripts/coolify-story-init.sh" --manifest "$MANIFEST" --story "${APP_NAME_PREFIX}"; then
      # ⛔ S `--skip-create` se tu dřív jen varovalo a kontrola existence aplikací
      # běžela JEN ve větvi bez `--skip-create` — chybějící aplikace (nezaložená
      # story-initem) pak tiše zmizela z vln. Existence se teď ověří níž pro obě cesty.
      nedokonceno "Krok 3: coolify-story-init.sh skončil nenulou (reconcile/založení) — výpis výš"
    fi
  fi
elif [ "$DRY_RUN" = "1" ]; then
  warn "[DRY RUN] Would run: scripts/coolify-story-init.sh --manifest $MANIFEST --story $APP_NAME_PREFIX"
else
  info "Running coolify-story-init.sh from manifest..."
  if ! bash "${REPO_ROOT}/scripts/coolify-story-init.sh" --manifest "$MANIFEST" --story "${APP_NAME_PREFIX}"; then
    nedokonceno "Krok 3: coolify-story-init.sh FAILED — aspoň jedna aplikace se nezaložila (výpis výš)"
  fi
fi

# ── EXISTUJE, CO MANIFEST NASAZUJE? — obě cesty kroku 3, po JMÉNECH ─────────────
# ⛔ NAMĚŘENO 2026-09-13 (audit nad guru): kontrola porovnávala POČTY a běžela
# jen bez `--skip-create`; opt-in služby odečítala ručním výčtem (source-broker).
# Počet neřekne KTERÁ aplikace chybí a ruční výčet zestárne s první další
# podmíněnou službou. Teď: jména z manifestu − služby s vypnutou lane
# (lib/provision-gate.mjs, tatáž odpověď jako story-init a resolver) vs projekt.
# Chybějící aplikace je NEDOKONČENO; zastavuje se jen při téměř úplném selhání
# (nad polovinu) — nasadit, co existuje, je lepší než nechat produkci ležet.
if [ "$DRY_RUN" != "1" ]; then
  info "Ověřuji, že aplikace z manifestu v projektu existují (po jménech)..."
  if ! _neprovisionovane=" $(node "${REPO_ROOT}/scripts/lib/provision-gate.mjs" --neprovisionovane --env-file "$ENV_COOLIFY" | tr '\n' ' ') "; then
    nedokonceno "Krok 3: brány opt-in služeb nejdou vyhodnotit — existenci aplikací NEOVĚŘUJI"
  elif ! _v_projektu=$(coolify_scoped_apps "^${APP_NAME_PREFIX}-"); then
    err "Seznam aplikací projektu nejde přečíst — existenci aplikací z manifestu nelze ověřit."
    err "Refusing to continue blind right after story-init."
    exit 1
  else
    _ocekavano=0
    _chybi=()
    while IFS= read -r _id; do
      [ -n "$_id" ] || continue
      case "$_neprovisionovane" in *" ${_id} "*) info "  ${APP_NAME_PREFIX}-${_id}: lane vypnutá — nezakládá se"; continue ;; esac
      # Držená aplikace se nezakládá ani nesrovnává (story-init ji vynechal) — že
      # v projektu není, není nález.
      if drzena "$_id"; then info "  ${APP_NAME_PREFIX}-${_id}: DRŽENO — nezakládá se, existence se nevyžaduje"; continue; fi
      _ocekavano=$((_ocekavano + 1))
      if ! printf '%s\n' "$_v_projektu" | cut -f1 | grep -qx "${APP_NAME_PREFIX}-${_id}"; then
        _chybi+=("${APP_NAME_PREFIX}-${_id}")
      fi
    done < <(vlastni_aplikace | cut -f1)
    # Externí služby se nezakládají (story-init je vynechal) — že v projektu nejsou, není nález.
    while IFS= read -r _id; do
      [ -n "$_id" ] && info "  ${APP_NAME_PREFIX}-${_id}: $(vlastnictvi_hlaska "$_id") — nezakládá se, existence se nevyžaduje"
    done <<< "$EXTERNI_APLIKACE"
    if [ "${#_chybi[@]}" -eq 0 ]; then
      ok "Všech ${_ocekavano} aplikací z manifestu v projektu existuje."
    elif [ "${#_chybi[@]}" -gt "$((_ocekavano / 2))" ]; then
      err "Z ${_ocekavano} aplikací manifestu chybí ${#_chybi[@]} — story-init téměř úplně selhal. Končím před nasazením."
      err "  Chybí: ${_chybi[*]}"
      exit 1
    else
      nedokonceno "Krok 3: v projektu CHYBÍ ${#_chybi[@]} z ${_ocekavano} aplikací manifestu: ${_chybi[*]} — nasazuji existující"
    fi
    unset _ocekavano _chybi _id
  fi
  unset _neprovisionovane _v_projektu
fi

# ─────────────────────────────────────────────────────────────────────────────
step "4. SET ENV VARS + WEBHOOKS"
cs_over_izolaci_projektu "krok 4"
# ─────────────────────────────────────────────────────────────────────────────

if [ "$DRY_RUN" = "1" ]; then
  warn "[DRY RUN] Would run: scripts/coolify-deploy-init.sh"
else
  info "Running coolify-deploy-init.sh (loads $ENV_COOLIFY)..."
  # ⛔ ŽÁDNÝ `source`. Nahrazeno 2026-08-25 — viz nacti_env_do_prostredi().
  #
  # Tady stálo `set -a; source "$ENV_COOLIFY" 2>/dev/null || true`. Komentář
  # u toho správně popisoval, že `.env.coolify` nese neuvozovkované hodnoty
  # s mezerami (SMTP_SENDER_NAME, COSMOS_SIGNER_MNEMONIC) — ale řešil to tak,
  # že chyby UMLČEL. Symptom zmizel, ztráta zůstala:
  #
  #   ⛔ NAMĚŘENO: ze 724 klíčů se 9 po `source` ztratí (v souboru hodnotu mají,
  #      v prostředí jsou prázdné): COOLIFY_API_TOKEN, COOLIFY_API_KEY,
  #      COSMOS_SIGNER_MNEMONIC, BUNDLE_CONSUMER_ROLES, 5× MAILER_SUBJECTS_*.
  #      Hodnota se utne na první mezeře a ZBYTEK SE VYKONÁ jako příkaz —
  #      části seed fráze a tokenů tak končí v chybovém výstupu a historii.
  nacti_env_do_prostredi "$ENV_COOLIFY"
  _nacteno_klicu="$NACTENO_KLICU"
  # Načtení, které nic nenačte, NESMÍ projít mlčky: dřív to `2>/dev/null || true`
  # spolklo a běh pokračoval s prázdným prostředím — projevilo se to až o vrstvu
  # dál jako „neplatná pověření" nebo „nevím, kam nasazovat".
  if [ "${_nacteno_klicu:-0}" -lt 1 ]; then
    err "Z $ENV_COOLIFY se nenačetl ANI JEDEN klíč."
    err "  Nepokračuju s prázdným prostředím — projevilo by se to o vrstvu dál"
    err "  jako vadná pověření nebo prázdná UUID, tedy daleko od příčiny."
    err "  Ověř, že soubor existuje a má řádky tvaru KLIC=hodnota."
    exit 1
  fi
  ok "Načteno $_nacteno_klicu klíčů z $ENV_COOLIFY (bez sourcování)"

  # ── Resolve UUIDs from Coolify (use coolify_api helper for retry + ctrl-strip) ──
  info "Resolving ${APP_NAME_PREFIX}-* UUIDs from Coolify API (project-scoped)..."
  # PROJECT-SCOPED + fail-loud: resolve UUIDs only from apps in the declared
  # project, so a name collision with another tenant's identically-named app in a
  # different environment can never redirect our env push / deploy. Sibling of
  # #605/#606.
  if ! ALL_APPS_TSV=$(coolify_scoped_apps); then
    err "  Project scope unresolved (COOLIFY_PROJECT_UUID) — cannot resolve UUIDs."
    err "  Refusing to continue blind (env push + deploy would target empty UUIDs)."
    exit 1
  fi

  resolve_uuid() {
    local name="$1"
    printf '%s\n' "$ALL_APPS_TSV" | awk -F'\t' -v n="$name" '$1==n{print $2; exit}'
  }

  export UUID_CORE="$(resolve_uuid "${APP_NAME_PREFIX}-core")"
  export UUID_KEYCLOAK="$(resolve_uuid "${APP_NAME_PREFIX}-keycloak")"
  export UUID_INTEGRATION="$(resolve_uuid "${APP_NAME_PREFIX}-integration")"
  export UUID_EDGE="$(resolve_uuid "${APP_NAME_PREFIX}-edge")"
  export UUID_OBSERVABILITY="$(resolve_uuid "${APP_NAME_PREFIX}-observability")"
  export UUID_ADMIN="$(resolve_uuid "${APP_NAME_PREFIX}-admin")"
  export UUID_ORCHESTRATION="$(resolve_uuid "${APP_NAME_PREFIX}-orchestration")"
  export UUID_MESSAGING="$(resolve_uuid "${APP_NAME_PREFIX}-messaging")"
  export UUID_PKI="$(resolve_uuid "${APP_NAME_PREFIX}-pki")"
  export UUID_LEDGER="$(resolve_uuid "${APP_NAME_PREFIX}-ledger")"
  export UUID_EXEC="$(resolve_uuid "${APP_NAME_PREFIX}-exec")"
  export UUID_NETBIRD="$(resolve_uuid "${APP_NAME_PREFIX}-netbird")"
  export UUID_REGISTRY="$(resolve_uuid "${APP_NAME_PREFIX}-registry")"
  # Phase 2 autopilot capabilities (optional — empty UUID = stack not provisioned)
  export UUID_LLM_GATEWAY="$(resolve_uuid "${APP_NAME_PREFIX}-llm-gateway")"
  export UUID_OPENCLAW="$(resolve_uuid "${APP_NAME_PREFIX}-openclaw")"
  # Verified ingestion + flow-runtime loop (optional, provision_when_env-gated —
  # empty UUID = stack not provisioned, deploy-init skips)
  # Extranet — its own container/compose like every other stack; edge only
  # routes its public host. Absent from every registry until 2026-07-29, so
  # a cold start brought the whole stack up WITHOUT the customer surface.
  export UUID_EXTRANET="$(resolve_uuid "${APP_NAME_PREFIX}-extranet")"
  export UUID_LOCAL_INGEST="$(resolve_uuid "${APP_NAME_PREFIX}-local-ingest")"
  export UUID_POTOK="$(resolve_uuid "${APP_NAME_PREFIX}-potok")"

  for v in CORE KEYCLOAK INTEGRATION EDGE OBSERVABILITY ADMIN ORCHESTRATION MESSAGING PKI LEDGER EXEC NETBIRD REGISTRY LLM_GATEWAY OPENCLAW LOCAL_INGEST POTOK; do
    var="UUID_$v"
    val="${!var}"
    if [ -n "$val" ]; then
      ok "  ${var} = ${val}"
    else
      warn "  ${var} not resolved (deploy-init may skip this stack)"
    fi
  done

  # NETBIRD_SELFHEAL_SKIP=1: at this point in cold-start (step 4 — env vars),
  # KC has NOT been deployed yet. The self-heal inside deploy-init has its
  # own KC smoke check that would burn 180s timing out before falling back.
  # Phase D (after Phase B bootstraps KC) is when self-heal becomes useful.
  # Kód se zachytí BEZ přepínání `set -e` — skript ho nemá zapnutý a zapnout ho
  # tady by změnilo chování celého zbytku běhu (tichý konec na první nenule).
  _deploy_init_rc=0
  NON_INTERACTIVE=1 NETBIRD_SELFHEAL_SKIP=1 bash "${REPO_ROOT}/scripts/coolify-deploy-init.sh" --set-build-server </dev/null || _deploy_init_rc=$?
  if [ "$_deploy_init_rc" = "3" ]; then
    # Aplikace chybějící v Coolify už zapsal krok 3; ostatní stacky jsou nastavené.
    nedokonceno "Krok 4: deploy-init nenastavil env stackům bez aplikace v Coolify — výpis výš"
  elif [ "$_deploy_init_rc" != "0" ]; then
    err "deploy-init failed — env vars per stack neselhaly do Coolify. Bez správné env propagace deploy ve step 5 padne s nejasnými chybami."
    err "  Diagnostika: bash scripts/coolify-deploy-init.sh (interactive)"
    exit 1
  fi
  unset _deploy_init_rc

  info "Syncing full .env.coolify to all aisha-* apps (prevents missing per-stack env vars)..."
  # External-only secrets (NETBIRD_API_TOKEN, RESEND_API_KEY, TELEGRAM_*, COSMOS_SIGNER_MNEMONIC...)
  # cannot be auto-generated; they're either in .env-prod-backup or set manually after first deploy.
  # Skip strict preflight here — the heal pass in step 2 already wrote everything we can derive.
  # MANIFEST_FILE explicitně — story (manifest) ≠ prefix (jména aplikací); viz step 2.
  if ! MANIFEST_FILE="$MANIFEST" SKIP_ENV_PREFLIGHT=1 bash "${REPO_ROOT}/scripts/coolify-sync-envs.sh" </dev/null; then
    err "coolify-sync-envs failed — některé stacky nedostaly potřebné env vars. Pokračovat by znamenalo deploy s missing secrets."
    err "  Diagnostika: bash scripts/coolify-sync-envs.sh (interactive, ne SKIP_ENV_PREFLIGHT)"
    exit 1
  fi

  # ── Domain-doctor: pre-deploy recovery for silent-dropped PATCHes ─────
  # Coolify v4 occasionally returns 200 on docker_compose_domains PATCH
  # but silently drops the value (memory: feedback_coolify_api_quirks.md).
  # set_coolify_domains in deploy-init now retries 3x, but if Coolify is
  # under sustained load all 3 retries can fail. Run domain-doctor --apply
  # here as a recovery pass BEFORE wave deploy: any drifted app gets a
  # fresh PATCH so wave deploy registers correct Traefik routes.
  # No --restart: apps haven't been deployed yet (step 5 is next), so
  # there's nothing to restart — the domain config gets baked in on
  # first deploy.
  info "Running domain-doctor --apply to catch silent-drop PATCHes before wave deploy..."
  if (cd "$REPO_ROOT" && node scripts/coolify-domain-doctor.mjs --apply </dev/null); then
    ok "Domain doctor — pre-deploy domains in sync"
  else
    nedokonceno "Krok 4: domain-doctor --apply nechal zbytkový drift domén — vlny narazí na routovací 404 (node scripts/coolify-domain-doctor.mjs)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "4b. VERIFY 'coolify' DOCKER NETWORK (Coolify-managed)"
# ─────────────────────────────────────────────────────────────────────────────
# Coolify vytvoří `coolify` Docker network sám při instalaci. Pokud z nějakého
# důvodu chybí, deploy padne. Tady jen defensivně ověříme — žádný host-level
# zásah, jen warning pokud lokální docker je k dispozici a síť chybí.
#
# DESIGN: for cross-stack DNS *aliases* (netbird-signal, netbird-management) the
# Coolify-managed `coolify` network is enough — Docker's embedded resolver maps
# an alias to its container BY NAME, so a churning IP is irrelevant. We do NOT
# create shared networks for that case; we add `coolify` membership in both stacks.
#
# EXCEPTION — the single-purpose mesh resolver: consumers point their `dns:` at
# it, and a resolv.conf nameserver must be an IP, not a name. On the shared
# `coolify` network that IP churns every restart (Coolify's dynamic IPAM), which
# is exactly what broke NETBIRD_DNS_IP durability. So the resolver — and ONLY the
# resolver — lives on an instance-owned network (${MESH_DNS_NETWORK}) whose
# address space we control, giving it a deterministic pinned IP that survives
# restart. This is the one justified shared network. See memory tenant-jednoucelove-dns-navrh.
if [ "$DRY_RUN" = "1" ] || [ "$SKIP_DEPLOY" = "1" ]; then
  warn "Skipping coolify network verify (DRY_RUN/SKIP_DEPLOY)"
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker network inspect coolify >/dev/null 2>&1; then
    ok "Docker network 'coolify' exists (Coolify-managed)"
  else
    warn "Docker network 'coolify' missing — should be created by Coolify itself."
    warn "If deploy fails, run on Coolify host: docker network create coolify --driver bridge"
  fi
  # ODSTRANĚNO 2026-08-10: mesh-DNS síť se tu PŘEDVYTVÁŘET NESMÍ.
  #
  # Ten blok tu byl proto, aby síť existovala dřív, než ji vlny označí za
  # `external`. Nikdy to nefungovalo a bylo to i škodlivé:
  #
  #  1. NEFUNGOVALO — `docker` tady mluví s LOKÁLNÍM démonem, tedy s operátorskou
  #     stanicí, ne s cílovým hostem. Naměřeno: `aisha-mesh-dns` existovala na
  #     giah/talos jen jako sirotek po smazaném projektu a na varra CHYBĚLA, takže
  #     local-ingest spadl na "network aisha-mesh-dns declared as external,
  #     but could not be found".
  #  2. ŠKODILO BY — síť z `docker network create` nemá labely
  #     `com.docker.compose.*`, takže jakmile ji compose deklaruje jako svou
  #     (ne-external), každý stack umře na `incorrect label ... set to ""`.
  #     Změřeno na živém hostu 2026-08-10.
  #
  # Sítě si teď zakládá COMPOSE (viz `networks.mesh-dns` v docker-compose.coolify-*.yml):
  # první stack ji na daném hostu vytvoří se správným subnetem, další se jen
  # připojí (compose u cizího projektu pouze varuje — naměřeno). Funguje to na
  # každém hostu bez ohledu na to, odkud cold-start běží, a po `--wipe` se síť
  # obnoví sama. Táž úvaha platí pro `${APP_NAME_PREFIX}-shared-net`.
else
  ok "Skipping local docker check (no daemon access — Coolify host manages 'coolify' network)"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "4c. PROXY SERVERŮ — typ proxy podle deklarace slotu (před vlnami)"
# Proxy serveru (Traefik/Caddy, kterou Coolify spouští na každém serveru) je
# vlastnost STROJE. Slot, který ji deklaruje (`proxy` v coolify/servers.json — GPU
# uzel `gpu`: none), ji má mít dřív, než na něj vlny cokoli nasadí. Měří a srovná
# jeden nástroj (scripts/coolify-server-proxy.mjs): bez lane slotu se nic neměří.
#   • zápis (--apply, PATCH + zpětné čtení) jen produkční běh — server je společný
#     všem projektům na něm, ne-produkční běh ho jen změří (cs_beh_odpovida_za_sdileny_server),
#   • rozdíl nebo NEMĚŘENO = v produkčním běhu NEDOKONČENO (běh skončí červeně),
#     ale vlny poběží: firewall hostitele (vlna 1) zahodí veřejné 80/443 i s proxy,
#     tvrdý stop by ho nenasadil vůbec. V běhu, který za sdílený server neodpovídá
#     (ne-produkční, dry-run), je to hlasité VAROVÁNÍ — server měnit nesmí a za jeho
#     stav nemůže, červeně kvůli němu nekončí,
#   • kód 0 mluví o TYPU V API: zápis `none` běžící kontejner proxy nezastaví. Že
#     na uzlu žádná proxy porty nepublikuje, měří až závěrečné ověření na konci
#     běhu (overeni_proxy_na_uzlu níž).

# Verdikt kroku 4c z KÓDU nástroje. Jen kód 0 je splněno.
#   • Rozdíl (2) a NEMĚŘENO (3) jsou STAV SDÍLENÉHO SERVERU. V běhu, který za něj
#     odpovídá (cs_beh_odpovida_za_sdileny_server — táž jediná odpověď, podle které
#     se výš přidává --apply), jdou do NEDOKONCENO a běh končí nenulou („brána
#     hotovosti"). Běh, který za něj neodpovídá, ho měnit nesmí a za jeho stav
#     nemůže: hlasité VAROVÁNÍ, červeně kvůli tomu nekončí — a `ok` to není nikdy.
#   • Jiný kód je chyba deklarace, čtení nebo zápisu TOHOHLE běhu, ne stav
#     serveru: NEDOKONCENO v každém běhu.
#   proxy_serveru_krok_verdikt <návratový kód coolify-server-proxy.mjs>
proxy_serveru_krok_verdikt() {
  case "$1" in
    0) ok "Typ proxy serverů v API Coolify odpovídá deklaraci slotů (nebo žádný slot v provozu proxy nedeklaruje)" ;;
    2)
      if cs_beh_odpovida_za_sdileny_server; then
        nedokonceno "Krok 4c: proxy serveru se liší od deklarace slotu a tenhle běh ji nenastavil (výpis výš)"
      else
        warn "Krok 4c: proxy serveru se liší od deklarace slotu (výpis výš) — sdílený server tenhle běh nemění; srovná ho produkční běh"
      fi ;;
    3)
      if cs_beh_odpovida_za_sdileny_server; then
        nedokonceno "Krok 4c: proxy serveru NEZMĚŘENA (výpis výš) — chybí UUID serveru slotu, nebo typ proxy v API změřit ani zapsat nejde (důvod ve výpisu, viz POLE_PROXY v scripts/coolify-server-proxy.mjs)"
      else
        warn "Krok 4c: proxy serveru NEZMĚŘENA (výpis výš) — sdílený server tenhle běh nemění; srovná ho produkční běh"
      fi ;;
    *) nedokonceno "Krok 4c: proxy serveru — chyba deklarace, čtení nebo zápisu (kód $1, výpis výš)" ;;
  esac
}

# Verdikt kontroly kontejnerů NA UZLU (za vlnami) z KÓDU nástroje. Jen kód 0 je
# splněno: nález (1) i NEZMĚŘENO (2, 3) jdou do NEDOKONCENO — shoda typu v API
# bez tohohle měření nedokazuje, že proxy neběží. Nález je KAŽDÝ port publikovaný
# mimo loopback a mimo deklaraci uzlu — kontejner proxy serveru i kterýkoli jiný
# (R1 re-recenze d8: dřív se poznávala jen proxy podle jména).
#   kontejnery_uzlu_krok_verdikt <návratový kód lib/kontejnery-uzlu.mjs>
kontejnery_uzlu_krok_verdikt() {
  case "$1" in
    0) ok "Proxy na uzlech s firewallem hostitele: žádný kontejner (proxy serveru ani jiný) nepublikuje port mimo loopback a deklaraci uzlu (měřeno na uzlu), nebo se firewall hostitele nenasazuje" ;;
    1) nedokonceno "Proxy na uzlu: kontejner PUBLIKUJE port mimo loopback a deklaraci uzlu (výpis výš — proxy serveru, nebo jiný) — typ 'none' v API Coolify proxy nezastaví a firewall nález jen zakryje; zastavení kontejneru je rozhodnutí majitele, tenhle běh jen měří" ;;
    2|3) nedokonceno "Proxy na uzlu NEZMĚŘENA (výpis výš, kód $1) — bez výpisu kontejnerů uzlu s kotvou firewallu není 'proxy none' doložená (node scripts/lib/kontejnery-uzlu.mjs)" ;;
    *) nedokonceno "Proxy na uzlu: kontrola kontejnerů selhala (kód $1, výpis výš) — NEZMĚŘENO" ;;
  esac
}

# Závěrečné ověření: kontejner proxy NA UZLECH s firewallem hostitele (ne z API).
# Krok 4c srovnal TYP proxy v API Coolify; zápis `none` ale běžící kontejner proxy
# nezastaví a firewall v enforce ho zakryje i vnější sondě. Jediný důkaz je výpis
# kontejnerů uzlu (`docker -H ssh://<hostname slotu>`, jen čtení).
#   • Měří KAŽDÝ produkční běh naostro — i se --skip-deploy: je to čtecí měření,
#     na nasazení nezávisí, a bez něj by nález z předletu (kde je jen varováním)
#     zmizel. Ne-produkční běh ani dry-run neměří (sdílený server není jejich)
#     a řekne to.
#   • Volá se až na KONCI běhu: kotvou výpisu je kontejner firewallu hostitele
#     a ten nasazuje vlna — před vlnami by kotva chyběla.
#   • Kontejner proxy se NEZASTAVUJE (rozhodnutí majitele); nález i NEZMĚŘENO
#     jsou NEDOKONČENO.
overeni_proxy_na_uzlu() {
  if ! cs_beh_odpovida_za_sdileny_server; then
    info "Proxy na uzlech s firewallem hostitele se v tomhle běhu NEMĚŘÍ (DRY_RUN=${DRY_RUN}, AISHA_ENV='${AISHA_ENV:-}' — prázdné = přímý běh = produkce) — sdílený server ověřuje produkční běh naostro"
    return 0
  fi
  info "Závěrečné ověření: kontejner proxy na uzlech s firewallem hostitele (scripts/lib/kontejnery-uzlu.mjs, jen čtení)..."
  local _ku_args=() _ku_rc=0
  if [ -n "${ENV_COOLIFY:-}" ] && [ -f "$ENV_COOLIFY" ]; then _ku_args+=(--env-soubor "$ENV_COOLIFY"); fi
  (cd "$REPO_ROOT" && node scripts/lib/kontejnery-uzlu.mjs ${_ku_args[@]+"${_ku_args[@]}"} </dev/null) || _ku_rc=$?
  kontejnery_uzlu_krok_verdikt "$_ku_rc"
}

_px_args=()
if [ -n "${ENV_COOLIFY:-}" ] && [ -f "$ENV_COOLIFY" ]; then _px_args+=(--env-soubor "$ENV_COOLIFY"); fi
if cs_beh_odpovida_za_sdileny_server; then
  _px_args+=(--apply)
else
  info "Proxy serverů: jen měření (DRY_RUN=${DRY_RUN}, AISHA_ENV='${AISHA_ENV:-}' — prázdné = přímý běh = produkce)"
fi
_px_rc=0
node "$REPO_ROOT/scripts/coolify-server-proxy.mjs" ${_px_args[@]+"${_px_args[@]}"} || _px_rc=$?
proxy_serveru_krok_verdikt "$_px_rc"
unset _px_args _px_rc

# ─────────────────────────────────────────────────────────────────────────────
step "5. TRIGGER FIRST DEPLOY (POST /restart per app)"
# Od kdy se počítají záznamy TOHOTO běhu (verdikt bootstrapu n8n v kroku 6).
COLD_START_KROK5_T0="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cs_over_izolaci_projektu "krok 5"
# ─────────────────────────────────────────────────────────────────────────────

if [ "$SKIP_DEPLOY" = "1" ]; then
  warn "Skipped (--skip-deploy) — trigger manually via Coolify UI or API"
elif [ "$DRY_RUN" = "1" ]; then
  warn "[DRY RUN] Would POST /restart for each ${APP_NAME_PREFIX}-* app"
else
  # PROJECT-SCOPED + fail-loud: enumerate only apps in the declared project. A
  # global list filtered by a hardcoded "^aisha-" would PATCH another tenant's
  # aisha-* stack on the shared host (incident 2026-07-05). Sibling of #605/#606.
  if ! SCOPED_APPS=$(coolify_scoped_apps "^${APP_NAME_PREFIX}-"); then
    err "Project scope unresolved (COOLIFY_PROJECT_UUID) — cannot pre-seed docker_compose_raw."
    err "  Refusing to continue blind (a global name filter could PATCH a foreign tenant's apps)."
    exit 1
  fi
  if [ -z "$SCOPED_APPS" ]; then
    # Prázdný projekt tady znamená, že vlny níž NENASADÍ NIC (celý blok je v else).
    err "V projektu nejsou žádné ${APP_NAME_PREFIX}-* aplikace — není co nasadit (krok 3 je nezaložil?)."
    exit 1
  else
    # ── Seed docker_compose_raw for any app where it's NULL ────────────────
    # Coolify stores compose YAML in DB column docker_compose_raw, populated
    # on first git checkout. If it's NULL at deploy time, ApplicationDeployment
    # Job throws Yaml::parse(null). Seed from local files to make first deploy
    # succeed without bootstrap dance.
    info "Pre-seeding docker_compose_raw for apps with NULL value..."
    while IFS=$'\t' read -r name uuid; do
      # Držená aplikace: žádný zápis konfigurace (ani seed compose).
      if drzena "$(cs_role_aplikace "$name")"; then
        info "  ${name}: DRŽENO — docker_compose_raw se nedoplňuje"
        continue
      fi
      compose_path=$(coolify_api GET "/applications/${uuid}" 2>/dev/null \
        | jq -r '.docker_compose_location // "" | ltrimstr("/")')
      raw_state=$(coolify_api GET "/applications/${uuid}" 2>/dev/null \
        | jq -r '.docker_compose_raw // "" | length')
      local_compose="${REPO_ROOT}/${compose_path}"
      if [ "$raw_state" = "0" ] && [ -n "$compose_path" ] && [ -f "$local_compose" ]; then
        coolify_api PATCH "/applications/${uuid}" \
          -d "$(jq -n --rawfile raw "$local_compose" '{ docker_compose_raw: $raw }')" \
          >/dev/null && ok "  Seeded $name (${compose_path})" \
          || nedokonceno "Krok 5: docker_compose_raw pro ${name} se nezapsal — první nasazení spadne na Yaml::parse(null)"
      fi
    done <<< "$SCOPED_APPS"

    # ── Wave-based orchestrated deploy with health waits ─────────────────
    # aisha-redeploy.mjs implements the 7-wave DAG (registry cache → PKI →
    # keycloak → core → mesh → observability → peers → apps) with per-wave health polling.
    # This is the AUTONOMOUS step — no parallel /restart blast, no manual
    # ordering. Each wave waits for prior wave's apps to become healthy before
    # triggering the next.
    #
    # NOTE: --skip-healthy MUST NOT be used with --skip-create.
    # When apps already exist (--skip-create), they are running:healthy →
    # --skip-healthy would filter ALL of them out and no redeploy would happen.
    # Use --skip-healthy ONLY on fresh install where nothing is running yet.
    REDEPLOY_FLAGS="--wave-timeout=${WAVE_TIMEOUT:-${AISHA_WAVE_TIMEOUT_S:-420}}"
    # Domény v Coolify srovnal krok 4 (deploy-init + doktor domén) a krok 4 běží
    # před vlnami VŽDY (výjimkou je jen --dry-run, kde vlny neběží). Redeploy by
    # je jinak srovnával znovu v každé fázi — deklarujeme, že vlastník je tady.
    REDEPLOY_FLAGS="$REDEPLOY_FLAGS --bez-domen"
    if [ "$SKIP_CREATE" = "0" ]; then
      # Fresh install: apps just created, none running → safe to skip already-healthy
      REDEPLOY_FLAGS="$REDEPLOY_FLAGS --skip-healthy"
    fi

    # ── Conceptually correct wave order with mid-flight bootstraps ─────────
    # Waves 1-3 (registry + core+pki+edge + keycloak) → KC container healthy
    #   ↓ Bootstrap KC: import realm + provision SSO + aisha-bootstrap user
    # Wave 4 (netbird + observability + orchestration + admin)
    #   ↓ Bootstrap NetBird: groups + setup keys (mgmt API now serving)
    # Waves 5-6 (edge mesh re-enroll + integration/ledger/exec)
    #
    # Without splitting the deploy here, wave 4 apps (NetBird, OAuth2 proxy
    # for admin) attempt OIDC discovery against KC's `aisha` realm before
    # configure-realms.sh has imported it → 404 → restart loop.

    # ── Hranice fází: JEDEN DOMOV ──────────────────────────────────────────
    # Čísla vln se sem NEOPISUJÍ. Vydává je `aisha-redeploy.mjs --print-phases`
    # ze STEJNÉHO pole, které vlny definuje — takže rozdělení nebo přidání vlny
    # je změna na jednom místě.
    #
    # ⛔ PROČ: do 2026-08-13 tu stálo `--until=3`, `--from=4 --until=4`,
    # `--from=5` na OSMI místech. Rozdělení vlny 2 (kořen důvěry × jeho
    # konzumenti) by znamenalo přepsat osm nezávislých literálů — a jedno minout
    # znamená TIŠE PŘESKOČENOU VLNU: log jde dál, stack se nenasadí, nikde ani
    # slovo. Přesně tak zůstala 2026-08-11 varra bez sítí, když se vlna 0
    # přidala do pole, ale výchozí `--from=1` ji přeskakoval.
    if ! eval "$(cd "$REPO_ROOT" && node scripts/aisha-redeploy.mjs --print-phases </dev/null)"; then
      err "Nepodařilo se načíst hranice fází z aisha-redeploy.mjs --print-phases"
      err "  Bez nich by cold-start hádal rozsah vln — a tiše nasadil něco jiného."
      exit 1
    fi
    # Patička je DŮKAZ ÚPLNOSTI: bez ní by uříznutý výstup (roura + exit) vypadal
    # jako platná, jen kratší sada — a chybějící klíč by se projevil až prázdným
    # `--until=`, tedy nasazením VŠEHO místo fáze A.
    if [ -z "${__PHASES_END__:-}" ] || [ -z "${AISHA_WAVE_PHASE_A_UNTIL:-}" ] \
       || [ -z "${AISHA_WAVE_PHASE_C_FROM:-}" ] || [ -z "${AISHA_WAVE_PHASE_D_FROM:-}" ]; then
      err "Hranice fází dorazily neúplné (patička='${__PHASES_END__:-}')"
      exit 1
    fi

    # ── Phase A: až po Keycloak včetně ─────────────────────────────────────
    # Fresh KC DB init + admin user creation + realm bootstrap can take 5-8min;
    # use longer timeout for Phase A to wait for "the machine to come up"
    # (per user directive: cold-start must self-manage waiting on prereqs).
    PHASE_A_FLAGS="$(echo "$REDEPLOY_FLAGS" | sed 's/--wave-timeout=[0-9]*//') --wave-timeout=${PHASE_A_WAVE_TIMEOUT:-${AISHA_PHASE_A_WAVE_TIMEOUT_S:-720}}"
    info "Running wave-orchestrated deploy (Phase A: vlny 0-${AISHA_WAVE_PHASE_A_UNTIL} — bring KC up)..."
    # shellcheck disable=SC2086
    # ⛔ NAMĚŘENO PŘI WIPU 2026-08-24. Tady se testoval jen „nula × nenula", takže
    # jediná nezdravá MĚKKÁ appka (`<fork>-clamav`, tier=optional, isolovaný)
    # zastavila celý bootstrap: mesh ani edge se nenasadily a všechny veřejné
    # povrchy zůstaly na 503. Měkké selhání se chovalo jako tvrdé.
    #
    # Kód 3 = „nezdravé jsou POUZE měkké aplikace" (viz aisha-redeploy.mjs).
    # Pokračujeme, ale HLASITĚ — operátor to musí vidět v souhrnu i na konci.
    # ⛔ Kód se zachytí BEZ `set +e … set -e`. Ta dvojice tu stála a `set -e`
    # zapnula pro CELÝ zbytek běhu (skript sám ho nemá — ř. „set -uo pipefail").
    # Popsaný následek (fáze B skončila beze slova, 2026-08-25) je o kus níž;
    # tady se jen odstraňuje jeho zdroj, aby žádná pozdější nenula neukončila
    # běh tiše a nepřeskočila kroky, které po ní přijdou.
    _phase_a_rc=0
    (cd "$REPO_ROOT" && node scripts/aisha-redeploy.mjs \
        --until=${AISHA_WAVE_PHASE_A_UNTIL} $PHASE_A_FLAGS </dev/null) || _phase_a_rc=$?
    if [ "$_phase_a_rc" = "0" ]; then
      ok "Fáze A hotová do vlny ${AISHA_WAVE_PHASE_A_UNTIL} (Keycloak container ready for realm import)"
    elif [ "$_phase_a_rc" = "3" ]; then
      warn "Fáze A: nedokončené jsou POUZE měkké aplikace — pokračuji do fáze B."
      nedokonceno "Fáze A (vlny 0-${AISHA_WAVE_PHASE_A_UNTIL}): měkké aplikace nedokončené — výpis redeploye výš"
    else
      err "aisha-redeploy.mjs returned non-zero on Phase A (vlny 0-${AISHA_WAVE_PHASE_A_UNTIL}) — bootstrap aborted"
      err "  Retry:     node scripts/aisha-redeploy.mjs --until=${AISHA_WAVE_PHASE_A_UNTIL} $REDEPLOY_FLAGS"
      exit 1
    fi

    # ── Phase B: KC bootstrap (realm + provision-sso + aisha-bootstrap user) ─
    # Inline mini-step; full version in step 6 will only do n8n workflows now.
    info "Phase B: KC realm + provision-sso + aisha-bootstrap user..."

    # ── Který realm Keycloak umí HNED po startu ─────────────────────────────
    # `--import-realm` nasype při prvním startu právě jeden realm: ten, který
    # peče obraz (Dockerfile.keycloak → keycloak/aisha-realm.json). Jméno se
    # ČTE Z TÉ ŠABLONY, neopisuje se — kdyby se v ní jednou změnilo, opis by
    # tiše přestal platit a projevilo by se to jako „Keycloak nenaběhl".
    #
    # Šablona ho od 2026-08-25 nese jako `${KEYCLOAK_REALM}`, aby si instance
    # mohla realm pojmenovat po sobě. Placeholder se tu proto rozvine stejnou
    # hodnotou, jakou dosadí entrypoint uvnitř kontejneru — jinak by sonda
    # hledala realm jménem „${KEYCLOAK_REALM}".
    #
    # ⛔ ŽÁDNÝ FALLBACK. Dosazené jméno by znamenalo, že sonda hlásí zdraví
    # realmu, který instance nepoužívá — tedy zelená branka nad cizí identitou.
    _kc_bootstrap_realm() {
      local _tpl="${REPO_ROOT}/keycloak/aisha-realm.json" _r=""
      if [ ! -f "$_tpl" ]; then
        err "Šablona realmu ${_tpl} chybí — jméno realmu není z čeho odvodit."
        exit 1
      fi
      if ! command -v jq >/dev/null 2>&1; then
        err "jq není k dispozici — jméno realmu se čte ze šablony, neopisuje se."
        exit 1
      fi
      _r="$(jq -r '.realm // empty' "$_tpl" 2>/dev/null)"
      case "$_r" in
        '${KEYCLOAK_REALM}')
          if [ -z "${KEYCLOAK_REALM:-}" ]; then
            err "Šablona realmu čeká KEYCLOAK_REALM, ale ta není deklarovaná."
            err "Jméno realmu je identita instance — doplň ji do .env-prod-backup."
            exit 1
          fi
          _r="${KEYCLOAK_REALM}"
          ;;
      esac
      if [ -z "$_r" ]; then
        err "Šablona ${_tpl} nemá klíč .realm — jméno realmu není z čeho přečíst."
        exit 1
      fi
      printf '%s' "$_r"
    }

    # ── Kde leží deklarace POJMENOVANÉHO realmu ─────────────────────────────
    # Pojmenovaný realm je vlastnost INSTANCE, ne forku — proto se hledá
    # v instančním overlayi, vedle klientů (`keycloak/NN_*-client.json`), které
    # tam už bydlí. Když overlay není nebo soubor nemá, proměnná zůstane prázdná
    # a configure-realms.sh si hledá po svém (vedle sebe ve forku).
    #
    # ⚠️ `if`, ne `[ … ] && …`. Fáze B běží pod `set -e` (zapne ho krok fáze A
    # a nevypne — viz komentář tam), takže `test && přiřazení` je při NEEXISTUJÍCÍM
    # souboru příkaz s návratovým kódem 1 a ukončí celý běh BEZ JEDINÉHO SLOVA.
    # Nepřítomnost volitelného souboru je normální stav, ne chyba.
    _KC_TENANT_REALM_FILE=""
    if [ -n "${AISHA_INSTANCE_CONFIG_DIR:-}" ] && [ -n "${KEYCLOAK_REALM:-}" ]; then
      _kc_cand="${AISHA_INSTANCE_CONFIG_DIR}/keycloak/${KEYCLOAK_REALM}.json"
      if [ -f "$_kc_cand" ]; then
        _KC_TENANT_REALM_FILE="$_kc_cand"
      fi
      unset _kc_cand
    fi

    # Operator-run KC bootstrap reaches Keycloak from OFF-MESH — and the mesh isn't
    # even up yet in Phase B (netbird is wave 4). Use the PUBLIC edge face
    # (auth.<public> via pfSense HAProxy → edge), NOT the mesh canonical KEYCLOAK_DOMAIN.
    # The in-cluster KEYCLOAK_URL (mesh) was already written to .env.coolify above for
    # the containers; this override only affects the operator-run bootstrap steps below
    # (smoke-keycloak, configure-realms, provision-sso, provision-operators).
    # Reach KC at its DIRECT backend host (auth.backend.<tld>) — the host KC's own
    # Coolify Traefik actually serves (registered by coolify-domain-doctor). The
    # public auth.<tld> face is served by the EDGE which proxies here; using the
    # direct host makes operator bootstrap independent of the edge/pfSense chain
    # being fully wired. NOT the mesh host (unreachable off-mesh + mesh not up yet).
    # ── VNITRNI SEV PRES SSH (2026-08-24) ────────────────────────────────
    # Komentar vys popisuje DIRECT router, ktery NEEXISTUJE (compose ani
    # derivace ho nemaji) — a verejna tvar auth stoji na edge, ktery podle
    # mapy prijde az PO meshi. Pravidlo majitele: nikdo dovnitr jinak nez
    # pres mesh; operatorsky bootstrap tedy jde DOVNITR (SSH na hostitele),
    # ne pres predcasne otevrene dvere.
    #
    # Kanal se DEKLARUJE (AISHA_KC_SSH_HOST v .env-prod-backup), nehada.
    # Kdyz deklarovany neni, plati puvodni retez (DIRECT → PUBLIC → vnitrni)
    # — instance s dosazitelnym KC zvenci (edge uz stoji pri --skip-create
    # rerunu) funguji beze zmeny.
    #
    # ⛔ `|| true` NENÍ kosmetika (naměřeno 2026-08-25). Nedeklarovaný kanál je
    # NORMÁLNÍ stav — a přesně ten až dosud UKONČIL celý běh. Řetěz: grep bez
    # shody vrátí 1 → `pipefail` to pustí přes `cut` → přiřazení selže →
    # `set -e`, který si zapnul krok fáze A a nevypnul, ukončí skript. Bez
    # jediného řádku, protože `set -e` nic nepíše. Následek: fáze B se nikdy
    # nevykonala, takže realm, provision-sso ani povrchy nevznikly — a v logu
    # stálo jen „Phase B: …" a konec. Větev „platí původní řetěz", kterou slibuje
    # komentář výš, byla tím pádem NEDOSAŽITELNÁ pro každou instanci, která si
    # SSH kanál nedeklaruje.
    _KC_SSH_HOST="$(grep -m1 '^AISHA_KC_SSH_HOST=' "$ENV_PROD_BACKUP" 2>/dev/null | cut -d= -f2- || true)"
    if [ -n "$_KC_SSH_HOST" ]; then
      _KC_IP="$(ssh -o ConnectTimeout=10 -o BatchMode=yes "$_KC_SSH_HOST" \
        'C=$(docker ps --format "{{.Names}}" | grep "^keycloak-" | head -1); [ -n "$C" ] && docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}" "$C" | awk "{print \$1}"' 2>/dev/null)"
      if [ -n "$_KC_IP" ]; then
        # Lokální loopback port tunelu — konstanta, ne vlastnost světa.
        _KC_TUNNEL_PORT=18080
        # -f -N: tunel na pozadi; uklidime ho na konci fáze B
        # ⛔ KEEPALIVE JE NUTNY (namereno 2026-08-24): tunel bez nej spojeni
        # utne behem delsi operace a nasledek se projevi az o krok dal —
        # provision-sso.sh hlasil "Cannot authenticate to Keycloak admin API",
        # tedy VADU POVERENI, prestoze povereni byla v poradku (token HTTP 200
        # po znovuotevreni tunelu). Mrtvy kanal se prevlekl za spatne heslo.
        ssh -o ConnectTimeout=10 -o BatchMode=yes -o ExitOnForwardFailure=yes \
          -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o TCPKeepAlive=yes \
          -f -N -L "127.0.0.1:${_KC_TUNNEL_PORT}:${_KC_IP}:80" "$_KC_SSH_HOST" \
          && _KC_TUNNEL_UP=1 || _KC_TUNNEL_UP=0
        if [ "$_KC_TUNNEL_UP" = "1" ]; then
          export KEYCLOAK_URL="http://127.0.0.1:${_KC_TUNNEL_PORT}"
          # ⛔ OBĚ override proměnné, ne jen jedna (naměřeno 2026-08-25).
          # Operátorské skripty si adresu Keycloaku zjišťují KAŽDÝ PO SVÉM:
          #   smoke-keycloak.sh, provision-sso.sh,
          #   aisha-bootstrap-user-init.sh  → čtou KEYCLOAK_URL
          #   netbird-bootstrap.sh          → čte KEYCLOAK_PUBLIC_URL
          # Když se naplnila jen první, fáze D sáhla na VNITŘNÍ jméno
          # (<fork>-keycloak:80), operátor ho nepřeložil a ražba setup klíčů
          # se zastavila na `OIDC discovery: 000` — tedy o dvě fáze dál, než
          # kde byla příčina.
          export KEYCLOAK_PUBLIC_URL="http://127.0.0.1:${_KC_TUNNEL_PORT}"
          ok "Fáze B jde DOVNITŘ: SSH tunel 127.0.0.1:${_KC_TUNNEL_PORT} → KC ${_KC_IP}:80 (žádná veřejná plocha)"
          # Kanál se tu ZÁMĚRNĚ nesonduje vlastním curl: sonda na Keycloak má
          # jeden domov (smoke-keycloak.sh) a brána cold-start-hardening ad-hoc
          # dotaz právem zakazuje. Fáze B si na KC počká svou vlastní smyčkou.
        else
          warn "SSH tunel na KC se nepodařil — spadám na veřejný řetěz (DIRECT/PUBLIC)"
        fi
      else
        warn "KC kontejner přes SSH nenalezen — spadám na veřejný řetěz (DIRECT/PUBLIC)"
      fi
    fi
    if [ -z "${KEYCLOAK_URL:-}" ] || [ "${_KC_TUNNEL_UP:-0}" != "1" ]; then
      export KEYCLOAK_URL="https://${KEYCLOAK_DOMAIN_DIRECT:-${KEYCLOAK_DOMAIN_PUBLIC:-$KEYCLOAK_DOMAIN}}"
    fi
    # ── Is Keycloak OURS to bootstrap? ────────────────────────────────────
    # A story may consume a SHARED, externally-managed Keycloak (profile
    # service_overrides.keycloak.external_domain → the app is absent from the
    # manifest). Then the generated KEYCLOAK_ADMIN/_PASSWORD belong to a KC this
    # deploy never created, so realm import / provision-sso / user provisioning
    # MUST NOT run: at best they fail, at worst they authenticate against someone
    # else's identity provider. Own it → full bootstrap. Don't own it → verify the
    # realm is already served and tell the operator exactly what to do if not.
    # Vlastnictví říká domov (profil prostředí), ne přítomnost řádku v manifestu:
    # manifest je inventář všech prostředí a produkce může Keycloak vlastnit,
    # zatímco staging téže instance konzumuje sdílený.
    if vlastni keycloak; then
      KC_OWNED=1
    else
      KC_OWNED=0
    fi
    if [ "$KC_OWNED" = "0" ]; then
      if externi keycloak; then
        warn "keycloak: $(vlastnictvi_hlaska keycloak) — realm neimportuji, SSO ani uživatele nezakládám."
      else
        warn "Keycloak is EXTERNAL (not in ${MANIFEST##*/}) — this deploy does not own it."
      fi
      # A consumer NEVER administers someone else's Keycloak — not with its own
      # generated admin, and not by borrowing the owner's either. The owner PROVIDES
      # the realm as a service: our realm is declared as a record in the OWNING
      # stack's instance-data (keycloak/*-realm.json), and that stack's own
      # configure-realms.sh creates/keeps it on every one of ITS deploys. Here we only
      # VERIFY that the service we consume is being served.
      _kc_disc="${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}/.well-known/openid-configuration"
      info "  Verifying the shared realm is served: ${_kc_disc}"
      if curl -fsS -m 15 "$_kc_disc" >/dev/null 2>&1; then
        ok "  Realm '${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}' is served — nothing to do (provided by the owning stack)"
      else
        warn "  Realm '${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}' is NOT served by ${KEYCLOAK_URL}."
        warn "  This is not ours to fix from here. The OWNING stack must declare our realm as a"
        warn "  record in ITS instance-data overlay (keycloak/<NN>-${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}-realm.json);"
        warn "  its configure-realms.sh then provisions it on that stack's next deploy, and the"
        warn "  shared Keycloak serves it to us. Nothing else in that stack is ours to touch."
        nedokonceno "Fáze B: realm '${KEYCLOAK_REALM}' sdílený Keycloak NESERVÍRUJE — OIDC aplikace budou cyklit na 404, dokud ho vlastník nedodá"
      fi
      unset _kc_disc
    elif KEYCLOAK_URL="${KEYCLOAK_URL:-https://${KEYCLOAK_DOMAIN}}" \
       KC_REALM="$(_kc_bootstrap_realm)" \
       TIMEOUT_SECONDS="${KC_GATE_TIMEOUT:-600}" \
       bash "${REPO_ROOT}/scripts/smoke-keycloak.sh" </dev/null; then
      _kc_gate_ok=1   # Phase G (operator DB grant po vlně 5) na tom větví — přesun zachovává původní "KC fail => jen warn"
      info "  Importing realm '${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}'..."
      # AISHA_INSTANCE_DATA_GIT_URL: explicit pass-through (eval'd generate-secrets
      # vars are not exported) — configure-realms.sh upserts the private overlay's
      # keycloak/NN_*-client.json instance clients with it; empty = skip.
      #
      # TENANT_REALM_FILE: kde leží deklarace TENANT realmu. configure-realms.sh
      # ji sám hledá vedle sebe (`keycloak/${KEYCLOAK_REALM}.json` ve forku), jenže
      # tam patřit nemůže — pojmenovaný realm je vlastnost INSTANCE a fork zůstává
      # upstream-čistý. Instanční overlay už vedle sebe nese `keycloak/NN_*-client.json`,
      # takže realm bydlí ve stejném adresáři. Když overlay není nebo soubor nemá,
      # proměnná se nevydá a platí původní hledání vedle skriptu.
      #
      # ⛔ NAMĚŘENO 2026-09-17 (dva běhy za sebou): `${X:+TENANT_REALM_FILE=…}` mezi
      # přiřazeními před příkazem NENÍ přiřazení — bash pozná přiřazení podle tvaru
      # slova PŘED expanzí, a tohle slovo začíná `$`. Stalo se jménem příkazu; po
      # expanzi (prázdné i neprázdné) se příkazem stalo další slovo
      # `AISHA_INSTANCE_DATA_GIT_URL=https://oauth2:<token>@…` → „No such file or
      # directory" S HODNOTOU v logu, a configure-realms.sh NIKDY neběžel.
      # Proměnné proto jdou polem přes `env` — podmíněná položka se přidá jen, když je.
      _kc_realm_env=(
        KC_URL="${KEYCLOAK_URL:-https://${KEYCLOAK_DOMAIN}}"
        KC_ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
        KC_ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD}"
        AISHA_INSTANCE_DATA_GIT_URL="${AISHA_INSTANCE_DATA_GIT_URL:-}"
      )
      [ -n "${_KC_TENANT_REALM_FILE:-}" ] && _kc_realm_env+=(TENANT_REALM_FILE="$_KC_TENANT_REALM_FILE")
      env "${_kc_realm_env[@]}" bash "${REPO_ROOT}/keycloak/configure-realms.sh" </dev/null \
        && ok "  KC realm '${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}' imported" \
        || nedokonceno "Fáze B: configure-realms.sh skončil nenulou — realm/klienti nemusí odpovídat deklaraci"
      unset _kc_realm_env
      # ⛔ TEPRVE TEĎ se sonduje realm, který instance SKUTEČNĚ používá.
      #
      # Do 2026-08-25 ho sondovala branka VÝŠE — tedy PŘED krokem, který ho
      # zakládá. Pro výchozí `aisha` to prošlo, protože ten realm nasype
      # `--import-realm` při startu kontejneru; pro POJMENOVANÝ realm to projít
      # nemohlo nikdy. Naměřeno na této instanci: `/realms/aisha` 200,
      # `/realms/<fork>-realm` 404, fáze B umřela osmnáct sekund po vlně 4
      # bez jediného řádku chyby — „realm neexistuje" vypadá stejně jako
      # „Keycloak ještě nenaběhl". Funkce tenant realmu v configure-realms.sh byla
      # tím pádem napsaná, zdokumentovaná a NEDOSAŽITELNÁ.
      #
      # Dvě různé otázky, dvě různé sondy: branka výš se ptá „stojí Keycloak?"
      # (realm, který obraz peče), tahle „má instance svůj realm?".
      if [ "${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}" != "$(_kc_bootstrap_realm)" ]; then
        if KEYCLOAK_URL="${KEYCLOAK_URL:-https://${KEYCLOAK_DOMAIN}}" \
           KC_REALM="${KEYCLOAK_REALM}" TIMEOUT_SECONDS=120 \
           bash "${REPO_ROOT}/scripts/smoke-keycloak.sh" </dev/null; then
          ok "  Tenant realm '${KEYCLOAK_REALM}' je obsluhovaný"
        else
          err "  Tenant realm '${KEYCLOAK_REALM}' se nezaložil."
          err "  Deklarace bez souboru: configure-realms.sh čeká ${_KC_TENANT_REALM_FILE:-<fork>/keycloak/${KEYCLOAK_REALM}.json}."
          err "  Každá služba míří na /realms/${KEYCLOAK_REALM} — pokračovat znamená nasadit stack, kam se nikdo nepřihlásí."
          exit 1
        fi
      fi
      # ⛔ NAMĚŘENO 2026-08-20 na riqi. Tenhle krok RAZÍTKUJE do Keycloaku secrety
      # důvěrných klientů (oauth2-proxy před extranetem, n8n, nocodb, studio,
      # appsmith, langfuse, openclaw). Když se nevykoná, Keycloak si u nově
      # založených klientů vygeneruje VLASTNÍ hodnoty — a konzumenti pak drží
      # jinou. Přihlášení proběhne, ale výměna kódu za token skončí na
      #   `token exchange failed: "unauthorized_client" "Invalid client credentials"`.
      #
      # Přesně to se stalo: rozešlo se 11 kopií napříč 7 aplikacemi a nikdo o tom
      # nevěděl, protože tady stálo `|| warn` — nezdar se spolkl a běh pokračoval.
      # Táž třída jako „exit 0 po chybě", která nás stála čtyři dny meshe.
      #
      # Není to volitelná ozdoba: bez tohohle kroku nefunguje ŽÁDNÉ přihlášení
      # přes proxy. Proto se tu KONČÍ, ne varuje.
      info "  Provisioning Keycloak client secrets (provision-sso.sh)..."
      if (cd "$REPO_ROOT" && bash scripts/provision-sso.sh --prod --keycloak-only </dev/null); then
        ok "  Client secrets provisioned"
      else
        err "  provision-sso.sh SELHAL — Keycloak nedostal secrety důvěrných klientů."
        err "  Každé přihlášení přes proxy (extranet, n8n, nocodb, studio, appsmith)"
        err "  by skončilo na 'unauthorized_client'. Pokračovat by znamenalo nasadit"
        err "  stack, který vypadá zdravě a nepustí nikoho dovnitř."
        exit 1
      fi
      info "  Provisioning aisha-bootstrap system user..."
      if (cd "$REPO_ROOT" && SYNC_COOLIFY=1 bash scripts/aisha-bootstrap-user-init.sh </dev/null); then
        ok "  aisha-bootstrap user provisioned"
        # Fáze B právě přerazila pověření v Keycloaku a zapsala je do SOUBORU.
        # Prostředí tohohle shellu je ale SNÍMEK z doby před ní (krok 4), a
        # `netbird-bootstrap.sh` čte přes `env_value`, které dává přednost
        # prostředí před souborem — takže by fáze D poslala starou hodnotu.
        #
        # ⛔ NAMĚŘENO (run10 i run13), týž obraz: fáze B „ROPC token acquired",
        # fáze D o čtyři minuty později HTTP 401. Stejné dveře, stejný uživatel,
        # stejný realm — lišila se JEN hodnota, kterou která fáze držela.
        #
        # Přebírá se CELÝ soubor, ne vyjmenované klíče: ruční seznam by zestárl
        # u prvního dalšího pověření, které fáze B začne vyrábět.
        #
        # ⛔ ALE NE adresu Keycloaku pro OPERÁTORA (naměřeno 2026-09-17): soubor nese
        # KEYCLOAK_URL pro KONTEJNERY (mesh jméno). Převzetím se přepsala adresa, kterou
        # fáze B vybrala pro tenhle stroj (tunel / přímá tvář), a hned další krok
        # (provision-operators) i fáze D sahaly z operátorského stroje na mesh jméno
        # → `fetch failed`, operátoři se nezaložili.
        _kc_url_operatora="$KEYCLOAK_URL"
        nacti_env_do_prostredi "$ENV_COOLIFY"
        export KEYCLOAK_URL="$_kc_url_operatora"
        unset _kc_url_operatora
        ok "  převzato z fáze B: $NACTENO_KLICU klíčů (KEYCLOAK_URL zůstává operátorská: ${KEYCLOAK_URL})"
      else
        warn "  aisha-bootstrap-user-init.sh non-zero — netbird-bootstrap SE ZASTAVI (fáze D)"
        warn "  Ustup na servisni ucet byl 2026-08-20 odstranen: zakladal ucet na identitu,"
        warn "  kterou IdP nevidi, a to je nevratne. Radeji hlasity stop nez tichy poison."
        # If PKI bootstrap secrets are empty (KC client not yet created), strip
        # the empty lines so env-doctor heal pass generates random placeholders.
        # This prevents coolify-sync-envs preflight from blocking Phase D.
        # Real values are written by aisha-bootstrap-user-init.sh on next retry.
        if command -v node >/dev/null 2>&1; then
          _pki_healed=0
          for _pki_k in AISHA_PKI_BOOTSTRAP_CLIENT_SECRET AISHA_PKI_BOOTSTRAP_PASSWORD \
                         PKI_BOOTSTRAP_CLIENT_SECRET PKI_BOOTSTRAP_PASSWORD; do
            if grep -qE "^${_pki_k}=$" "$ENV_COOLIFY" 2>/dev/null; then
              grep -v "^${_pki_k}=$" "$ENV_COOLIFY" > "${ENV_COOLIFY}.pki-tmp" \
                && env_zapis_atomicky "${ENV_COOLIFY}.pki-tmp" "$ENV_COOLIFY"
              _pki_healed=1
            fi
          done
          unset _pki_k
          if [ "$_pki_healed" = "1" ]; then
            info "  Generating PKI secret placeholders via env-doctor..."
            node "${REPO_ROOT}/scripts/aisha-env-doctor.mjs" >/dev/null 2>&1 || true
            warn "  PKI secrets are placeholders — re-run aisha-bootstrap-user-init.sh after KC is healthy"
          fi
          unset _pki_healed
        fi
      fi

      # ── Restore operator USERS (realm + operators now exist in Keycloak) ─────
      # The wave-2 core migrate ran BEFORE Keycloak existed, so its built-in
      # provision-operators step soft-skipped (no realm to resolve subs against).
      # Now that Phase B has imported the realm, re-run the IDEMPOTENT core migrate:
      # provision-operators resolves each operator's live KC sub by email and
      # grants DB roles (aisha_auth.users + user_roles), restoring this install's
      # users on every wipe — the user half of "wipe = repo/fork source-of-truth".
      # Only when this install has a roster (instance-data overlay / config/
      # operators.json → AISHA_OPERATORS, or AISHA_PRIMARY_ADMIN_EMAIL);
      # clean/community installs skip it. The re-migrate TRIGGER is soft, but
      # the OUTCOME is verified below and fails LOUD: when a roster exists, a
      # cold-start that ends without its admin authorized is a broken cold-start
      # (live instance 2026-07-18: provision died in-container, cold-start said OK).
      if [ -n "${OPERATORS_COMPACT:-}" ] || [ -n "${AISHA_PRIMARY_ADMIN_EMAIL:-}" ]; then
        # ── Auto-create MISSING Keycloak roster users (closes the wipe gap) ──
        # A volume-purging wipe destroys human operator accounts and the realm
        # import ships none (PII-free public repo) — without this, the migrate's
        # provision-operators step skipped them ("create the account first") and
        # restoration stayed manual. Run the creation pass HOST-side (public KC
        # URL; admin creds already in scope from Phase B) so each auto-created
        # user's ONE-TIME temp password prints HERE in the cold-start terminal
        # ([TEMP-PASSWORD] block; first login forces UPDATE_PASSWORD). Existing
        # users are never touched (idempotent); the in-container --apply pass
        # then resolves the new subs and keeps temp passwords OUT of the
        # DB-persisted migrate log. Opt-out: AISHA_OPERATORS_CREATE_MISSING=0.
        if [ "${AISHA_OPERATORS_CREATE_MISSING:-1}" != "0" ]; then
          info "  Ensuring roster operators exist in Keycloak (auto-create missing; temp passwords print below)..."
          if (cd "$REPO_ROOT" && \
              AISHA_OPERATORS="${OPERATORS_COMPACT:-}" \
              AISHA_PRIMARY_ADMIN_EMAIL="${AISHA_PRIMARY_ADMIN_EMAIL:-}" \
              KEYCLOAK_URL="${KEYCLOAK_URL:-https://${KEYCLOAK_DOMAIN}}" \
              KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-admin}" \
              KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD}" \
              node scripts/db/provision-operators.mjs --create-only </dev/null); then
            ok "  Roster users present in Keycloak (copy any [TEMP-PASSWORD] block above NOW — shown once)"
          else
            nedokonceno "Fáze B: automatické založení operátorů v Keycloaku skončilo nenulou — chybějící uživatelé se neprovisionují"
          fi
        else
          info "  AISHA_OPERATORS_CREATE_MISSING=0 — missing Keycloak users will NOT be auto-created"
        fi
      else
        info "  No operator roster (config/operators.json / AISHA_OPERATORS) — skipping user provisioning (clean install)"
      fi
      # Bootstrap JWKS pro pki-bridge: KC brána prošla → veřejné podpisové klíče
      # realmu existují a jsou čerstvé. Doručíme je TEĎ, PŘED wave 4 a NetBirdem
      # (Phase D) — právě v tom okně, kdy mesh ještě není nahoře a multi-node
      # pki-bridge by se ke KC po síti nedostal. Živá cesta zůstává primární;
      # tohle je jen doručený záložní runk. Neblokující: selže-li, cold-start
      # jede dál (single-node ho nepotřebuje, alias stačí).
      if MANIFEST_FILE="$MANIFEST" node "${REPO_ROOT}/scripts/pki-bootstrap-jwks-sync.mjs" </dev/null; then
        ok "  bootstrap JWKS doručen do pki-bridge"
      else
        nedokonceno "Fáze B: bootstrap JWKS sync selhal — multi-node pki-bridge bootstrap může viset"
      fi
    else
      nedokonceno "Fáze B: brána Keycloaku neprošla — OIDC aplikace vlny 4 budou cyklit na 404"
    fi

    # ── Phase C: dynamic DB+OIDC wave range from aisha-redeploy ────────────
    # ⛔ ÚKLID TUNELU SE PŘESUNUL ZA FÁZI D (naměřeno 2026-08-25). Zavíral jsem
    # ho tady, jenže Keycloak potřebuje i fáze D: `netbird-bootstrap.sh` si ho
    # sonduje sám a bez tunelu sáhne na VNITŘNÍ jméno (`<fork>-keycloak:80`),
    # které operátor mimo mesh nepřeloží — `OIDC discovery: 000` a ražba setup
    # klíčů se zastaví. Kanál tedy žije, dokud ho operátorské kroky potřebují.

    info "Phase C: deploying vlny ${AISHA_WAVE_PHASE_C_FROM}-${AISHA_WAVE_PHASE_C_UNTIL} (vznik meshe — realm je provisionovaný, mesh peery přijdou až ve fázi D po výrobě setup klíčů)..."
    # shellcheck disable=SC2086
    _phase_c_rc=0
    (cd "$REPO_ROOT" && node scripts/aisha-redeploy.mjs \
        --from=${AISHA_WAVE_PHASE_C_FROM} --until=${AISHA_WAVE_PHASE_C_UNTIL} $REDEPLOY_FLAGS </dev/null) || _phase_c_rc=$?
    if [ "$_phase_c_rc" = "0" ]; then
      ok "Phase C waves ${AISHA_WAVE_PHASE_C_FROM}-${AISHA_WAVE_PHASE_C_UNTIL} completed"
    elif [ "$_phase_c_rc" = "3" ]; then
      # Mesh vznikl (kritické aplikace prošly); nedokončené jsou jen měkké.
      nedokonceno "Fáze C (vlny ${AISHA_WAVE_PHASE_C_FROM}-${AISHA_WAVE_PHASE_C_UNTIL}): měkké aplikace nedokončené — výpis redeploye výš"
    else
      err "Phase C waves ${AISHA_WAVE_PHASE_C_FROM}-${AISHA_WAVE_PHASE_C_UNTIL} did not complete — mesh nevznikl (netbird nezdravý nebo brána fáze neprošla)"
      err "  Cold-start stops here so NetBird/downstream services are not started on broken prerequisites."
      err "  Diagnose:  node scripts/aisha-redeploy.mjs --status"
      err "  PKI:       bash scripts/diagnose-pki-coolify.sh"
      err "  Retry:     node scripts/aisha-redeploy.mjs --from=${AISHA_WAVE_PHASE_C_FROM} --until=${AISHA_WAVE_PHASE_C_UNTIL} $REDEPLOY_FLAGS"
      exit 1
    fi

    # ── Phase D: NetBird bootstrap (now mgmt API is up + KC realm exists) ──
    info "Phase D: NetBird bootstrap (groups + setup keys)..."
    if NETBIRD_DOMAIN="${NETBIRD_DOMAIN}" \
       TIMEOUT_SECONDS="${NETBIRD_GATE_TIMEOUT:-300}" \
       bash "${REPO_ROOT}/scripts/smoke-netbird.sh" </dev/null; then
      # ⛔ KEYCLOAK_PUBLIC_URL, ne KEYCLOAK_URL (naměřeno 2026-08-25).
      #
      # netbird-bootstrap.sh má vlastní pořadí zdrojů adresy (viz komentář tam):
      #   1. KEYCLOAK_PUBLIC_URL   výslovný operátorský override
      #   2. KEYCLOAK_INTERNAL_URL container alias — „kdo je uvnitř, jde napřímo"
      #   3. veřejná tvář
      #   4. KEYCLOAK_URL          hodnota volajícího
      #
      # Předávali jsme ČTVRTOU, takže vyhrála DRUHÁ: container alias z .env.coolify.
      # Jenže tenhle krok běží na OPERÁTORSKÉM stroji, kde se alias nerozřeší —
      # brána Keycloaku 183 s sbírala HTTP 000 a fáze D skončila, aniž vznikly setup
      # klíče. Bez nich se do mesh nezapíše ani jeden peer, takže vlny 6+ stály
      # na prázdné mesh.
      #
      # KEYCLOAK_URL je v tuhle chvíli operátorsky DOSAŽITELNÁ adresa (fáze B ji
      # nastavila na SSH tunel nebo přímou tvář), takže se předává do slotu,
      # který skript čte PRVNÍ.
      if SYNC_COOLIFY=1 REDEPLOY_AFTER_NETBIRD=0 \
         KEYCLOAK_PUBLIC_URL="${KEYCLOAK_URL}" \
         bash "${REPO_ROOT}/scripts/netbird-bootstrap.sh" </dev/null; then
        ok "  NetBird bootstrap complete (setup keys synced to Coolify)"
      else
        err "  netbird-bootstrap.sh failed — stopping before mesh peers/downstream waves"
        err "  Diagnose:  bash scripts/smoke-netbird.sh && bash scripts/netbird-bootstrap.sh"
        exit 1
      fi
      # Modelový mesh forku (varianta C): TÝŽ skript nad modelovou instancí — jen když
      # topologie vydala MODEL_MESH (model forku na GPU slotu); bez ní se nevolá vůbec.
      if [ -n "${MODEL_MESH:-}" ]; then
        if SYNC_COOLIFY=1 NETBIRD_INSTANCE=model \
           KEYCLOAK_PUBLIC_URL="${KEYCLOAK_URL}" \
           bash "${REPO_ROOT}/scripts/netbird-bootstrap.sh" </dev/null; then
          ok "  Modelový mesh: bootstrap hotov (skupiny, politika, klíč uzlu na GPU slotu)"
        else
          err "  Modelový mesh: bootstrap selhal nebo ZASTAVIL (cizí/zdvojený peer) — uzel na GPU slotu se nezapíše"
          err "  Diagnose:  NETBIRD_INSTANCE=model bash scripts/netbird-bootstrap.sh"
          exit 1
        fi
      fi
      # Operátorské kroky skončily → kanál se zavírá. Nechat ho žít by znamenalo
      # trvalé dveře, které nikdo nehlídá.
      if [ "${_KC_TUNNEL_UP:-0}" = "1" ]; then
        pkill -f "ssh.*-L 127.0.0.1:18080:" 2>/dev/null || true
        _KC_TUNNEL_UP=0
        ok "  SSH tunel operátorského bootstrapu uzavřen"
      fi
    else
      err "  NetBird mgmt gate failed — stopping before mesh peers/downstream waves"
      err "  Diagnose:  bash scripts/smoke-netbird.sh"
      err "  Retry after fix: node scripts/aisha-redeploy.mjs --from=${AISHA_WAVE_PHASE_C_FROM} --until=${AISHA_WAVE_PHASE_C_UNTIL} $REDEPLOY_FLAGS"
      exit 1
    fi

    # ── Phase D1b: co tenhle běh vyrazil, musí vidět i jeho vlastní potomci ──
    #
    # ⛔ NAMĚŘENO 2026-08-26: fáze D vyrazila 4 nové setup klíče a uložila
    # čerstvý AISHA_BOOTSTRAP_CLIENT_SECRET do .env.coolify. Fáze D2 pak
    # dostávala 401 unauthorized_client a stála 90 minut. Vada má DVĚ patra a
    # oprava jednoho z nich NESTAČÍ:
    #
    #   1) `.env-prod-backup` má v kanonickém řetězu VYŠŠÍ přednost než
    #      `.env.coolify` (lib/config-env-files.mjs:36). Je to záměr — díky
    #      tomu wipe hodnoty neztratí. Jenže ten snapshot vzniká PŘED wipem,
    #      takže drží mrtvé kopie všeho, co běh vyrobí až potom.
    #   2) `pre_resolve_load_env` ten snapshot navíc EXPORTUJE do prostředí
    #      (load_env_file_keys … overwrite). Potomci čtou `process.env` a to
    #      přebíjí soubor — takže ani oprava souboru sama o sobě nedosáhne.
    #
    # Ověřeno mutací: se starou hodnotou v prostředí `netbird-peer-discover`
    # končí exit 2 + 401, bez ní exit 0. Proto se dělá OBOJE — přerazit
    # soubor a znovu načíst prostředí. Kdyby se dělalo jen jedno, běh by
    # vypadal opraveně a stál by dál.
    #
    # Fail-loud: doktor vrací nenulu i u klíče, který NEUMÍ posoudit (není v
    # registru env-doctoru). „Nedokážu posoudit" není „je to v pořádku" —
    # pokračovat by znamenalo nasazovat s hodnotou neznámého původu.
    if node "$REPO_ROOT/scripts/vault-drift-doctor.mjs" --oprav; then
      ok "  trezor souhlasí s tím, co tenhle běh vyrazil"
    else
      err "  vault-drift-doctor: v trezoru je rozchod, který nelze posoudit."
      err "  Klíč, který si platforma vyrábí, patří do registru v scripts/aisha-env-doctor.mjs;"
      err "  klíč dodávaný operátorem tam patří jako \"external\" (tam je trezor autorita)."
      err "  Diagnose:  node scripts/vault-drift-doctor.mjs"
      exit 1
    fi
    # Prostředí TOHOTO procesu — bez tohohle řádku by potomci dál dostávali
    # hodnoty vyexportované na začátku běhu, tedy z doby před wipem.
    load_env_file_keys "$ENV_PROD_BACKUP" "overwrite"

    # ── Phase D2: propagate mesh peer IPs into Coolify ─────────────────────
    # coolify-mesh-sync.mjs zjistí live peer IP a PATCHne *_MESH_IP na Coolify.
    # Bez tohohle kroku zůstane CORE_MESH_IP prázdné a vlna 5 (mesh warmup)
    # nasadí edge s mesh-routerem, jehož DNAT nemá cíl → api 502
    # (incidenty 07-29 / 07-30 / 07-31).
    #
    # Skript existoval a byl NEZAPOJENÝ: volaly ho jen `npm run mesh:sync`,
    # runbook a chybová hláška v compose. Přitom dvě brány tvrdí, že běží
    # „v cold-start step 5" (cold-start-heredoc-bindings.gate.test.ts,
    # env-doctor-contract-coverage.gate.test.ts) — ověřovaly ale jen to, že
    # SOUBOR EXISTUJE, ne že se volá. Naměřeno 2026-08-09 na --wipe deployi.
    # Drží to teď src/tests/gates/mesh-sync-is-wired-into-coldstart.gate.test.ts.
    #
    # Fail-loud: bez mesh IP nemá smysl pokračovat do vlny 5 — edge by se buď
    # odmítl nasadit (pojistka v aisha-redeploy.mjs), nebo nasadil rozbitý.
    # Podmíněno projektovým rozsahem, ne tvarem nasazení: rozhoduje MESH_ENABLED
    # (operátorská deklarace; profily nesou jen šablonový default false). Týž
    # idiom jako zbytek skriptu. Multi-cloud / multi-node / single-node tak jedou
    # STEJNOU cestou — liší se jen tím, co si instance deklarovala, ne větvením
    # podle profilu.
    # Nedeklarovaná hodnota není "ne". Mesh je architektura instance — izolované
    # prostředí, kde spolu služby mluví bezpečně a odděleně — takže "nevím, jestli
    # tahle instance jede přes mesh" je chyba, ne tichý opt-out. Bez téhle
    # kontroly by prázdné MESH_ENABLED Phase D2 přeskočilo a vlna 5 by nasadila
    # edge s mesh-routerem bez cíle DNAT, aniž by to kdokoli vyslovil.
    # Týž princip, jaký skript už uplatňuje u identity instance.
    if [ -z "${MESH_ENABLED:-}" ]; then
      err "MESH_ENABLED není deklarované — nevím, jestli tahle instance jede přes mesh."
      err "  Mesh je architektura instance, ne volitelný doplněk; 'nevím' není 'ne'."
      err "  Deklaruj MESH_ENABLED=true|false v .env-prod-backup nebo .env.local."
      exit 1
    fi
    if [ "${MESH_ENABLED}" = "true" ]; then
      info "Phase D2: propagace mesh peer IP do Coolify (coolify-mesh-sync)..."
      if (cd "$REPO_ROOT" && node scripts/coolify-mesh-sync.mjs --apply </dev/null); then
        ok "  mesh IP propagovány (CORE_MESH_IP je na Coolify i v .env.coolify)"
      else
        err "  coolify-mesh-sync.mjs selhal — vlna ${AISHA_WAVE_PHASE_D_FROM} by nasadila edge bez cíle DNAT (api 502)"
        err "  Diagnose:  node scripts/coolify-mesh-sync.mjs        # check-only, vypíše co vidí"
        err "  Retry:     node scripts/coolify-mesh-sync.mjs --apply && node scripts/aisha-redeploy.mjs --from=${AISHA_WAVE_PHASE_D_FROM} $REDEPLOY_FLAGS"
        exit 1
      fi
    else
      info "Phase D2 přeskočena — MESH_ENABLED != true (služby si vystačí s docker sítí)"
    fi

    # ── Phase E: Waves 5-6 (mesh warmup + peer agents) ─────────────────────
    info "Phase E: deploying waves 5-7 (edge mesh re-enroll + integration/ledger/exec)..."
    # shellcheck disable=SC2086
    _phase_e_rc=0
    (cd "$REPO_ROOT" && node scripts/aisha-redeploy.mjs \
        --from=${AISHA_WAVE_PHASE_D_FROM} $REDEPLOY_FLAGS </dev/null) || _phase_e_rc=$?
    if [ "$_phase_e_rc" = "0" ]; then
      ok "All waves completed"
    else
      # ⛔ Dřív tu stálo `exit 1` s hláškou „Step 6 (n8n workflows) se PŘESKAKUJE".
      # Pozdní vlny nenesou předpoklad kroků 5c–7: n8n (vlna 4) už běží a každý
      # další krok si svůj předpoklad ověří sám. Zastavit tady znamenalo přeskočit
      # n8n kvůli jakékoli aplikaci z vln 5+ — i měkké.
      nedokonceno "Fáze E (vlny ${AISHA_WAVE_PHASE_D_FROM}+): redeploy skončil kódem ${_phase_e_rc} — výpis výš; pokračuji kroky 5c–7"
      err "  Diagnose:  node scripts/aisha-redeploy.mjs --status"
      err "  Retry:     node scripts/aisha-redeploy.mjs --from=${AISHA_WAVE_PHASE_D_FROM} $REDEPLOY_FLAGS"
    fi

    # ── Phase F: populate the mesh-DNS zone (single-purpose NetBird resolver) ──
    # The resolver now lives at a DETERMINISTIC address: mesh-router pins
    # MESH_DNS_RESOLVER_IP on the instance-owned ${MESH_DNS_NETWORK}, and every
    # consumer already received NETBIRD_DNS_IP + that network membership at its
    # NORMAL deploy (coolify-sync-envs at step 4, before the waves). So there is
    # NO IP to discover and NO consumer to redeploy here — the value self-sets and
    # self-propagates on every deploy, and survives restart because the pin never
    # moves. The only thing left is to POPULATE the zone: reconcile netbird
    # records so mesh names (auth.mesh.<tld>, …) map to the live in-cluster IPs.
    # Idempotent; a few passes as apps settle. See scripts/netbird-dns-provision.mjs
    # + memory tenant-jednoucelove-dns-navrh.
    #
    # Gated on MESH_ENABLED and a local docker (the provisioner reads host state).
    if [ "${MESH_ENABLED}" = "true" ] && ! { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }; then
      # Provisioner čte stav hostitele přes lokální docker. Bez něj se zóna
      # NENAPLNÍ — a dřív se o tom nedozvěděl nikdo (podmínka neměla else).
      nedokonceno "Fáze F: mesh DNS zóna NENAPLNĚNA — na tomhle stroji neodpovídá docker (node scripts/netbird-dns-provision.mjs --apply)"
    elif [ "${MESH_ENABLED}" = "true" ]; then
      info "Phase F: populating mesh-DNS zone (resolver=${MESH_DNS_RESOLVER_IP:-?} on ${MESH_DNS_NETWORK:?})..."

      # ⛔ Forwarder se dřív bral z /etc/resolv.conf STROJE, ODKUD SE NASAZUJE
      # (naměřeno 2026-09-16: notebook na hotspotu = fe80::…%en0). Je to resolver
      # SÍTĚ SERVERŮ, tedy deklarace instance — ověřuje ji lib/dns-forwarder.mjs
      # a netbird-dns-provision bez ní nezapíše nic.
      _fwd_ip="${NETBIRD_DNS_FORWARD_IP:-}"
      _dns_provision() {
        (cd "$REPO_ROOT" && NETBIRD_DNS_FORWARD_IP="$_fwd_ip" node scripts/netbird-dns-provision.mjs --apply </dev/null)
      }

      if [ "$DRY_RUN" = "1" ]; then
        info "  [DRY RUN] would populate netbird DNS zone (${DNS_PROVISION_PASSES:-3} passes, forwarder=${_fwd_ip:-none})"
      else
        _pass=0
        _dns_ok=0
        while [ "$_pass" -lt "${DNS_PROVISION_PASSES:-3}" ]; do
          sleep "${DNS_PROVISION_INTERVAL:-45}"
          if _dns_provision; then ok "  NetBird DNS zone populated (pass $((_pass+1)))"; _dns_ok=1; else
            warn "  netbird-dns-provision pass $((_pass+1)) failed"; fi
          _pass=$((_pass+1))
        done
        # ⛔ ANI JEDEN ÚSPĚŠNÝ PRŮCHOD = mesh DNS je PRÁZDNÉ. Do 2026-08-25 se to
        # odbylo varováním u každého průchodu a fáze pokračovala jako hotová —
        # jenže bez zóny se `<svc>.mesh.<tld>` nepřeloží NIKOMU a celý princip
        # „dovnitř jen meshem, plným jménem" tiše neplatí. Zbytek běhu přitom
        # vypadá zeleně, protože ostatní kroky mesh DNS nepoužívají.
        if [ "$_dns_ok" = "0" ]; then
          # Počet průchodů se sem NEOPISUJE druhým `:-` — brána nad fallbacky
          # počítá VÝSKYTY, ne jedinečné klíče, takže i zopakovaná táž výchozí
          # hodnota zvedne dluh. `$_pass` nese, kolikrát se to opravdu zkusilo.
          nedokonceno "Mesh DNS zóna zůstala PRÁZDNÁ — neuspěl ani jeden z ${_pass} průchodů."
          err "  Bez ní se vnitřní jména nepřeloží a služby spolu mluví jen přes docker aliasy."
          err "  Diagnose:  node scripts/netbird-dns-provision.mjs      # nasucho, vypíše co vidí"
          err "  Nejčastěji: agenti nemají wt0 (mesh nezapsala peery) → cíle bez živé IP."
        fi
      fi
    fi

    # ── Phase G: operator provisioning (DB grant) + VERIFY ─────────────────
    # PŘESUNUTO z Phase B (2026-08-09). Baseline i verify čtou
    # migration_log_dump přes https://${API_DOMAIN_PUBLIC} — tedy
    # edge → mesh-router → CORE_MESH_IP. Ta cesta VZNIKÁ až vlnou 5 (Phase E);
    # v Phase B se měřil kanál, který na čerstvém wipe z principu neexistuje,
    # a hlásilo se "PostgREST/api is not serving" — nepravdivá atribuce
    # (naměřeno: web=200, core=starting, netbird=nenasazený, je ve vlně 4).
    # Čtvrtý výskyt třídy "fáze žádá podmínku, kterou vyrábí fáze pozdější";
    # KC brána o pár řádků výš dělá totéž SPRÁVNĚ (KEYCLOAK_DOMAIN_DIRECT
    # s komentářem "NOT the mesh host … mesh not up yet"). Drží
    # src/tests/gates/verify-kanal-patri-fazi.gate.test.ts.
    #
    # KC-gate sémantika zachovaná: původně se tenhle blok přeskočil (jen warn),
    # když KC brána neprošla — _kc_gate_ok to přenáší přes přesun.
    if [ "${_kc_gate_ok:-0}" = "1" ] && { [ -n "${OPERATORS_COMPACT:-}" ] || [ -n "${AISHA_PRIMARY_ADMIN_EMAIL:-}" ]; }; then
        info "  Restoring operator users (re-running idempotent core migrate, KC realm now up)..."
        # Strip --skip-healthy: core is already healthy from Phase A, but we MUST
        # redeploy it so the (idempotent) migrate re-runs its provision-operators
        # step — --skip-healthy would filter core out and nothing would happen.
        _provision_flags="$(printf '%s' "$REDEPLOY_FLAGS" | sed 's/--skip-healthy//g')"
        # ── Run-correlate the upcoming migrate BEFORE triggering it ──────
        # The redeploy returns as soon as core CLASSIFIES healthy — with core
        # already healthy from Phase A that is seconds after QUEUING the
        # deployment, minutes before the new migrate container even starts
        # (waitForHealthyOrFailedDeploy returns on a first-poll fully-healthy;
        # adversarial review 2026-07-18). Grepping the latest dump row at that
        # point reads the PREVIOUS migrate's output: on a wipe that is the
        # markerless wave-2 pre-KC row (deterministic false FAIL), on a
        # re-warmup an old success row would mask a current failure (false
        # PASS). Record the newest row id now; verify ONLY a newer row.
        _mig_api="https://${API_DOMAIN_PUBLIC:-$API_DOMAIN}/rest/v1/migration_log_dump"
        _admin_email="${AISHA_PRIMARY_ADMIN_EMAIL:-${PLATFORM_ADMIN_EMAIL:-}}"
        # ── Robust baseline: newest dump id BEFORE the re-migrate ────────
        # A single un-retried read defaulting to 0 on any transient failure
        # would match the pre-existing wave-2 markerless row (id=gt.0) and
        # re-open the exact false-FAIL / stale-PASS gap (adversarial verify
        # 2026-07-19). Retry; distinguish an empty table ("[]" → baseline 0 is
        # correct) from a transport failure (curl -f suppresses 4xx/5xx bodies →
        # empty string → retry, then fail LOUD — NEVER fabricate a baseline).
        # The write_dump NOTIFY keeps PostgREST's schema cache fresh so the table
        # is readable here even right after wave-2 first created it.
        _mig_last_id=""
        for _snap in $(seq 1 15); do
          _snap_resp=$(curl -fsS --max-time 15 \
            ${ANON_KEY:+-H "apikey: ${ANON_KEY}"} \
            ${ANON_KEY:+-H "Authorization: Bearer ${ANON_KEY}"} \
            "${_mig_api}?select=id&order=id.desc&limit=1" 2>/dev/null) || _snap_resp=""
          case "$_snap_resp" in
            "[]") _mig_last_id=0; break ;;
            # Require the PostgREST array shape ([…"id":N…]) — not merely "any
            # digit": a 200 interstitial (proxy/SPA HTML with digit-bearing asset
            # hashes) must NOT be parsed as an id (adversarial verify 2026-07-19).
            # api.<tld> is PostgREST-direct here, but this stays correct if it isn't.
            '['*'"id":'*) _mig_last_id=$(printf '%s' "$_snap_resp" | grep -oE '"id":[0-9]+' | grep -oE '[0-9]+' | head -1); break ;;
            *) sleep 4 ;;
          esac
        done
        if [ -z "$_mig_last_id" ]; then
          err "  Cannot read migration_log_dump baseline via ${_mig_api} after 15 tries —"
          err "  PostgREST/api is not serving in Phase B, so operator provisioning cannot be"
          err "  verified. NOT proceeding on a fabricated baseline (that silently masked the"
          err "  unauthorized-admin bug once). Fix core/postgrest, then re-run:"
          err "    node scripts/aisha-redeploy.mjs --only=core"
          nedokonceno "Fáze G: migration_log_dump nejde přečíst přes ${_mig_api} — provisioning operátorů NESPUŠTĚN ani neověřen"
        # shellcheck disable=SC2086
        elif (cd "$REPO_ROOT" && node scripts/aisha-redeploy.mjs --only=core $_provision_flags </dev/null); then
          # ── Truth-check: did provisioning grant the ADMIN its roles? ─────
          # "redeploy exited 0" only proves core came back healthy — the wave-2
          # provision is soft-by-design. tenant 2026-07-18: a dead aisha-keycloak
          # alias made provision die 'fetch failed' while this line said OK and
          # every wipe left the admin authenticated-but-unauthorized. Correlate
          # to THIS run by a dump row id>baseline, and require the migrate's
          # tail-stable 'PROVISION_GRANTED email_sha256=<otisk admina> roles=…admin/staff…'
          # line — proving THIS run resolved AND role-granted the DELIBERATE
          # admin, not merely that "≥1 operator" provisioned.
          _mig_deadline=$(( $(date +%s) + ${MIGRATE_VERIFY_TIMEOUT_S:-900} ))
          _mig_row=""
          info "  Verifying THIS run granted ${_admin_email:-the roster} (dump id > ${_mig_last_id}, ≤${MIGRATE_VERIFY_TIMEOUT_S:-900}s)..."
          while [ "$(date +%s)" -lt "$_mig_deadline" ]; do
            _mig_row=$(curl -fsS --max-time 20 \
              ${ANON_KEY:+-H "apikey: ${ANON_KEY}"} \
              ${ANON_KEY:+-H "Authorization: Bearer ${ANON_KEY}"} \
              "${_mig_api}?select=id,output&id=gt.${_mig_last_id}&order=id.desc&limit=1" 2>/dev/null) || _mig_row=""
            if grep -q '"output"' <<< "$_mig_row"; then break; fi
            _mig_row=""
            sleep 10
          done
          if [ -z "$_mig_row" ]; then
            err "  Re-migrate verification timed out: no NEW migration_log_dump row (id > ${_mig_last_id})"
            err "  within ${MIGRATE_VERIFY_TIMEOUT_S:-900}s — deployment stuck queued, or migrate crashed"
            err "  before write_dump. Inspect the core migrate container logs, then re-run:"
            err "    node scripts/aisha-redeploy.mjs --only=core"
            nedokonceno "Fáze G: ověření re-migrace vypršelo — žádný nový řádek migration_log_dump (id > ${_mig_last_id})"
          fi
          # Admin-specific grant: a PROVISION_GRANTED line for the primary admin
          # carrying admin/staff. With no single primary (overlay-only roster),
          # accept any granted admin/staff operator.
          # roles class includes '_' — app_role enum values like production_operator
          # can precede admin/staff in the list; digits/hyphen allow future tokens.
          # Velikost písmen adresy řeší otisk (obě strany počítají z malých písmen).
          _grant_ok=0
          if [ -z "$_mig_row" ]; then
            :   # nedokončeno zapsané výš — není co číst
          elif [ -n "$_admin_email" ]; then
            # Řádek nese OTISK adresy (veřejně čitelná tabulka) — týž výpočet jako entrypoint
            # migrate: malá písmena, sha256. openssl je na macOS i Linuxu.
            _admin_hash=$(printf '%s' "$_admin_email" | tr '[:upper:]' '[:lower:]' | openssl dgst -sha256 -r | cut -d' ' -f1)
            grep -qE "PROVISION_GRANTED email_sha256=${_admin_hash} roles=[a-z0-9,_-]*(admin|staff)" <<< "$_mig_row" && _grant_ok=1
          else
            grep -qE "PROVISION_GRANTED email_sha256=[0-9a-f]{64} roles=[a-z0-9,_-]*(admin|staff)" <<< "$_mig_row" && _grant_ok=1
          fi
          if [ -z "$_mig_row" ]; then
            :
          elif [ "$_grant_ok" = "1" ]; then
            ok "  Operator provisioning VERIFIED — this run granted ${_admin_email:-an admin/staff operator} (migration_log_dump)"
          else
            err "  Operator provisioning DID NOT grant ${_admin_email:-the admin} — this run's migrate"
            err "  finished but carries no 'PROVISION_GRANTED email_sha256=…admin/staff' line for it (roster"
            err "  exists, so this is fatal — the admin would be authenticated-but-unauthorized)."
            err "  This run's migrate output (provisioning section):"
            printf '%s' "$_mig_row" | tr ',' '\n' | grep -iE "provision|keycloak|fetch|operator|granted" | head -8 >&2 || true
            err "  Diagnose in-container cause, then re-run:"
            err "    node scripts/aisha-redeploy.mjs --only=core"
            nedokonceno "Fáze G: provisioning NEUDĚLIL ${_admin_email:-adminovi} roli admin/staff — admin by byl přihlášený bez oprávnění"
          fi
          # ── Verdikt srovnání providera vllm-local z TÉHOŽ řádku migrate ─────
          # ⛔ NAMĚŘENO 2026-09-13: selhání scripts/deploy/reconcile-local-model-provider.sql
          # končilo v entrypointu jen `log "WARN … FAILED"` a exit se neměnil — cold-start
          # se to nedozvěděl a provider zůstal ve stavu ze seedu, aniž by to cokoli
          # pojmenovalo. Migrate kvůli tomu NESHAZUJE (gateway čeká na
          # service_completed_successfully), doručuje to sem: tail-stabilní řádek
          # `RECONCILE_VERDIKT slug=vllm-local status=ok|failed duvod=…` na konci výstupu.
          # V JSON odpovědi je konec řádku `\n`, proto `[^\\"]*` končí na zpětném lomítku.
          if [ -n "$_mig_row" ]; then
            _rec_verdikt=$(printf '%s' "$_mig_row" | grep -oE 'RECONCILE_VERDIKT slug=vllm-local status=(ok|failed)( duvod=[^\\"]*)?' | tail -1)
            case "$_rec_verdikt" in
              *"status=ok"*)
                ok "  Provider vllm-local srovnán s topologií (migrate RECONCILE_VERDIKT)" ;;
              *"status=failed"*)
                nedokonceno "Fáze G: migrate NESROVNAL provider vllm-local s topologií — ${_rec_verdikt#*duvod=} (lokální model resolver nenabídne; celý výstup: migration_log_dump / kontejner ${APP_NAME_PREFIX}-migrate)" ;;
              *)
                nedokonceno "Fáze G: výstup migrate z tohoto běhu nenese RECONCILE_VERDIKT — srovnání providera vllm-local NEZMĚŘENO (kontejner ${APP_NAME_PREFIX}-migrate)" ;;
            esac
            unset _rec_verdikt
          fi
          unset _mig_row _mig_deadline _mig_last_id _mig_api _admin_email _admin_hash _grant_ok _snap _snap_resp
        else
          err "  core re-migrate non-zero — operator users NOT provisioned (roster exists, fatal)."
          err "  Retry: node scripts/aisha-redeploy.mjs --only=core, then verify public.migration_log_dump"
          nedokonceno "Fáze G: re-migrace core skončila nenulou — operátoři NEPROVISIONOVÁNI (roster existuje)"
        fi
        unset _provision_flags
    elif [ "${_kc_gate_ok:-0}" != "1" ] && [ "${KC_OWNED:-}" = "0" ] && { [ -n "${OPERATORS_COMPACT:-}" ] || [ -n "${AISHA_PRIMARY_ADMIN_EMAIL:-}" ]; }; then
      nedokonceno "Fáze G (DB grant operátorů) neproběhla — Keycloak v tomhle prostředí není náš (KC_OWNED=0); operátory v realmu spravuje vlastník a DB grant tímto během nezměřen"
    elif [ "${_kc_gate_ok:-0}" != "1" ]; then
      nedokonceno "Fáze G (DB grant operátorů) neproběhla — KC brána ve fázi B neprošla"
    else
      info "  No operator roster — DB provisioning skipped (clean install)"
      # Bez rosteru se migrate v tomhle běhu znovu nespouští, takže řádek migration_log_dump
      # korelovaný s TÍMTO během neexistuje a verdikt reconcile (RECONCILE_VERDIKT) se nečte.
      info "  Verdikt srovnání providera vllm-local (RECONCILE_VERDIKT z migrate) v tomto běhu NEZMĚŘEN — bez rosteru se migrate nekoreluje"
      VSTUPY_OBSLUHY+=("roster operátorů (instance-data operators.json nebo AISHA_PRIMARY_ADMIN_EMAIL) — do platformy se nepřihlásí žádný admin")
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "5c. PROVISION SURFACES (extranet, mobile — opt-in)"
# ─────────────────────────────────────────────────────────────────────────────
# A surface is NOT a compose stack. It is a standalone Coolify Dockerfile app
# (deploy/surface-host/Dockerfile) built with SHELL_APP + INSTANCE_DIR build
# args, so story-init's role:server:compose model cannot express it — which is
# exactly why provision-surfaces.sh exists as its own provisioner.
#
# It was never called from here. The consequence, measured 2026-07-28: a cold
# start produced a stack with no extranet at all, and because the surface's
# public hostname was likewise underived, ALLOWED_ORIGINS never contained it —
# the deployed app signed in and then had every API call rejected at the CORS
# preflight. The declaration now lives in the instance profile (`surfaces`),
# derive-domains.mjs emits it as AISHA_SURFACES + SURFACE_ORIGINS, and this step
# provisions what that declares.
#
# Runs AFTER step 5 (Keycloak is up): each surface needs a public KC client, and
# creating one against a KC that is not yet serving would fail.
#
# Opt-in: with no `surfaces` in the profile, AISHA_SURFACES is unset and the
# provisioner is a no-op — upstream and surface-less instances are unaffected.
if [ "$SKIP_DEPLOY" = "1" ] || [ "$DRY_RUN" = "1" ]; then
  warn "[DRY RUN / --skip-deploy] Would run: scripts/provision-surfaces.sh"
elif [ -z "${AISHA_SURFACES:-}" ]; then
  # ⛔ NAMĚŘENO 2026-09-13 (guru): manifest nasazuje `extranet`, jeho lane je
  # zapnutá (EXTRANET_ENABLED) — a profil žádný povrch nedeklaruje. Build pak
  # nemá overlay (instances/<instance> neexistuje) a padá; tady to prošlo jako
  # „nothing to provision". Zapnutý extranet bez povrchu je rozpor, ne klid.
  if vlastni extranet \
     && node "${REPO_ROOT}/scripts/lib/provision-gate.mjs" --zapnuto extranet --env-file "$ENV_COOLIFY" >/dev/null; then
    nedokonceno "Krok 5c: extranet je v manifestu a zapnutý, ale profil nedeklaruje žádný povrch (surfaces) — build extranetu nemá overlay"
  else
    info "AISHA_SURFACES unset (profile declares no surfaces) — nothing to provision."
  fi
else
  info "Provisioning surfaces: ${AISHA_SURFACES}"
  # Nezastavuje: platforma už běží a nepovedený povrch ji nemá vracet zpět.
  # Nedokončené to ale JE — a konec běhu to vyjmenuje (dřív jen varování).
  if ! bash "${REPO_ROOT}/scripts/provision-surfaces.sh" </dev/null; then
    nedokonceno "Krok 5c: provision-surfaces selhal — povrch (${AISHA_SURFACES}) chybí (AISHA_SURFACES='${AISHA_SURFACES}' bash scripts/provision-surfaces.sh)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "6. POST-DEPLOY BOOTSTRAP (n8n workflows)"
# ─────────────────────────────────────────────────────────────────────────────
# NOTE: KC realm import + provision-sso + aisha-bootstrap user + NetBird
# bootstrap moved to mid-flight phases B+D in step 5 (right place — between
# wave 3 [keycloak ready] and wave 4 [OIDC apps deploy], and between wave 4
# [netbird mgmt up] and wave 5 [edge mesh re-enroll]).
# Step 6 now only handles n8n workflow imports.

if [ "$SKIP_DEPLOY" = "1" ] || [ "$DRY_RUN" = "1" ]; then
  warn "Skipped (--skip-deploy or --dry-run) — run manually:"
  warn "  npm run aisha:workflows:deploy"
else
  # 6. Wait for n8n + deploy workflows. n8n is INTERNAL (mesh-only, NO public edge
  #    face) — verify readiness via its Coolify container health (the healthcheck
  #    runs inside the mesh), NOT an off-mesh HTTP probe to n8n.mesh.<tld> (which the
  #    operator cannot reach; only public services go through the edge).
  # n8n je ZÁKLAD platformy: manifest, který ho nenasazuje, je vada konfigurace,
  # ne důvod krok přeskočit.
  if ! N8N_APP="$(aplikace_podle_compose docker-compose.coolify-n8n.yml)"; then
    err "Manifest ${MANIFEST} nenasazuje docker-compose.coolify-n8n.yml — n8n je základ platformy"
    err "  a cold-start nemá jak ověřit jeho workflows. Doplň do manifestu řádek app: <role>:<slot>:docker-compose.coolify-n8n.yml."
    exit 1
  fi
  info "Waiting for ${N8N_APP} (n8n) container health (internal service; via Coolify control plane)..."
  N8N_READY=0
  for i in $(seq 1 60); do
    if coolify_app_healthy "$N8N_APP"; then
      N8N_READY=1
      ok "${N8N_APP} (n8n) healthy (after ${i}x5s)"
      break
    fi
    sleep 5
  done
  if [ "$N8N_READY" = "1" ]; then
    # ── VERDIKT BOOTSTRAPU n8n (klíč → credentials → workflows) ───────────────
    # n8n 1.79 blokuje vytvoření API klíče ZVENKU, proto vše dělá jednorázový
    # kontejner `${APP_NAME_PREFIX}-n8n--workflow-init` přímo proti n8n:5678.
    #
    # ⛔ NAMĚŘENO 2026-09-13: jeho kód NIKDO NEČETL (Coolify ho do stavu aplikace
    # nepromítne) a ověření z hostitele potřebovalo API klíč, který operátor nemá —
    # veřejné API n8n stojí za OAuth, takže vždy skončilo „Host verify skipped".
    # Credentials se na cestě cold-startu nezakládaly vůbec.
    #
    # Init teď zapíše VERDIKT přes auditní RPC log_integration_action('n8n',
    # 'bootstrap') a tady se přečte přes veřejné API service klíčem. Počítá se
    # jen verdikt z TOHOTO běhu (created_at ≥ start kroku 5).
    info "Čekám na verdikt bootstrapu n8n z ${APP_NAME_PREFIX}-n8n--workflow-init (audit log_integration_action)..."
    _svc_token="${POSTGREST_SERVICE_TOKEN:-$(existing_env_value POSTGREST_SERVICE_TOKEN)}"
    _verdikt=""
    if [ -z "$_svc_token" ]; then
      nedokonceno "n8n: POSTGREST_SERVICE_TOKEN není k dispozici — verdikt bootstrapu NEJDE přečíst"
    else
      _verdikt_url="https://${API_DOMAIN_PUBLIC:-$API_DOMAIN}/rest/v1/integration_service_logs?select=status,error_message,action_detail,created_at,integration_services!inner(service_name)&integration_services.service_name=eq.n8n&action=eq.bootstrap&created_at=gte.${COLD_START_KROK5_T0}&order=created_at.desc&limit=1"
      _verdikt_konec=$(( $(date +%s) + ${AISHA_N8N_VERDIKT_TIMEOUT_S:?config/cold-start-timeouts.env} ))
      while [ "$(date +%s)" -lt "$_verdikt_konec" ]; do
        _odpoved=$(curl -sS --max-time 20 -H "apikey: ${_svc_token}" -H "Authorization: Bearer ${_svc_token}" "$_verdikt_url" 2>/dev/null || true)
        if printf '%s' "$_odpoved" | jq -e 'type == "array" and length == 1' >/dev/null 2>&1; then
          _verdikt="$_odpoved"
          break
        fi
        sleep 20
      done
      if [ -z "$_verdikt" ]; then
        nedokonceno "n8n: verdikt bootstrapu z tohoto běhu NEDORAZIL (${AISHA_N8N_VERDIKT_TIMEOUT_S} s) — init neproběhl, nebo nedosáhl na API. Logy: kontejner ${APP_NAME_PREFIX}-n8n--workflow-init"
      else
        _v_status=$(printf '%s' "$_verdikt" | jq -r '.[0].status')
        _v_selhalo=$(printf '%s' "$_verdikt" | jq -r '(.[0].action_detail.selhalo // []) | join(", ")')
        _v_zalozeno=$(printf '%s' "$_verdikt" | jq -r '.[0].action_detail.credentials.zalozeno // "?"')
        if [ "$_v_status" = "success" ]; then
          ok "n8n bootstrap: API klíč, credentials (nově ${_v_zalozeno}) i workflowy HOTOVO"
        else
          nedokonceno "n8n bootstrap NEDOKONČEN (${_v_selhalo:-neznámý krok}) — logy kontejneru ${APP_NAME_PREFIX}-n8n--workflow-init"
        fi
        # Přeskočená pověření = chybí VSTUP OBSLUHY. Není to vada běhu, ale workflowy,
        # které je používají, při prvním spuštění spadnou — musí to být vidět.
        while IFS= read -r _chybi; do
          [ -n "$_chybi" ] && VSTUPY_OBSLUHY+=("n8n credential ${_chybi}")
        done < <(printf '%s' "$_verdikt" | jq -r '.[0].action_detail.credentials.preskocene[]? | "\(.nazev) [\(.typ)] — chybí \(.chybi | join(", "))"')
      fi
      unset _verdikt_url _verdikt_konec _odpoved _v_status _v_selhalo _v_zalozeno _chybi
    fi
    unset _svc_token _verdikt
  else
    nedokonceno "n8n (${N8N_APP}) není zdravý ani po 5 min — workflowy ani credentials nešlo ověřit"
    err "  Diagnose: node scripts/aisha-redeploy.mjs --status"
  fi

  # 6c. Smoke test. PUBLIC-facing services are verified through their PUBLIC EDGE
  #     faces (pfSense HAProxy ACME → edge → mesh) — the real user path. INTERNAL
  #     (mesh-only) services have no public face and are verified via Coolify
  #     container health (mesh-resident healthcheck), never an off-mesh HTTP probe
  #     to *.mesh.<tld> (unreachable — everything public goes through the edge).
  info "Smoke-testing public edge faces + internal container health..."
  SMOKE_FAILED=0
  for ep in \
    "https://${APP_DOMAIN}" \
    "https://${API_DOMAIN_PUBLIC:-$API_DOMAIN}/health" \
    "https://${KEYCLOAK_DOMAIN_PUBLIC:-$KEYCLOAK_DOMAIN}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration"; do
    if curl -fsS --max-time 10 -o /dev/null "$ep"; then
      ok "  ${ep} → OK"
    else
      warn "  ${ep} → FAIL"
      SMOKE_FAILED=$((SMOKE_FAILED + 1))
    fi
  done
  # Internal-only services (mesh; no public edge face) — control-plane health check.
  for _app in "$N8N_APP"; do
    if coolify_app_healthy "$_app"; then
      ok "  ${_app} container healthy (Coolify)"
    else
      warn "  ${_app} container NOT healthy (Coolify)"
      SMOKE_FAILED=$((SMOKE_FAILED + 1))
    fi
  done
  if [ "$SMOKE_FAILED" = "0" ]; then
    ok "All smoke tests passed"
  else
    nedokonceno "${SMOKE_FAILED} smoke test(ů) selhalo — výpis výš"
  fi

  # 6d. Verify docker_compose_domains match contract (read-only)
  # deploy-init sets domains in step 4, but Coolify PATCH can silently fail.
  # Domain doctor in check mode detects drift without mutating anything.
  info "Verifying docker_compose_domains against contract (domain doctor, read-only)..."
  if (cd "$REPO_ROOT" && node scripts/coolify-domain-doctor.mjs </dev/null); then
    ok "Domain doctor — no drift detected"
  else
    nedokonceno "Domain doctor: docker_compose_domains se rozchází s kontraktem — node scripts/coolify-domain-doctor.mjs --apply"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "6b. EMBED KICKSTART (RAG — knowledge_items + expert_rules)"
# ─────────────────────────────────────────────────────────────────────────────
# The instance-data overlay (00_kb.sql) loads knowledge_items + expert_rules as
# TEXT, but their vector embeddings are produced by svc-mcp-knowledge's /embeddings/*
# routes (normally a weekly n8n cron) — NOT by the seed/overlay. Without this
# kickstart the RAG support content exists but semantic search returns nothing on a
# fresh stack. svc-mcp-knowledge is internal-only, so drive both corpora through the
# public gateway /functions/v1 facade with the service token. Both routes are
# idempotent (force omitted → only un-embedded rows) so re-runs are safe and a
# fully-embedded corpus returns processed:0 at once.
if [ "$SKIP_DEPLOY" = "1" ] || [ "$DRY_RUN" = "1" ]; then
  warn "Embed kickstart skipped (--skip-deploy / --dry-run)."
else
  SVC_TOKEN="${POSTGREST_SERVICE_TOKEN:-$(existing_env_value POSTGREST_SERVICE_TOKEN)}"
  _embed_ok=1
  if [ -z "$SVC_TOKEN" ]; then
    nedokonceno "Embed kickstart: POSTGREST_SERVICE_TOKEN není k dispozici — RAG embeddingy NEVZNIKLY"
    _embed_ok=0
  fi
  # ── Vstup kroku: embedding model prostoru v1 ───────────────────────────────
  # Embed funkce vybírají model resolverem prostoru (fn_resolve_embedding_model_for_space)
  # a bez něj vrací 503. Model se objeví POZDĚ: svc-model se nasazuje až po ai-chat,
  # stahuje váhy a discovery ho zaregistruje při startu nebo v další periodě.
  # Kickstart hned po nasazení by tak skončil „HTTP chyba" u instance, které nic
  # nechybí — jen na vstup nikdo nepočkal. Čeká se na ODPOVĚĎ resolveru, ne na čas.
  # ⛔ C6 (naměřeno 2026-09-13): na periodu discovery (15 min) se nečeká — dokud
  # resolver model nevydá, cold-start discovery VYŽÁDÁ (POST /functions/v1/discover-models,
  # servisní token, selfTest:false = jen objevení a změření rozměru). Její výsledek
  # jde do důvodu, kdyby model nedorazil.
  if [ "$_embed_ok" = "1" ]; then
    _emb_konec=$(( $(date +%s) + ${AISHA_EMBED_MODEL_TIMEOUT_S:?config/cold-start-timeouts.env} ))
    _emb_model=""
    _emb_stav="nezměřeno (resolver neodpověděl)"
    info "  Čekám na embedding model prostoru v1 (resolver, strop ${AISHA_EMBED_MODEL_TIMEOUT_S} s) ..."
    while [ "$(date +%s)" -lt "$_emb_konec" ]; do
      if _emb_resp="$(curl -fsS --max-time 30 -X POST \
          -H "apikey: ${SVC_TOKEN}" -H "Authorization: Bearer ${SVC_TOKEN}" -H 'content-type: application/json' \
          -d '{"p_rag_space":"v1"}' \
          "https://${API_DOMAIN_PUBLIC:-${API_DOMAIN}}/rest/v1/rpc/fn_resolve_embedding_model_for_space" 2>/dev/null)"; then
        if printf '%s' "$_emb_resp" | jq -e 'type == "array"' >/dev/null 2>&1; then
          _emb_model="$(printf '%s' "$_emb_resp" | jq -r '.[0].model_id // empty')"
          [ -n "$_emb_model" ] && break
          _emb_stav="resolver odpovídá, ale žádný dostupný embedding model s rozměrem 1024"
          if _emb_disc="$(curl -fsS --max-time 600 -X POST \
              -H "Authorization: Bearer ${SVC_TOKEN}" -H 'content-type: application/json' \
              -d '{"selfTest":false}' \
              "https://${API_DOMAIN_PUBLIC:-${API_DOMAIN}}/functions/v1/discover-models" 2>&1)"; then
            _emb_stav="${_emb_stav}; discovery vyžádána: $(printf '%s' "$_emb_disc" | jq -c '{discovered, availabilityUnmeasured, errors}' 2>/dev/null | head -c 300)"
          else
            _emb_stav="${_emb_stav}; vyžádání discovery SELHALO: $(printf '%s' "$_emb_disc" | head -c 160)"
          fi
        else
          _emb_stav="odpověď resolveru není pole ($(printf '%s' "$_emb_resp" | head -c 120))"
        fi
      fi
      sleep 30
    done
    if [ -n "$_emb_model" ]; then
      ok "  Embedding model prostoru v1: ${_emb_model}"
    else
      nedokonceno "Embed kickstart: embedding model prostoru v1 do ${AISHA_EMBED_MODEL_TIMEOUT_S} s NEDORAZIL — ${_emb_stav}. Zkontroluj svc-model (${APP_NAME_PREFIX}-svc-model: váhy, EMBED_GGUF_URL, EMBED_ALIAS) a discovery v ai-chat; RAG embeddingy NEVZNIKLY"
      _embed_ok=0
    fi
    unset _emb_konec _emb_resp _emb_stav _emb_disc
  fi
  for fn in generate-knowledge-embeddings generate-embeddings; do
    [ "$_embed_ok" = "1" ] || break
    info "  Embedding via /functions/v1/${fn} ..."
    i=0
    while [ "$i" -lt 200 ]; do
      i=$((i + 1))
      if ! resp="$(curl -fsS --max-time 60 -X POST \
        -H "Authorization: Bearer ${SVC_TOKEN}" -H 'content-type: application/json' \
        -d '{"batch_size":50}' "https://${API_DOMAIN_PUBLIC:-${API_DOMAIN}}/functions/v1/${fn}" 2>/dev/null)"; then
        nedokonceno "Embed kickstart ${fn}: HTTP chyba nebo timeout — embeddingy NEDOKONČENY"
        _embed_ok=0
        break
      fi
      # ⛔ Odpověď, která NENÍ objekt s čísly, není „nic nezbývá". Dřív
      # `jq … || echo 0` přečetlo HTML stránku se stavem 2xx jako „0 zpracováno"
      # a smyčka hlásila „drained".
      if ! printf '%s' "$resp" | jq -e 'type == "object" and (.processed | type == "number") and ((.failed // 0) | type == "number")' >/dev/null 2>&1; then
        nedokonceno "Embed kickstart ${fn}: odpověď není očekávaný JSON — zpracování NEZMĚŘENO ($(printf '%s' "$resp" | head -c 120))"
        _embed_ok=0
        break
      fi
      failed="$(printf '%s' "$resp" | jq -r '.failed // 0')"
      if [ "$failed" != "0" ]; then
        nedokonceno "Embed kickstart ${fn}: ${failed} položek se nepodařilo zaembedovat (resp: $(printf '%s' "$resp" | head -c 200))"
        _embed_ok=0
        break
      fi
      processed="$(printf '%s' "$resp" | jq -r '.processed')"
      [ "$processed" = "0" ] && break
    done
    [ "$_embed_ok" = "1" ] || break
    if [ "$processed" != "0" ]; then
      nedokonceno "Embed kickstart ${fn}: ani po ${i} dávkách nezbývá nula — fronta NEVYPRÁZDNĚNA"
      _embed_ok=0
      break
    fi
    ok "  ${fn} drained (${i} batch(es))."
  done
  [ "$_embed_ok" = "1" ] && ok "Embed kickstart complete — RAG embeddings generated for the fresh corpus."
  unset _embed_ok
fi

# ─────────────────────────────────────────────────────────────────────────────
step "6z. ÚKLID WARMUPU (hostitelské sítě jsou hotové — socket už nikdo nepotřebuje)"
# ─────────────────────────────────────────────────────────────────────────────
# Warmup aplikace (docker-compose.coolify-netinit.yml) montují docker.sock, aby
# mohly založit sítě instance. To je root-ekvivalentní přístup na hostiteli,
# takže NESMÍ zůstat stát: svou práci odvedly ve vlně 0 a od té doby jen drží
# hlídku (healthcheck = sítě existují). Tady hlídka končí a mizí i definice
# aplikace — restart validace hned pod tím pak prokáže, že na ní za běhu nic
# nezávisí a že sítě její smazání přežily.
#
# Sítě to nesmaže: warmup je vytvořil přes CLI, takže je compose nevlastní a
# `delete_connected_networks` se jich netýká (ověřeno 2026-08-11 pokusem na
# živém hostu — síť přežila smazání svého tvůrce i teardown konzumenta).
remove_warmup_apps() {
  local scoped name uuid _uuids=() _names=()
  if ! scoped=$(coolify_scoped_apps "$APP_NAME_PREFIX_RE"); then
    nedokonceno "Úklid warmupu: rozsah projektu nejde určit — ${APP_NAME_PREFIX}-netinit-* ZŮSTÁVAJÍ (montují docker.sock)"
    return 0
  fi
  while IFS=$'\t' read -r name uuid; do
    [ -z "$uuid" ] && continue
    case "$name" in "${APP_NAME_PREFIX}-netinit-"*) _names+=("$name"); _uuids+=("$uuid") ;; esac
  done <<< "$scoped"

  if [ "${#_uuids[@]}" -eq 0 ]; then
    ok "Úklid warmupu: žádná ${APP_NAME_PREFIX}-netinit-* aplikace nezbyla."
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    warn "[DRY RUN] Smazal bych ${#_uuids[@]} warmup aplikací: ${_names[*]}"
    return 0
  fi

  info "Mažu ${#_uuids[@]} warmup aplikací: ${_names[*]}"
  for uuid in "${_uuids[@]}"; do
    # ZÁMĚRNĚ BEZ `delete_volumes`: warmup žádná volumes nemá (jen socket a
    # jeden běh), takže ten příznak by nic nemazal a jen by z tohohle úklidu
    # udělal druhou "destruktivní purge" — a právě jedna taková smí existovat,
    # uvnitř wipe_orphan_apps. Nežádat o zničení tam, kde není co zničit.
    coolify_api DELETE "/applications/${uuid}?delete_configurations=true" >/dev/null 2>&1 &
  done
  wait

  # Ověřit, ne předpokládat: odeslaný DELETE není smazaná aplikace.
  local zbyva=0 i
  for i in "${!_uuids[@]}"; do
    if coolify_api GET "/applications/${_uuids[$i]}" 2>/dev/null | jq -e '.uuid' >/dev/null 2>&1; then
      warn "  ${_names[$i]} STÁLE EXISTUJE — smaž ji ručně, montuje docker.sock"
      zbyva=$((zbyva+1))
    fi
  done
  if [ "$zbyva" -eq 0 ]; then
    ok "Warmup uklizen — docker.sock už nikde nevisí."
  else
    nedokonceno "Úklid warmupu neúplný: zbývá $zbyva aplikací ${APP_NAME_PREFIX}-netinit-* (montují docker.sock)"
  fi
}
remove_warmup_apps

# ─────────────────────────────────────────────────────────────────────────────
step "6zz. RESTART VALIDACE (stack se musí umět vrátit sám)"
# ─────────────────────────────────────────────────────────────────────────────
# Čistý wipe dokazuje "od nuly to naběhne" — NEdokazuje "po restartu to naběhne
# znovu". To jsou dvě různé otázky (rodina from-zero zelené / upgrade rozbité):
# první běh mohl uspět jen díky bootstrapu, který už se nikdy nezopakuje.
# Restartujeme proto všechny aplikace po vlnách (Coolify restart, ŽÁDNÝ env-sync
# ani rebuild — měří se přesně ten stav, který poběží po příštím výpadku) a
# čekáme, až se každá sama vrátí do zdraví, včetně re-běhu wave gate kontrol.
# Běží až PO úklidu warmupů: tím se zároveň prokazuje, že hostitelské sítě
# přežily smazání svého tvůrce a že za běhu na netinit nic nezávisí.
if [ "$SKIP_DEPLOY" = "1" ] || [ "$DRY_RUN" = "1" ]; then
  warn "Restart validace skipped (--skip-deploy / --dry-run)."
else
  info "Restartuji stack po vlnách a měřím návrat do zdraví..."
  # ZÁMĚRNĚ bez $REDEPLOY_FLAGS: --skip-healthy by restart validaci vyprázdnil
  # (restartujeme právě zdravé aplikace) a skript tu kombinaci odmítá.
  # shellcheck disable=SC2086
  if (cd "$REPO_ROOT" && node scripts/aisha-redeploy.mjs --restart-validate \
      --wave-timeout="${WAVE_TIMEOUT:-${AISHA_WAVE_TIMEOUT_S:-420}}" </dev/null); then
    ok "Restart validace prošla — stack se po restartu vrací do zdraví sám."
  else
    nedokonceno "RESTART VALIDACE SELHALA — stack po restartu nekonverguje do zdraví (další výpadek by ho nepostavil)"
    err "  Diagnóza:  node scripts/aisha-redeploy.mjs --status"
    err "  Opakování: node scripts/aisha-redeploy.mjs --restart-validate"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "7. SUMMARY"
# ─────────────────────────────────────────────────────────────────────────────

# Stav aplikací TOHOTO projektu. Dřív se četl globální `/applications` (všichni
# nájemníci na hostiteli) a filtrovalo se jen prefixem jména.
COOLIFY_URL="${COOLIFY_URL:-}" COOLIFY_API_TOKEN="${COOLIFY_API_TOKEN:-}" COOLIFY_PROJECT_UUID="${COOLIFY_PROJECT_UUID:-}" \
  node "${REPO_ROOT}/scripts/lib/coolify-project-scope.mjs" --list-apps --with-status --name-re="^${APP_NAME_PREFIX}-" 2>/dev/null \
  | column -t -s $'\t' || warn "Stav aplikací projektu se nepodařilo vypsat."

# ── ZÁVĚREČNÉ MĚŘENÍ: platí to, co stojí na konci, ne mezistavy vln ─────────────
# Vlny hlásí stav V OKAMŽIKU vlny; bootstrap okno i pozdější restarty ho mění.
# Verdikt o běhu proto dává read-only verify nad tím, co nakonec běží.
if [ "$SKIP_DEPLOY" != "1" ] && [ "$DRY_RUN" != "1" ]; then
  info "Závěrečné ověření: scripts/cold-start-verify.mjs (read-only)..."
  if (cd "$REPO_ROOT" && node scripts/cold-start-verify.mjs </dev/null); then
    ok "cold-start-verify: nasazený stav odpovídá manifestu instance"
  else
    nedokonceno "cold-start-verify: nasazený stav NEODPOVÍDÁ manifestu instance — výpis výš"
  fi
fi

# Proxy na uzlech se měří MIMO podmínku nasazení: i běh se --skip-deploy musí nález
# z předletu dovést do NEDOKONČENO (kdo a kdy měří, rozhoduje overeni_proxy_na_uzlu).
overeni_proxy_na_uzlu

echo ""
# ── DRŽENÉ APLIKACE: běh je vynechal — a souhrn to říká jménem ─────────────────
# Zelený konec nesmí znamenat „nasazeno všechno“, když část stacku běh záměrně
# obešel. Držení trvá, dokud položku v overlayi instance někdo nesmaže.
if [ -n "$DRZENI_APLIKACE" ]; then
  warn "DRŽENÉ APLIKACE ($(printf '%s\n' "$DRZENI_APLIKACE" | awk 'NF { n++ } END { print n + 0 }')) — běh je NENASADIL, nerestartoval, nedoručil jim env a nesmazal je:"
  while IFS= read -r _dr_hlaska; do
    [ -n "$_dr_hlaska" ] || continue
    warn "  · ${_dr_hlaska}"
  done <<< "$(drzeni_vypis)"
  unset _dr_hlaska
  warn "  Držení se ruší smazáním položky v nasazeni-drzene.json overlaye instance; pak je dorovná: bash scripts/aisha-cold-start.sh --skip-create"
fi
if [ "${#VSTUPY_OBSLUHY[@]}" -gt 0 ]; then
  warn "CHYBÍ VSTUP OBSLUHY (${#VSTUPY_OBSLUHY[@]}) — funkce na něm závislé spadnou až za provozu:"
  for _v in "${VSTUPY_OBSLUHY[@]}"; do warn "  · ${_v}"; done
fi
if [ "${#NEDOKONCENO[@]}" -gt 0 ]; then
  err "COLD-START NEDOKONČEN — ${#NEDOKONCENO[@]} bodů (běh doběhl do konce, nic se nepřeskočilo, ale tohle NENÍ hotové):"
  for _n in "${NEDOKONCENO[@]}"; do err "  ✗ ${_n}"; done
  err "Po nápravě dorovnej: bash scripts/aisha-cold-start.sh --skip-create"
  exit 1
fi
# ⛔ NAMĚŘENO 2026-09-13: `--dry-run` končil bannerem „Cold-start dokončen — všechny
# kroky proběhly a závěrečné ověření prošlo", ač se nic nenasadilo a cold-start-verify
# výš se v dry-runu (i s --skip-deploy) VŮBEC nespouští. Banner úspěchu tvrdí ověření,
# takže smí stát jen tam, kde ověření proběhlo: pod TOUŽ podmínkou jako volání
# cold-start-verify. Běhy, které nasazení vynechaly, končí nulou a pravdivou větou.
if [ "$DRY_RUN" = "1" ]; then
  warn "DRY RUN — nic nenasazeno, nic neověřeno (kroky jen vypsaly, co by udělaly)."
  exit 0
fi
if [ "$SKIP_DEPLOY" = "1" ]; then
  warn "--skip-deploy — kroky před nasazením proběhly; nasazení, bootstrap ani závěrečné ověření NEPROBĚHLY."
  exit 0
fi
ok "Cold-start dokončen — všechny kroky proběhly a závěrečné ověření prošlo."
info "Monitor builds via:  ${COOLIFY_URL:-(set COOLIFY_URL to see your Coolify UI URL)}"
info "Verify health:       npm run check:infra"

#!/usr/bin/env bash
# ==============================================================================
# coolify-sync-envs.sh — idempotentní sync .env.coolify → Coolify API (VŠECHNY AISHA apps)
# ==============================================================================
#
# Smysl: Jediný zdroj pravdy pro secrets je `.env.coolify` (generovaný
# `scripts/aisha-cold-start.sh`). Skript pro KAŽDOU aisha-* app spočítá
# průnik (klíče v .env.coolify) ∩ (klíče referenced v jejím compose souboru)
# a přes `PATCH /applications/{uuid}/envs/bulk` ho upsertne.
#
# Per-app filtr (default):
#   - aisha-keycloak compose referencuje 4 vars → pošle 4 (ne všech 270)
#   - aisha-core compose referencuje 54 vars → pošle 54
#   - validace: hlásí MISSING (compose chce, .env.coolify nemá)
#   - app→compose mapping z coolify/manifests/aisha.manifest
#
# Idempotence:
#   - PATCH /envs/bulk je upsert pro production záznam (is_preview=false)
#   - Preview záznamy (is_preview=true) se u nových klíčů kopírují automaticky
#   - Opakované spuštění jen aktualizuje hodnoty; neexplikuje duplikáty
#
# Použití:
#   bash scripts/coolify-sync-envs.sh                    # všechny aisha-* (per-app filtr)
#   bash scripts/coolify-sync-envs.sh core web           # jen vybrané (bez prefixu)
#   DRY_RUN=1 bash scripts/coolify-sync-envs.sh          # ukáž počty per app, neodes
#   VALIDATE_ONLY=1 bash scripts/coolify-sync-envs.sh    # jen validace MISSING
#   SEND_ALL=1 bash scripts/coolify-sync-envs.sh         # legacy (vše do všeho)
#   KEYS=PKI_BRIDGE_URL bash scripts/coolify-sync-envs.sh core edge   # jen ten klíč
#   REDEPLOY=1 bash scripts/coolify-sync-envs.sh core    # po sync spustí deploy
#   PRUNE_EXTRA=1 bash scripts/coolify-sync-envs.sh core  # + odstraní proměnné,
#        na které compose NEODKAZUJE. Coolify si spravuje své: `is_coolify`
#        a `is_shared` se nikdy nedotýká. Naměřeno 2026-08-23 na `core`:
#        177 proměnných, compose jich odkazuje 99 — 76 tam leželo bez důvodu
#        a 18 z nich vypadalo jako tajemství (KEYCLOAK_ADMIN_PASSWORD na appce,
#        která Keycloak neprovozuje; SERVICE_ROLE_KEY obcházející RLS).
#        Sync do té doby jen PŘIDÁVAL — co poslaly starší verze, zůstalo.
#
# Prereq: jq, curl, `.env.coolify` v kořeni repa, `.env-prod-backup` s tokenem.
# ==============================================================================
set -euo pipefail

# ⛔ NAMĚŘENO 2026-08-26: běh cold-startu skončil hláškou „některé stacky
# nedostaly env vars", a v logu byl POSLEDNÍ řádek `<app> OK` — žádný
# souhrn, žádná appka označená za vadnou, nic. Pod `set -e` totiž shell na
# první neošetřený nenulový návrat MLČKY skončí; volající pak hlásí obecnou
# vadu a místo, kde to prasklo, je nedohledatelné. (Táž appka spuštěná
# samostatně vzápětí prošla — šlo o přechodný stav API, ne o její vadu.)
#
# Past na chybu z toho dělá NÁLEZ: řekne řádek i příkaz. Nemění chování —
# `set -e` skončí stejně — jen přestane mlčet.
trap 'rc=$?; printf "\nFATAL coolify-sync-envs.sh: řádek %s skončil s kódem %s\n  příkaz: %s\n  (pod set -e tenhle skript jinak končí BEZE SLOVA)\n" "$LINENO" "$rc" "$BASH_COMMAND" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Přepínač NENÍ jméno aplikace ──────────────────────────────────────────────
# Skript přepínače nečte: volby jdou přes prostředí (DRY_RUN=1, VALIDATE_ONLY=1,
# REDEPLOY=1, KEYS=…) a poziční argumenty jsou jména aplikací.
#
# ⛔ NÁLEZ 2026-09-23 (obhlídka forku): `--dry-run` skript nezastavil, zapisovalo
# se naostro. Mechanismus z kódu: `--dry-run` spadne do FILTER_NAMES jako jméno
# aplikace, na nic nesedne a filtr ho mlčky vynechá — `… --dry-run core` tedy
# vybere `<prefix>-core` a pošle do něj. Obsluha se ptala „smím zapisovat?",
# odpověď „ne" nedostala a zápis ano.
#
# Neznámý přepínač se proto odmítá DŘÍV, než skript cokoli přečte nebo pošle.
# Nepřekládá se ani na DRY_RUN=1: tipnutý význam je u bezpečnostní volby horší
# než žádný (neznámý bezpečnostní přepínač = fail-closed).
for _arg in "$@"; do
  case "$_arg" in
    -*)
      echo "FATAL coolify-sync-envs.sh: neznámý přepínač '$_arg' — nic jsem nečetl ani neodeslal." >&2
      echo "       Volby se zadávají prostředím, ne přepínačem:" >&2
      echo "         DRY_RUN=1 bash scripts/coolify-sync-envs.sh core      # jen ukáže, co by poslal" >&2
      echo "       Poziční argumenty jsou jména aplikací bez prefixu (core web …)." >&2
      exit 2
      ;;
  esac
done

# Úklid přebytků je VOLBA obsluhy, ne odvozenina — vypnutý, dokud ho někdo
# nezapne. Čte se z prostředí PŘÍMO přes `env`, ne dosazením výchozí hodnoty:
# dosazený literál hádá fakt o světě a ráčna `zadny-fallback-nad-identitou`
# ho právem odmítá. Tady se nic nehádá — buď je v prostředí `PRUNE_EXTRA=1`,
# nebo není, a to je celá otázka.
PRUNE_EXTRA_ZAPNUT=0
if env | grep -qx 'PRUNE_EXTRA=1'; then PRUNE_EXTRA_ZAPNUT=1; fi
# Totéž pro vypnutí zpětného čtení doručení (tajemství i povinné proměnné
# compose): volba obsluhy, čtená z prostředí přímo, bez dosazené hodnoty.
# Herestring, ne roura: `grep -q` by pod pipefail mohl skončit SIGPIPE (141).
DORUCENI_NEOVEROVAT=0
if grep -qx 'SKIP_DELIVERY_CHECK=1' <<< "$(env)"; then DORUCENI_NEOVEROVAT=1; fi
# Výchozí env soubor i záloha s tokenem podle prostředí z jednoho domova (PR2
# izolace): ne-produkční běh nečte produkční `.env.coolify` ani `.env-prod-backup`
# (staging a produkce mohou mít různé Coolify). Cold-start předává obojí výslovně.
# shellcheck source=lib/prostredi-behu.sh
. "$ROOT/scripts/lib/prostredi-behu.sh"
ENV_FILE="${ENV_FILE:-$(pb_env_soubor "$ROOT" "${AISHA_ENV:-}")}"
if pb_je_prod "${AISHA_ENV:-}"; then
  TOKEN_FILE="${TOKEN_FILE:-$ROOT/.env-prod-backup}"
else
  TOKEN_FILE="${TOKEN_FILE:-$(pb_zdroj_doplneni "$ROOT" "${AISHA_ENV:-}" "${ENV_PROD_BACKUP:-}" || true)}"
fi
COOLIFY_API="${COOLIFY_API:-}"
# ── WHICH INSTANCE does this run write to? ────────────────────────────────────
# The prefix decides that, so it is derived from the env file being synced — that
# file IS the instance — and NEVER from an ambient default.
#
# There is no fallback on purpose. `${APP_NAME_PREFIX:-aisha}` looks harmless and
# is not: several instances share one Coolify (aisha-*, tenant-*, another-tenant-* …),
# so an unexported variable silently retargets the run at somebody else's
# production. That is not hypothetical — on 2026-07-21 a run whose caller set
# AISHA_PROFILE (a DIFFERENT variable) left APP_NAME_PREFIX unset, fell back to
# "aisha", and pushed TENANT's .env.coolify into 8 aisha-* apps (103 vars into
# aisha-core alone) and queued their redeploys. The comment below this block had
# already described that exact failure once; the fix kept the fallback, so the
# hole stayed open for the case where the variable is merely absent.
#
# Unknown target = stop. A guessed target is worse than no run.
prefix_from_env_file() {
  [ -f "$ENV_FILE" ] || return 1
  grep -E '^APP_NAME_PREFIX=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- \
    | tr -d '"'"'"' \r' | tr -d '[:space:]'
}

APP_PREFIX_FROM_FILE="$(prefix_from_env_file || true)"

if [ -n "${APP_NAME_PREFIX:-}" ] && [ -n "$APP_PREFIX_FROM_FILE" ] \
   && [ "$APP_NAME_PREFIX" != "$APP_PREFIX_FROM_FILE" ]; then
  echo "FATAL: APP_NAME_PREFIX='$APP_NAME_PREFIX' but ${ENV_FILE##*/} declares '$APP_PREFIX_FROM_FILE'." >&2
  echo "       Refusing to sync — one of them targets the wrong instance and I cannot tell which." >&2
  exit 1
fi

APP_NAME_PREFIX="${APP_NAME_PREFIX:-$APP_PREFIX_FROM_FILE}"

if [ -z "${APP_NAME_PREFIX:-}" ]; then
  echo "FATAL: cannot determine APP_NAME_PREFIX — neither the environment nor ${ENV_FILE##*/} declares it." >&2
  echo "       Refusing to sync: on a shared Coolify an unknown prefix would write into another instance." >&2
  echo "       Set APP_NAME_PREFIX=<instance> or add it to ${ENV_FILE##*/}." >&2
  exit 1
fi

# Manifest default is STORY-aware: the story names the manifest, the prefix names
# the apps — on story-scoped deploys (story ≠ app-name prefix) they differ,
# and defaulting from the prefix invents a nonexistent <prefix>.manifest. Explicit
# MANIFEST_FILE (cold-start) > AISHA_STORY > prefix (legacy, story==prefix).
# ⛔ NAMĚŘENO 2026-09-03 na <fork>: cesta se tu SKLÁDALA (repo-relativní), takže
# instanci, která inventář korektně drží v privátním overlayi, tenhle skript hlásil
# „manifest not found" — a protože ho aisha-redeploy.mjs volá jako env-sync PŘED
# každým nasazením, spadla vlna 1 a nenasadilo se nic. Sdílená hranice instance
# (lib/coolify-instance-scope.mjs) zná pořadí --manifest → overlay → repo; vlastní
# kopie pravidla driftuje proti tomu, podle čeho se doopravdy nasazuje. Týž tvar,
# jaký používá aisha-cold-start.sh. Výslovný MANIFEST_FILE má dál přednost,
# dosazení zůstává jen pro případ, že by resolver nebyl k dispozici.
MANIFEST_FILE="${MANIFEST_FILE:-$(node "$ROOT/scripts/lib/coolify-instance-scope.mjs" --manifest-path 2>/dev/null \
  || echo "$ROOT/coolify/manifests/${AISHA_STORY:-$APP_NAME_PREFIX}.manifest")}"
if [ ! -f "$MANIFEST_FILE" ]; then
  echo "FATAL: manifest for instance '${APP_NAME_PREFIX}' not found: ${MANIFEST_FILE}" >&2
  echo "       Refusing to fall back to another instance's manifest." >&2
  exit 1
fi
DRY_RUN="${DRY_RUN:-0}"
REDEPLOY="${REDEPLOY:-0}"
NORMALIZE_BUILDTIME="${NORMALIZE_BUILDTIME:-1}"
# Per-app filtr: posílá jen klíče skutečně referencované v compose souboru.
# SEND_ALL=1 = legacy chování (všech 270 klíčů do každé app).
SEND_ALL="${SEND_ALL:-0}"
# VALIDATE_ONLY=1 = jen ověř dostupnost požadovaných klíčů, nešli nic.
VALIDATE_ONLY="${VALIDATE_ONLY:-0}"

source "$ROOT/scripts/lib/coolify-buildtime-envs.sh"
source "$ROOT/scripts/lib/coolify-app-vars.sh"
# shellcheck source=lib/mesh-profile.sh
source "$ROOT/scripts/lib/mesh-profile.sh"

# ── Barvy ─────────────────────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'; N='\033[0m'
info()   { echo -e "${B}ℹ${N}  $*"; }
ok()     { echo -e "${G}✅${N} $*"; }
warn()   { echo -e "${Y}⚠️${N}  $*"; }
err()    { echo -e "${R}❌${N} $*" >&2; }
banner() { echo -e "\n${C}═══ $* ═══${N}"; }

# ── Prereq ────────────────────────────────────────────────────────────────────
command -v jq >/dev/null || { err "jq není nainstalován (brew install jq)"; exit 1; }
command -v curl >/dev/null || { err "curl není nainstalován"; exit 1; }
[ -f "$ENV_FILE" ] || { err "$ENV_FILE neexistuje — spusť nejdřív scripts/aisha-cold-start.sh"; exit 1; }

# Čtení .env.coolify mimo `source` (read_env_key, parse_env_soubor) — hodnota jako v bashi.
# shellcheck source=scripts/lib/env-soubor.sh
. "$(dirname "$0")/lib/env-soubor.sh"

# Zapíná profil `mesh` (viz zajisti_mesh_profil). Čte se ze SoT, stejně jako
# payload — o tom, co aplikace dostane, rozhoduje soubor, ne náhodné prostředí.
MESH_ENABLED="$(read_env_key "MESH_ENABLED" "$ENV_FILE")"
# Deklarace dveří (profil `knock`) — týž zdroj: SoT, ne prostředí (viz zajisti_profil_dveri).
DVERE_DEKLARACE="$(read_env_key "EDGE_COMPOSE_PROFILES" "$ENV_FILE")"

COOLIFY_URL="${COOLIFY_URL:-$(read_env_key "COOLIFY_URL" "$ENV_FILE")}"
# Normalize to <host>/api/v1 — idempotent for BOTH a bare COOLIFY_URL and a
# set-but-bare COOLIFY_API (the old derive-only-when-empty guard missed the
# latter → /applications 404 → "Žádná aplikace nevyhovuje filtru").
# shellcheck source=scripts/lib/coolify-api-base.sh
source "$ROOT/scripts/lib/coolify-api-base.sh"
COOLIFY_API="$(resolve_coolify_api)" || exit 1

TOKEN="${COOLIFY_API_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$TOKEN_FILE" ]; then
  TOKEN=$(grep -E '^COOLIFY_API_TOKEN=' "$TOKEN_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '[:space:]')
fi
[ -n "$TOKEN" ] || { err "COOLIFY_API_TOKEN nenalezen (ani v env, ani v $TOKEN_FILE)"; exit 1; }

# ── Preflight: env contract validation (fail-fast on empty critical secrets) ──
# Runs aisha-env-doctor in strict report mode; exits non-zero if any critical
# secret is empty, any required `secret`/`hex` key is empty, or any external
# key is missing. Bypass with SKIP_ENV_PREFLIGHT=1 only for emergency debugging.
SKIP_ENV_PREFLIGHT="${SKIP_ENV_PREFLIGHT:-0}"
if [ "$SKIP_ENV_PREFLIGHT" != "1" ]; then
  banner "Preflight: env contract"
  if ! node "$ROOT/scripts/aisha-env-doctor.mjs" --report --strict --no-external; then
    err "Env preflight failed — fix empty/missing critical secrets in $ENV_FILE before sync"
    err "Bypass (NOT recommended): SKIP_ENV_PREFLIGHT=1 bash scripts/coolify-sync-envs.sh ..."
    exit 1
  fi
  ok "Env preflight passed"
fi

# Jména tajemství se ODVOZUJÍ z kontraktu env-doktora — `--print-contract-keys`
# tiskne `KLÍČ\tdruh` a končí PATIČKOU `__CONTRACT_END__\tPOČET`. Ta patička je
# tu podstatná: bez ní by useknutý výstup (roura, plánovač) vypadal jako kratší
# kontrakt a read-back by tiše hlídal jen část tajemství — mlčení místo měření.
# Úplnost se proto VYMÁHÁ, ne předpokládá.
SECRET_KEYS_JSON=""
if _kontrakt=$(node "$ROOT/scripts/aisha-env-doctor.mjs" --print-contract-keys 2>/dev/null); then
  _ocekavano=$(printf '%s' "$_kontrakt" | awk -F'\t' '$1=="__CONTRACT_END__"{print $2}')
  _radku=$(printf '%s' "$_kontrakt" | grep -c . || true)
  if [ -n "$_ocekavano" ] && [ "$_radku" -eq "$((_ocekavano + 1))" ]; then
    SECRET_KEYS_JSON=$(printf '%s' "$_kontrakt" \
      | awk -F'\t' '$2=="secret" || $2=="hex" {print $1}' \
      | jq -R -s 'split("\n") | map(select(length > 0))')
  else
    warn "kontrakt env-doktora dorazil NEÚPLNÝ (${_radku} řádků, čekáno ${_ocekavano:-?}+1) — doručení tajemství NEJDE ověřit, zapisované aplikace SELŽOU"
  fi
else
  warn "kontrakt env-doktora se nepodařilo přečíst — doručení tajemství NEJDE ověřit, zapisované aplikace SELŽOU"
fi

# ⛔ NAMĚŘENO 2026-08-24 při wipu: Coolify pod náporem (33 paralelních DELETE
# + naše dotazy) odpovídá HTTP 429 a vrací HTML chybovou stránku. `jq` na ní
# skončí `parse error: Invalid numeric literal`, seznam aplikací vyjde prázdný
# a celý cold-start se přeruší hláškou „některé stacky nedostaly env vars" —
# tedy příčina (rate limit) se převlékne za úplně jinou vadu.
#
# Rozpočet na opakování musí odpovídat tomu, jak dlouho limit trvá: 3×2 s
# nestačilo, limit odezněl řádově v minutách. `--retry-all-errors` pokrývá
# i 429; delší prodleva je to podstatné.
API() {
  curl -sS --http1.1 --max-time 45 --connect-timeout 10 \
    --retry 6 --retry-delay 10 --retry-all-errors --retry-connrefused \
    -H "Authorization: Bearer $TOKEN" "$@"
}

bulk_response_ok() {
  jq -e '(type=="array" and length>0 and .[0].uuid) or (.data? | type=="array")' >/dev/null 2>&1
}

bulk_response_count() {
  jq -r 'if type=="array" then length else (.data|length) end' 2>/dev/null || echo "?"
}

# Je odpověď VŮBEC odpovědí téhle služby? Tělo, které není JSON, není chyba
# API — je to cizí stránka (přihlášení, 502 od proxy, výpadek uprostřed).
je_json() { jq -e . >/dev/null 2>&1; }

# ⛔ NAMĚŘENO 2026-08-26 dvakrát: Coolify vrátil `HTTP 200` a v těle SVOU HTML
# stránku (`<!DOCTYPE html><html data-theme="dark"`). `curl --retry-all-errors`
# na tom nemá co opakovat — z jeho pohledu požadavek USPĚL; teprve kontrola
# o vrstvu výš zjistila, že to není JSON, a to už byl tvrdý FAIL, který
# přerušil celý cold-start.
#
# Stavový kód tedy NESTAČÍ: opakovat se musí podle TVARU odpovědi. A rozlišují
# se dva různé nezdary, protože si žádají opačné chování:
#   · platný JSON, který není úspěch → SKUTEČNÁ chyba API (např. 422). Opakovat
#     ji je zbytečné a jen zdrží — vrací se hned.
#   · tělo, které není JSON → služba vůbec neodpověděla na tuhle otázku.
#     To je přechodné, a jedině tady má opakování smysl.
# Kolik pokusů má smysl. Deklarováno TADY, na jednom pojmenovaném místě —
# dosazený literál přímo ve výrazu je vymyšlená hodnota bez domova a račna
# `zadny-fallback-nad-identitou` ho právem odmítá. Řetěz deklarací je v pořádku.
BULK_RETRIES_VYCHOZI=5

API_BULK() {
  local payload="$1" url="$2" pokus=0 odpoved=""
  local strop="${COOLIFY_BULK_RETRIES:-${BULK_RETRIES_VYCHOZI}}"
  while :; do
    odpoved=$(API -X PATCH -H "Content-Type: application/json" -d "$payload" "$url" | tr -d '\000-\037' || true)
    # ⛔ PRÁZDNÉ TĚLO SE KLASIFIKUJE VÝSLOVNĚ, ne přes `jq`.
    #
    # NAMĚŘENO 2026-08-27: brána na tuhle funkci prošla lokálně a v CI SPADLA —
    # `jq -e` vrací na prázdný vstup 4 (žádný platný výsledek), jenže to je
    # chování ZÁVISLÉ NA VERZI a na tom, jestli `jq` vůbec v obrazu je. Nechat
    # rozhodnutí „je tohle odpověď?" na cizím nástroji znamená, že se produkční
    # větvení mění s obrazem CI. Prázdno je odpověď na nic — patří k opakování,
    # a musíme to říct MY, ne jq.
    if [ -z "$odpoved" ]; then
      pokus=$((pokus + 1))
      if [ "$pokus" -ge "$strop" ]; then break; fi
      echo -e "\n      ${Y}↻${N}  prázdná odpověď (pokus $pokus/$strop) — čekám $((pokus * 10))s" >&2
      sleep $((pokus * 10))
      continue
    fi
    if printf '%s' "$odpoved" | bulk_response_ok; then
      printf '%s' "$odpoved"; return 0
    fi
    if printf '%s' "$odpoved" | je_json; then
      printf '%s' "$odpoved"; return 1   # API odpovědělo a odmítlo — neopakovat
    fi
    pokus=$((pokus + 1))
    if [ "$pokus" -ge "$strop" ]; then break; fi
    echo -e "\n      ${Y}↻${N}  odpověď není JSON (pokus $pokus/$strop) — čekám $((pokus * 10))s" >&2
    sleep $((pokus * 10))
  done
  printf '%s' "$odpoved"
  return 1
}

bulk_response_error() {
  local response
  response=$(cat)
  echo "$response" | jq -c '.message // .error // .' 2>/dev/null || echo "$response" | head -c 200
}

# ── Parse .env.coolify → „KLÍČ<TAB>hodnota" (hodnoty jako po `source`, viz lib/env-soubor.sh) ──
parse_env_file() {
  parse_env_soubor "$ENV_FILE"
}

# Resolved and validated at the top of this file, fail-closed. Deliberately no
# `:-` default here: see the block next to MANIFEST_FILE.
PREFIX="$APP_NAME_PREFIX"

# ── Získat seznam apps (name + uuid) ──────────────────────────────────────────
#
# ROZSAH DOTAZU JE BEZPEČNOST I VÝKON, ne detail.
#
# `GET /applications` vrací aplikace VŠECH nájemníků toho Coolify. Naměřeno
# 2026-08-10: 6 367 265 B / 5,6 s pro 168 aplikací šesti nájemníků — a při zátěži
# to překročilo `--max-time 45`, spadlo v půli přenosu (2,1 MB) a ZASTAVILO wipe
# až PO destrukci, takže zůstaly vytvořené, ale prázdné a nenasazené aplikace.
#
# Dotaz omezený na náš projekt vrací totéž, co potřebujeme (uuid + name):
#   /projects/{uuid}/{env}   1 150 195 B / 1,9 s / 27 aplikací
# tedy o 82 % méně dat a o 66 % rychleji. A hlavně to NEROSTE s každým dalším
# nájemníkem na hostu — zvýšit timeout by práh jen posunulo.
#
# Bezpečnostní půlka: cizí konfigurace vůbec nestahujeme. Co nemáme, nemůžeme
# omylem zalogovat ani vystavit — týž princip jako odpojení pki-db od sdílené sítě.
#
# Ověřeno, že jinudy to nejde: `?project_uuid=` Coolify IGNORUJE (vrátí stejných
# 6,4 MB) a `/projects/{uuid}/applications` neexistuje (404).
banner "Discover ${PREFIX} apps"
COOLIFY_PROJECT_UUID="${COOLIFY_PROJECT_UUID:-}"
if [ -z "$COOLIFY_PROJECT_UUID" ] && [ -f "$TOKEN_FILE" ]; then
  COOLIFY_PROJECT_UUID=$(grep -E '^COOLIFY_PROJECT_UUID=' "$TOKEN_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '[:space:]')
fi
COOLIFY_ENVIRONMENT="${COOLIFY_ENVIRONMENT:-production}"

# „Které aplikace jsou naše" má JEDEN domov — sdílený s doktorem. Dřív to tenhle
# skript odpovídal sám (podle projektu) a doktor jinak (podle prefixu jména), a
# ten rozdíl vydal cizí aplikaci za náš nejhorší případ. Viz lib/coolify-our-apps.sh.
# shellcheck source=lib/coolify-our-apps.sh
. "$ROOT/scripts/lib/coolify-our-apps.sh"
ALL_APPS=$(COOLIFY_PROJECT_UUID="$COOLIFY_PROJECT_UUID" COOLIFY_ENVIRONMENT="$COOLIFY_ENVIRONMENT" \
  coolify_our_applications "$COOLIFY_API" "$TOKEN") || ALL_APPS=""
if [ -z "$ALL_APPS" ]; then
  # Prázdná odpověď se nesmí tvářit jako „projekt nemá aplikace" a tiše přeskočit
  # sync (feedback_tool_failure_read_as_data) — hlásí se a sáhne po celém výpisu.
  warn "seznam našich aplikací se nezjistil — padám zpět na /applications (pomalejší, stáhne i cizí nájemníky)"
fi
[ -n "$ALL_APPS" ] || ALL_APPS=$(API "$COOLIFY_API/applications" | tr -d '\000-\037')
FILTER_NAMES=("$@")

if [ ${#FILTER_NAMES[@]} -gt 0 ]; then
  # Filtr: přesný match na aisha-<arg>
  SELECTED=$(echo "$ALL_APPS" | jq -r --arg prefix "$PREFIX" --argjson names "$(printf '%s\n' "${FILTER_NAMES[@]}" | jq -R . | jq -sc '.')" '
    .[] | select(.name as $n | $names | map($prefix+"-"+.) | index($n)) | "\(.name)\t\(.uuid)"
  ')
else
  SELECTED=$(echo "$ALL_APPS" | jq -r --arg prefix "$PREFIX" '.[] | select(.name | startswith($prefix+"-")) | "\(.name)\t\(.uuid)"')
fi

[ -n "$SELECTED" ] || { err "Žádná aplikace nevyhovuje filtru"; exit 1; }

APP_COUNT=$(echo "$SELECTED" | wc -l | tr -d ' ')
info "Nalezeno $APP_COUNT apps:"
echo "$SELECTED" | awk -F'\t' '{ printf "   %-24s %s\n", $1, $2 }'

# ── Sestav bulk payload (jednou pro všechny apps) ─────────────────────────────
banner "Parse $ENV_FILE"
ENV_PAIRS=$(parse_env_file)
KEY_COUNT=$(echo "$ENV_PAIRS" | wc -l | tr -d ' ')
info "Nalezeno $KEY_COUNT proměnných v $ENV_FILE"

# ⛔ NEROZBALENÝ ODKAZ V HODNOTĚ SE NEROZNÁŠÍ (naměřeno 2026-09-15). Poškozená
# kopie SoT nesla 74 řádků tvaru `KLIC=${KLIC:-}` — šablona, kterou nikdo
# nerozbalil — a sync je poslal do Coolify jako doslovné hodnoty. Coolify je
# pak dosadil do compose a služby dostaly místo tajemství text `${…}`.
# SoT je výsledek generátorů, ne šablona: hodnota s `${` v něm nemá co dělat.
NEROZBALENE=$(echo "$ENV_PAIRS" | awk '{ v = substr($0, index($0, "\t") + 1); if (index(v, "${")) print substr($0, 1, index($0, "\t") - 1) }')
if [ -n "$NEROZBALENE" ]; then
  err "$ENV_FILE nese nerozbalený odkaz \${…} v $(echo "$NEROZBALENE" | wc -l | tr -d ' ') hodnotách — sync by je poslal do Coolify jako doslovný text:"
  echo "$NEROZBALENE" | head -20 | sed 's/^/      /' >&2
  err "Sync zastaven. SoT je poškozený nebo nevygenerovaný — obnov ho ze zálohy (.backup/) nebo spusť generátor (aisha-cold-start)."
  exit 1
fi

# Plainý payload (všech klíčů) — použitý v SEND_ALL režimu nebo jako základ pro per-app filtr
BULK_PAYLOAD=$(echo "$ENV_PAIRS" | jq -Rs '
  split("\n") | map(select(length>0) | split("\t")) | map({key: .[0], value: .[1]}) | {data: .}
')

# ⛔ BEZ ROURY (naměřeno 2026-09-23): `echo "$ENV_PAIRS" | awk '…{exit}'` pod
# `set -o pipefail` náhodně končil kódem 141 (SIGPIPE) — awk po nálezu zavřel
# rouru dřív, než echo dopsalo payload větší než její buffer. Selhání záviselo
# na velikosti payloadu a pozici klíče, takže padal jen někdy a jen u části
# aplikací (registry, keycloak, observability). Here-string rouru nemá.
# Kolokační vstupy pro přepis PKI_BRIDGE_URL čti ze STEJNÉHO souboru jako
# payload — ne z prostředí volajícího. Sync spuštěný ručně (mimo cold-start)
# by jinak měl prázdné vstupy a tiše by přepis vynechal: deklarace bez plniče.
if [ -z "${PKI_COLOCATED_SLOTS:-}" ]; then
  PKI_COLOCATED_SLOTS=$(awk -F'\t' '$1=="PKI_COLOCATED_SLOTS"{print $2; exit}' <<<"$ENV_PAIRS")
fi
if [ -z "${PKI_BRIDGE_URL_COLOCATED:-}" ]; then
  PKI_BRIDGE_URL_COLOCATED=$(awk -F'\t' '$1=="PKI_BRIDGE_URL_COLOCATED"{print $2; exit}' <<<"$ENV_PAIRS")
fi
# KEYS="A B C" — zúží payload na vyjmenované klíče (napříč per-app i SEND_ALL).
#
# Proč: .env.coolify NENÍ jediný zapisovatel do Coolify env. Část hodnot tam
# doplňují bootstrap skripty ze živých systémů (aisha-bootstrap-user-init.sh
# vytáhne AISHA_PKI_ISSUER_CLIENT_SECRET z Keycloaku a PATCHne ho na pki; env-doctor
# u těchto klíčů drží jen náhodnou výplň, aby byly smluvně pokryté). Plný sync
# takovou hodnotu přepíše výplní a rozbije právě to, co fungovalo.
#
# Když se tedy opravuje JEDEN driftlý klíč, musí jít poslat jen on. Bez toho zbývá
# buď plný sync (přepíše bootstrapem vlastněné hodnoty), nebo jednorázový skript
# mimo pipeline — obojí je horší než filtr.
if [ -n "${KEYS:-}" ]; then
  KEYS_JSON=$(printf '%s' "$KEYS" | tr ', ' '\n\n' | awk 'NF' | jq -R . | jq -sc '.')
  BULK_PAYLOAD=$(echo "$BULK_PAYLOAD" | jq -c --argjson keep "$KEYS_JSON" \
    '{data: [.data[] | select(.key as $k | $keep | index($k))]}')
  FOUND=$(echo "$BULK_PAYLOAD" | jq -r '.data | length')
  WANTED=$(echo "$KEYS_JSON" | jq -r 'length')
  if [ "$FOUND" -ne "$WANTED" ]; then
    err "KEYS žádá $WANTED klíčů, ale v $ENV_FILE jich je $FOUND — překlep by tiše neposlal nic"
    echo "$BULK_PAYLOAD" | jq -r '.data[].key' | sed 's/^/      nalezeno: /' >&2
    exit 1
  fi
  warn "KEYS aktivní — posílám jen: $(echo "$BULK_PAYLOAD" | jq -r '[.data[].key] | join(", ")')"
fi

SENT_KEYS=$(echo "$BULK_PAYLOAD" | jq -r '.data | length')
info "Payload obsahuje $SENT_KEYS klíčů (celý .env.coolify)"

# ── Per-app filter setup ─────────────────────────────────────────────────────
if [ "$SEND_ALL" = "1" ]; then
  warn "SEND_ALL=1 — legacy režim, všech $SENT_KEYS klíčů do každé app"
else
  if [ ! -f "$MANIFEST_FILE" ]; then
    err "Manifest nenalezen: $MANIFEST_FILE (nutný pro per-app filtr; SEND_ALL=1 pro legacy)"
    exit 1
  fi
  load_app_compose_map "$MANIFEST_FILE"
  info "Per-app filtr aktivní (manifest: ${MANIFEST_FILE#$ROOT/}, ${#APP_NAMES[@]} apps mapováno)"

  # Umístění má dva zapisovatele (manifest = kam se nasadí, profil = jakou
  # adresu dostane) a tady jsou poprvé pohromadě. Rozpor se projeví až
  # o tři kroky dál u někoho třetího — viz assert_placement_agrees().
  # Sync je poslední místo PŘED zápisem do Coolify, takže se tu končí.
  if ! assert_placement_agrees; then
    err "Sync zastaven: umístění služeb si odporuje (výpis výše)."
    exit 1
  fi
fi

# Vytvoř lookup soubor pro rýchle filtrování klíčů (jeden klíč na řádek)
ENV_KEYS_FILE=$(mktemp -t coolify-env-keys.XXXXXX)
echo "$ENV_PAIRS" | awk -F'\t' 'NF>0 {print $1}' > "$ENV_KEYS_FILE"
trap 'rm -f "$ENV_KEYS_FILE"' EXIT

# ── Seznamy klíčů se řadí i porovnávají JEDNOU kolací: bajtovou ──────────────
# `comm` předpokládá, že oba vstupy jsou seřazené TOUŽ kolací, jakou sám
# porovnává — a `sort` i `comm` ji berou z locale procesu. Seznam povinných
# proměnných ale řadí YAML extraktor v Node (`.sort()` = pořadí kódových bodů,
# tedy bajtově), kdežto `sort` pod en_US.UTF-8 staví `_` před písmena
# (APP_NAME_PREFIX < APPNAME; v C obráceně). Pořadí obou stran se rozejdou,
# comm ztratí synchronizaci a jako MISSING hlásí klíče, které v souboru JSOU.
#
# ⛔ NAMĚŘENO 2026-09-26 na skutečném .env.coolify (748 klíčů), validace MISSING:
# pod LC_ALL=en_US.UTF-8 12 falešných MISSING (mj. POSTGRES_PASSWORD,
# APP_NAME_PREFIX), pod LC_ALL=C 0. Znovu týž den nad jiným souborem (794 klíčů,
# povinné proměnné všech docker-compose.coolify*.yml): en_US.UTF-8 → 14 MISSING,
# z toho 9 falešných; C → 5 skutečných; s klice_comm 5 pod OBĚMA locale.
# Locale je vlastnost TERMINÁLU obsluhy, ne instance — výsledek validace na něm
# záviset nesmí.
#
# Proto se obě strany seřadí A porovnají tady, pod LC_ALL=C: pořadí, v jakém
# je volající podá, ani locale, které zdědil, nerozhoduje. Jiná cesta ke comm
# v tomhle skriptu nevede (brána src/tests/gates/sync-envs-kolace-klicu.gate.test.ts).
#   klice_comm <volby comm> <soubor A> <soubor B>   (jeden klíč na řádek)
klice_comm() {
  LC_ALL=C comm "$1" <(awk 'NF' "$2" | LC_ALL=C sort -u) <(awk 'NF' "$3" | LC_ALL=C sort -u)
}

build_app_payload() {
  # Vratí JSON {data: [...]} obsahující jen klíče použité v compose
  # i pomocný výpis: validace_výsledek na stderr
  local app_short="$1"
  local compose_file
  if ! compose_file=$(resolve_compose_for_app "$app_short"); then
    echo "VALIDATION_NO_MAP" >&2
    return 1
  fi
  local compose_path="$ROOT/$compose_file"
  if [ ! -f "$compose_path" ]; then
    echo "VALIDATION_NO_COMPOSE: $compose_file" >&2
    return 1
  fi
  local payload_vars req_vars compose_refs
  # Selže-li YAML extraktor, aplikace se NAHLÁSÍ a nedostane nic. Uvnitř
  # `{ …; } | sort -u` by se jeho nenulový návrat ztratil a prázdný seznam
  # referencí by prošel jako „compose nic nepotřebuje" — sync by poslal nulu
  # klíčů a hlásil OK.
  if ! compose_refs=$(extract_compose_vars "$compose_path") \
     || ! req_vars=$(extract_required_compose_vars "$compose_path"); then
    echo "VALIDATION_NO_REFS: $compose_file" >&2
    return 1
  fi
  # union: compose ${VAR} reference + ARG deklarace z build Dockerfiles
  # (build-arg konzumace není v compose textu videt — viz coolify-app-vars.sh)
  # + klíče BuildKit secretů (`secrets: <id>: environment: KLIC`).
  # ⛔ NAMĚŘENO 2026-09-13: čtvrtý zdroj chyběl. `environment: GIT_TOKEN`
  # není `${…}` reference, takže ho filtr nepustil — core ho dostával jen
  # náhodou (runtime `GIT_TOKEN: ${GIT_TOKEN:-}` u jiné služby téhož
  # compose), keycloak a extranet vůbec. Secret pak byl při buildu prázdný
  # a klon privátního overlaye selhal (nebo se téma tiše nepřevzalo). Příznak
  # build-time dostat nesmí — to hlídá coolify_normalize_buildtime_envs.
  payload_vars=$({ printf '%s\n' "$compose_refs"; extract_dockerfile_arg_vars "$compose_path"; extract_realm_template_vars "$compose_path"; coolify_buildkit_secret_keys "$compose_path"; } | awk 'NF' | sort -u)
  local req_count missing_count
  req_count=$(echo "$req_vars" | grep -c . || true)
  # missing = required \ available
  local missing
  missing=$(klice_comm -23 <(printf '%s\n' "$req_vars") "$ENV_KEYS_FILE" || true)
  missing_count=$(echo "$missing" | grep -c . || true)
  echo "VALIDATION:req=$req_count missing=$missing_count" >&2
  if [ "$missing_count" -gt 0 ]; then
    echo "$missing" | sed 's/^/      MISSING: /' >&2
  fi
  # intersect vars
  local present
  present=$(klice_comm -12 <(printf '%s\n' "$payload_vars") "$ENV_KEYS_FILE")
  # filtruj BULK_PAYLOAD na present klíče
  local payload
  payload=$(echo "$BULK_PAYLOAD" | jq -c --argjson keys "$(echo "$present" | jq -R . | jq -sc '.')" '
    {data: [.data[] | select(.key as $k | $keys | index($k))]}
  ')

  # ── Kolokační přepis PKI_BRIDGE_URL ─────────────────────────────────────────
  # Kolokace je vlastnost DVOJICE (konzument, pki), ne světa. Globální hodnota
  # nese bezpečný cross-host tvar (Traefik direct — bootstrapová výjimka pro
  # skok na jiný host, dokud mesh nestojí). Aplikace na slotu, který bydlí
  # s pki (PKI_COLOCATED_SLOTS z resolveru), ale nemá co posílat interní
  # provoz přes Traefik — dostane přímý hop po warmup síti.
  #
  # ⛔ NAMĚŘENO 2026-08-13: jedna globální hodnota rozhodnutá podle netbirdu
  # poslala kolokovanému core https na kontejner, kde 443 nikdo neposlouchá
  # (most má jen http:3040; TLS je až na Traefiku) → pki-init 600 s marně,
  # exit 1, vlna 2 stála. http://<ip>:3040 → 200 + 3 certifikáty, změřeno.
  if [ -n "${PKI_COLOCATED_SLOTS:-}" ] && [ -n "${PKI_BRIDGE_URL_COLOCATED:-}" ]; then
    local app_slot
    if app_slot=$(resolve_slot_for_app "$app_short") && [ -n "$app_slot" ]; then
      case ",${PKI_COLOCATED_SLOTS}," in
        *",${app_slot},"*)
          payload=$(echo "$payload" | jq -c --arg url "$PKI_BRIDGE_URL_COLOCATED" '
            {data: [.data[] | if .key == "PKI_BRIDGE_URL" then .value = $url else . end]}
          ')
          echo "PKI_BRIDGE_URL→colocated (slot=${app_slot})" >&2
          ;;
      esac
    fi
  fi
  echo "$payload"
}

# ── DOSTANE COMPOSE, BEZ ČEHO SPADNE? ──────────────────────────────────────
#
# ⛔ NAMĚŘENO 2026-09-13: `Deploy: Core` spadl na `${MESH_DNS_NETWORK:?}` —
# hodnota ležela v .env.coolify, do aplikace ji nikdo nedoručil. Přes flotilu
# 20 z 32 aplikací, 8 klíčů, všechno `${X:?}`, všechno „příští nasazení spadne".
#
# Read-back níž dosud hlídal jen TAJEMSTVÍ z kontraktu env-doktora. Povinné
# proměnné compose — tedy přesně to, na čem nasazení padá — nehlídal nikdo:
# MISSING výš je jen varování nad SOUBOREM, ne měření APLIKACE.
#
# Měří se stav aplikace PO zápisu (to, co compose při nasazení uvidí), ne
# .env.coolify: klíč může na aplikaci ležet z dřívějška, nebo tam naopak chybět,
# i když ho soubor má. Odpověď dává jediný domov té otázky,
# scripts/lib/povinne-promenne.mjs. Hodnoty nevypisuje, jen jména.
#
# Návrat: 0 doručeno · 1 nedoručeno (vypsáno) · 2 NEMĚŘENO (vypsáno).
over_povinne_na_aplikaci() {
  local envs_json="$1" compose_path="$2" app_short="$3" vystup rc=0
  vystup=$(printf '%s' "$envs_json" \
    | node "$ROOT/scripts/lib/povinne-promenne.mjs" --compose "$compose_path" --coolify-envs - \
        --app "$app_short" --sot "$ENV_FILE" 2>&1) || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) echo -e "      ${R}✗${N}  COMPOSE PŘI NASAZENÍ SPADNE — aplikaci chybí povinné proměnné:"
       printf '%s\n' "$vystup" | sed 's/^/         /'
       return 1 ;;
    *) echo -e "      ${R}✗${N}  DORUČENÍ POVINNÝCH NEZMĚŘENO — nejistota o doručení je STOP, ne varování:"
       printf '%s\n' "$vystup" | sed 's/^/         /'
       return 2 ;;
  esac
}

# ── PROFIL MESH DRŽÍ I VLNOVÁ ROVINA ───────────────────────────────────────
#
# ⛔ NAMĚŘENO 2026-09-13 na nasazeném forku: `COMPOSE_PROFILES` neměla ani jedna
# ze 34 aplikací. Zapisoval ho jen coolify-deploy-init.sh (cold-start), tenhle
# sync — jediné, co běží před KAŽDÝM vlnovým nasazením — ho nehlídal, a úklid
# PRUNE_EXTRA ho mazal. První redeploy core naběhl bez `netbird-agent`
# a `core-mesh-ingress` → edge `no route to host` → veřejné API 502.
#
# Profil se SLUČUJE s tím, co aplikace už má (edge/matrix/domain-services si
# nesou vlastní), zvlášť pro production i preview záznam, a ověří se zpětným
# čtením. Aplikace, jejíž compose mesh profil nedeklaruje, zůstane nedotčená.
#
# Návrat: 0 drží / nebylo co · 1 nepodařilo se (vypsáno).
zajisti_mesh_profil() {
  local uuid="$1" compose_path="$2" envs pv cur next resp role
  [ "$MESH_ENABLED" = "true" ] || return 0
  compose_ma_mesh_profil "$compose_path" || return 0
  envs=$(API -H "Accept: application/json" "$COOLIFY_API/applications/$uuid/envs" 2>/dev/null | tr -d '\000-\037' || echo "")
  if ! echo "$envs" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo -e "      ${R}✗${N}  profil mesh NEOVĚŘEN — envy aplikace nečitelné"
    return 1
  fi
  for pv in false true; do
    role=production; [ "$pv" = "true" ] && role=preview
    cur=$(echo "$envs" | jq -r --argjson pv "$pv" \
      '[ .[] | select(.key == "COMPOSE_PROFILES" and ((.is_preview // false) == $pv)) | .value ] | first // ""')
    next=$(mesh_profile_merge "$cur")
    [ "$cur" = "$next" ] && continue
    if [ "$DRY_RUN" = "1" ]; then
      echo -e "      ${B}DRY${N} COMPOSE_PROFILES ($role): '${cur}' → '${next}'"
      continue
    fi
    resp=$(API_BULK "$(jq -nc --arg v "$next" --argjson pv "$pv" \
      '{data: [{key: "COMPOSE_PROFILES", value: $v, is_preview: $pv}]}')" \
      "$COOLIFY_API/applications/$uuid/envs/bulk" || true)
    if ! echo "$resp" | bulk_response_ok; then
      echo -e "      ${R}✗${N}  COMPOSE_PROFILES ($role) se nepodařilo zapsat — mesh sidecary by při nasazení nenaběhly"
      return 1
    fi
    echo -e "      ${G}⊕${N}  COMPOSE_PROFILES ($role): '${cur}' → '${next}'"
  done
  [ "$DRY_RUN" = "1" ] && return 0
  envs=$(API -H "Accept: application/json" "$COOLIFY_API/applications/$uuid/envs" 2>/dev/null | tr -d '\000-\037' || echo "")
  # Envy jdou do jq rourou, NE přes --argjson: nesou hodnoty tajemství a argv
  # vidí každý `ps` na stroji.
  if ! echo "$envs" | jq -e '
      . as $e | [false, true] | all(. as $pv | $e
        | any(.[]; .key == "COMPOSE_PROFILES" and ((.is_preview // false) == $pv)
                   and ((.value // "") | split(",") | index("mesh"))))' >/dev/null 2>&1; then
    echo -e "      ${R}✗${N}  profil mesh po zápisu CHYBÍ — Coolify zápis nepřevzal"
    return 1
  fi
  return 0
}

# ── PROFIL DVEŘÍ DRŽÍ DEKLARACE, NE TO, CO NA APLIKACI ZBYLO ─────────────────
#
# ⛔ NAMĚŘENO 2026-09-15 (rozbor dveří): profil `knock` zapisoval jen deploy-init
# při cold-startu, a to podle ROSTERU. Vlnová rovina (tenhle sync před každým
# redeployem) ho nehlídala vůbec, takže Coolify držel, co tam kdo kdy nechal:
# instance, která deklaraci změnila, nasazovala dál starý stav dveří — zapnuté
# dveře bez deklarace, nebo deklarované bez profilu.
#
# Tvar zajisti_mesh_profil: production i preview záznam, SLOUČENÍ s ostatními
# profily (profil_sluc/profil_bez z lib/mesh-profile.sh), ověření zpětným čtením.
# Rozdíl je jediný: dveře se srovnávají OBĚMA směry — deklarace je jediná
# autorita, takže nedeklarovaný `knock` se odebere. Deklarované dveře se před
# zápisem ověří (lib/dvere-soulad.mjs --soulad): v rozporu (režim ↔ roster,
# port) by svc-knock nenaběhl a stáhl s sebou edge.
#
# Návrat: 0 drží / nebylo co · 1 nepodařilo se nebo rozpor (vypsáno).
zajisti_profil_dveri() {
  local uuid="$1" compose_path="$2" envs pv cur next resp role chce="ne" vystup
  compose_ma_profil_dveri "$compose_path" || return 0
  case ",${DVERE_DEKLARACE}," in *,knock,*) chce="ano" ;; esac
  if [ "$chce" = "ano" ]; then
    if ! vystup=$(node "$ROOT/scripts/lib/dvere-soulad.mjs" --soulad --env-file "$ENV_FILE" 2>&1); then
      echo -e "      ${R}✗${N}  dveře deklarované, ale NE v souladu — profil knock se nezapíše:"
      printf '%s\n' "$vystup" | sed 's/^/         /'
      return 1
    fi
  fi
  envs=$(API -H "Accept: application/json" "$COOLIFY_API/applications/$uuid/envs" 2>/dev/null | tr -d '\000-\037' || echo "")
  if ! echo "$envs" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo -e "      ${R}✗${N}  profil dveří NEOVĚŘEN — envy aplikace nečitelné"
    return 1
  fi
  for pv in false true; do
    role=production; [ "$pv" = "true" ] && role=preview
    cur=$(echo "$envs" | jq -r --argjson pv "$pv" \
      '[ .[] | select(.key == "COMPOSE_PROFILES" and ((.is_preview // false) == $pv)) | .value ] | first // ""')
    if [ "$chce" = "ano" ]; then next=$(profil_sluc "$cur" knock); else next=$(profil_bez "$cur" knock); fi
    [ "$cur" = "$next" ] && continue
    if [ "$DRY_RUN" = "1" ]; then
      echo -e "      ${B}DRY${N} COMPOSE_PROFILES ($role): '${cur}' → '${next}' (dveře)"
      continue
    fi
    resp=$(API_BULK "$(jq -nc --arg v "$next" --argjson pv "$pv" \
      '{data: [{key: "COMPOSE_PROFILES", value: $v, is_preview: $pv}]}')" \
      "$COOLIFY_API/applications/$uuid/envs/bulk" || true)
    if ! echo "$resp" | bulk_response_ok; then
      echo -e "      ${R}✗${N}  COMPOSE_PROFILES ($role) se nepodařilo zapsat — dveře by se nasadily podle starého profilu"
      return 1
    fi
    echo -e "      ${G}⊕${N}  COMPOSE_PROFILES ($role): '${cur}' → '${next}' (dveře)"
  done
  [ "$DRY_RUN" = "1" ] && return 0
  envs=$(API -H "Accept: application/json" "$COOLIFY_API/applications/$uuid/envs" 2>/dev/null | tr -d '\000-\037' || echo "")
  if ! echo "$envs" | jq -e --arg chce "$chce" '
      . as $e | [false, true] | all(. as $pv | $e
        | [ .[] | select(.key == "COMPOSE_PROFILES" and ((.is_preview // false) == $pv))
                | ((.value // "") | split(",") | index("knock")) != null ]
        | if $chce == "ano" then any else (any | not) end)' >/dev/null 2>&1; then
    echo -e "      ${R}✗${N}  profil dveří po zápisu NESEDÍ s deklarací — Coolify zápis nepřevzal"
    return 1
  fi
  return 0
}

if [ "$DRY_RUN" = "1" ]; then
  warn "DRY_RUN=1 — neodesílám, jen vypíšu plnou statistiku per-app:"
fi

# ── Sync do každé app ─────────────────────────────────────────────────────────
banner "Sync"
FAILED=()
for line in $SELECTED; do :; done  # noop: keep shellcheck happy

while IFS=$'\t' read -r NAME UUID; do
  [ -z "$NAME" ] && continue
  printf "   %-24s " "$NAME"

  # Sestav per-app payload (nebo plný BULK_PAYLOAD při SEND_ALL=1)
  # Strip the story prefix (e.g. acme-core → core) so the discovered app name
  # maps to its manifest role. Hardcoding "aisha-" left fork/story names
  # (acme-core) unstripped → the role lookup missed → VALIDATION_NO_MAP for all.
  APP_SHORT="${NAME#${PREFIX}-}"
  if [ "$SEND_ALL" = "1" ]; then
    APP_PAYLOAD="$BULK_PAYLOAD"
    APP_SENT="$SENT_KEYS"
  else
    VAL_OUT=$(mktemp -t coolify-val.XXXXXX)
    APP_PAYLOAD=$(build_app_payload "$APP_SHORT" 2>"$VAL_OUT" || echo "")
    if [ -z "$APP_PAYLOAD" ]; then
      # Two different situations, and only one of them is our problem.
      #
      # NO_MAP  — the app exists in Coolify but the manifest does not declare it.
      #           The manifest is the source of truth for what this deployment
      #           MANAGES, so an undeclared app is out of scope: we hold no
      #           compose for it and must not invent env for it. Warn and skip.
      #           Failing here let a single stray app (an orphan left over from
      #           an earlier run, or one preserved through a wipe) abort the whole
      #           cold-start with "deploy s missing secrets" — about an app the
      #           deployment does not even own.
      # NO_COMPOSE — the manifest DOES declare it but the file is gone. That is a
      #           real inconsistency in this repo and must stay fatal.
      if grep -q '^VALIDATION_NO_MAP' "$VAL_OUT"; then
        # "Není v mapě" odpovídá na DVĚ různé otázky: (a) tuhle app tahle
        # instalace nevlastní, (b) vlastní ji, ale lane není zapnutá — protože
        # load_app_compose_map() gatované služby z mapy vyhazuje. Hlásit (a)
        # místo (b) je nepravda, která navíc SCHOVÁ běžící app, které se env
        # nikdy neposílá. Přesně tenhle případ pojmenovává komentář
        # u _unprovisioned_services() (<fork>-potok / <fork>-local-ingest, 2026-07-21),
        # a manifest_declares_app() na ten rozdíl v knihovně UŽ existuje —
        # jen se nevolala. Měřeno 2026-07-28: <fork>-potok BĚŽÍ, v manifestu je,
        # a sync o něm hlásil, že do téhle instalace nepatří.
        if manifest_declares_app "$MANIFEST_FILE" "$APP_SHORT"; then
          echo -e "${Y}SKIP${N} (v manifestu JE, ale lane není zapnutá — env se nesynchronizuje; app přitom může běžet)"
        else
          echo -e "${Y}SKIP${N} (není v manifestu — mimo rozsah této instalace)"
        fi
        rm -f "$VAL_OUT"
        continue
      fi
      if grep -q '^VALIDATION_NO_REFS' "$VAL_OUT"; then
        echo -e "${R}FAIL${N} (compose nejde přečíst YAML parserem — nevím, co mu doručit)"
      else
        echo -e "${R}FAIL${N} (v manifestu, ale chybí compose soubor)"
      fi
      cat "$VAL_OUT" | sed 's/^/      /'
      rm -f "$VAL_OUT"
      FAILED+=("$NAME")
      continue
    fi
    APP_SENT=$(echo "$APP_PAYLOAD" | jq -r '.data | length')
    VAL_LINE=$(grep '^VALIDATION:' "$VAL_OUT" | head -1)
    MISSING_LINES=$(grep '^      MISSING:' "$VAL_OUT" || true)
    rm -f "$VAL_OUT"
  fi

  if [ "$VALIDATE_ONLY" = "1" ]; then
    if [ -n "$MISSING_LINES" ]; then
      echo -e "${Y}MISSING${N} ($APP_SENT klíčů nalezeno; viz níže)"
      echo "$MISSING_LINES"
    else
      echo -e "${G}OK${N}  ($APP_SENT klíčů, vše dostupné)"
    fi
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo -e "${B}DRY${N} ($APP_SENT klíčů by se odeslalo)"
    if [ -n "$MISSING_LINES" ]; then echo "$MISSING_LINES"; fi
    continue
  fi

  if [ "$APP_SENT" -eq 0 ]; then
    echo -e "${G}OK${N}  (0 odesláno → žádné compose env vars v $ENV_FILE)"
    # Nula odeslaných neznamená, že compose nic nepotřebuje — jen že soubor nic
    # z toho nemá. Co aplikace skutečně drží, se změří stejně jako po zápisu.
    if [ "$SEND_ALL" != "1" ] && _compose=$(resolve_compose_for_app "$APP_SHORT"); then
      # Profil mesh i bez jediného klíče z payloadu — sidecary na něm visí tak jako tak.
      zajisti_mesh_profil "$UUID" "$ROOT/$_compose" || FAILED+=("$NAME")
      zajisti_profil_dveri "$UUID" "$ROOT/$_compose" || FAILED+=("$NAME")
      if [ "$DORUCENI_NEOVEROVAT" != "1" ]; then
        RB0=$(API -H "Accept: application/json" "$COOLIFY_API/applications/$UUID/envs" 2>/dev/null | tr -d '\000-\037' || echo "")
        over_povinne_na_aplikaci "$RB0" "$ROOT/$_compose" "$APP_SHORT" || FAILED+=("$NAME")
      fi
    fi
    if [ "$NORMALIZE_BUILDTIME" = "1" ]; then
      if ! coolify_normalize_buildtime_envs "$COOLIFY_API" "$TOKEN" "$UUID" "$NAME" "$DRY_RUN"; then
        FAILED+=("$NAME")
      fi
    fi
    continue
  fi

  # Zjisti existující production keys PŘED syncem (pro přesný new/update diff).
  BEFORE_ENVS=$(API "$COOLIFY_API/applications/$UUID/envs" | tr -d '\000-\037' || echo "[]")
  NEW_KEYS="?"
  CHANGED_KEYS="?"
  if echo "$BEFORE_ENVS" | jq -e 'type == "array"' >/dev/null 2>&1; then
    APP_KEYS=$(echo "$APP_PAYLOAD" | jq -r '.data[].key' | sort -u)
    BEFORE_KEYS=$(echo "$BEFORE_ENVS" | jq -r '.[] | select((.is_preview // false) == false) | .key' | sort -u)
    NEW_KEYS=$(klice_comm -13 <(printf '%s\n' "$BEFORE_KEYS") <(printf '%s\n' "$APP_KEYS") | grep -c . || true)
    CHANGED_KEYS=$((APP_SENT - NEW_KEYS))
  fi

  # Coolify v4 datový model vytváří per-key DUPLICATE záznam (production +
  # preview, oba s is_buildtime=true). Bez explicitního is_preview flag PATCH
  # /envs/bulk update jen production. Při docker compose up Coolify generuje
  # `.env` ze VŠECH záznamů (preview wins on duplicate key) → preview záznam
  # se starou hodnotou contaminuje deploy. Fix: posíláme každý klíč 2× —
  # production (is_preview=false) + preview (is_preview=true). Tím obě entries
  # mají stejnou hodnotu.
  PROD_PAYLOAD=$(echo "$APP_PAYLOAD" | jq '{data: [.data[] | . + {is_preview: false}]}')
  PREVIEW_PAYLOAD=$(echo "$APP_PAYLOAD" | jq '{data: [.data[] | . + {is_preview: true}]}')

  PROD_RESP=$(API_BULK "$PROD_PAYLOAD" "$COOLIFY_API/applications/$UUID/envs/bulk" || true)
  PREVIEW_RESP=$(API_BULK "$PREVIEW_PAYLOAD" "$COOLIFY_API/applications/$UUID/envs/bulk" || true)
  # Úspěch = pole s .uuid v prvním prvku (nebo JSON object s data polem).
  if echo "$PROD_RESP" | bulk_response_ok && echo "$PREVIEW_RESP" | bulk_response_ok; then
    PROD_COUNT=$(echo "$PROD_RESP" | bulk_response_count)
    PREVIEW_COUNT=$(echo "$PREVIEW_RESP" | bulk_response_count)
    if [[ "$NEW_KEYS" =~ ^[0-9]+$ ]] && [[ "$CHANGED_KEYS" =~ ^[0-9]+$ ]]; then
      if [ "$NEW_KEYS" -gt 0 ]; then
        echo -e "${G}OK${N}  ($APP_SENT odesláno, production $PROD_COUNT + preview $PREVIEW_COUNT potvrzeno, ${G}+${NEW_KEYS} nových${N}, ${CHANGED_KEYS} aktualizováno)"
      else
        echo -e "${G}OK${N}  ($APP_SENT odesláno, production $PROD_COUNT + preview $PREVIEW_COUNT potvrzeno, ${CHANGED_KEYS} aktualizováno, 0 nových)"
      fi
    else
      echo -e "${G}OK${N}  ($APP_SENT odesláno, production $PROD_COUNT + preview $PREVIEW_COUNT potvrzeno)"
    fi
    if [ -n "${MISSING_LINES:-}" ]; then
      echo -e "      ${Y}⚠${N}  $(echo "$MISSING_LINES" | wc -l | tr -d ' ') chybějících klíčů (compose je referencuje, .env.coolify ne)"
    fi

    # Profil mesh PŘED zpětným čtením níž: úklid PRUNE_EXTRA pak vidí stav,
    # který nasazení opravdu dostane.
    if [ "$SEND_ALL" != "1" ] && _compose=$(resolve_compose_for_app "$APP_SHORT"); then
      zajisti_mesh_profil "$UUID" "$ROOT/$_compose" || FAILED+=("$NAME")
      zajisti_profil_dveri "$UUID" "$ROOT/$_compose" || FAILED+=("$NAME")
    fi

    # ── DORUČENÍ SE OVĚŘUJE ZPĚTNÝM ČTENÍM ──────────────────────────────────
    #
    # ⛔ MEZERA NALEZENÁ 2026-08-16: preflight (`aisha-env-doctor --strict`)
    # ověřuje LOKÁLNÍ `.env.coolify`. Že hodnota opravdu DORAZILA do Coolify,
    # neověřoval nikdo — odpověď `bulk` potvrdí jen počet záznamů, ne obsah.
    # Částečně selhaný sync tak prošel jako zelený a chytil ho až compose svým
    # `${VAR:?}` při parsování, tedy nástroj na úplně jiném stanovišti.
    #
    # Doktor hlídá SOUBOR, tenhle read-back hlídá DORUČENÍ. Teprve když je
    # obojí, jde `${VAR:?}` z compose odebrat — a s ním i zapékání tajemství
    # do metadat obrazu (build arg).
    #
    # Co se ověřuje, se ODVOZUJE z kontraktu env-doktora (druh `secret`),
    # ne z vypsaného seznamu: nový secret se pohlídá sám.
    if [ "$DRY_RUN" != "1" ] && [ "$DORUCENI_NEOVEROVAT" != "1" ]; then
      # ⛔ NAMĚŘENO 2026-09-02 V PROVOZU: tenhle řádek SHODIL CELÉ NASAZENÍ.
      #
      # Skript běží pod `set -euo pipefail`. `RB=$(roura)` je PROSTÝ PŘÍKAZ
      # s návratovým kódem té roury, takže `set -e` ho zabije DŘÍV, než se
      # vůbec vyhodnotí `if` pod ním. Tolerantní větev „doručení NEOVĚŘENO"
      # tedy byla NEDOSAŽITELNÝ KÓD od chvíle, co ji někdo napsal — ošetření
      # křehčí než porucha, kterou ošetřuje.
      #
      # Skutečný běh: Coolify po zápisu 366 proměnných odpovídal >60 s, curl
      # skončil kódem 28 a celý sync umřel na FATAL. Vlna 3 pak neprovedla
      # ANI JEDNO nasazení. Sesterská čtení na ř. 583 a 681 pojistku `|| echo`
      # mají; tohle bylo jediné bez ní.
      #
      # ⚠️ POJISTKA JE PRÁZDNÝ ŘETĚZEC, NE `[]`. Prázdné pole je PLATNÉ pole:
      # prošlo by testem `type == "array"`, seznam prázdných tajemství by vyšel
      # prázdný a nepřečtený read-back by se vydával za ověřené doručení.
      # Mlčení nástroje se nesmí dát odlišit od nálezu jen tím, co dosadíme.
      #
      # A čte se přes `API`, ne syrovým curlem: pomocník nese opakování
      # (`--retry 6 --retry-delay 10`), takže pomalá odpověď je ČEKÁNÍ, ne pád.
      RB=$(API -H "Accept: application/json" \
        "$COOLIFY_API/applications/$UUID/envs" 2>/dev/null | tr -d '\000-\037' || echo "")
      if ! echo "$RB" | jq -e 'type == "array"' >/dev/null 2>&1; then
        # Mlčení nástroje NENÍ důkaz doručení — a nejistota o doručení tajemství
        # je STOP, ne varování. Dřív se tu jen varovalo a nasazení pokračovalo;
        # tím se „nevím" tvářilo stejně jako „v pořádku", což je přesně ta
        # záměna, kvůli které tenhle read-back vznikl.
        echo -e "      ${R}✗${N}  DORUČENÍ NEOVĚŘENO — envy se ani po opakování nepodařilo přečíst"
        echo "         To NENÍ totéž jako v pořádku: zápis mohl projít celý, částečně, nebo vůbec."
        FAILED+=("$NAME")
      else
        # Tajemství z kontraktu. Bez kontraktu (env-doktor ho nevydal celý) se
        # tahle půlka NEMĚŘÍ — a řekne se to; povinné proměnné níž běží i tak.
        PRAZDNA=""
        if [ -n "${SECRET_KEYS_JSON:-}" ]; then
          PRAZDNA=$(echo "$RB" | jq -r --argjson tj "$SECRET_KEYS_JSON" '
            [ .[] | select((.is_preview // false) == false)
                  | select(.key | IN($tj[]))
                  | select((.value // "") == "") | .key ] | unique | join(", ")')
        else
          # Nejistota o doručení tajemství je STOP, ne varování (týž princip jako
          # u nečitelného read-backu výš): bez kontraktu nevím, co zkontrolovat.
          echo -e "      ${R}✗${N}  kontrakt tajemství nečitelný (env-doktor --print-contract-keys) — doručení tajemství NEOVĚŘENO"
          FAILED+=("$NAME")
        fi
        # ── CO TAM NEMÁ CO DĚLAT ──────────────────────────────────────────
        #
        # ⛔ NAMĚŘENO 2026-08-23 na `core`: 177 proměnných, z toho compose
        # odkazuje 99. Zbylých 78 (5 602 B) tam leželo bez důvodu — a 18 z nich
        # vypadalo jako tajemství, mj. KEYCLOAK_ADMIN_PASSWORD na aplikaci, která
        # Keycloak neprovozuje, a SERVICE_ROLE_KEY (klíč obcházející RLS).
        #
        # PŘÍČINA: per-app filtr určuje, co se POŠLE, ale sync nikdy nic NEODEBRAL.
        # Co poslaly starší, volnější verze, zůstalo napořád. Celá mašinérie —
        # brány, env-doctor, cold-start — se přitom ptá „nechybí něco?"; otázku
        # „není tam něco navíc?" nekladl NIKDO.
        #
        # ⚠️ COOLIFY SI SPRAVUJE SVÉ: `is_coolify` ani `is_shared` se NIKDY
        # nedotýkáme. Naměřeno na `core`: 0 sdílených, 3 coolify — ty zůstávají.
        # ⚠️ SEZNAM „CO NECHAT" JE PAYLOAD, NE `.env.coolify`. První verze brala
        # ENV_KEYS_FILE, tedy VŠECHNY dostupné klíče instance — a odstranila 11
        # ze 76, protože zbytek v tom širokém seznamu byl. Rozhoduje to, co se
        # téhle APLIKACI posílá, ne co existuje ve světě.
        # ⚠️ KLÍČE, KTERÉ ČTE DOCKER COMPOSE SÁM (`COMPOSE_PROFILES`), compose
        # nikdy neodkazuje jako `${…}`, takže v payloadu nejsou — a úklid je
        # smazat NESMÍ. Naměřeno 2026-09-13: bez profilu naběhlo core bez mesh
        # sidecarů a veřejné API vracelo 502 (lib/mesh-profile.sh).
        if [ "$PRUNE_EXTRA_ZAPNUT" = "1" ] && [ -n "$APP_PAYLOAD" ]; then
          NAVIC=$(echo "$RB" | jq -r --argjson keep "$(echo "$APP_PAYLOAD" | jq -c \
              --arg ridici "$MESH_PROFILE_RIDICI_KLICE_COMPOSE" '[.data[].key] + ($ridici | split(" "))')" '
            [ .[] | select((.is_preview // false) == false)
                  | select((.is_coolify // false) == false)
                  | select((.is_shared  // false) == false)
                  | select((.key | IN($keep[])) | not)
                  | { key, uuid } ] | .[] | .key + "\t" + .uuid' 2>/dev/null)
          POCET=0
          POCET=$(printf '%s' "$NAVIC" | grep -c . || true)
          if [ "$POCET" -gt 0 ]; then
            echo -e "      ${Y}⌫${N}  odstraňuji $POCET proměnných, na které compose neodkazuje"
            while IFS=$'\t' read -r kkey kuuid; do
              [ -n "$kuuid" ] || continue
              curl -sS --http1.1 --max-time 30 --connect-timeout 10 -o /dev/null \
                -X DELETE -H "Authorization: Bearer ${TOKEN}" \
                "$COOLIFY_API/applications/$UUID/envs/$kuuid" 2>/dev/null || \
                echo -e "      ${Y}⚠${N}  $kkey se nepodařilo odstranit (zůstává)"
            done <<< "$NAVIC"
          fi
        fi

        if [ -n "$PRAZDNA" ]; then
          echo -e "      ${R}✗${N}  DORUČENO PRÁZDNÉ: $PRAZDNA"
          echo "         Preflight prošel nad .env.coolify, ale do Coolify to nedorazilo."
          FAILED+=("$NAME")
        fi
        if [ "$SEND_ALL" != "1" ] && _compose=$(resolve_compose_for_app "$APP_SHORT"); then
          over_povinne_na_aplikaci "$RB" "$ROOT/$_compose" "$APP_SHORT" || FAILED+=("$NAME")
        fi
      fi
    fi
    if [ "$NORMALIZE_BUILDTIME" = "1" ]; then
      if ! coolify_normalize_buildtime_envs "$COOLIFY_API" "$TOKEN" "$UUID" "$NAME" "$DRY_RUN"; then
        FAILED+=("$NAME")
      fi
    fi
  else
    echo -e "${R}FAIL${N}"
    if ! echo "$PROD_RESP" | bulk_response_ok; then
      if echo "$PROD_RESP" | je_json; then
        echo "      production: $(echo "$PROD_RESP" | bulk_response_error)"
      else
        echo "      production: odpověď NENÍ JSON ani po opakování — Coolify vrátil cizí tělo"
        echo "         (typicky vlastní HTML stránka se stavem 200; zvýšit COOLIFY_BULK_RETRIES)"
      fi
    fi
    if ! echo "$PREVIEW_RESP" | bulk_response_ok; then
      echo "      preview: $(echo "$PREVIEW_RESP" | bulk_response_error)"
    fi
    FAILED+=("$NAME")
  fi
done <<< "$SELECTED"

# ── Redeploy (volitelné) ──────────────────────────────────────────────────────
if [ "$REDEPLOY" = "1" ]; then
  banner "Redeploy"
  while IFS=$'\t' read -r NAME UUID; do
    [ -z "$NAME" ] && continue
    printf "   %-24s " "$NAME"
    # Aplikace, jejíž sync SELHAL, se nenasazuje: s nedoručenou povinnou
    # proměnnou compose spadne jistě, a s nedoručeným tajemstvím by naběhla
    # na prázdné hodnotě. Pád tady je levnější než nasazení, které to zjistí.
    if [[ " ${FAILED[*]:-} " == *" $NAME "* ]]; then
      echo -e "${R}NENASAZENO${N} (sync výš selhal — viz jeho výpis)"
      continue
    fi
    RESP=$(API -X POST "$COOLIFY_API/deploy?uuid=$UUID&force=true" | tr -d '\000-\037' || true)
    DUUID=$(echo "$RESP" | jq -r '.deployments[0].deployment_uuid // empty' 2>/dev/null)
    if [ -n "$DUUID" ]; then
      echo -e "${G}queued${N} $DUUID"
    else
      echo -e "${Y}?${N} $(echo "$RESP" | head -c 120)"
    fi
  done <<< "$SELECTED"
fi

# ── Souhrn ────────────────────────────────────────────────────────────────────
banner "Souhrn"
if [ ${#FAILED[@]} -eq 0 ]; then
  if [ "$SEND_ALL" = "1" ]; then
    ok "Všech $APP_COUNT apps zesynchronizováno (legacy SEND_ALL: $SENT_KEYS klíčů každé)"
  else
    ok "Všech $APP_COUNT apps zesynchronizováno (per-app filtr aktivní)"
  fi
else
  # Jedna aplikace může selhat víc kontrolami (tajemství i povinné) — jméno jednou.
  warn "Selhaly: $(printf '%s\n' "${FAILED[@]}" | awk '!videno[$0]++' | tr '\n' ' ')"
  exit 1
fi

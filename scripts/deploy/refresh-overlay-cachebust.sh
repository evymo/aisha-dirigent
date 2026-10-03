#!/usr/bin/env bash
# =============================================================================
# refresh-overlay-cachebust.sh — aby na cestě nasazení nezáleželo
# =============================================================================
# Obnoví `*_CACHEBUST` na Coolify aplikaci PŘED tím, než se spustí build, který
# klonuje overlay repo.
#
# PROČ TO EXISTUJE
# BuildKit kešuje vrstvu podle TEXTU příkazu. Text `git clone` se mezi
# nasazeními nemění, takže klon proběhne jednou a pak už nikdy — obraz veze
# obsah overlay repa ze dne prvního buildu, build přitom projde zeleně.
# Proti tomu stojí `*_CACHEBUST`: SHA vzdálené větve, které se do textu příkazu
# propíše a keš tím rozbije právě tehdy, když se overlay změnil.
#
# Tuhle obnovu uměl jen `aisha-redeploy.mjs` (a při studeném startu
# `aisha-cold-start.sh`). Kdo nasadil jinak — CI workflow `deploy.yml`,
# `scripts/ci/deploy-and-verify.sh`, nebo ruční `GET /api/v1/deploy` — sestavil
# obraz se ZASTARALÝM overlayem a nasazení zezelenalo.
#
# Naměřeno 2026-08-31 na `<fork>`: `AISHA_WEB_DESIGN_CACHEBUST` stálo na
# 88844ca, zatímco designové repo bylo na 73cf68a. Paleta značky se opravovala
# opakovaně v repu, do obrazu se ale nikdy nedostala a v DB zůstávala stará
# barva. Brána `overlay-clone-cachebust` to nechytí — ta hlídá, že hodnota není
# PRÁZDNÁ, a zastaralá hodnota projde stejně dobře jako správná.
#
# Kontrola tvaru se dá udělat staticky v CI; kontrola AKTUÁLNOSTI vyžaduje
# porovnání s vnějším světem (`git ls-remote`), a proto musí běžet při nasazení.
#
# Použití:
#   COOLIFY_API_TOKEN=… scripts/deploy/refresh-overlay-cachebust.sh <app-uuid> <stack>
#
# Argumenty:
#   $1  UUID Coolify aplikace
#   $2  krátký název stacku (core | keycloak | extranet); ostatní = no-op
#
# Prostředí:
#   COOLIFY_API_TOKEN  povinné
#   COOLIFY_BASE_URL   povinné (adresa Coolify — NEHÁDÁ se)
#
# Návratové kódy:
#   0  DOKÁZÁNO: cachebust obnoven, beze změny, nebo overlay pro stack není deklarovaný
#   1  chyba zadání (chybí UUID/token/adresa)
#   3  NEDOKÁZÁNO: overlay je (nebo může být) deklarovaný a cachebust se NEOBNOVIL
#      — HEAD nečitelný, zápis selhal, nebo envy aplikace nečitelné. Build vezme
#      overlay z KEŠE.
#
# FAIL-SOFT, ALE NAHLAS: když se HEAD nepodaří přečíst nebo zápis selže,
# nasazení se nezastaví — ale řekne se, CO to znamená, ne jen že něco selhalo.
# Zastavit deploy kvůli nedostupnému overlay repu by bylo horší než nasadit
# starý overlay; tichý starý overlay je ale to nejhorší ze všech tří.
#
# ⛔ „NAHLAS" MUSÍ BÝT I V NÁVRATOVÉM KÓDU, ne jen ve warningu. NAMĚŘENO
# 2026-09-24 (CI běh 51874, <fork> main 3e0886282): deploy joby neměly FORGEJO_TOKEN,
# `git ls-remote` soukromého overlay repa selhal, skript vypsal warning — a skončil
# 0, protože smyčka běžela v rouře (podskořepina) a každý neúspěch byl jen
# `continue`. Volající (`deploy-and-verify.sh`) to podle kódu 0 shrnul jako
# „PROVEDENO" a core i extranet se postavily z KEŠOVANÉHO overlaye. Warning v logu
# nikdo nečte; souhrn ano. Proto kód 3 a smyčka bez roury.
# =============================================================================
set -euo pipefail

UUID="${1:-}"
STACK="${2:-}"
BASE_URL="${COOLIFY_BASE_URL:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$UUID" ] || [ -z "$STACK" ]; then
  echo "refresh-overlay-cachebust: chybí argumenty — použití: $0 <app-uuid> <stack>" >&2
  exit 1
fi
if [ -z "${COOLIFY_API_TOKEN:-}" ]; then
  echo "refresh-overlay-cachebust: COOLIFY_API_TOKEN není nastaven — cachebust NELZE obnovit" >&2
  exit 1
fi
# ⛔ ŽÁDNÝ DOSAZENÝ LITERÁL. Adresa Coolify je fakt o světě, ne výchozí hodnota:
# dosazená by tiše mířila na JINOU instalaci a cachebust by se zapsal někam
# jinam — nasazení by přitom prošlo zeleně. Chybějící hodnota musí selhat tady,
# ne projevit se později jako starý overlay bez souvislosti s příčinou.
if [ -z "$BASE_URL" ]; then
  echo "refresh-overlay-cachebust: COOLIFY_BASE_URL není nastaven — adresu Coolify NEHÁDÁM" >&2
  exit 1
fi

# Tabulka overlayů. Zdroj pravdy je stejný jako v `aisha-redeploy.mjs`
# (OVERLAY_CACHEBUSTS) — když sem přibude rodina, musí přibýt i tam.
# Formát: <stack>|<bustKey>|<urlKey>|<refKey nebo prázdno>|<popis>
OVERLAYS="
core|AISHA_WEB_DESIGN_CACHEBUST|AISHA_WEB_DESIGN_GIT_URL||designový overlay webu
keycloak|KC_THEME_OVERLAY_CACHEBUST|KC_THEME_OVERLAY_GIT_URL|KC_THEME_OVERLAY_REF|téma přihlašovací stránky
extranet|SURFACE_OVERLAY_CACHEBUST|SURFACE_OVERLAY_GIT_URL|SURFACE_OVERLAY_REF|instanční overlay povrchů
source-broker|SOURCE_ADAPTER_OVERLAY_CACHEBUST|SOURCE_ADAPTER_OVERLAY_GIT_URL|SOURCE_ADAPTER_OVERLAY_REF|zdrojové adaptéry z instančního overlaye
"

ENVS_JSON=""
_load_envs() {
  [ -n "$ENVS_JSON" ] && return 0
  ENVS_JSON=$(curl -sS --max-time 30 -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
    "${BASE_URL}/api/v1/applications/${UUID}/envs" 2>/dev/null || true)
  if [ -z "$ENVS_JSON" ]; then
    echo "::warning::refresh-overlay-cachebust: envy aplikace se nepodařilo přečíst — overlay se považuje za nedeklarovaný a cachebust se NEDOPLNÍ" >&2
    return 1
  fi
}

_env_value() {   # $1 = klíč → hodnota na stdout (prázdno když není)
  printf '%s' "$ENVS_JSON" | python3 -c '
import sys, json
key = sys.argv[1]
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
rows = d if isinstance(d, list) else d.get("data", [])
for e in rows:
    # is_preview sada je druhá kopie téhož klíče; build produkce bere tu první.
    if e.get("key") == key and not e.get("is_preview"):
        print(e.get("value") or "")
        break
' "$1" 2>/dev/null || true
}

# Smyčka BEZ roury (here-string): v rouře by běžela v podskořepině a NEDOKAZANO
# by se za `done` ztratilo — přesně tak dřív každý neúspěch skončil kódem 0.
NEDOKAZANO=""
while IFS='|' read -r st bust url_key ref_key what; do
  [ -z "$st" ] && continue
  [ "$st" = "$STACK" ] || continue

  # Envy nečitelné = nevíme, jestli je overlay deklarovaný. To NENÍ „není co
  # obnovovat" — je to nezměřeno.
  if ! _load_envs; then NEDOKAZANO="${NEDOKAZANO} ${bust}(envy)"; continue; fi

  URL="$(_env_value "$url_key")"
  if [ -z "$URL" ]; then
    # Overlay pro tuhle instanci nedeklarovaný — komunitní instalace bez
    # instančního designu. Není co obnovovat a není to chyba.
    echo "refresh-overlay-cachebust: ${url_key} nenastaveno → ${what} se neklonuje, přeskakuji"
    continue
  fi

  REF=""
  [ -n "$ref_key" ] && REF="$(_env_value "$ref_key")"

  # Odvozená URL overlaye je bez tokenu (jde do build ARGu). Token pro čtení HEAD
  # je tentýž, který build dostává secretem — z prostředí, jinak z appky.
  TOKEN="${FORGEJO_TOKEN:-$(_env_value FORGEJO_TOKEN)}"
  # stderr pomocníka NEzahazovat: nese důvod od gitu (token maskovaný) — `2>/dev/null` ho schoval (2026-09-25).
  if ! SHA="$(FORGEJO_TOKEN="$TOKEN" sh "${HERE}/overlay-cachebust.sh" "$URL" "$REF")"; then
    echo "::warning::${bust}: HEAD overlay repa se nepodařilo přečíst — build '${STACK}' použije KEŠOVANÝ klon a nasadí ${what} v podobě z prvního buildu" >&2
    NEDOKAZANO="${NEDOKAZANO} ${bust}(HEAD)"
    continue
  fi
  SHA="$(printf '%s' "$SHA" | tr -d '[:space:]')"
  # Prázdné se nikdy nezapisuje: Dockerfile na prázdné hodnotě schválně padá,
  # takže bychom si nasazení shodili vlastní opravou.
  if [ -z "$SHA" ]; then NEDOKAZANO="${NEDOKAZANO} ${bust}(prázdný HEAD)"; continue; fi

  CUR="$(_env_value "$bust")"
  if [ "$SHA" = "$CUR" ]; then
    echo "refresh-overlay-cachebust: ${bust} beze změny (${SHA%"${SHA#??????????}"}…) → keš smí zůstat"
    continue
  fi

  # PATCH v Coolify jen PŘEPISUJE; nad neexistujícím klíčem vrací 404. Klíč,
  # který na aplikaci nikdy nebyl, se proto musí nejdřív ZALOŽIT přes POST.
  WROTE=""
  for METHOD in PATCH POST; do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 \
      -X "$METHOD" "${BASE_URL}/api/v1/applications/${UUID}/envs" \
      -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"${bust}\",\"value\":\"${SHA}\",\"is_preview\":false}" 2>/dev/null || :)
      # `|| :` nikoli `|| echo 000`: echo by se PŘIPSALO k tomu, co curl už
      # stihl vypsat, takže „000" by ve skutečnosti mohlo být „500000" a
      # číselné porovnání níž by na tom tiše selhalo. Prázdný CODE = neúspěch,
      # protože `[ "" -ge 200 ]` neprojde. Hlídá brána
      # `curl-http-code-capture-integrity`.
    if [ "$CODE" -ge 200 ] 2>/dev/null && [ "$CODE" -lt 300 ] 2>/dev/null; then WROTE="$METHOD"; break; fi
  done

  if [ -z "$WROTE" ]; then
    echo "::warning::${bust}: zápis na Coolify aplikaci selhal — build '${STACK}' použije KEŠOVANÝ klon a nasadí ${what} v podobě z prvního buildu" >&2
    NEDOKAZANO="${NEDOKAZANO} ${bust}(zápis)"
    continue
  fi
  echo "refresh-overlay-cachebust: ${bust}=${SHA%"${SHA#############}"}… zapsáno ($WROTE, ${what})"
done <<< "$OVERLAYS"

if [ -n "$NEDOKAZANO" ]; then
  echo "refresh-overlay-cachebust: NEDOKÁZÁNO pro '${STACK}':${NEDOKAZANO} — build vezme overlay z keše" >&2
  exit 3
fi

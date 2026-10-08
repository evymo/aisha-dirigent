#!/usr/bin/env bash
# ============================================================================
# Nasadit a DOKÁZAT to. Jeden krok pro všechny deploy úlohy.
#
# PROČ VZNIKL (naměřeno 2026-08-08)
# ---------------------------------
# Po merge do mainu byly všechny deploy úlohy ZELENÉ — a extranet přesto
# servíroval bajtově týž bundle jako před opravou. Nasadil se až ručně
# spuštěným `aisha-redeploy.mjs`.
#
# Horší než ta jedna vada je, že se z té úlohy NEDÁ ZJISTIT, co se stalo:
# končila `exit 0` ve třech různých situacích —
#   1. chybí COOLIFY_API_TOKEN        → warning, zeleno, nenasazeno
#   2. appka v Coolify nenalezena     → warning, zeleno, nenasazeno
#   3. POST /api/v1/deploy vrátil 2xx → zeleno, ale to je jen PŘIJETÍ požadavku;
#                                        build mohl doběhnout, spadnout, nebo
#                                        běžet ještě dlouho po konci úlohy
# Barva úlohy tedy nenesla ŽÁDNOU informaci o cíli. Sama si to ostatně napsala
# do warningu: „Měřidlo je tag běžícího obrazu, NIKDY barva téhle úlohy."
# Tenhle skript tu větu bere vážně a to měřidlo do CI doplňuje.
#
# CO SE ZMĚNILO
# -------------
#   • chybějící pověření = PÁD. Deploy úloha, která nemá čím nasadit, není
#     „přeskočená" — je to rozbitá pipeline a musí být vidět. Tiché zeleno
#     znamená, že se měsíce nenasazuje a nikdo o tom neví.
#   • po spuštění se ČEKÁ na terminální stav přes `coolify-deploy-watch.mjs
#     --wait --wait-healthy --strict` (nástroj, který v repu už byl a CI ho
#     nepoužívalo) — zeleno tedy znamená „deploy doběhl a appka je zdravá".
#   • skript NAHLAS říká, co dokázal a co NE (viz závěrečný výpis). Sonda,
#     která mlčí o hranicích svého měření, svádí k přeceňování.
#
# CO SE OVĚŘUJE A ČÍM (přepsáno 2026-08-11)
# -----------------------------------------
# TVRDÝ důkaz je REVIZE: záznam nasazení v Coolify nese `commit`, takže se dá
# zjistit, jestli se postavila právě ta revize, kterou úloha nasazuje — a to
# UVNITŘ, bez dotýkání veřejné adresy. Nesedí-li, krok PADÁ.
#
# `--verify-url` je DOPLNĚK, ne brána. Do 2026-08-11 padal, když se otisk
# nezměnil, a to tvrzení je nepravdivé ve třech situacích:
#   1. změna, která do artefaktu nezasahuje (merge jen do CI nebo testů);
#   2. ostré dveře (SPA knock) — odpověď vrátného je před i po stejná, takže
#      měřidlo tiše měří DVEŘE místo artefaktu;
#   3. fetch z CI je APLIKACE, KTERÁ ŤUKÁ — proti pravidlu „ťuká jen člověk".
# Nově se v odpovědi HLEDÁ revize zapečená v artefaktu (`__GIT_SHA__`, #175):
# najde-li se, je to nejsilnější možný důkaz; nenajde-li, NEDOKAZUJE to opak.
#
# Použití:
#   deploy-and-verify.sh <suffix> [--optional] [--verify-url <url>] [--timeout-s N]
#     <suffix>        část jména appky za prefixem instance (core, extranet, web…)
#     --optional      appka nemusí v Coolify existovat (nenalezena = přeskočit,
#                     ne spadnout). Pro appky, které si instance nemusí zapnout.
#     --verify-url    veřejná URL — DOPLŇKOVÝ důkaz (hledá se v ní revize);
#                     neodpověď ani shodný otisk NEJSOU pád
#     --health-url    veřejná URL, která po nasazení musí vrátit 2xx/3xx
#                     (nebo proměnná prostředí HEALTH_URL)
#     --health-za-dvermi ano|ne — POVINNÉ, když je HEALTH_URL. Stojí-li povrch
#                     za dveřmi, je 403 s prázdným tělem podpis vrátného, tedy
#                     „NEMĚŘENO", ne pád. Neodvozuje se z odpovědi a nemá
#                     výchozí hodnotu (nebo prostředí HEALTH_ZA_DVERMI)
#     --timeout-s     strop PRÁCE nasazení — běží až od opuštění fronty Coolify (default 1800)
#     --fronta-s      strop čekání ve FRONTĚ Coolify, stav `queued` (default 1800)
# ============================================================================
set -uo pipefail

SUFFIX="${1:-}"
if [ -z "$SUFFIX" ]; then
  echo "::error title=deploy-and-verify::chybí argument <suffix> (core|extranet|web|…)"
  exit 1
fi
shift

OPTIONAL=0
VERIFY_URL=""
# Veřejná adresa, na které se po nasazení ověří, že služba ODPOVÍDÁ.
# Bere se z prostředí (HEALTH_URL), protože adresa je vlastnost NASAZENÍ —
# do generického CI souboru nepatří (brána split-rule) a druhá instance má svou.
HEALTH_URL="${HEALTH_URL:-}"
# Stojí ten povrch za dveřmi (SPA knock), nebo ne?
#
# ⛔ NEODVOZUJE SE z odpovědi. Kdyby se dveře poznávaly podle toho, co přišlo,
# stačilo by, aby aplikace jednou vrátila 403, a měřidlo by mlčky spolklo
# skutečnou vadu. Vztah povrchu ke dveřím je vlastnost NASAZENÍ — musí být
# vyslovena, ne uhodnuta.
#
# ⛔ A NEMÁ VÝCHOZÍ HODNOTU. Kdyby nevyplněno znamenalo „ne", každá nová
# nasazovací úloha by tiše zdědila tvrzení, které o ní nikdo nevyslovil.
# Prázdno = neurčito = STOP (vymáhá se níž, hned po parsování přepínačů).
HEALTH_ZA_DVERMI="${HEALTH_ZA_DVERMI:-}"
TIMEOUT_S=1800
# ⛔ FRONTA NENÍ PRÁCE. NAMĚŘENO 2026-09-26 (<fork>, vlna 7 — 6 appek naráz, Coolify
# staví 2 souběžně). Fronta / stavba+start: openclaw 36 / 7 min, source-broker
# 43 / 7 min, orchestration 10 / 25 min, domain-services 10 / 37 min. Jeden strop
# od zařazení hlásil „NEDOBĚHLO V ČASE“ i appkám, které se postavily za 7 minut —
# jen čekaly, až na ně přijde řada. Proto dva stropy: FRONTA_S pro `queued`,
# TIMEOUT_S až od chvíle, kdy nasazení frontu opustí. Oba pojme strop úlohy
# (hlídá `opakovani-nasazeni-se-vejde-do-ulohy`).
FRONTA_S=1800
while [ $# -gt 0 ]; do
  case "$1" in
    --optional)     OPTIONAL=1; shift ;;
    --verify-url)   VERIFY_URL="${2:-}"; shift 2 ;;
    --health-url)   HEALTH_URL="${2:-}"; shift 2 ;;
    --health-za-dvermi) HEALTH_ZA_DVERMI="${2:-}"; shift 2 ;;
    --timeout-s)    TIMEOUT_S="${2:-1800}"; shift 2 ;;
    --fronta-s)     FRONTA_S="${2:-1800}"; shift 2 ;;
    *) echo "::error title=deploy-and-verify::neznámý přepínač '$1'"; exit 1 ;;
  esac
done

# ── 0. Kdo měří veřejnou cestu, musí říct, co za ní čeká. ──────────────────
# Bez tohohle by šlo přidat nasazovací úlohu s HEALTH_URL a nechat nevyslovené,
# jestli povrch stojí za dveřmi. Taková úloha by pak buď věčně červenala (povrch
# za dveřmi), nebo by tolerovala 403 tam, kde je to vada. Obojí je horší než
# hlasitý pád tady, který se dá opravit jedním řádkem.
if [ -n "$HEALTH_URL" ] && [ "$HEALTH_ZA_DVERMI" != "ano" ] && [ "$HEALTH_ZA_DVERMI" != "ne" ]; then
  echo "::error title=nevyslovený vztah ke dveřím::HEALTH_URL je předána, ale HEALTH_ZA_DVERMI není 'ano' ani 'ne'."
  cat <<'NAPOVEDA'

CO TO ZNAMENÁ: měříš veřejnou cestu a neřekl jsi, jestli na ní stojí vrátný.

  HEALTH_ZA_DVERMI: 'ano'  povrch je za dveřmi (SPA knock). 403 s prázdným
                           tělem se pak bere jako „NEMĚŘENO", ne jako pád —
                           z CI se ťukat nesmí, ťuká vždy jen člověk.
  HEALTH_ZA_DVERMI: 'ne'   povrch je před dveřmi. Cokoli mimo 2xx/3xx je pád.

Nevyplněno NENÍ 'ne'. Neurčitost tady znamená STOP, ne domněnku.
NAPOVEDA
  exit 1
fi

# ── 1. Pověření. Chybí-li, NEJDE nasadit ANI ověřit ⇒ pád, ne warning. ──────
if [ -z "${COOLIFY_API_TOKEN:-}" ] || [ -z "${COOLIFY_URL:-}" ]; then
  echo "::error title=deploy nemá čím nasazovat::COOLIFY_API_TOKEN nebo COOLIFY_URL není nastaven."
  cat <<'NAPOVEDA'

CO TO ZNAMENÁ: tahle úloha NIC nenasadila — a dřív by to skončila ZELENĚ, takže
se dalo měsíce mergovat s pocitem, že se nasazuje. Proto teď padá.

CO S TÍM — jedno ze dvou:
  (a) doplnit tajemství COOLIFY_API_TOKEN + COOLIFY_URL do nastavení repozitáře
      (Settings → Secrets and variables → Actions); pak se nasazuje automaticky;
  (b) pokud se tahle instalace nasazuje VÝHRADNĚ ručně, smazat proměnnou
      APP_NAME_PREFIX — deploy úlohy v .github/workflows/ci.yml jsou opt-in
      a bez ní se nespustí, takže pipeline nepředstírá krok, který nedělá.
Ruční cesta zůstává: node scripts/aisha-redeploy.mjs --only=<app>
NAPOVEDA
  exit 1
fi

# ── 2. Instance se DEKLARUJE. Odvození ze stromu je jen druhý zdroj. ────────
#
# ⛔ NAMĚŘENO 2026-08-09: tady stálo POUZE `ls -1 instances | grep -v '^_'`.
# Fungovalo to jen do chvíle, než instanční data z forku odešla tam, kam podle
# návrhu patří — do datového repa instance (PR #163). Výpis se vyprázdnil a
# `Deploy: Core` i `Deploy: Extranet` začaly nad `main` padat po 4 vteřinách
# na „instanci nelze odvodit z instances/".
#
# ⭐ Odvozovat instanci z toho, co náhodou leží ve stromu, byl vždycky ODHAD.
# Fork MÁ být upstreamu podobný a instanční data v sobě nenosit — takže strom,
# ze kterého se to četlo, je právě ten, který se má vyprázdnit. Deklarace to
# obrací správně: co se nasazuje, se ŘEKNE.
#
# Týž zdroj a totéž pořadí, jaké už používá `coolify_app_prefix()` v
# scripts/lib/coolify-resolve-uuid.sh, i `deploy.yml` (vars.APP_NAME_PREFIX).
# Rozpor dvou zdrojů je FATAL, ne důvod jeden upřednostnit: nejistota v prefixu
# je nejistota v tom, ČÍ provoz se restartuje.
APP_PREFIX="${APP_NAME_PREFIX:-}"
ZE_STROMU=$(ls -1 instances 2>/dev/null | grep -v '^_' | head -2)
if [ "$(printf '%s\n' "$ZE_STROMU" | grep -c .)" -gt 1 ]; then
  echo "::error title=deploy misconfigured::v instances/ je víc instancí ($(printf '%s ' $ZE_STROMU)) — nevím, kterou nasadit."
  exit 1
fi

if [ -n "$APP_PREFIX" ] && [ -n "$ZE_STROMU" ] && [ "$APP_PREFIX" != "$ZE_STROMU" ]; then
  echo "::error title=deploy misconfigured::Rozpor v určení instance: deklarace říká '$APP_PREFIX', strom říká '$ZE_STROMU'."
  echo "::error::Nasazení se ZASTAVUJE. Nejistota v prefixu je nejistota v tom, ČÍ provoz se restartuje."
  exit 1
fi
[ -z "$APP_PREFIX" ] && APP_PREFIX="$ZE_STROMU"

if [ -z "$APP_PREFIX" ]; then
  echo "::error title=deploy misconfigured::APP_NAME_PREFIX není nastaven a v instances/ není žádná instance."
  echo "::error::Nevím, KTEROU instanci nasadit, a proto nenasazuji nic."
  echo "::error::Nastav proměnnou repozitáře APP_NAME_PREFIX (Settings → Secrets and variables → Actions → Variables)"
  echo "::error::— stejnou, jakou používá deploy.yml. Výchozí hodnota se ZÁMĚRNĚ nedosazuje:"
  echo "::error::dosazený 'aisha' by z forku nasadil cizí produkci."
  exit 1
fi
APP="${APP_PREFIX}-${SUFFIX}"

# ⛔ HODNOTA A DIAGNOSTIKA SE NESMÍ SLÉVAT (naměřeno 2026-08-08 na <fork>-core).
# Tady stálo `UUID=$(... 2>&1)`. Resolver posílá diagnostiku na stderr — a jednou
# z jeho hlášek je PŘECHODNÁ: „/applications returned empty (attempt 1) —
# retrying". Ten pokus pak uspěl, jenže varování už bylo ve $UUID, a protože se
# testovalo jen na `::error::` a `::notfound::`, prošlo dál. Výsledek:
#     POST /api/v1/deploy?uuid=::warning::coolify-resolve-uuid:%20/applic…
#     → HTTP 000 a nasazení, které se nikdy nestalo.
# Padlo to nahlas (to je dobře), ale příčina ukazovala jinam, než kde byla.
#
# Kanál nese hodnotu, ne komentář: stdout = UUID, stderr = pro člověka, a o tom,
# CO se stalo, rozhoduje NÁVRATOVÝ KÓD, který má resolver zdokumentovaný:
#     rc=0  nalezeno · rc=1  appka v Coolify není · rc≥2  selhala infrastruktura
CHYBY=$(mktemp)
UUID=$(bash scripts/lib/coolify-resolve-uuid.sh "$APP" 2>"$CHYBY") || RC=$?
RC="${RC:-0}"
DIAG=$(cat "$CHYBY" 2>/dev/null || true)
rm -f "$CHYBY"
[ -n "$DIAG" ] && printf '%s\n' "$DIAG" >&2

if [ "$RC" -ge 2 ]; then
  echo "::error title=deploy selhal::UUID se nepodařilo zjistit — infrastruktura, ne chybějící appka (rc=$RC)."
  exit 1
fi
if [ "$RC" -eq 1 ] || [ -z "$UUID" ]; then
  if [ "$OPTIONAL" -eq 1 ]; then
    echo "::warning title=appka není nasazena::'$APP' v Coolify není a je označená jako volitelná — přeskakuji."
    echo "PŘESKOČENO (volitelná appka): $APP"
    exit 0
  fi
  echo "::error title=appka chybí v Coolify::'$APP' se nenašla, takže se NIC nenasadilo."
  echo "Buď ji do Coolify založ, nebo (je-li pro tuhle instanci nepovinná) předej --optional."
  exit 1
fi
# A tvar se ověří, i když rc=0: identifikátor, který nevypadá jako identifikátor,
# by se jinak vlepil do URL a odpověď by mluvila o něčem úplně jiném.
if ! printf '%s' "$UUID" | grep -qE '^[a-z0-9]{8,}$'; then
  echo "::error title=deploy selhal::resolver vrátil něco, co není UUID (${#UUID} znaků) — nasazovat se podle toho NEDÁ."
  exit 1
fi

# ── Volání Coolify API, které přežije 429 ──────────────────────────────────
# ⛔ Rozpočet API je 200 požadavků/min na UŽIVATELE a všechny tokeny instance —
# i tenhle z CI — patří jednomu uživateli, kterého sdílí víc instancí. Při souběhu
# (čtyři deploy úlohy po merge + cizí cold-start) přijde
#     HTTP 429 {"message":"Too Many Attempts."}
# a `POST /deploy` tu dosud padal okamžitě jako „deploy odmítnut" — tedy
# NENASAZENO kvůli cizímu provozu, ne kvůli vadě. 429 je server, který říká
# „zkus to za chvíli" (`Retry-After` ve vteřinách), takže se počká: 4 pokusy,
# strop 120 s na jedno čekání. Jiné kódy se neopakují — 401/404/422 jsou vady.
#
# Primitiv podle brány curl-http-code-capture-integrity: kód na stdout, `|| true`.
# Tělo jde do souboru v $1 (nebo /dev/null).
coolify_volani() {
  local telo="$1" hlavicky kod="" pokus cekej
  shift
  hlavicky=$(mktemp)
  for pokus in 1 2 3 4; do
    kod=$(curl -s -o "$telo" -D "$hlavicky" -w "%{http_code}" --max-time 30 \
      -H "Authorization: Bearer $COOLIFY_API_TOKEN" "$@" || true)
    [ "$kod" = "429" ] && [ "$pokus" -lt 4 ] || break
    cekej=$(tr -d '\r' < "$hlavicky" | awk -F': *' 'tolower($1)=="retry-after" {print $2; exit}')
    if ! [[ "$cekej" =~ ^[0-9]+$ ]] || [ "$cekej" -eq 0 ]; then cekej=$((pokus * 20)); fi
    [ "$cekej" -le 120 ] || cekej=120
    echo "  Coolify API: HTTP 429 (rozpočet požadavků) — pokus ${pokus}/4, čekám ${cekej} s" >&2
    sleep "$cekej"
  done
  rm -f "$hlavicky"
  printf '%s' "$kod"
}

# ── 2b. DOSTANE COMPOSE, BEZ ČEHO SPADNE? — dřív, než se cokoli spustí. ────
#
# ⛔ NAMĚŘENO 2026-09-13 po slití forků do upstreamu: `Deploy: Core` spadl na
# `${MESH_DNS_NETWORK:?}`. Hodnota ležela v .env.coolify obsluhy, do aplikace ji
# nikdo nedoručil — a úloha to zjistila až z logu nasazení, které Coolify
# zařadil, rozjel a shodil. Běžel dál starý kontejner. Přes celou flotilu
# změřeno 20 z 32 aplikací, 8 klíčů: každé příští nasazení by skončilo stejně.
#
# Tahle otázka se tu klade PŘED zápisem revize i před spuštěním: compose
# z TÉTO revize (checkout úlohy je revize, kterou Coolify postaví) proti envům,
# které aplikace v Coolify SKUTEČNĚ drží. Který compose, řekne aplikace sama
# (`docker_compose_location`) — neodhaduje se ze jména.
#
# CI nemá .env.coolify, doplnit tedy nic neumí — umí to jen PŘESNĚ pojmenovat.
#
# NEMĚŘENO (parser nejde stáhnout, API mlčí) NENÍ důvod nenasazovat: compose je
# sám fail-closed a nasazení to řekne. Nesmí se to ale vydávat za „doručeno".
PREFLIGHT_STAV="NEMĚŘENO: doručení povinných proměnných compose."

# YAML parser: v řídkém checkoutu nejsou node_modules. Stáhne se JEN balík
# `yaml` (nemá žádné závislosti) v PŘIPNUTÉ verzi s PŘIPNUTÝM otiskem —
# `npm pack` nespouští skripty a nesahá na strom projektu, takže to není
# `npm install` celého repa. Nesedí-li otisk, parser se NEPOUŽIJE.
#
# ⚠️ Pin je tady, ne v package-lock.json: lock pro `yaml` pole `integrity`
# nenese (naměřeno 2026-09-13), takže by nebylo s čím porovnat. A verze se na
# lock NEVÁŽE schválně — bot závislostí by jinak každým posunem yaml rozbil
# nasazení. Otisk ověřen proti registry.npmjs.org (dist.integrity) i proti
# staženému balíku. Sémantika parsování je v rámci yaml 2.x stabilní.
YAML_PARSER_VERZE="2.9.0"
YAML_PARSER_OTISK="sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA=="
zajisti_yaml_parser() {
  [ -f node_modules/yaml/dist/index.js ] && return 0
  command -v npm >/dev/null && command -v openssl >/dev/null || return 1
  local tmp balik
  tmp=$(mktemp -d)
  balik=$(cd "$tmp" && npm pack --silent "yaml@${YAML_PARSER_VERZE}" 2>/dev/null | tail -1) || { rm -rf "$tmp"; return 1; }
  if [ -z "$balik" ] || [ ! -f "$tmp/$balik" ] \
     || [ "sha512-$(openssl dgst -sha512 -binary "$tmp/$balik" | openssl base64 -A)" != "$YAML_PARSER_OTISK" ]; then
    echo "::warning title=YAML parser se neověřil::yaml@${YAML_PARSER_VERZE} se nestáhl, nebo nesedí na připnutý otisk — nepoužije se." >&2
    rm -rf "$tmp"; return 1
  fi
  mkdir -p node_modules/yaml && tar -xzf "$tmp/$balik" -C node_modules/yaml --strip-components=1
  rm -rf "$tmp"
  [ -f node_modules/yaml/dist/index.js ]
}

if ! zajisti_yaml_parser; then
  echo "::warning title=doručení povinných NEMĚŘENO::YAML parser není k dispozici — nevím, bez čeho compose '$APP' spadne. Nasazuji; compose sám je fail-closed."
else
  # mktemp zakládá soubor 0600; envy nesou tajné hodnoty, mažou se hned po čtení.
  APP_JSON=$(mktemp)
  ENVS_JSON=$(mktemp)
  KOD_APP=$(coolify_volani "$APP_JSON" "${COOLIFY_URL}/api/v1/applications/${UUID}")
  KOD_ENVS=$(coolify_volani "$ENVS_JSON" "${COOLIFY_URL}/api/v1/applications/${UUID}/envs")
  COMPOSE=$(node -e '
    try {
      const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(a.docker_compose_location ?? "").replace(/^\/+/, ""));
    } catch { process.stdout.write(""); }
  ' "$APP_JSON")
  rm -f "$APP_JSON"
  if [ "$KOD_APP" != "200" ] || [ "$KOD_ENVS" != "200" ]; then
    echo "::warning title=doručení povinných NEMĚŘENO::aplikace HTTP ${KOD_APP}, envy HTTP ${KOD_ENVS} — nasazuji bez té kontroly."
  elif [ -z "$COMPOSE" ] || [ ! -f "$COMPOSE" ]; then
    echo "::warning title=doručení povinných NEMĚŘENO::aplikace hlásí compose '${COMPOSE}' (prázdné = nehlásí žádný), v checkoutu téhle revize není."
  else
    PREFLIGHT_RC=0
    PREFLIGHT_VYSTUP=$(node scripts/lib/povinne-promenne.mjs --compose "$COMPOSE" --coolify-envs "$ENVS_JSON" --app "$SUFFIX" 2>&1) || PREFLIGHT_RC=$?
    rm -f "$ENVS_JSON"
    printf '%s\n' "$PREFLIGHT_VYSTUP"
    case "$PREFLIGHT_RC" in
      0) PREFLIGHT_STAV="DOKÁZÁNO: aplikace drží všechny povinné proměnné compose ${COMPOSE} této revize." ;;
      1) echo "::error title=compose při nasazení SPADNE::${APP} nemá doručené povinné proměnné (${COMPOSE}). NENASAZUJI."
         cat <<'NAPOVEDA'

CO TO ZNAMENÁ: nová revize compose chce proměnnou, kterou aplikace v Coolify
nedrží. Nasazení by se zařadilo, rozjelo a spadlo na `${X:?}` — a běžel by dál
starý kontejner. Tahle úloha to umí jen pojmenovat; .env.coolify nemá.

CO S TÍM (na stanovišti obsluhy, s .env.coolify):
  node scripts/aisha-env-doctor.mjs                 # doplní odvoditelné klíče
  KEYS=<klíče výš> bash scripts/coolify-sync-envs.sh <appka>
Pak úlohu spustit znovu. Celý postup: docs/deploy/UPGRADE_NASAZENE_INSTANCE.md
NAPOVEDA
         exit 1 ;;
      *) echo "::warning title=doručení povinných NEMĚŘENO::kontrola nedoběhla (kód ${PREFLIGHT_RC}) — nasazuji; compose sám je fail-closed." ;;
    esac
  fi
  rm -f "$ENVS_JSON"
fi

# ── 3. Otisk PŘED, když se má dokazovat změna obsahu. ──────────────────────
OTISK_PRED=""
if [ -n "$VERIFY_URL" ]; then
  OTISK_PRED=$(curl -fsS --max-time 20 "$VERIFY_URL" 2>/dev/null | shasum -a 256 | cut -d' ' -f1 || true)
  printf 'otisk PŘED (%s): %s\n' "$VERIFY_URL" "${OTISK_PRED:0:12}"
fi

# ── 3b. Doručit REVIZI dřív, než se build rozjede. ─────────────────────────
# ⛔ NAMĚŘENO 2026-08-09 přímo v Coolify:
#     <fork>-edge      GIT_SHA = 'main'
#     <fork>-core      GIT_SHA = 'main'
#     <fork>-extranet  GIT_SHA vůbec není
# Tedy NE prázdno — VĚTEV. To je horší: prázdná hodnota se pozná, `main` vypadá
# jako údaj, nikdy se nezmění, a `vite.config.ts` ji přes `define __GIT_SHA__`
# zapeče do bundlu, takže se uživateli v build-info ukazuje jako verze.
#
# PROČ tam ta větev je: hodnotu zapisuje JEDINÝ skript — `coolify-deploy-init.sh`
# (set_coolify_env … "GIT_SHA"), a ten běží při PROVISIONINGU. Tenhle skript ji
# do 2026-08-09 jen VYPSAL na řádku „Nasazuji …" a poslal POST /deploy. Compose
# přitom `GIT_SHA: ${GIT_SHA:-}` předává správně — jenže hodnotu bere z ULOŽENÉHO
# env appky, ne z běhu CI. Revize byla tedy po celou dobu známá a nikdo ji
# nepřenesl přes poslední hranici.
#
# ⭐ Zapisuje se PŘED spuštěním: Coolify čte env při startu buildu, takže zápis
# po POSTu by se projevil až v NÁSLEDUJÍCÍM nasazení — artefakt by nesl revizi
# toho předchozího, což je hůř než žádná.
if [ -z "${GIT_SHA:-}" ]; then
  echo "::error title=deploy nezná revizi::GIT_SHA není nastaven."
  echo "Nasazený artefakt by nešlo přiřadit k commitu — a právě tak vznikl stav,"
  echo "kdy v Coolify ležela větev 'main' místo revize. Workflow ho předává jako"
  echo "  GIT_SHA: \${{ github.sha }}"
  exit 1
fi
# Production i preview zvlášť — Coolify v4 drží per klíč dva záznamy a při
# duplicitě VYHRÁVÁ preview. Zápis jen do production by tedy neudělal nic.
# (Týž důvod, proč to 2× posílá `set_coolify_env` v coolify-deploy-init.sh.)
REVIZE_OK=1
for JE_PREVIEW in false true; do
  KOD=$(coolify_volani /dev/null \
    -X PATCH "${COOLIFY_URL}/api/v1/applications/${UUID}/envs/bulk" \
    -H "Content-Type: application/json" \
    -d "{\"data\":[{\"key\":\"GIT_SHA\",\"value\":\"${GIT_SHA}\",\"is_preview\":${JE_PREVIEW}}]}")
  case "$KOD" in
    2*) : ;;
    *)  REVIZE_OK=0
        echo "::warning title=revize se nezapsala::PATCH envs/bulk (is_preview=${JE_PREVIEW}) vrátil HTTP ${KOD}." ;;
  esac
done
# Nezapsaná revize NEBLOKUJE nasazení: je to diagnostický údaj, kdežto neproběhlé
# nasazení je vada. Ale mlčet se o tom nesmí — artefakt pak nese revizi předchozí.
if [ "$REVIZE_OK" -eq 1 ]; then
  REVIZE_STAV="DOKÁZÁNO: revize ${GIT_SHA:0:12} zapsána do env před buildem."
  printf 'revize → Coolify: %s (production i preview)\n' "${GIT_SHA:0:12}"
else
  REVIZE_STAV="NEDOKÁZÁNO: revize se do env NEZAPSALA — bundle ponese tu předchozí."
fi

# ── 3c. Obnovit CACHEBUST overlaye dřív, než se build rozjede. ─────────────
# ⛔ NAMĚŘENO 2026-09-23 (<fork>-source-broker, nasazení z CI po sloučení
# brokeru): build padl v kroku `source-adapters` — `SOURCE_ADAPTER_OVERLAY_GIT_URL`
# nastavené, `SOURCE_ADAPTER_OVERLAY_CACHEBUST` PRÁZDNÉ, a Dockerfile na prázdné
# hodnotě schválně končí `exit 1`. `refresh-overlay-cachebust.sh` („aby na cestě
# nasazení nezáleželo") ale volal jen ruční `deploy.yml`; cesta CI přes tenhle
# skript ne. Táž mezera u extranetu: overlay prokliků by build vzal z keše.
# Fail-soft a nahlas, stejně jako `deploy.yml`: nedostupné overlay repo nesmí
# zastavit nasazení, ale nesmí ani mlčet. Jednou před pokusy — overlay se mezi
# pokusy nemění. Stack bez overlaye je pro skript no-op.
#
# ⛔ KÓD, NE „DOBĚHL". NAMĚŘENO 2026-09-24 (běh 51874): skript vypsal „HEAD overlay
# repa se nepodařilo přečíst" (deploy joby neměly token pro čtení overlay rep), skončil ale 0
# a tenhle souhrn z toho udělal „PROVEDENO" — core i extranet se postavily
# z KEŠOVANÉHO overlaye. Skript teď vrací 3 = NEDOKÁZÁNO a souhrn čte kód.
CACHEBUST_STAV="NEDOKÁZÁNO: cachebust overlaye se neobnovil — build mohl vzít overlay z keše."
CACHEBUST_RC=0
COOLIFY_BASE_URL="$COOLIFY_URL" bash scripts/deploy/refresh-overlay-cachebust.sh "$UUID" "$SUFFIX" || CACHEBUST_RC=$?
case "$CACHEBUST_RC" in
  0) CACHEBUST_STAV="DOKÁZÁNO: cachebust overlaye je aktuální před buildem (obnoven, beze změny, nebo stack overlay nemá — viz výpis výše)." ;;
  3) CACHEBUST_STAV="NEDOKÁZÁNO: overlay je deklarovaný, ale cachebust se neobnovil (HEAD nečitelný, zápis nebo envy selhaly) — build vezme overlay z KEŠE."
     echo "::warning title=cachebust NEDOKÁZÁN::'$APP' — build vezme overlay z keše (důvod ve výpisu refresh-overlay-cachebust výše; chybí GIT_TOKEN?)." ;;
  *) CACHEBUST_STAV="NEDOKÁZÁNO: refresh-overlay-cachebust.sh skončil kódem ${CACHEBUST_RC} (chyba zadání) — cachebust se neobnovil."
     echo "::warning title=cachebust neobnoven::'$APP' — refresh-overlay-cachebust.sh kód ${CACHEBUST_RC}; build může vzít overlay z keše, nebo na prázdném cachebustu spadnout." ;;
esac

# ── 4–4b. Spustit, počkat — a PŘECHODNÝ pád dotáhnout. ─────────────────────
# ⛔ NAMĚŘENO 2026-09-23 (<fork>-core po #380): build spadl na
#     npm error notarget No matching version found for @sentry/core@10.75.3.
# Verze vyšla ve veřejném npm 3 min PO startu nasazení (14:06:21Z), build padl
# 14:06:24Z — závod s vydáním. Compose je jeden celek, takže se nevyměnilo nic
# a jádro stálo na starém commitu, dokud nasazení někdo RUČNĚ nespustil znovu.
# Opakování téhož commitu prošlo. Majitel: „potřebujeme mechanismus, který to
# umožní automaticky povyšovat".
#
# ⭐ Opakuje se JEN pád, u kterého `nasazeni-prechodna-chyba.mjs` DOLOŽÍ
# přechodnou příčinu (závod s vydáním ověřený časem v registru, limit nebo síť
# registru). Neznámý pád zůstává pádem — slepé opakování by vadu zakrylo.
# Před opakováním se čeká PRODLEVA_S a ověří se, že téže appce neběží jiné
# nasazení: souběžná nasazení se perou o obrazy.
# ⭐ OPAKOVANI a PRODLEVA_S jsou vlastnost TOHOTO skriptu (jeden domov), ne
# proměnná prostředí s dosazeným literálem (brána `zadny-fallback-nad-identitou`).
# 0 opakování = mechanismus vypnutý. Strop úlohy musí pojmout
# (1 + OPAKOVANI) × TIMEOUT_S + prodlevu — hlídá `opakovani-nasazeni-se-vejde-do-ulohy`.
OPAKOVANI=1
PRODLEVA_S=120
POKUSU_MAX=$(( 1 + OPAKOVANI ))
POKUS=1
OPAKOVANI_STAV="NEOPAKOVÁNO: nasazení doběhlo na první pokus."

# Rozhodne, jestli spadlé nasazení zopakovat. 0 = opakovat (a počkalo se), 1 = ne.
dalsi_pokus() {
  local nasazeni="$1" verdikt ano trida dukaz aktivni
  if [ "$POKUS" -ge "$POKUSU_MAX" ]; then
    [ "$POKUSU_MAX" -gt 1 ] && echo "Opakování vyčerpáno (${POKUS}/${POKUSU_MAX} pokusů) — zůstává pád."
    return 1
  fi
  verdikt=$(curl -s --max-time 60 -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
      "${COOLIFY_URL}/api/v1/deployments/${nasazeni}" \
    | node scripts/lib/nasazeni-prechodna-chyba.mjs) || {
    echo "::warning title=opakování neposouzeno::klasifikace pádu selhala — neopakuji (bez měření se nerozhoduje)."
    return 1
  }
  IFS=$'\t' read -r ano trida dukaz <<<"$verdikt"
  if [ "$ano" != "ano" ]; then
    echo "Neopakuji: ${dukaz:-bez verdiktu}"
    return 1
  fi
  # Posunul se mezitím main? Coolify staví HLAVU větve, ne GIT_SHA — opakování by
  # nasadilo novější revizi pod jménem starší a krok 5b by ji odmítl. Novější
  # commit má vlastní běh CI, který nasadí sám. (Recenze aisha-team 09-23.)
  # Větev se nedosazuje: bez GITHUB_REF (běh mimo CI) nevím, čí hlavu porovnat.
  local ref="${GITHUB_REF:-}"
  if [ -z "$ref" ]; then
    echo "::warning title=opakování neposouzeno::GITHUB_REF není nastavený — nevím, kterou větev porovnat; neopakuji."
    return 1
  fi
  hlava=$(git ls-remote origin "$ref" 2>/dev/null | cut -f1)
  if [ -z "$hlava" ]; then
    echo "::warning title=opakování neposouzeno::hlavu $ref nelze zjistit (git ls-remote) — neopakuji."
    return 1
  fi
  if [ -n "${GIT_SHA:-}" ] && [ "$hlava" != "$GIT_SHA" ]; then
    echo "Neopakuji: větev se posunula na ${hlava:0:12} (nasazuji ${GIT_SHA:0:12}) — nasadí ji její vlastní běh CI."
    return 1
  fi
  echo "::warning title=nasazení se zopakuje::${APP} — přechodná chyba '${trida}': ${dukaz}. Pokus $((POKUS + 1))/${POKUSU_MAX} za ${PRODLEVA_S} s."
  sleep "$PRODLEVA_S"
  # Souběh se měří na nasazeních TÉTO appky podle UUID — globální seznam je sdílený
  # s cizí instancí a jeho pole nebyla změřena (recenze aisha-team 09-23). Tvar
  # odpovědi {count, deployments:[{status,…}]} je naměřený 09-23 na <fork>-core.
  aktivni=$(curl -s --max-time 90 -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
      "${COOLIFY_URL}/api/v1/deployments/applications/${UUID}?skip=0&take=5" \
    | node -e '
        let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
          try {
            const l=JSON.parse(s)?.deployments;
            if (!Array.isArray(l)) { process.stdout.write("?"); return; }
            process.stdout.write(String(l.filter(d=>["in_progress","queued"].includes(d?.status)).length));
          } catch { process.stdout.write("?"); }
        });')
  if [ "$aktivni" != "0" ]; then
    echo "::warning title=opakování odloženo::téže appce běží jiné nasazení (${aktivni}) — neopakuji, souběh by se pral o obrazy."
    return 1
  fi
  OPAKOVANI_STAV="OPAKOVÁNO: pokus $((POKUS + 1))/${POKUSU_MAX} po přechodné chybě '${trida}' (${dukaz})."
  return 0
}

# Soubor odpovědi JEDNOU, před smyčkou — každý pokus ho jen vyprázdní.
ODPOVED=$(mktemp)
trap 'rm -f "$ODPOVED"' EXIT
while :; do
# ── 4. Spustit. ────────────────────────────────────────────────────────────
# Odpověď do VLASTNÍHO souboru. Pevné `/tmp/deploy-resp.txt` sdílí celý stroj:
# když curl selže (HTTP 000), soubor se nepřepíše a `cat` vypíše odpověď
# z PŘEDCHOZÍHO nasazení — hlášení pak mluví o jiné aplikaci než ta, co spadla.
# Naměřeno 2026-08-08: pád <fork>-core ukazoval tělo od <fork>-extranet.
: > "$ODPOVED"   # opakovaný pokus nesmí vypsat tělo PŘEDCHOZÍHO volání
printf 'Nasazuji %s — uuid=%s sha=%s (pokus %s/%s)\n' "$APP" "${UUID:0:12}" "${GIT_SHA:-?}" "$POKUS" "$POKUSU_MAX"
# ⛔ `force=true`, NE `false`. NAMĚŘENO 2026-08-10:
# Při `force=false` Coolify nasazení NEZALOŽÍ, když usoudí, že není co dělat —
# vrátí 2xx a nic nezařadí. Krok 5 pak uvidí „deploys 0 active, 0 latest failed"
# a ohlásí HOTOVO. Ten rychlý konec je o pár řádků níž popsaný jako ŽÁDOUCÍ,
# jenže je NEROZLIŠITELNÝ od „nic se nenasadilo".
#
# Tak vypadal `Deploy: Edge` toho dne: zelený za pár sekund, a web dál servíroval
# bundle ze 7. srpna (`last-modified` i hashe bundlů beze změny). Ruční
# `aisha-redeploy.mjs` tutéž appku nasadil na první pokus — protože posílá
# `force=true` (viz jeho ř. 1398). Dva nástroje, dvě různá volání, jedno z nich
# tiše nic nedělalo.
HTTP_CODE=$(coolify_volani "$ODPOVED" \
  -X POST "${COOLIFY_URL}/api/v1/deploy?uuid=${UUID}&force=true" \
  -H "Content-Type: application/json")
if ! [[ "$HTTP_CODE" =~ ^[0-9]+$ ]] || [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
  echo "::error title=deploy odmítnut::POST /api/v1/deploy vrátil HTTP $HTTP_CODE"
  cat "$ODPOVED" 2>/dev/null || true
  exit 1
fi
# ⭐ 2xx JE JEN PŘIJETÍ. Důkaz, že se něco ZAŘADILO, je `deployment_uuid`
# v odpovědi — bez něj by se čekalo na něco, co neexistuje.
# ⛔ JSON se PARSUJE, negrepuje. Odpověď je JEDEN řádek a `"status"` je v ní
# TŘIKRÁT: kromě stavu nasazení i vnořený stav aplikace (`running:healthy`).
# Hladový `sed` vrací poslední výskyt — u dnešní odpovědi náhodou správně, ale
# stačí, aby Coolify pole přeházel, a krok by hlásil zdraví APLIKACE jako
# výsledek NASAZENÍ. Přesně ta záměna, kterou tenhle blok odstraňuje.
#
# ⛔ POLE JE VNOŘENÉ. NAMĚŘENO 2026-08-10 živým voláním nad <fork>-core:
#   {"deployments":[{"message":"…queued.","resource_uuid":"…","deployment_uuid":"…"}]}
# Kořenový `deployment_uuid` NEEXISTUJE (je `undefined`). Původní verze četla
# jen kořen, dostala prázdno a skončila hláškou „nasazení se nezařadilo" —
# přestože Coolify nasazení POCTIVĚ zařadil.
#
# ⭐ Důsledek byl horší než vada, kterou tenhle blok opravoval: `Deploy: Core`,
# `Deploy: Edge` i `Deploy: Extranet` padaly na mainu ČTYŘI merge po sobě
# (#177 → #181) a nikdo si toho nevšiml, protože na PR se deploy PŘESKAKUJE —
# první běh nad mainem je zároveň první test a ten už nic neblokuje.
# Zaměnit „tiše zeleno" za „vždy červeno" NENÍ oprava.
#
# Tvar bere `aisha-redeploy.mjs` (ř. 1425) správně od začátku; tenhle skript se
# s ním teď shoduje — a hlídá to brána `deploy-cte-vnorene-pole`.
NASAZENI=$(node -e '
  const fs=require("fs");
  try {
    const r = JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    process.stdout.write(String(r?.deployments?.[0]?.deployment_uuid ?? r?.deployment_uuid ?? ""));
  }
  catch { process.stdout.write(""); }
' "$ODPOVED")
if [ -z "$NASAZENI" ]; then
  echo "::error title=nasazení se nezařadilo::Coolify vrátil HTTP $HTTP_CODE, ale v odpovědi NENÍ deployment_uuid."
  echo "Požadavek byl tedy přijat a zahozen — čekat na výsledek nemá na co."
  cat "$ODPOVED" 2>/dev/null || true
  exit 1
fi
echo "Požadavek přijat (HTTP $HTTP_CODE), nasazení ${NASAZENI} zařazeno. Čekám na JEHO výsledek."

# ── 4b. Počkat na TOTO nasazení, ne na „nějaké aktivní". ───────────────────
# ⛔ NAMĚŘENO 2026-08-10 — tohle je ta vada, kvůli které byl web tři dny starý.
#
# Krok 5 níž volá `coolify-deploy-watch.mjs`, který se ptá GLOBÁLNÍHO
# `/api/v1/deployments`. Ten vrací jen AKTIVNÍ nasazení, takže:
#   • ptá-li se dřív, než se nasazení objeví → vidí nulu → „hotovo za 4 s"
#   • ptá-li se potom, co spadlo → z aktivních zmizelo → zase nula
# Obojí dopadne stejně: „deploys 0 active, 0 latest failed" = ZELENO.
#
# Coolify záznam přitom pravdu měl:
#   07:04:35 status=failed   ← tohle spustila CI úloha, která skončila ZELENĚ
#   07:16:33 status=failed   ← totéž ručně
# (Obě padla na buildu `svc-knock`; compose je jeden celek, takže se nevyměnil
# ani kontejner `web`.) Seznam je navíc sdílený s CIZÍ instancí — v jednu chvíli
# v něm bylo 16 nasazení `aisha-*`, mezi kterými se to naše ztratí.
#
# ⭐ Autorita je `/api/v1/deployments/<deployment_uuid>`: vrací stav TOHO
# nasazení včetně `failed`. Ptáme se tedy na to, co jsme sami spustili.
# Čas (fronta zvlášť, práce zvlášť) řídí `cekej_na_nasazeni` níž.
# ─────────────────────────────────────────────────────────────────────────────
# POSTAVENO N × PŘENESENO M — vyslovit SKUTEČNOU příčinu
#
# ⛔ NAMĚŘENO 2026-08-22 (<fork>-core, jedno konkrétní nasazení). Docker ohlásil:
#     target postgrest: failed to solve: failed to read dockerfile:
#     open Dockerfile.postgrest: no such file or directory
# Ten soubor ale V REPU JE — a v témž logu o pár řádků výš stojí `postgrest Built`,
# což bez něj nejde. Postavit se povedlo 10 obrazů, přenést 8:
#     "Transferring 8 built image(s) from Soren to RIQi."
# Cíl pak ty dva chybějící chtěl STAVĚT U SEBE, kde repo není — a Docker to
# oznámil jako chybějící soubor. Hlášení popisuje DŮSLEDEK, ne příčinu, a posílá
# hledat do repozitáře, kde není co najít (naměřeno už podruhé).
#
# Proto se ta dvě čísla po pádu PŘEČTOU a rozdíl se vysloví nahlas.
# ⚠️ M se čte jako ČÍSLO VE VĚTĚ, ne jako počet výskytů slova — BuildKit loguje
# desítky řádků "transferring context/dockerfile", které s tímhle nesouvisí.
diagnostikuj_neuplny_prenos() {
  local nasazeni="$1" telo
  telo=$(curl -s --max-time 30 -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
    "${COOLIFY_URL}/api/v1/deployments/${nasazeni}" 2>/dev/null) || return 0
  printf '%s' "$telo" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      let t="";
      try { t=(JSON.parse(JSON.parse(s).logs||"[]")).map(l=>String(l.output||"")).join("\n"); }
      catch { return; }
      // ⛔ DVA TVARY LOGU, JEDNA VLASTNOST. Původní vzor `<jméno> Built` na
      // začátku řádku přestal platit: Docker 29.7.2 loguje
      // `Image <uuid>_<služba>:<sha> Built`. Naměřeno 2026-08-28 na nasazení,
      // které padlo PŘESNĚ na tuhle vadu (postaveno 13, přeneseno 12, chyběl
      // `pki-init`) — a tahle diagnostika k tomu MLČELA, protože nenašla ani
      // jeden „Built" a `!postaveno.length` ji poslalo pryč.
      // Měřidlo, které mine tvar světa, vydá TÝŽ výstup jako měřidlo, které nic
      // nenašlo. Proto se čtou oba tvary a mlčení má vlastní hlášku.
      const jmena=new Set();
      for (const mm of t.matchAll(/^\s*([a-z0-9][a-z0-9._-]*)\s+Built\s*$/gmi)) jmena.add(mm[1]);
      for (const mm of t.matchAll(/Image\s+(\S+?)(?::[0-9a-f]{7,40})?\s+Built\b/gi)) jmena.add(mm[1]);
      const postaveno=[...jmena];
      const m=/Transferring\s+([0-9]+)\s+built image/i.exec(t);
      if (!m) return;
      const preneseno=Number(m[1]);
      if (!postaveno.length) {
        process.stdout.write(
          "::warning title=POČET POSTAVENÝCH OBRAZŮ NEPŘEČTEN::log hlásí \"Transferring "+
          preneseno+" built image(s)\", ale ani jeden tvar \"Built\" se nepodařilo rozpoznat.\n"+
          "Tahle diagnostika tedy NEMĚŘILA — neber její mlčení jako \"přenos je v pořádku\".\n"+
          "Nejspíš se změnil tvar logu (verze Dockeru); vzor patří doplnit.\n");
        return;
      }
      if (preneseno >= postaveno.length) return;
      process.stdout.write(
        "::error title=NEÚPLNÝ PŘENOS OBRAZŮ::postaveno "+postaveno.length+
        ", přeneseno "+preneseno+" — chybí "+(postaveno.length-preneseno)+".\n"+
        "Pokud log tvrdí \"failed to read dockerfile\", NEHLEDEJ ten soubor v repu:\n"+
        "postavit se ten obraz povedl, jen nedorazil na cíl, a compose ho tam pak\n"+
        "zkusil stavět znovu — bez repozitáře. Příčina je PŘENOS mezi stroji.\n"+
        "Postavené obrazy: "+postaveno.join(", ")+"\n");
    });' || true
}

# Počká na výsledek nasazení $NASAZENI. Nastaví STAV a vrátí 0, když doběhlo
# (`finished`) nebo když se má opakovat (STAV=opakovat, doložená přechodná chyba).
# Jinak skript UKONČÍ: 1 = selhalo / nečitelné, 4 = nedoběhlo v čase (fronta
# nebo práce) — výsledek NEZNÁMÝ, Coolify nasazení neruší.
# ⭐ Dva stropy (viz FRONTA_S nahoře): dokud je nasazení `queued`, měří se proti
# FRONTA_S; jakmile frontu opustí, začne běžet TIMEOUT_S. Čekání ve frontě tak
# nespotřebuje čas práce a hláška řekne, KTERÝ z nich došel.
cekej_na_nasazeni() {
  local zacatek ted fronta_konec konec=0
  zacatek=$(date +%s)
  fronta_konec=$(( zacatek + FRONTA_S ))
  STAV=""
  while :; do
    ted=$(date +%s)
    if [ "$konec" -eq 0 ]; then
      [ "$ted" -lt "$fronta_konec" ] || break
    else
      [ "$ted" -lt "$konec" ] || break
    fi
    STAV=$(curl -s --max-time 20 -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
      "${COOLIFY_URL}/api/v1/deployments/${NASAZENI}" \
      | node -e '
        let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
          // TOP-LEVEL `status`, ne první nalezený řetězec: odpověď nese i vnořený
          // stav aplikace, a ten o výsledku nasazení nevypovídá.
          try { process.stdout.write(String(JSON.parse(s).status ?? "")); } catch { process.stdout.write(""); }
        });
      ')
    case "$STAV" in
      finished|success|succeeded) echo "  nasazení ${NASAZENI}: $STAV"; return 0 ;;
      failed|cancelled|canceled|error)
        echo "::error title=nasazení SELHALO::${APP} — nasazení ${NASAZENI} skončilo se stavem '${STAV}'."
        echo "Log je v Coolify u toho nasazení. Pozor: obraz jedné služby se mohl postavit"
        echo "úspěšně — compose je JEDEN CELEK, takže pád kterékoli služby znamená, že se"
        echo "nevymění ŽÁDNÝ kontejner a běží dál ta stará verze."
        diagnostikuj_neuplny_prenos "$NASAZENI"
        if dalsi_pokus "$NASAZENI"; then STAV="opakovat"; break; fi
        exit 1 ;;
      "") printf '  (stav nasazení zatím neznámý)\n' ;;
      queued) printf '  nasazení %s: queued — ve frontě Coolify %ss (strop fronty %ss)\n' "${NASAZENI:0:8}" "$(( ted - zacatek ))" "$FRONTA_S" ;;
      *)
        if [ "$konec" -eq 0 ]; then
          konec=$(( ted + TIMEOUT_S ))
          printf '  nasazení %s opustilo frontu po %ss — od teď běží strop práce %ss\n' "${NASAZENI:0:8}" "$(( ted - zacatek ))" "$TIMEOUT_S"
        fi
        printf '  nasazení %s: %s\n' "${NASAZENI:0:8}" "$STAV" ;;
    esac
    sleep 15
  done
  [ "$STAV" = "opakovat" ] && return 0
  # ⛔ NEDOBĚHLO V ČASE ≠ SELHALO. NAMĚŘENO 2026-09-24 (běh 51874, vlna 7):
  # <fork>-orchestration, <fork>-domain-services a <fork>-source-broker byly po 1800 s
  # stále `in_progress`/`queued` (server vytížilo 5–6 cizích nasazení), CI je
  # ohlásilo jako SELHALO — a Coolify je všechna tři DOKONČIL úspěšně o 3–9 min
  # později. CI Coolify nasazení neruší, jen přestane čekat; výsledek je tedy
  # NEZNÁMÝ, ne špatný. Vlastní kód 4, ať volající (vlny) řekne pravdu.
  # Nečitelný stav (prázdná odpověď) zůstává kódem 1: tam nevíme ani to, že běží.
  case "$STAV" in
    queued)
      echo "::error title=nasazení NEZAČALO (fronta Coolify)::${APP} — nasazení ${NASAZENI} je po ${FRONTA_S}s stále ve FRONTĚ Coolify ('queued'), práce na něm nezačala. Coolify ho NEZRUŠIL a může doběhnout; výsledek je NEZNÁMÝ, ne selhání — dočti /api/v1/deployments/${NASAZENI}."
      exit 4 ;;
    in_progress)
      echo "::error title=nasazení NEDOBĚHLO V ČASE::${APP} — nasazení ${NASAZENI} opustilo frontu, ale PRÁCE je po ${TIMEOUT_S}s stále '${STAV}'. Coolify ho NEZRUŠIL a může doběhnout; výsledek je NEZNÁMÝ, ne selhání — dočti /api/v1/deployments/${NASAZENI}."
      exit 4 ;;
  esac
  echo "::error title=nasazení nedoběhlo::${APP} — nasazení ${NASAZENI} nedosáhlo terminálního stavu (fronta ${FRONTA_S}s, práce ${TIMEOUT_S}s; poslední: '${STAV:-neznámý}')."
  exit 1
}

cekej_na_nasazeni
if [ "$STAV" = "opakovat" ]; then
  POKUS=$((POKUS + 1))
  continue
fi
break
done

# ── 5. Počkat na terminální stav. Tohle je ten krok, který v CI chyběl. ─────
# ⚠️ ZDRAVOTNÍ SONDY SE ODTUD NESPOUŠTÍ (--no-health), a je to poctivost, ne
# ústupek. `--wait-healthy` zkouší MESH adresy (api.mesh.<instance>.internal),
# na které runner NEDOSÁHNE — v CI by tedy každé nasazení čekalo až do stropu
# a pak spadlo, i když je všechno v pořádku. Naměřeno 2026-08-08:
#   s --wait-healthy   ERR:fetch failed https://api.mesh.…/health → timeout
#   s --no-health      hotovo za 4 s: „deploys 0 active, 0 latest failed"
# Měřit odtud, odkud na cíl není vidět, je táž vada jako věřit barvě úlohy —
# jen dává falešně ČERVENOU. Že služba opravdu odpovídá, se ověřuje zevnitř
# (nebo veřejným artefaktem přes --verify-url), ne odsud.
if ! node scripts/coolify-deploy-watch.mjs \
      --wait --strict --no-health --no-clear \
      --prefix="$APP_PREFIX" --only="$SUFFIX" --timeout-s="$TIMEOUT_S"; then
  echo "::error title=deploy neproběhl::'$APP' nedoběhl do zdravého stavu (nebo spadl) do ${TIMEOUT_S}s."
  exit 1
fi

# ── 5b. JE NASAZENÁ MOJE REVIZE? — měření, které NEPOTŘEBUJE dveře. ────────
#
# ⭐ TOHLE JE TA SPRÁVNÁ OTÁZKA. Krok 6 níž se ptal „změnil se artefakt?", což je
# otázka zástupná a má TŘI vady:
#   1) je nepravdivá u změn, které ten artefakt měnit NEMAJÍ (merge, který sáhl
#      jen na CI nebo na testy) — a pak hlásí červenou nad bezvadným nasazením;
#   2) potřebuje projít VEŘEJNOU adresou;
#   3) za ostrými dveřmi (SPA knock) tiše změří NĚCO JINÉHO: odpověď vrátného
#      je před i po nasazení bajtově stejná, takže „cíl se nezměnil" vyskočí
#      i u dokonale proběhlého nasazení. Záměna předmětu měření, beze slova.
#
# ⛔ A hlavně: fetch veřejné adresy z CI je APLIKACE, KTERÁ ŤUKÁ. Pravidlo zní
# „ťuká vždy jen člověk, nikdy aplikace" — automatika jen za výslovným parametrem.
#
# Coolify přitom commit ZAZNAMENÁVÁ. Naměřeno 2026-08-11 nad <fork>-core:
#   {"commit":"5f7656a00dd2…","status":"finished","commit_message":"Merge …"}
# Tedy uvnitř, bez dveří, a odpovídá to na otázku, která nás zajímá.
if [ -n "${GIT_SHA:-}" ]; then
  REVIZE_NASAZENA=$(curl -s --max-time 20 -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
    "${COOLIFY_URL}/api/v1/deployments/${NASAZENI}" \
    | node -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
        try { process.stdout.write(String(JSON.parse(s).commit ?? "")); } catch { process.stdout.write(""); }
      });
    ')
  if [ -z "$REVIZE_NASAZENA" ]; then
    # Sonda musí umět říct „nevím" jinak než „je to špatně".
    echo "::warning title=revizi nasazení nelze přečíst::záznam ${NASAZENI} nenese pole 'commit' — NEDOKÁZÁNO, že je nasazená právě tahle revize."
    REVIZE_DUKAZ="NEDOKÁZÁNO: že nasazená revize je ${GIT_SHA:0:12} (Coolify commit nevrátil)."
  elif [ "${REVIZE_NASAZENA}" != "${GIT_SHA}" ]; then
    echo "::error title=nasazená revize NESEDÍ::nasazení ${NASAZENI} nese ${REVIZE_NASAZENA:0:12}, očekáváno ${GIT_SHA:0:12}."
    echo "Deploy doběhl, ale postavil se z JINÉ revize — přesně stav, kvůli kterému tenhle krok existuje."
    exit 1
  else
    echo "nasazená revize: ${REVIZE_NASAZENA:0:12} = ${GIT_SHA:0:12} ✓"
    REVIZE_DUKAZ="DOKÁZÁNO: nasazená revize je ${GIT_SHA:0:12} (ze záznamu nasazení, bez dotýkání veřejné adresy)."
  fi
else
  REVIZE_DUKAZ="NEDOKÁZÁNO: která revize je nasazená (GIT_SHA nebyl předán)."
fi

# ── 6. DOPLŇKOVÝ důkaz z veřejné cesty. NIKDY ne jediný. ───────────────────
#
# ⛔ PŘEPSÁNO 2026-08-11. Do té doby tenhle krok PADAL, když se otisk nezměnil.
# To tvrzení je nepravdivé ve třech situacích, a všechny nastaly:
#
#   1. Změna, která do artefaktu nezasahuje. `Deploy: Extranet` spadl nad merge,
#      který sáhl JEN na ci.yml a soubory bran — bundle se změnit NEMĚL.
#   2. Ostré dveře (SPA knock). Odpověď vrátného je před i po nasazení bajtově
#      stejná ⇒ „cíl se nezměnil" vyskočí i u bezvadného nasazení. Měřidlo tiše
#      měří DVEŘE místo artefaktu.
#   3. Fetch z CI je APLIKACE, KTERÁ ŤUKÁ — proti pravidlu „ťuká vždy jen člověk".
#
# ⭐ Tvrdý důkaz proto obstarává krok 5b (revize ze záznamu nasazení, bez dveří).
# Tady se hledá NEJSILNĚJŠÍ dostupné potvrzení: revize ZAPEČENÁ V ARTEFAKTU
# (`__GIT_SHA__` z vite define, doručeno v #175). Když ji v odpovědi najdeme,
# je dokázáno, že veřejná cesta servíruje právě tenhle commit. Když ne,
# NEDOKAZUJE to opak — mohly to být dveře, jiný asset, nebo cache.
if [ -n "$VERIFY_URL" ]; then
  TELO=$(mktemp); trap 'rm -f "$ODPOVED" "$TELO"' EXIT
  KOD_VERIFY=$(curl -s -o "$TELO" -w "%{http_code}" --max-time 20 "$VERIFY_URL" || true)
  OTISK_PO=$(shasum -a 256 < "$TELO" | cut -d' ' -f1)
  printf 'otisk PO   (%s): %s   [HTTP %s]\n' "$VERIFY_URL" "${OTISK_PO:0:12}" "$KOD_VERIFY"

  case "$KOD_VERIFY" in
    2*|3*) : ;;
    *)  # Neodpověď JE nález — ale ne nutně vada nasazení: takhle vypadá i vrátný.
        echo "::warning title=veřejná cesta neodpověděla::${VERIFY_URL} vrátila HTTP ${KOD_VERIFY}."
        echo "Za ostrými dveřmi (SPA knock) je to očekávané — CI ŤUKAT NESMÍ."
        OBSAH_DUKAZ="NEDOKÁZÁNO: co servíruje veřejná cesta (HTTP ${KOD_VERIFY})."
        ;;
  esac

  if [ -n "${GIT_SHA:-}" ] && grep -qF "$GIT_SHA" "$TELO" 2>/dev/null; then
    echo "veřejná cesta nese revizi ${GIT_SHA:0:12} ✓"
    OBSAH_DUKAZ="DOKÁZÁNO: ${VERIFY_URL} servíruje revizi ${GIT_SHA:0:12} (zapečenou v artefaktu)."
  elif [ "$OTISK_PO" != "$OTISK_PRED" ]; then
    OBSAH_DUKAZ="DOKÁZÁNO: obsah na ${VERIFY_URL} se po nasazení ZMĚNIL (revizi v něm ale nenajdu)."
  else
    # ⚠️ VAROVÁNÍ, NE PÁD. Shodný otisk je u no-op nasazení správný výsledek.
    echo "::warning title=obsah beze změny::${VERIFY_URL} vrací bajtově totéž co před nasazením."
    echo "Není to samo o sobě vada: buď se do tohohle artefaktu nic nezměnilo,"
    echo "nebo odpovídá vrátný. Tvrdý důkaz o revizi dává krok 5b."
    OBSAH_DUKAZ="NEDOKÁZÁNO: že se ZMĚNIL obsah (otisk shodný — u no-op nasazení očekávané)."
  fi
else
  OBSAH_DUKAZ="NEDOKÁZÁNO: že se změnil OBSAH artefaktu (nebyl předán --verify-url)."
fi

# ── 7. ODPOVÍDÁ SLUŽBA? Jen po VEŘEJNÉ cestě. ─────────────────────────────
# Runner do meshe nevidí (a pouštět ho tam by znamenalo dát kódu z libovolného
# PR přístup k vnitřním službám). Veřejná cesta je navíc SILNĚJŠÍ tvrzení:
# uživatel taky nepřichází z meshe, a mesh může být v pořádku, zatímco veřejná
# cesta je rozbitá — naměřeno 2026-08-08 (DB aktuální, bundle starý).
ZDRAVI="NEDOKÁZÁNO: že služba odpovídá (nebyla předána HEALTH_URL)."
if [ -n "$HEALTH_URL" ]; then
  # Pár pokusů: kontejner po nasazení chvíli nabíhá a jediné 502 hned po
  # přepnutí není vada, jen netrpělivost měřidla.
  ok=0
  dvere=0
  TELO_SONDY="$(mktemp)"
  for pokus in 1 2 3 4 5 6; do
    # ⛔ `|| true`, NIKDY `|| echo 000`. curl při selhání přenosu SÁM vypíše
    # `000`, takže sentinel se PŘILEPÍ (`000` → `000000`) a větev, která na
    # `000` čeká, je mrtvá. Naměřeno bránou `curl-http-code-capture-integrity`,
    # která přišla z upstreamu 2026-08-09 — a chytila tenhle řádek, napsaný
    # o den dřív v kroku, jehož celým smyslem je poctivé měření.
    # Táž třída jako „kanál s hodnotou nesmí nést diagnostiku": do proměnné,
    # která má nést KÓD, se přimíchá něco, co kódem není.
    kod=$(curl -s -o "$TELO_SONDY" -w "%{http_code}" --max-time 20 "$HEALTH_URL" || true)
    # Délka těla je DRUHÝ, nezávislý znak. Dveře odpovídají prázdným tělem
    # schválně ("kdo neťukal, nemá se dozvědět ani to, co je za dveřmi" —
    # services/svc-knock, handler /dvere). Aplikační 403 tělo skoro vždy má.
    delka=$(wc -c < "$TELO_SONDY" | tr -d ' ')
    printf '  sonda %d/6: HTTP %s (tělo %s B)\n' "$pokus" "$kod" "$delka"
    case "$kod" in 2*|3*) ok=1; break ;; esac
    # Dveře poznáme jen tam, kde je volající DEKLAROVAL, a jen na jejich
    # vlastním podpisu. Opakovat nemá smysl: verdikt vrátného se čekáním nezmění.
    if [ "$HEALTH_ZA_DVERMI" = "ano" ] && [ "$kod" = "403" ] && [ "$delka" -eq 0 ]; then
      dvere=1
      break
    fi
    sleep 10
  done
  rm -f "$TELO_SONDY"
  if [ "$ok" -eq 1 ]; then
    ZDRAVI="DOKÁZÁNO: služba odpovídá na $HEALTH_URL."
  elif [ "$dvere" -eq 1 ]; then
    # ⭐ NENÍ to pád služby a NENÍ to ani důkaz. Je to TŘETÍ výsledek: měřidlo
    # se nedostalo tam, kam mělo. Dveře odmítly nezaklepanou sondu — což je
    # jejich úkol, ne porucha.
    echo "::notice title=za dveře se z CI nevidí::${HEALTH_URL} odpověděl 403 s prázdným tělem."
    echo "To je podpis vrátného, ne mrtvá služba: nezaklepaný klient se nemá dozvědět, co je za dveřmi."
    echo "Ťukat z CI NEBUDEME — ťuká vždy jen člověk. Veřejnou cestou se tenhle povrch měřit nedá."
    ZDRAVI="NEDOKÁZÁNO: že služba odpovídá — dveře odmítly nezaklepanou sondu (403, prázdné tělo)."
  else
    echo "::error title=služba neodpovídá::${HEALTH_URL} po nasazení nevrátila 2xx/3xx."
    echo "Deploy doběhl, ale z místa, kde jsou uživatelé, služba nejede."
    exit 1
  fi
fi

echo
echo "DOKÁZÁNO: deploy '$APP' doběhl a Coolify nehlásí selhání."
echo "$ZDRAVI"
echo "$PREFLIGHT_STAV"
echo "$OPAKOVANI_STAV"
echo "$CACHEBUST_STAV"
echo "$REVIZE_STAV"
echo "${REVIZE_DUKAZ:-NEDOKÁZÁNO: která revize je nasazená.}"
echo "$OBSAH_DUKAZ"
echo "NEDOKÁZÁNO: dostupnost po VNITŘNÍ (mesh) cestě — na tu runner nevidí a nemá tam co dělat."

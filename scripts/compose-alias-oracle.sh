#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ORÁKULUM: NESE VNITŘNÍ ADRESA IDENTITU INSTANCE?
#
# ⛔ NAMĚŘENO 2026-08-16 živě (varra, síť `coolify`):
#
#     db-w5vgq…          aliasy: [db, aisha-db]
#     db-qosco…          aliasy: [db]              ← DVA nájemníci, jedno jméno
#     redis ×2 · web ×2 · n8n-redis ×3 · registry-cache ×2 · svc-agent-runner ×2
#
# Coolify připojuje aplikace na SDÍLENOU síť `coolify` a Docker tam každé službě
# přidá jako alias její KLÍČ V COMPOSE. Klíč identitu instance nenese, takže
# stejné jméno nárokuje víc nájemníků najednou. Vestavěný DNS mezi stejnojmennými
# ROUND-ROBINUJE — `postgresql://…@db:5432/…` z naší gateway tedy může skončit
# u cizí databáze. Ne teoreticky: gateway na té síti je a to jméno používá.
#
# PŘIDAT ALIAS NESTAČÍ. Holý klíč tam Docker dá vždycky a odebrat se nedá.
# Jediná obrana je holé jméno NEPOUŽÍT: každý odkaz musí být tvaru
# `${APP_NAME_PREFIX:?}-<služba>`, na který umí odpovědět jen naše instance.
#
# TENHLE SKRIPT MĚŘÍ DVĚ VLASTNOSTI, obě z RENDERU (ne ze zdrojového textu —
# kotvy a sloučení `<<:` řádkový sken nevidí, a `container_name` vypadá jako
# alias, ačkoli ho Coolify zahazuje):
#
#   1. ŽÁDNÝ odkaz v hostitelské pozici nemíří na holý klíč služby,
#   2. KAŽDÉ jméno `<prefix>-x` v hostitelské pozici má deklarovaný alias.
#
# Ty dvě spolu drží pár. Bez (2) by šlo (1) „splnit" přejmenováním odkazu na
# jméno, které nikdo nezodpoví — přesně ta vada, kterou jsem 2026-08-16 vyrobil
# tím, že jsem přepsal odkazy DŘÍV, než jsem deklaroval aliasy.
#
# Použití:
#   bash scripts/compose-alias-oracle.sh            # všechny compose
#   bash scripts/compose-alias-oracle.sh --json     # strojově
#
# Exit 0 = obě vlastnosti platí, 1 = neplatí, 2 = NEZMĚŘENO (chybí docker/jq).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# ⛔ KOŘEN JE DEKLARACE, NE MÍSTO SPUŠTĚNÍ (naměřeno 2026-09-20).
# Výchozí kořen zůstává REPOZITÁŘ odvozený z vlastní cesty — doktor i dvě brány
# spoléhají, že orákulum měří repozitář, ať je spuštěné odkudkoli; `cwd` jako
# výchozí by udělalo měření závislé na tom, odkud kdo skript pustí (táž třída
# vady, jen otočená). Kdo chce měřit jinde — brána nad svou FIXTUROU — musí to
# říct nahlas přes `--root`. Do té doby brána stavěla fixturu do dočasného
# adresáře, spouštěla orákulum s `cwd` v něm, a orákulum si stejně `cd`lo do
# repozitáře: fixtura se tedy NIKDY nečetla a „kontrolní běh bez poruchy" měřil
# živý strom souběžně s patnácti dalšími branami.
KOREN_SKRIPTU="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$KOREN_SKRIPTU"
KOREN_ZDROJ="odvozeny"   # odvozeny | predany — vlastnost, kterou dnes nikdo nevidí
JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --root) ROOT="${2:?--root potřebuje adresář}"; KOREN_ZDROJ="predany"; shift 2 ;;
    --root=*) ROOT="${1#--root=}"; KOREN_ZDROJ="predany"; shift ;;
    *) echo "NEZMĚŘENO: neznámý argument '$1' (--json | --root <adresář>)" >&2; exit 2 ;;
  esac
done
[ -d "$ROOT" ] || { echo "NEZMĚŘENO: --root '$ROOT' není adresář — orákulum se NESPUSTILO." >&2; exit 2; }
ROOT="$(cd "$ROOT" && pwd)"
cd "$ROOT" || exit 2
# Knihovna renderu patří ke SKRIPTU, ne k měřenému stromu — jinak by `--root`
# nad cizím adresářem tiše měřil jeho verzí renderu, nebo by se nenašla vůbec.
# shellcheck source=scripts/lib/compose-render.sh
. "$KOREN_SKRIPTU/scripts/lib/compose-render.sh"

for n in docker jq; do
  command -v "$n" >/dev/null 2>&1 || {
    echo "NEZMĚŘENO: chybí '$n' — orákulum se NESPUSTILO. To není zelený výsledek." >&2
    exit 2
  }
done

PFX="$COMPOSE_RENDER_PREFIX"
RENDER_DIR=$(mktemp -d)
trap 'rm -rf "$RENDER_DIR"' EXIT

# ── 1. render všeho, co se vyrenderovat dá ───────────────────────────────────
# Soubor, který se nevyrenderuje, je NEZMĚŘENO — ne „bez nálezů". Overlay
# (`docker-compose.coolify.netseg.yml`) projektem sám o sobě není a `livekit`
# má vlastní vadu; ani jeden se nesmí tvářit jako čistý.
# Renderuje se PARALELNĚ. Sériově to trvalo 14,5 s a doktor tím přelezl
# 120s limit brány `cold-start-doctor` — kontrola, která měla nasazení chránit,
# by ho místo toho zdržela. Soubory na sobě nezávisí, každý má vlastní `env -i`.
nezmereno=()
nezmereno_overlay=()
nezmereno_vada=()
soubory=()
vsechny=()
while IFS= read -r f; do
  [ -n "$f" ] && vsechny+=("$f")
done < <(ls docker-compose.coolify*.yml 2>/dev/null | sort)

# Šířka podle jader, ale se stropem: docker démon je sdílený a přehnaná
# souběžnost ho zdrží víc, než kolik ušetří.
_jader=$( (sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null) || echo 4 )
_soubezne=$(( _jader > 8 ? 8 : _jader ))
[ "$_soubezne" -lt 1 ] && _soubezne=1

# `wait -n` (čekej na PRVNÍ hotový) je bash 4.3+; macOS veze 3.2, kde je to
# neplatná volba. Čekalo se proto na CELOU dávku — jenže bariéra po každé
# osmici znamená, že se pokaždé čeká na nejpomalejšího z ní a okno se mezitím
# vyprazdňuje. Naměřeno 2026-08-18: 32 souborů, 13,7 s, a doktor kvůli tomu
# (spolu s druhým orákulem) přerostl 120s limit své vlastní brány.
#
# Přenosná náhrada za `wait -n` je POČÍTAT běžící úlohy: okno se doplňuje
# průběžně, takže nikdo nečeká na cizí dokončení. Práh i strop zůstávají —
# mění se jen to, kdy se do okna pouští další.
for f in "${vsechny[@]}"; do
  # ⛔ DŮVOD SELHÁNÍ SE NESMÍ ZTRATIT (naměřeno 2026-09-20, převzato z práce
  # relace jednoho forku): stderr renderu šel do /dev/null, takže „nevyrenderovalo
  # se" bylo bez příčiny a hledalo se čtením logů běhounu. Tři relace tu vadu
  # hledaly nezávisle, každá z jiné strany, právě proto že orákulum mlčelo.
  compose_render_json "$f" > "$RENDER_DIR/$(basename "$f").json" 2>"$RENDER_DIR/$(basename "$f").err" &
  while [ "$(jobs -pr | wc -l | tr -d ' ')" -ge "$_soubezne" ]; do sleep 0.05; done
done
wait

# Verdikt až po dokončení: prázdný soubor znamená, že render selhal. Rozlišit
# se to MUSÍ — „nevyrenderovalo se" není „bez nálezů".
for f in "${vsechny[@]}"; do
  j="$RENDER_DIR/$(basename "$f").json"
  if [ -s "$j" ] && jq -e '.services' "$j" >/dev/null 2>&1; then
    soubory+=("$f")
  else
    rm -f "$j"
    # ⛔ NAMĚŘENO 2026-09-02: „nevyrenderovalo se" se slévalo do JEDNOHO čísla,
    # ať šlo o overlay (fragment, který projektem sám o sobě NENÍ) nebo o
    # selhání renderu. Verdikt se pak počítal z NEÚPLNÉ unie: se souborem
    # zmizely i jeho `aliases:`, ale odkazy na ně z ostatních souborů zůstaly —
    # a spočítaly se jako „prefixované jméno, které nikdo nedeklaruje".
    #
    # Brána tím jednou ukázala na cizí soubor a podruhé mlčela, podle toho, co
    # zrovna vypadlo: TÝŽ commit dal `fail, pass, pass`. Nešlo o vadu v repu,
    # ale o měření vlastní neúplnosti vydávané za nález.
    #
    # Overlay se pozná VLASTNOSTÍ, ne textem chybové hlášky: fragment nedeklaruje
    # u žádné služby `image:` ani `build:`, takže projektem být nemůže. Naměřeno
    # na všech 32 souborech — přesně jeden (netseg) má nulu a přesně ten se
    # nerenderuje. Chybová hláška by se dala změnit vydáním dockeru; tahle
    # vlastnost je v souboru samotném.
    #
    # ⛔ DOPLNĚK 2026-09-20 (převzato z práce relace jednoho forku, e341e2bfb):
    # tolerance platí JEN pro fragment, který do unie jmen NIC NEPŘIDÁVÁ. Kdyby
    # overlay `aliases:` deklaroval a nevyrenderoval se, zmizí s ním z unie i ta
    # jména — a odkazy na ně vyjdou jako „osiřelé" v cizím souboru, tedy tiše
    # nesprávný nález. Vlastnost tedy nestačí jedna.
    #
    # Naměřeno dnes: `docker-compose.coolify.netseg.yml` má 0 `aliases:` i
    # 0 `image`/`build` (5 služeb, render padá na „service svc-plugin-system has
    # neither an image nor a build context" — což je právě ta vlastnost fragmentu).
    # Dnešní verdikt se tím tedy NEMĚNÍ; zavírá se past pro příští overlay.
    if [ "$(grep -cE '^[[:space:]]+(image|build):' "$f")" -eq 0 ] \
       && [ "$(grep -cE '^[[:space:]]+aliases:' "$f")" -eq 0 ]; then
      nezmereno_overlay+=("$f")
    else
      nezmereno_vada+=("$f")
    fi
    nezmereno+=("$f")
  fi
done

if [ ${#soubory[@]} -eq 0 ]; then
  echo "NEZMĚŘENO: nevyrenderoval se ani jeden compose." >&2
  exit 2
fi

# ── 2. co je KLÍČ služby a co je DEKLAROVANÝ alias ───────────────────────────
# Obojí přes UNII všech souborů: odkazy chodí i napříč aplikacemi (langfuse volá
# minio z jádra), takže per-soubor pohled by hlásil falešné díry.
#
# ⛔ NAMĚŘENO 2026-09-18: brána padala v CI (3× ze 4 běhů, „osiřelé" 2, pak 1),
# lokálně nad TÝMŽ commitem 6× z 6 nula. Vytěžení šlo smyčkou `for … jq …; done
# | sort -u` bez kontroly: selhání jq u jednoho souboru se spolklo, jeho aliasy
# z unie tiše zmizely a odkazy na ně se spočítaly jako NÁLEZ. Selhání vytěžení
# je selhání MĚŘENÍ — soubor jde do `nezmereno_vada`, verdikt se nepočítá.
klice=""; aliasy=""; hodnoty=""
# Provenience: `jméno<TAB>soubor`. Unie sama o sobě neumí říct, KDO jméno
# přinesl — a právě to nás u páté různé služby drželo ve spekulacích.
aliasy_prov=""
vytezeni_selhalo=()
for j in "$RENDER_DIR"/*.json; do
  b=$(basename "$j" .json)
  if ! k=$(jq -r '.services | keys[]' "$j") \
     || ! a=$(jq -r '.services[]? | (.networks // {})[]? | (.aliases // [])[]?' "$j") \
     || ! h=$(jq -r --arg f "$b" '
          [paths(type=="string") as $p | {p:($p|map(tostring)|join(".")), v:getpath($p)}] | .[]
          | select(.p | test("\\.(environment|command|entrypoint|labels)\\b"))
          | "\($f)\t\(.p)\t\(.v | gsub("[\\n\\t\\r]";" "))"' "$j"); then
    vytezeni_selhalo+=("$b")
    continue
  fi
  klice+="$k"$'\n'; aliasy+="$a"$'\n'; hodnoty+="$h"$'\n'
  while IFS= read -r _jm; do
    [ -n "$_jm" ] && aliasy_prov+="${_jm}"$'\t'"${b}"$'\n'
  done <<< "$a"
done
klice=$(printf '%s' "$klice" | sed '/^$/d' | sort -u)
aliasy=$(printf '%s' "$aliasy" | sed '/^$/d' | sort -u)
hodnoty=$(printf '%s' "$hodnoty" | sed '/^$/d')
for b in ${vytezeni_selhalo[@]+"${vytezeni_selhalo[@]}"}; do
  echo "NEZMĚŘENO: vytěžení jq selhalo u ${b} — jeho jména v unii chybí." >&2
  nezmereno_vada+=("${b} (vytěžení)")
  nezmereno+=("$b")
done

# ── 3. hodnoty v HOSTITELSKÉ pozici ──────────────────────────────────────────
# Jen tam, kde jméno opravdu adresuje: env, command, entrypoint, labels.
# `depends_on` je klíč compose, ne DNS jméno — ten se prefixovat NESMÍ.
# Víceřádkové hodnoty (`command: |`) by rozbily řádkovou strukturu a nález by
# se pak tvářil, že patří k jinému souboru — proto se bílé znaky uvnitř hodnoty
# nahradí mezerou. Měříme JMÉNA, ne formátování.

# Holý odkaz: klíč služby následovaný `:port`, neuvozený znakem jména/tečkou
# (aby `foo-db:5432` netrefilo `db` a `redis.example.com:6379` taky ne).
hole=$(printf '%s\n' "$klice" | while IFS= read -r s; do
  [ -z "$s" ] && continue
  printf '%s\n' "$hodnoty" \
    | grep -E "(^|[^A-Za-z0-9._-])${s}:[0-9]{2,5}" \
    | sed "s|^|${s}\t|"
done | sort -u)

# Odkaz s prefixem, kterému nikdo neodpovídá.
#
# HRANICE: bere se JEN hostitelská pozice — `<jméno>:<port>`, nebo celá hodnota
# klíče končícího na `_HOST`/`_HOSTNAME`. Prefixované jméno nese i síť
# (`SHARED_NET`), volume nebo cesta; ty žádný alias mít nemají a hlásit je jako
# osiřelé by byl přesně ten typ nálezu, který odpovídá na jinou otázku.
# ⛔ OTISK MUSÍ MÍT OBĚ STRANY (naměřeno 2026-09-21): `jmen_otisk` fingerprintuje
# jen DEKLAROVANÁ jména. Verdikt ale vzniká porovnáním dvou množin — deklarací
# a KANDIDÁTŮ (prefixovaných jmen nalezených v hostitelské pozici). Když se dva
# běhy shodnou v počtech i v otisku jmen a přesto dají jiný verdikt, musí se
# lišit ta druhá množina; bez jejího otisku to nešlo odlišit od vady v samotném
# porovnání. Proto se kandidáti počítají zvlášť a otiskují taky:
# shodný `jmen_otisk` + shodný `kandidatu_otisk` ⇒ verdikt MUSÍ být shodný.
kandidati=$(printf '%s\n' "$hodnoty" | awk -F'\t' -v p="$PFX" '
  {
    if (match($3, "(^|[^A-Za-z0-9._-])" p "-[a-z0-9][a-z0-9-]*:[0-9][0-9]+")) {
      s = substr($3, RSTART, RLENGTH); sub(/^[^A-Za-z0-9]/, "", s); sub(/:[0-9]+$/, "", s); print s
    }
    if ($2 ~ /_HOSTNAME$|_HOST$/ && $3 ~ ("^" p "-[a-z0-9][a-z0-9-]*$")) print $3
  }' | sort -u)

osirele=$(printf '%s\n' "$kandidati" | while IFS= read -r n; do
      [ -z "$n" ] && continue
      # ⛔ Herestring, ne roura do `grep -q` — pod pipefail z nalezeného jména
      # dělá SIGPIPE „osiřelé". Rozbor a měření: brána jmeno-na-sdilene-siti.
      grep -qxF "$n" <<< "$aliasy" || printf '%s\n' "$n"
    done)

# ── 3a. PROVENIENCE OSIŘELÉHO JMÉNA ──────────────────────────────────────────
# ⛔ NAMĚŘENO 2026-09-21 (pátý pokus, páté různé jméno: svc-matrix,
# svc-mcp-knowledge, svc-ai-chat, svc-matrix znovu, svc-push). Orákulum dosud
# hlásilo, ŽE jméno nikdo nedeklaruje — ale ne, KDO ho měl deklarovat. Relace
# proto hádaly ze vstupů (overlay? profily? render?) místo aby četly měření:
# deklarace `aliases: ["${APP_NAME_PREFIX}-svc-push", "svc-push"]` prokazatelně
# existuje a její soubor se vyrenderoval, a přesto odkaz vyjde osiřelý.
#
# Chybějící údaj je provenience. Tyhle tři řádky ji dodávají:
#   · KDO ODKAZUJE — soubor a klíč, ze kterého odkaz pochází;
#   · KDO DEKLARUJE PODOBNÉ — jména se shodným sufixem za prefixem. Když
#     existuje holý `svc-push`, ale prefixovaný ne, je vada v SUBSTITUCI
#     prefixu při renderu, ne v repu;
#   · NEVYRENDEROVANÉ — alias, ve kterém po renderu zůstalo `${`. To je přímý
#     důkaz, že se proměnná nedosadila; unie pak nese jméno, které v běhu
#     nikdy nevznikne.
# Když nepadne ani jedno, je odpověď „deklaraci nepřinesl ŽÁDNÝ soubor" —
# a to je teprve nález o repu.
osirele_prov=""
while IFS= read -r n; do
  [ -z "$n" ] && continue
  _sufix=${n#"$PFX"-}
  _kdo=$(printf '%s\n' "$hodnoty" | awk -F'\t' -v n="$n" 'index($3, n) > 0 { print $1 " (" $2 ")" }' | sort -u | sed -n '1,3p' | paste -sd'; ' -)
  _podobne=$(printf '%s\n' "$aliasy_prov" | awk -F'\t' -v s="$_sufix" '$1 == s || $1 ~ ("-" s "$") { print $1 " <- " $2 }' | sort -u | sed -n '1,3p' | paste -sd'; ' -)
  _nerender=$(printf '%s\n' "$aliasy_prov" | awk -F'\t' -v s="$_sufix" 'index($1, "${") > 0 && index($1, s) > 0 { print $1 " <- " $2 }' | sort -u | sed -n '1,3p' | paste -sd'; ' -)
  [ -n "$_kdo" ]      || _kdo="(odkaz se nepodařilo dohledat)"
  [ -n "$_podobne" ]  || _podobne="NIKDO — deklaraci nepřinesl žádný soubor"
  [ -n "$_nerender" ] || _nerender="žádné"
  osirele_prov+="${n} | odkazuje: ${_kdo} | deklaruje podobné: ${_podobne} | nevyrenderované: ${_nerender}"$'\n'
done <<< "$(printf '%s\n' "$osirele" | sed '/^$/d')"

# ── 3b. SLUŽBA NA SDÍLENÉ SÍTI BEZ IDENTITNÍHO ALIASU ────────────────────────
# Docker přidá každé službě na síť jako alias JEJÍ KLÍČ V COMPOSE — vždycky a
# neodstranitelně. Když služba na SDÍLENÉ síti nemá NAVÍC alias nesoucí identitu
# instance, je jediné jméno, kterým jde adresovat, to sdílené — a o to se dělí
# s každým cizím nájemníkem, který má službu stejného jména.
#
# ⛔ NAMĚŘENO 2026-08-18, stálo to celý den: `netbird-proxy` byl na síti
# `coolify` BEZ identitního aliasu. Na témže hostiteli má jiná instance (`<fork>`) službu
# téhož jména. Vestavěný DNS mezi stejnojmennými round-robinuje, takže polovina
# požadavků na naši doménu skončila u cizí instance — naměřeno 12 požadavků
# s týmž tokenem: 200 401 200 401 200 401 …
# Doktor tu kolizi VIDĚL, ale zapsal ji jako „patří JINÝM nájemníkům — tohle
# nasazení se jich netýká". Netýká se NÁS jméno, které náš vlastní Caddy
# rozkládá? Týká.
#
# PROČ TO NEODHALILY vlastnosti 1 a 2: obě měří, JAK ADRESUJEME OSTATNÍ (odkazy
# v hostitelské pozici). Tahle měří, JAK JSME ADRESOVATELNÍ MY. Jiná otázka,
# proto vlastní měřidlo.
#
# Sdílená síť = `external: true`. Interní sítě instance kolidovat nemohou —
# jsou její vlastní.
bez_identity=$(for j in "$RENDER_DIR"/*.json; do
  b=$(basename "$j" .json)
  jq -r --arg f "$b" --arg p "$PFX" '
    (.networks // {}) as $sit
    | .services // {} | to_entries[]
    | .key as $sluzba | .value.networks // {} | to_entries[]
    # SDÍLENÁ = jméno sítě NENESE identitu instance. `external: true` je špatný
    # rozlišovač: naše vlastní `internal` i `mesh-dns` jsou taky external (jen je
    # zakládá jiný compose), ale jmenují se `<prefix>-shared-net` / `<prefix>-mesh-dns`,
    # takže na nich cizí nájemník být nemůže. Naměřeno: filtr na `external`
    # přestřelil 132 nálezů místo skutečných kolizních míst.
    | select((($sit[.key].name // .key) | startswith($p + "-")) | not)
    | select([(.value.aliases // [])[] | select(startswith($p + "-"))] | length == 0)
    | "\($f)\t\($sluzba)\t\(.key)"' "$j" 2>/dev/null
done | sort -u)

p_bez=$(printf '%s\n' "$bez_identity" | sed '/^$/d' | wc -l | tr -d ' ')

# ── 3. JMÉNO TRAEFIK SLUŽBY NESMÍ ZÁVISET NA INTERPOLACI ─────────────────────
# ⛔ NAMĚŘENO 2026-08-18 na živých kontejnerech, stálo to celodenní výpadek mesh:
#
#     traefik.http.services.${APP_NAME_PREFIX:?…}-netbird-proxy.loadbalancer…
#
# Coolify svoje VLASTNÍ generované labely interpoluje (`caddy_0=https://…`,
# routery s UUID aplikace), ale ručně psaný label z compose propouští BEZE ZMĚNY.
# V kontejneru pak stojí literál `${APP_NAME_PREFIX:?…}` — a cizí nájemník má
# přesně týž literál. Traefik proto považuje dva kontejnery za dvě instance
# JEDNÉ služby a rozkládá mezi ně zátěž: naměřeno 12 požadavků s týmž tokenem,
# 200 401 200 401 … Router přitom směroval správně (každý má svůj Host), rozpadlo
# se to až na druhém kroku, o identitě nevědoucím.
#
# Proto se to měří ze ZDROJE, ne z renderu: render proměnnou dosadí, takže by
# vadu skryl. Rozhoduje, co je v souboru — protože právě to Coolify předá dál.
# Táž třída jako #139: šablona doručená místo hodnoty.
traefik_sablona=$(for f in "${vsechny[@]}"; do
  grep -nE 'traefik\.http\.(services|routers|middlewares)\.[^"=]*\$\{' "$f" 2>/dev/null \
    | sed "s|^|$(basename "$f")\t|"
done | sort -u)

p_traefik=$(printf '%s\n' "$traefik_sablona" | sed '/^$/d' | wc -l | tr -d ' ')

p_hole=$(printf '%s\n' "$hole" | sed '/^$/d' | wc -l | tr -d ' ')
p_osirele=$(printf '%s\n' "$osirele" | sed '/^$/d' | wc -l | tr -d ' ')
# ⛔ ABY ŠLO POZNAT PRÁZDNÉ MĚŘENÍ (naměřeno 2026-09-20): počet souborů nestačí —
# brána nad fixturou by prošla i tehdy, kdyby v ní nebylo ani jedno jméno.
# Tyhle dvě čísla říkají, nad JAK VELKOU množinou verdikt vznikl.
p_jmen=$(printf '%s\n' "$aliasy" | sed '/^$/d' | wc -l | tr -d ' ')
p_odkazu=$(printf '%s\n' "$hodnoty" | sed '/^$/d' | wc -l | tr -d ' ')
# ⛔ OTISK MNOŽINY, NE JEN POČET (naměřeno 2026-09-20): dva běhy nad TÝMŽ stromem
# vydaly shodné počty (34 souborů / 86 jmen / 2024 odkazů) a přesto JINÝ verdikt —
# jeden nález, druhý nic. Počet tedy neodliší „měřilo se totéž" od „měřilo se jinak".
# Otisk to odliší: dva běhy se stejným otiskem MUSEJÍ dát stejný verdikt.
p_jmen_otisk=$(printf '%s\n' "$aliasy" | sed '/^$/d' | sort | shasum -a 256 2>/dev/null | cut -c1-12)
[ -n "$p_jmen_otisk" ] || p_jmen_otisk="neznamy"
p_kandidatu=$(printf '%s\n' "$kandidati" | sed '/^$/d' | wc -l | tr -d ' ')
p_kandidatu_otisk=$(printf '%s\n' "$kandidati" | sed '/^$/d' | sort | shasum -a 256 2>/dev/null | cut -c1-12)
[ -n "$p_kandidatu_otisk" ] || p_kandidatu_otisk="neznamy"

# ⛔ VERDIKT SE NESMÍ POČÍTAT Z NEÚPLNÉ UNIE.
# `hole_odkazy` i `osirele_odkazy` se obě opírají o množinu DEKLAROVANÝCH jmen,
# a ta vzniká unií vyrenderovaných souborů. Když se soubor nevyrenderoval kvůli
# VADĚ (ne proto, že je to overlay), chybí i jeho deklarace — a odkazy na ně se
# spočítají jako nález. Naměřená hodnota by pak byla o měřidle, ne o repu.
#
# Overlay tenhle problém nemá: fragment žádné služby nedeklaruje, takže jeho
# nepřítomnost unii nezmenšuje. Proto se rozlišuje.
#
# Obě čísla se v takovém případě vydají jako `null` — ne 0 (to by bylo „čisté")
# a ne N (to by ukazovalo na cizí soubor). `null` znamená NEZMĚŘENO a brána na
# něj musí reagovat jako na selhání MĚŘENÍ, ne jako na vadu v repu.
if [ ${#nezmereno_vada[@]} -gt 0 ]; then
  echo "NEZMĚŘENO: render selhal u ${#nezmereno_vada[@]} souboru/ů (${nezmereno_vada[*]})." >&2
  # Důvod k PRVNÍMU z nich — jednou, ať výpis nezakryje skutečné nálezy.
  _prvni="$RENDER_DIR/$(basename "${nezmereno_vada[0]}").err"
  if [ -s "$_prvni" ]; then
    echo "  důvod (${nezmereno_vada[0]}): $(head -c 400 "$_prvni" | tr '\n' ' ')" >&2
  else
    echo "  důvod (${nezmereno_vada[0]}): render nevydal ani stderr — prostředí, ne soubor." >&2
  fi
  echo "  Unie deklarovaných jmen je tím neúplná, takže odkazy na ně nelze posoudit." >&2
fi

if [ "$JSON" = "1" ]; then
  if [ ${#nezmereno_vada[@]} -gt 0 ]; then
    _hole=null; _osirele=null
  else
    _hole="$p_hole"; _osirele="$p_osirele"
  fi
  # Jména, ne jen čísla: brána v CI jinak neumí říct, NA CO ukazuje.
  jq -n --argjson hole "$_hole" --argjson osirele "$_osirele" \
        --argjson traefik "$p_traefik" --argjson mereno "${#soubory[@]}" --argjson nezmereno "${#nezmereno[@]}" \
        --argjson nez_overlay "${#nezmereno_overlay[@]}" --argjson nez_vada "${#nezmereno_vada[@]}" \
        --arg osirele_seznam "$osirele" --arg hole_seznam "$(printf '%s\n' "$hole" | cut -f1 | sort -u)" \
        --arg osirele_prov "$osirele_prov" \
        --arg koren "$ROOT" --arg koren_zdroj "$KOREN_ZDROJ" \
        --argjson jmen "$p_jmen" --argjson odkazu "$p_odkazu" --arg jmen_otisk "$p_jmen_otisk" \
        --argjson kandidatu "$p_kandidatu" --arg kandidatu_otisk "$p_kandidatu_otisk" \
        --arg nezmereno_seznam "$(printf '%s\n' ${nezmereno_vada[@]+"${nezmereno_vada[@]}"} ${nezmereno_overlay[@]+"${nezmereno_overlay[@]}"})" \
        '{hole_odkazy:$hole, osirele_odkazy:$osirele, traefik_jmeno_ze_sablony:$traefik,
          koren:$koren, koren_zdroj:$koren_zdroj,
          jmen_deklarovanych:$jmen, odkazu_zkoumanych:$odkazu, jmen_otisk:$jmen_otisk,
          kandidatu:$kandidatu, kandidatu_otisk:$kandidatu_otisk,
          souboru_mereno:$mereno, souboru_nezmereno:$nezmereno,
          nezmereno_overlay:$nez_overlay, nezmereno_vada:$nez_vada,
          osirele_jmena:($osirele_seznam | split("\n") | map(select(length > 0))),
          osirele_provenience:($osirele_prov | split("\n") | map(select(length > 0))),
          hole_jmena:($hole_seznam | split("\n") | map(select(length > 0))),
          nezmereno_soubory:($nezmereno_seznam | split("\n") | map(select(length > 0)))}'
  [ ${#nezmereno_vada[@]} -eq 0 ] && [ "$p_hole" -eq 0 ] && [ "$p_osirele" -eq 0 ] && [ "$p_traefik" -eq 0 ]
  exit $?
fi

echo "orákulum jmen — měřeno ${#soubory[@]} compose souborů (prefix '${PFX}')"
echo

if [ "$p_hole" -gt 0 ]; then
  echo "✗ ODKAZ NA HOLÉ JMÉNO SLUŽBY: ${p_hole}"
  echo "  Na sdílené síti 'coolify' to jméno nárokuje i cizí nájemník; DNS mezi"
  echo "  stejnojmennými round-robinuje, takže spojení může skončit u něj."
  printf '%s\n' "$hole" | sed '/^$/d' | sed -n '1,60p' \
    | awk -F'\t' '{printf "    %-20s %s\n    %s%s\n", $1, $2, "  → ", substr($4,1,88)}'
  echo
else
  echo "✓ žádný odkaz na holé jméno služby"
fi

if [ "$p_osirele" -gt 0 ]; then
  echo "✗ ODKAZ NA JMÉNO, KTERÉ NIKDO NEDEKLARUJE: ${p_osirele}"
  echo "  Prefix sám o sobě nestačí — bez 'aliases:' to jméno neresolvuje nikdo."
  printf '%s\n' "$osirele" | sed '/^$/d' | sed 's/^/    /'
  # Provenience: bez ní se hledá příčina čtením cizích logů, ne měřením.
  echo "  provenience (kdo odkazuje / kdo deklaruje podobné jméno):"
  printf '%s\n' "$osirele_prov" | sed '/^$/d' | sed 's/^/    /'
  echo
else
  echo "✓ každé prefixované jméno má deklarovaný alias"
fi

if [ "$p_traefik" -gt 0 ]; then
  echo "✗ JMÉNO TRAEFIK SLUŽBY ZÁVISÍ NA INTERPOLACI: ${p_traefik}"
  echo "  Coolify ručně psané labely NEINTERPOLUJE — do kontejneru se dostane"
  echo "  literál '\${VAR}', a cizí nájemník má týž literál. Traefik pak dva"
  echo "  kontejnery považuje za jednu službu a rozkládá mezi ně zátěž."
  echo "  Náprava: jméno služby bez proměnné (Coolify své vlastní routery už"
  echo "  odlišuje UUID aplikace), nebo label nepsat vůbec a nechat generování."
  printf '%s\n' "$traefik_sablona" | sed '/^$/d' | sed 's/^/    /' | cut -c1-150
  echo
else
  echo "✓ žádné jméno Traefik služby nezávisí na interpolaci"
fi

if [ ${#nezmereno[@]} -gt 0 ]; then
  echo "· NEZMĚŘENO (nevyrenderovalo se): ${nezmereno[*]}"
  echo "  Není to nález ani čistý štít — o těch souborech orákulum NEŘÍKÁ NIC."
fi

[ "$p_hole" -eq 0 ] && [ "$p_osirele" -eq 0 ] && [ "$p_traefik" -eq 0 ]

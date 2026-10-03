#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ORÁKULUM: STAČÍ ODVOZENÁ MNOŽINA NA PARSOVÁNÍ COMPOSE?
#
# Odvození v `coolify_parse_required_keys` je PRAVIDLO. Tenhle skript je jeho
# ZKOUŠKA — a rozhoduje o ní parser, ne úsudek. Postup:
#
#   1. odvoď množinu klíčů D pro daný compose,
#   2. postav prostředí, kde má hodnotu PRÁVĚ jen D a nic jiného,
#   3. spusť `docker compose config -q`.
#
# Projde-li parser, je D dostatečná. Selže-li na "required variable X is
# missing a value", je D děravá — a to je ROZBITÝ DEPLOY, ne menší expozice.
#
# PROČ ZKOUŠKA A NE ÚVAHA: pravidlo se opírá o pozici v souboru (uvnitř
# `environment:` × mimo něj) a o escapování `$$`. Obojí je věc parseru. Kdykoli
# se pravidlo zpřísní, tenhle skript řekne, jestli se tím něco nerozbilo —
# dřív, než to řekne nasazení.
#
# ÚMYSLNĚ SE NEPTÁ NA BEZPEČNOST. Tenhle skript zná jen jednu otázku: „projde
# parse?". Kolik tajemství v D zůstalo, měří brána `build-time-mnozina-vsech-
# compose` a doktor (fáze X). Dvě otázky, dvě měřidla.
#
# Použití:
#   bash scripts/compose-buildtime-oracle.sh                    # všechny compose
#   bash scripts/compose-buildtime-oracle.sh <soubor> [...]     # vybrané
#
# Výstup: řádek na soubor + souhrn. Exit 0 = všechny prošly, 1 = některý ne,
# 2 = nástroj chybí (NEZMĚŘENO — což NENÍ úspěch).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
# shellcheck source=scripts/lib/coolify-buildtime-envs.sh
. "$ROOT/scripts/lib/coolify-buildtime-envs.sh"
# Renderování (atrapy, maximální množina jmen, `env -i`) je SPOLEČNÉ s orákulem
# na jména — jinak by se dvě měřidla rozešla v tom, nad jakým dokumentem měří.
# shellcheck source=scripts/lib/compose-render.sh
. "$ROOT/scripts/lib/compose-render.sh"

if ! docker compose version >/dev/null 2>&1; then
  echo "NEZMĚŘENO: 'docker compose' není k dispozici — orákulum se NESPUSTILO." >&2
  echo "To není zelený výsledek; je to chybějící měření." >&2
  exit 2
fi


# ⛔ ZDE BYL ŘÁDKOVÝ DETEKTOR OVERLAYŮ — a mýlil se. Hledal `image:`/`build:`
# pod službou a označil `docker-compose.coolify-pki.yml` za overlay, přestože
# je to nasazovaný stack: obraz mu dodává YAML sloučení `<<: *openxpki-image`,
# které řádkový sken nevidí. Táž vada, jakou tu dnes zavíráme jinde — odpověď
# na JINOU otázku, než jaká byla položena.
#
# Náhrada se neptá souboru, ale PARSERU, a přisuzuje vinu srovnáním:
# selže-li parse s ÚZKOU (odvozenou) množinou, spustí se znovu s MAXIMÁLNÍ —
# každé jméno, které se v souboru vyskytne. Projde-li maximální, je selhání
# opravdu způsobené zúžením (= vada odvození). Selže-li i maximální, žádná
# množina klíčů by nepomohla; soubor sám o sobě projekt není (overlay) nebo je
# vadný jinak — a to je TŘETÍ verdikt, NEZMĚŘENO, ne úspěch a ne pád.


# `mapfile` tu být nesmí: macOS veze bash 3.2 a builtin tam neexistuje. Tichý
# důsledek by byl PRÁZDNÝ seznam souborů, tedy „nic k měření" — což vypadá
# k nerozeznání od „vše prošlo". Proto while-read, který běží všude.
soubory=()
if [ "$#" -gt 0 ]; then
  soubory=("$@")
else
  while IFS= read -r f; do
    [ -n "$f" ] && soubory+=("$f")
  done < <(ls docker-compose.coolify*.yml 2>/dev/null | sort)
fi
if [ ${#soubory[@]} -eq 0 ]; then
  echo "NEZMĚŘENO: nenašel jsem žádný compose soubor." >&2
  exit 2
fi

selhalo=0
proslo=0
nezmereno=0

# ── PROČ TO BĚŽÍ SOUBĚŽNĚ ────────────────────────────────────────────────────
# Každý soubor stojí jedno spuštění `docker compose config`, tedy ~300 ms
# procesu. Sériově je to na naší sadě 32 souborů ~11 s a doktor se s tím
# nevešel do 120s limitu SVÉ VLASTNÍ brány (naměřeno 2026-08-18: doktor 80 s na
# mainu, brána padala na `Test timed out in 120000ms`).
#
# Parser, vstupy ani verdikty se NEMĚNÍ — parser rozhoduje dál, protože právě
# o to tu jde. Mění se jediné: nečeká se na doběhnutí jednoho souboru, než
# začne další. Verdikt každého souboru je na ostatních nezávislý, takže pořadí
# SPUŠTĚNÍ nic neovlivní; pořadí VÝSTUPU drží číslované sloty, ze kterých se
# čte až potom, v původním pořadí. Bez toho by se hlášky proplétaly a rozdíl
# mezi dvěma běhy by vypadal jako změna měření.
_posud() {                     # $1 = compose soubor → verdikt na stdout, rc 0/1/3
  local soubor="$1" klice pocet vystup duvod

  if [ ! -f "$soubor" ]; then
    echo "✗ ${soubor}: soubor neexistuje"
    return 1
  fi

  klice=$(coolify_parse_required_keys "$soubor" "[]")
  if [ -z "$klice" ]; then
    # Prázdné odvození NENÍ „nula potřebných klíčů" — je to rozbité měření.
    echo "✗ ${soubor}: odvození vrátilo PRÁZDNO (NEZMĚŘENO, ne nula)"
    return 1
  fi

  # `env -i` je jádro zkoušky: běh NESMÍ vidět nic z prostředí operátora, jinak
  # by chybějící klíč zakryla hodnota, kterou nasazení mít nebude. PATH musí
  # zůstat, aby se našel docker sám.
  zkus_parse() {
    local jmena="$1" envfile vystup
    envfile=$(mktemp)
    while IFS= read -r k; do
      [ -z "$k" ] && continue
      compose_has_bare_ref "$soubor" "$k" || continue
      printf '%s=%s\n' "$k" "$(compose_dummy_value "$k")" >> "$envfile"
    done <<< "$jmena"
    vystup=$(env -i PATH="$PATH" HOME="$HOME" \
      docker compose --env-file "$envfile" -f "$soubor" config -q 2>&1)
    local rc=$?
    rm -f "$envfile"
    printf '%s' "$vystup"
    return $rc
  }

  pocet=$(printf '%s\n' "$klice" | sed '/^$/d' | wc -l | tr -d ' ')
  if vystup=$(zkus_parse "$klice"); then
    printf '✓ %-46s %3s klíčů stačí\n' "$soubor" "$pocet"
    return 0
  elif zkus_parse "$(compose_all_names "$soubor")" >/dev/null 2>&1; then
    # Maximální množina projde, úzká ne → vinu nese ZÚŽENÍ. To je vada odvození
    # a v nasazení by z ní byl „required variable X is missing a value".
    printf '✗ %-46s %3s klíčů NESTAČÍ — chyba je v ZÚŽENÍ\n' "$soubor" "$pocet"
    # „variable is not set" je u klíčů z `environment:` OČEKÁVANÉ — právě je
    # odvození záměrně vynechává. Signál je až chybová/validační hláška.
    printf '%s\n' "$vystup" \
      | grep -vE 'level=warning msg="The .* variable is not set' \
      | sed 's/^/    /' | head -10
    return 1
  else
    # Neprojde ani s VŠEMI jmény — žádná množina klíčů by nepomohla. Overlay
    # nebo jiná vada souboru; odvození za to nemůže a orákulum o něm NEŘÍKÁ NIC.
    duvod=$(printf '%s\n' "$vystup" \
      | grep -vE 'level=warning msg="The .* variable is not set' \
      | grep -E 'error|invalid|validating' | head -1 | sed 's/^ *//')
    printf '· %-46s NEZMĚŘENO — neprojde ani se VŠEMI klíči\n' "$soubor"
    [ -n "$duvod" ] && printf '    %s\n' "${duvod:0:120}"
    return 3
  fi
}

# Počet pruhů se ODVOZUJE od stroje, nedrží se natvrdo: na dvoujádru by osm
# pruhů thrashovalo, na dvaatřicetijádru by osm bylo zbytečné zdržení. Naměřeno
# 2026-08-18 na 10 jádrech (load 12): sériově 8,6–15,5 s, 4 pruhy 3,55 s,
# 8 pruhů 3,32 s, 16 pruhů 2,53 s. Operátor to smí přebít, když ví o svém
# stroji víc než my.
_jader=$( { command -v nproc >/dev/null 2>&1 && nproc; } || sysctl -n hw.ncpu 2>/dev/null || echo 4 )
_lanes="${COMPOSE_ORACLE_LANES:-$(( _jader > 1 ? _jader : 2 ))}"
_vysledky=$(mktemp -d)
_i=0
for soubor in "${soubory[@]}"; do
  _i=$((_i + 1))
  _slot=$(printf '%03d' "$_i")
  {
    _posud "$soubor" > "${_vysledky}/${_slot}.out" 2>&1
    echo $? > "${_vysledky}/${_slot}.rc"
  } &
  # macOS veze bash 3.2, kde `wait -n` neexistuje — počítat běžící úlohy je
  # jediná přenosná brzda. Bez ní by 32 `docker compose` naráz stroj zahltilo
  # a měření by bylo pomalejší než sériové.
  while [ "$(jobs -pr | wc -l | tr -d ' ')" -ge "$_lanes" ]; do sleep 0.05; done
done
wait

for _f in "${_vysledky}"/*.out; do
  [ -f "$_f" ] || continue
  cat "$_f"
  # Chybějící `.rc` NENÍ úspěch — úloha se nedopočítala a musí spadnout do
  # `selhalo`, ne se ztratit. Proto catch-all větev, ne `0)` jako výchozí.
  case "$(cat "${_f%.out}.rc" 2>/dev/null)" in
    0) proslo=$((proslo + 1)) ;;
    3) nezmereno=$((nezmereno + 1)) ;;
    *) selhalo=$((selhalo + 1)) ;;
  esac
done
rm -rf "$_vysledky"

echo
if [ "$nezmereno" -gt 0 ]; then
  echo "orákulum: ${proslo} prošlo, ${selhalo} selhalo, ${nezmereno} NEZMĚŘENO (z ${#soubory[@]})"
else
  echo "orákulum: ${proslo} prošlo, ${selhalo} selhalo (z ${#soubory[@]})"
fi
[ "$selhalo" -eq 0 ]

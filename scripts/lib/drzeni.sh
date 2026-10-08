#!/usr/bin/env bash
# =============================================================================
# drzeni.sh — deklarované DRŽENÍ aplikací pro shellové cesty mimo CI
# =============================================================================
# Použití (sourcovat, ne spouštět):
#   . "$(dirname "$0")/lib/drzeni.sh"
#   drzeni_nacti <nástroj> [env-soubor] || exit 1   # jednou, PŘED prvním zásahem
#   if drzena "$role"; then echo "$(drzeni_hlaska "$role"). Nesahám."; continue; fi
#
# Pravidla, tvar deklarace, validace i TEXT hlášky bydlí v jediném domově:
# scripts/lib/nasazeni-drzene.mjs. Tady se jen VOLÁ jeho CLI (`--instance`) a čte
# výstup — žádná kopie logiky. Overlay instance si domov obstará sám (cesta
# z prostředí, jinak klon podle deklarace; `env-soubor` = soubor prostředí
# instance, ze kterého deklaraci overlaye vezme samostatně spuštěný nástroj).
#
# ── PROČ (změřeno čtením 2026-10-04) ────────────────────────────────────────
# Deklaraci držení četlo jen nasazení z CI. Studený start a nástroje, které volá
# (sync env, deploy-init, story-init), o ní nevěděly: konvergence existující
# instance by drženou aplikaci přenasadila a ještě předtím jí doručila proměnné,
# jejichž nepřítomnost dnes nasazení zastavuje.
#
# ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
#   · `drzeni_nacti` ≠ 0  = nevíme, co je drženo (overlay deklarovaný a nedostupný,
#     nečitelná nebo neplatná deklarace, výstup bez patičky). Volající KONČÍ;
#     důvod už vypsal domov na stderr.
#   · `drzena` před úspěšným `drzeni_nacti` ukončí skript: odpověď „není držená“
#     od nenačtené deklarace by byla fail-open.
#   · Výstup domova se přijme jen s patičkou `__DRZENI_END__<TAB>počet` a počet
#     musí sedět — prázdný nebo uříznutý výstup s kódem 0 není „nic drženo“.
#
# Proměnné po načtení:
#   DRZENI_APLIKACE  role držených aplikací, jedna na řádek (prázdné = nic drženo)
#   DRZENI_POPIS     odkud se četlo / proč je prázdno (jedna věta pro výpis)
# =============================================================================

DRZENI_NACTENO=0
DRZENI_TSV=""
DRZENI_APLIKACE=""
DRZENI_POPIS=""

drzeni_nacti() {
  local nastroj="${1:-}" env_soubor="${2:-}" domov vystup paticka pocet radku
  DRZENI_NACTENO=0
  DRZENI_TSV=""
  DRZENI_APLIKACE=""
  DRZENI_POPIS=""
  if [ -z "$nastroj" ]; then
    echo "::error title=deklarace držení::drzeni_nacti: chybí jméno nástroje" >&2
    return 1
  fi
  domov="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/nasazeni-drzene.mjs"
  if [ -n "$env_soubor" ]; then
    vystup="$(node "$domov" --instance "$nastroj" --tvar tsv --env-soubor "$env_soubor")" || return 1
  else
    vystup="$(node "$domov" --instance "$nastroj" --tvar tsv)" || return 1
  fi
  # Patička je DŮKAZ ÚPLNOSTI: bez ní je výstup uříznutý nebo žádný a „0 řádků“
  # by se přečetlo jako „nic drženo“.
  paticka="$(tail -n 1 <<< "$vystup")"
  if [ "$(cut -f1 <<< "$paticka")" != "__DRZENI_END__" ]; then
    echo "::error title=deklarace držení::validátor skončil bez patičky — nevíme, co je drženo, NENASAZUJI." >&2
    return 1
  fi
  pocet="$(cut -f2 <<< "$paticka")"
  DRZENI_TSV="$(awk -F'\t' '$1 != "__DRZENI_END__" && NF' <<< "$vystup")"
  radku="$(awk 'NF { n++ } END { print n + 0 }' <<< "$DRZENI_TSV")"
  if [ "$pocet" != "$radku" ]; then
    echo "::error title=deklarace držení::výstup validátoru je neúplný (patička hlásí ${pocet}, řádků ${radku}) — nevíme, co je drženo, NENASAZUJI." >&2
    DRZENI_TSV=""
    return 1
  fi
  DRZENI_APLIKACE="$(cut -f1 <<< "$DRZENI_TSV")"
  DRZENI_POPIS="$(cut -f3- <<< "$paticka")"
  DRZENI_NACTENO=1
  return 0
}

# drzena <role> — 0 = aplikace je deklarovaně držená.
drzena() {
  if [ "$DRZENI_NACTENO" != "1" ]; then
    echo "::error title=deklarace držení::drzena '${1:-}': deklarace nebyla načtena (drzeni_nacti) — nevíme, co je drženo, KONČÍM." >&2
    exit 1
  fi
  [ -n "$DRZENI_APLIKACE" ] || return 1
  # Here-string, ne roura: `printf | grep -q` s pipefail vrací 141 (SIGPIPE)
  # a shoda by se přečetla jako neshoda.
  grep -qxF -- "$1" <<< "$DRZENI_APLIKACE"
}

# drzeni_hlaska <role> — „DRŽENO: <role> — <důvod> — rozhodnutí …; drženo od … (N dní)“.
# Text skládá domov (hlaskaDrzeno), tady se jen vypíše.
drzeni_hlaska() {
  awk -F'\t' -v a="$1" '$1 == a { print $2; f = 1 } END { exit f ? 0 : 1 }' <<< "$DRZENI_TSV"
}

# drzeni_vypis — hlášky všech držených aplikací, jedna na řádek (nic drženo = nic).
drzeni_vypis() {
  [ -n "$DRZENI_TSV" ] || return 0
  cut -f2 <<< "$DRZENI_TSV"
}

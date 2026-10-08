#!/usr/bin/env bash
# =============================================================================
# vlastnictvi.sh — které aplikace manifestu toto prostředí VLASTNÍ (shellové cesty)
# =============================================================================
# Použití (sourcovat, ne spouštět):
#   . "$(dirname "$0")/lib/vlastnictvi.sh"
#   vlastnictvi_nacti "$MANIFEST" [profil] [env-soubor] || exit 1   # jednou, PŘED prvním rozhodnutím
#     profil      prázdné = AISHA_PROFILE z prostředí, pak z env-souboru (čteno jako data)
#   if externi "$role"; then echo "$(vlastnictvi_hlaska "$role")"; continue; fi
#   vlastni_aplikace                                       # „role<TAB>slot<TAB>compose<TAB>volby“ vlastních aplikací
#
# Pravidlo, čtení manifestu i TEXT hlášky bydlí v jediném domově:
# scripts/lib/vlastnictvi-aplikaci.mjs. Tady se jen VOLÁ jeho CLI a čte výstup —
# žádný vlastní `grep '^app:'` (hlídá brána vlastnictvi-z-topologie).
#
# ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
#   · `vlastnictvi_nacti` ≠ 0 = nevíme, co je v prostředí naše (profil nedeklarovaný
#     nebo nenalezený, manifest chybí nebo má vadný řádek, výstup bez patičky).
#     Volající KONČÍ; důvod už vypsal domov na stderr.
#   · `vlastni`/`externi` před úspěšným načtením ukončí skript: odpověď od nenačteného
#     vlastnictví by byla fail-open.
#   · Výstup domova se přijme jen s patičkou `__VLASTNICTVI_END__<TAB>počet` a počet
#     musí sedět.
#
# Proměnné po načtení:
#   VLASTNI_APLIKACE   role vlastních aplikací, jedna na řádek
#   EXTERNI_APLIKACE   role externích aplikací, jedna na řádek (prázdné = žádná)
#   VLASTNICTVI_POPIS  jedna věta pro výpis (profil, počty)
# =============================================================================

VLASTNICTVI_NACTENO=0
VLASTNICTVI_TSV=""
VLASTNI_APLIKACE=""
EXTERNI_APLIKACE=""
VLASTNICTVI_POPIS=""

vlastnictvi_nacti() {
  local manifest="${1:-}" profil="${2:-}" env_soubor="${3:-}" domov vystup paticka pocet radku
  local -a volby=()
  VLASTNICTVI_NACTENO=0
  VLASTNICTVI_TSV=""
  VLASTNI_APLIKACE=""
  EXTERNI_APLIKACE=""
  VLASTNICTVI_POPIS=""
  if [ -z "$manifest" ]; then
    echo "::error title=vlastnictví aplikací::vlastnictvi_nacti: chybí cesta k manifestu" >&2
    return 1
  fi
  domov="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/vlastnictvi-aplikaci.mjs"
  [ -n "$profil" ] && volby+=(--profil "$profil")
  [ -n "$env_soubor" ] && volby+=(--env-soubor "$env_soubor")
  vystup="$(node "$domov" --manifest "$manifest" ${volby[@]+"${volby[@]}"} --tvar tsv)" || return 1
  paticka="$(tail -n 1 <<< "$vystup")"
  if [ "$(cut -f1 <<< "$paticka")" != "__VLASTNICTVI_END__" ]; then
    echo "::error title=vlastnictví aplikací::domov skončil bez patičky — nevíme, co je v prostředí naše, NENASAZUJI." >&2
    return 1
  fi
  pocet="$(cut -f2 <<< "$paticka")"
  VLASTNICTVI_TSV="$(awk -F'\t' '$1 != "__VLASTNICTVI_END__" && NF' <<< "$vystup")"
  radku="$(awk 'NF { n++ } END { print n + 0 }' <<< "$VLASTNICTVI_TSV")"
  if [ "$pocet" != "$radku" ]; then
    echo "::error title=vlastnictví aplikací::výstup domova je neúplný (patička hlásí ${pocet}, řádků ${radku}) — NENASAZUJI." >&2
    VLASTNICTVI_TSV=""
    return 1
  fi
  VLASTNI_APLIKACE="$(awk -F'\t' '$1 == "vlastni" { print $2 }' <<< "$VLASTNICTVI_TSV")"
  EXTERNI_APLIKACE="$(awk -F'\t' '$1 == "externi" { print $2 }' <<< "$VLASTNICTVI_TSV")"
  VLASTNICTVI_POPIS="$(cut -f3- <<< "$paticka")"
  VLASTNICTVI_NACTENO=1
  return 0
}

_vlastnictvi_nacteno_nebo_konec() {
  if [ "$VLASTNICTVI_NACTENO" != "1" ]; then
    echo "::error title=vlastnictví aplikací::${1:-dotaz} '${2:-}': vlastnictví nebylo načteno (vlastnictvi_nacti) — nevíme, co je naše, KONČÍM." >&2
    exit 1
  fi
}

# vlastni <role> — 0 = aplikace manifestu je v tomhle prostředí NAŠE.
vlastni() {
  _vlastnictvi_nacteno_nebo_konec vlastni "${1:-}"
  [ -n "$VLASTNI_APLIKACE" ] || return 1
  # Here-string, ne roura: `printf | grep -q` s pipefail vrací 141 (SIGPIPE).
  grep -qxF -- "$1" <<< "$VLASTNI_APLIKACE"
}

# externi <role> — 0 = služba je v tomhle prostředí EXTERNÍ (profil: external_domain).
externi() {
  _vlastnictvi_nacteno_nebo_konec externi "${1:-}"
  [ -n "$EXTERNI_APLIKACE" ] || return 1
  grep -qxF -- "$1" <<< "$EXTERNI_APLIKACE"
}

# vlastnictvi_hlaska <role> — „EXTERNÍ: <role> — <adresa> — … nevlastním“ (text skládá domov).
vlastnictvi_hlaska() {
  awk -F'\t' -v r="$1" '$1 == "externi" && $2 == r { print $4; f = 1 } END { exit f ? 0 : 1 }' <<< "$VLASTNICTVI_TSV"
}

# vlastnictvi_vypis — hlášky všech externích aplikací, jedna na řádek (žádná = nic).
vlastnictvi_vypis() {
  awk -F'\t' '$1 == "externi" { print $4 }' <<< "$VLASTNICTVI_TSV"
}

# vlastni_aplikace — „role<TAB>slot<TAB>compose<TAB>volby“ každé vlastní aplikace v pořadí
# manifestu (volby = zbytek řádku `app:` za compose, např. `bluegreen=on`; může být prázdné).
vlastni_aplikace() {
  _vlastnictvi_nacteno_nebo_konec vlastni_aplikace ""
  awk -F'\t' -v OFS='\t' '$1 == "vlastni" { print $2, $3, $4, $5 }' <<< "$VLASTNICTVI_TSV"
}

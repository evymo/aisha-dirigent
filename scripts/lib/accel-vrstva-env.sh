# shellcheck shell=bash
# accel-vrstva-env.sh — načte env akcelerační vrstvy (ACCEL_*) z deklarace GPU uzlu do shellu.
#
# Hodnoty vydává JEDEN domov: scripts/lib/derive-accel-uzel.mjs (deklarace v datech instance,
# overlay accel/uzel.json). Tady se jen čtou PARSEREM — jméno klíče musí být z výčtu vrstvy
# (ACCEL_*), hodnota se přiřadí doslova přes `printf -v` a exportuje. Žádné `source` ani `eval`:
# hodnota se nevykoná (viz env soubory parserem).
#
# Volá se PO načtení zálohy prostředí obsluhy (.env-prod-backup), stejně jako topologie
# (derive-domains --shell): odvozená vrstva přebije zastaralou hodnotu ze zálohy, ne naopak.
#
# Použití: . scripts/lib/accel-vrstva-env.sh; nacti_env_vrstvy_accel <kořen repa> || exit
# Návratový kód: 0 = načteno (bez deklarace: všechny klíče prázdné), 1 = deklarace vadná
# nebo výstup mimo výčet (důvod na stderr). Volající rozhodne, jestli je to STOP — v cold-startu ano.
nacti_env_vrstvy_accel() {
  local koren="$1" vystup radek klic
  vystup="$(node "$koren/scripts/lib/derive-accel-uzel.mjs")" || {
    echo "accel-vrstva-env: deklaraci GPU uzlu (accel/uzel.json v datech instance) nejde vyložit — důvod výš" >&2
    return 1
  }
  while IFS= read -r radek; do
    [ -n "$radek" ] || continue
    klic="${radek%%=*}"
    case "$klic" in
      ACCEL_*)
        case "$klic" in *[!A-Z0-9_]*) echo "accel-vrstva-env: klíč '${klic}' mimo [A-Z0-9_]" >&2; return 1 ;; esac
        printf -v "$klic" '%s' "${radek#*=}"
        export "${klic?}"
        ;;
      *) echo "accel-vrstva-env: derive-accel-uzel vydal řádek mimo výčet vrstvy: '${klic}'" >&2; return 1 ;;
    esac
  done <<< "$vystup"
  return 0
}

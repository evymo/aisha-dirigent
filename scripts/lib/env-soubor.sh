# shellcheck shell=bash
# env-soubor.sh — čtení env souboru (.env.coolify) MIMO `source`.
#
# ⛔ NAMĚŘENO 2026-09-19 (guru): env-doktor uvozuje hodnoty, které by `source`
# rozbil, dvojitými uvozovkami s escapy \\ \" \$ \` (scripts/lib/env-hodnota.mjs).
# Tenhle čtenář je dřív jen ODŘÍZL — `AISHA_OPERATORS` tak šel do Coolify jako
# `{\"email\":…}`, migrace hlásila „AISHA_OPERATORS is not valid JSON" a operátoři
# se nikdy neprovisionovali. Hodnota musí vyjít STEJNĚ jako v bashi:
#   "…"  → bez uvozovek, \\ \" \$ \` → doslovný znak (ostatní \X zůstává);
#   '…'  → bez uvozovek, obsah doslova;
#   jinak beze změny.
# Zrcadlo odUvozovkuj() v scripts/lib/env-hodnota.mjs; obojí měří
# scripts/lib/env-soubor.test.mjs proti skutečnému `bash source`.

_ENV_SOUBOR_DEQ='
function deq(v,    o, i, n, c, d) {
  if (length(v) >= 2 && substr(v, 1, 1) == "\"" && substr(v, length(v), 1) == "\"") {
    v = substr(v, 2, length(v) - 2); o = ""; n = length(v)
    for (i = 1; i <= n; i++) {
      c = substr(v, i, 1)
      if (c == "\\" && i < n) {
        d = substr(v, i + 1, 1)
        if (d == "\\" || d == "\"" || d == "$" || d == "`") { o = o d; i++; continue }
      }
      o = o c
    }
    return o
  }
  if (length(v) >= 2 && substr(v, 1, 1) == "\047" && substr(v, length(v), 1) == "\047") return substr(v, 2, length(v) - 2)
  return v
}'

# parse_env_soubor SOUBOR — řádky „KLÍČ<TAB>hodnota" (komentáře a prázdné řádky pryč).
parse_env_soubor() {
  awk "${_ENV_SOUBOR_DEQ}"'
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/ {
      eq = index($0, "=")
      key = substr($0, 1, eq - 1); val = substr($0, eq + 1)
      sub(/^[[:space:]]+/, "", key); sub(/[[:space:]]+$/, "", key)
      printf "%s\t%s\n", key, deq(val)
    }
  ' "$1"
}

# read_env_key KLÍČ SOUBOR — hodnota PRVNÍHO výskytu klíče (chybějící = prázdná).
read_env_key() {
  local key="$1" file="$2"
  [ -f "$file" ] || return 0
  # Chybějící klíč = prázdná hodnota. Bez `|| true` by grep bez shody pod
  # `pipefail` vrátil 1 a `set -e` skript ukončil na PŘIŘAZENÍ (naměřeno 2026-09-13).
  { grep -E "^${key}=" "$file" || true; } | head -1 | awk "${_ENV_SOUBOR_DEQ}"'
    { v = substr($0, index($0, "=") + 1); sub(/^[[:space:]]+/, "", v); sub(/[[:space:]]+$/, "", v); print deq(v) }'
}

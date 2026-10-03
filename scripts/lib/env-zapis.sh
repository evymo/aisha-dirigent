# shellcheck shell=bash
# env-zapis.sh — atomická náhrada obsahu env souboru, která PŘEŽIJE SYMLINK.
#
# ⛔ NAMĚŘENO 2026-09-15. V git worktree bývá `.env.coolify` symlink na hlavní
# trezor. `mv "$tmp" "$ENV_FILE"` symlink NAHRADÍ regulárním souborem: zápis
# skončí v kopii, hlavní trezor zůstane starý a trezor se tiše rozštěpí.
# Tentýž vzor měl i `aisha-redeploy.mjs` (tmp + renameSync) — tam se opravil
# `realpathSync`, tady touhle funkcí. Hlídá brána `zapis-env-prezije-symlink`.
#
# Dočasný soubor vzniká VEDLE skutečného cíle (týž adresář = týž souborový
# systém), takže `mv` zůstává atomickým přejmenováním i tehdy, když volající
# připravil obsah v `mktemp` na jiném svazku.

# Skutečná cesta souboru: rozliší řetěz symlinků, i relativních. Neexistující
# cíl vrátí beze změny (první zápis). Bez `readlink -f` / `realpath` — na macOS
# nejsou jisté.
env_realna_cesta() {
  local f="$1" t n=0
  while [ -L "$f" ]; do
    n=$((n + 1))
    if [ "$n" -gt 40 ]; then
      echo "env_realna_cesta: cyklus symlinků u $1" >&2
      return 1
    fi
    t="$(readlink "$f")"
    case "$t" in
      /*) f="$t" ;;
      *) f="$(dirname "$f")/$t" ;;
    esac
  done
  printf '%s\n' "$f"
}

# env_zapis_atomicky <zdroj> <cil>
#   Nahradí obsah <cil> obsahem <zdroj> atomicky přes skutečnou cestu cíle,
#   s právy 600 (trezor). <zdroj> po úspěchu smaže. Při selhání nechá cíl
#   netknutý a vrátí nenulu.
env_zapis_atomicky() {
  local zdroj="$1" cil="$2" realny docasny
  realny="$(env_realna_cesta "$cil")" || return 1
  docasny="$(mktemp "$(dirname "$realny")/.$(basename "$realny").tmp.XXXXXX")" || return 1
  if ! cat "$zdroj" > "$docasny"; then
    rm -f "$docasny"
    return 1
  fi
  chmod 600 "$docasny"
  if ! mv -f "$docasny" "$realny"; then
    rm -f "$docasny"
    return 1
  fi
  [ "$zdroj" = "$realny" ] || rm -f "$zdroj"
}

#!/usr/bin/env bash
# env-file-keys.sh — načítání KEY=VALUE souborů do prostředí cold-startu.
#
# CO SOUBOR PŘEPSAT NESMÍ: řídicí proměnné běhu. Ty říkají, CO se má dělat
# (nanečisto, se smazáním, bez nasazení…), a nastavuje je JEN příkazová řádka.
# Režim `overwrite` platí pro konfiguraci, ne pro záměr běhu.
#
# NAMĚŘENO 2026-09-24 (fork, staging na sdíleném Coolify):
#   AISHA_ENV=staging bash scripts/aisha-cold-start-env.sh --dry-run --wipe
# běžel NAOSTRO. Bootstrap zálohy z Coolify (bootstrap-env-from-coolify.mjs)
# stáhl z env aplikace netinit i `DRY_RUN=0` (compose tam má
# `DRY_RUN: ${DRY_RUN:-0}`) a `load_env_file_keys "$ENV_PROD_BACKUP" overwrite`
# ho vrátil do prostředí — příznak `--dry-run` tím zmizel. Doktor, generování
# secretů i zápis env souborů proběhly doopravdy; zastavila to až pojistka
# zástupných hodnot těsně před wipem.
#
# Proto: řídicí proměnná ze souboru se IGNORUJE a ohlásí (záloha, která ji
# nese, je znečištěná a stojí za úklid). Nic se tím neztrácí — ze souboru
# nikdy správně přijít neměla.
#
# Hodnoty čte parse_env_soubor (lib/env-soubor.sh) — uvozovky a escapy jako
# bash. Knihovna si čtenáře načítá SAMA, nespoléhá na pořadí v cold-startu.

_ENV_FILE_KEYS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/env-soubor.sh
. "${_ENV_FILE_KEYS_DIR}/env-soubor.sh"

CS_RIDICI_PROMENNE=(
  DRY_RUN
  SKIP_CREATE
  SKIP_DEPLOY
  SKIP_DOCTOR
  WIPE
  WIPE_VOLUMES
  SKIP_ORPHAN_CLEANUP
  WIPE_PENDING
  REWARMUP_APPS
  AISHA_ENV
)

je_ridici_promenna() {
  local k
  for k in "${CS_RIDICI_PROMENNE[@]}"; do
    [ "$k" = "$1" ] && return 0
  done
  return 1
}

# load_env_file_keys <soubor> [overwrite|if-unset]
#   if-unset  (výchozí) — nastaví jen klíče, které v prostředí ještě nejsou
#   overwrite           — přepíše i nastavené (operátor má poslední slovo)
# Řídicí proměnné běhu se v OBOU režimech přeskočí.
load_env_file_keys() {
  local file="$1" mode="${2:-if-unset}" key value
  [ -f "$file" ] || return 0
  while IFS=$'\t' read -r key value; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if je_ridici_promenna "$key"; then
      echo "WARN  $file nese řídicí proměnnou $key — ignoruji (řídí ji jen příkazová řádka)" >&2
      continue
    fi
    [ "$mode" = "overwrite" ] || [ -z "${!key:-}" ] || continue
    export "$key=$value"
  done < <(parse_env_soubor "$file")
}

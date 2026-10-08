#!/usr/bin/env bash
#
# npm-ci.sh — `npm ci`, který přežije rozbitou SDÍLENOU cache
#
# ⛔ NAMĚŘENO 2026-09-03, třikrát za jediný den (#266 v 23:16, main a0178ed89
# ve dvou úlohách naráz v 08:01). Podpis je vždycky stejný a nese OBĚ chyby:
#
#     npm error code EEXIST
#     npm error ENOENT: no such file or directory, rename
#               '/ci-cache/npm/_cacache/tmp/…' -> '…/content-v2/sha512/…'
#     npm error File exists: …/content-v2/sha512/…
#
# „Cíl existuje" A ZÁROVEŇ „zdroj zmizel" je podpis toho, že někdo mazal cache
# POD BĚŽÍCÍ instalací. Runner má vedle sebe uklízeče, který při volném místě
# ≤ CI_MIN_FREE_PCT dělá `rm -rf /ci-cache/npm/*` — tedy i té cache, kterou
# právě běžící job POUŽÍVÁ (popsáno v ci.yml u `test:run`). Uklízeč navíc
# uklízí s filtrem `until=24h`, takže na čerstvou build cache nesáhne a místo
# se plní dál — situace se tedy vrací.
#
# ⭐ PROČ RETRY A NE OPRAVA UKLÍZEČE: janitor je konfigurace RUNNERU, ne tohohle
# repa — odsud ho vypnout nejde. Tohle je jediné místo, kde se s tím dá něco
# udělat, aniž bychom sáhli na cizí infrastrukturu.
#
# ⭐ PROČ DRUHÝ POKUS JDE JINUDY: opakovat `npm ci` nad TOUŽ cache znamená
# opakovat i příčinu. Druhý pokus proto dostane SOUKROMOU cache — je pomalejší
# (stahuje znovu), ale nesdílí ji s nikým, takže ji nemá kdo smazat.
#
# ⛔ NENÍ to „spolknutí chyby": skutečná vada v závislostech selže OBAKRÁT
# a job zčervená. Tenhle skript odstraňuje jen NÁHODNOST, ne signál.
#
# Běží v adresáři, ze kterého ho krok zavolal (kroky s `working-directory`),
# proto se volá absolutní cestou přes $GITHUB_WORKSPACE.

set -euo pipefail

# ⛔ EXTRANET SDK JE VSTUP INSTALACE, NE VOLITELNÝ SUBMODUL (2026-10-04, review PR #1).
# Kořenový package.json má workspaces packages/extranet-sdk/{ui,tokens} a mobilní
# aplikace bere -native/-tokens přes `file:`. actions/checkout submoduly nestahuje
# (výchozí `submodules: false`; test-web to má i výslovně, protože na insight runner
# nedosáhne), takže se instalovalo proti prázdnému adresáři: odkazy do prázdna,
# build/typecheck přes rozbité importy a brána stack-nesmi-znat-jmeno-instance
# neinicializované SDK záměrně hlásí jako chybu. Tady je jediné místo, kterým
# prochází instalace všech úloh — inicializuje se JEN SDK (ne insight), relativní
# URL v .gitmodules zdědí autentizaci checkoutu. Selhání je tvrdé: bez SDK nemá
# smysl pokračovat a matoucí pád o tři kroky dál je horší než jasný tady.
koren="${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel)}"
if grep -q 'path = packages/extranet-sdk' "$koren/.gitmodules" 2>/dev/null \
   && [ ! -f "$koren/packages/extranet-sdk/package.json" ]; then
  echo "▶ inicializuji submodul packages/extranet-sdk (vstup npm workspaces)"
  if ! git -C "$koren" submodule update --init packages/extranet-sdk; then
    # Relativní URL dědí pověření checkoutu. Token běhu (GITHUB_TOKEN) ale čte
    # jen VLASTNÍ repo — je-li repo SDK privátní, klon tady padne. Řekne se to
    # jménem, ne až kaskádou rozbitých importů o tři kroky dál.
    echo "::error title=extranet SDK nedostupné::submodul packages/extranet-sdk nejde naklonovat pověřením checkoutu — repo SDK musí být čitelné pro tenhle běh (veřejné, nebo checkout s tokenem, který na něj vidí)." >&2
    exit 1
  fi
fi

if npm ci "$@"; then
  exit 0
fi

soukroma="$(mktemp -d)/npm-cache"
echo "::warning::npm ci selhal nad sdílenou cache — druhý pokus jde přes soukromou ($soukroma)" >&2
npm ci --cache "$soukroma" "$@"

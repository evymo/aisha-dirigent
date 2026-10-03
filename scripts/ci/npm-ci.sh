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

if npm ci "$@"; then
  exit 0
fi

soukroma="$(mktemp -d)/npm-cache"
echo "::warning::npm ci selhal nad sdílenou cache — druhý pokus jde přes soukromou ($soukroma)" >&2
npm ci --cache "$soukroma" "$@"

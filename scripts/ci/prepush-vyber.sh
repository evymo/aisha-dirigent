#!/usr/bin/env bash
# =============================================================================
# prepush-vyber.sh — co se pushem mění a jak to směrovat (pro cílený pre-push)
# =============================================================================
# Volání (z .husky/pre-push):  bash scripts/ci/prepush-vyber.sh <remote> < <stdin pre-push>
#   stdin = řádky `<local ref> <local sha> <remote ref> <remote sha>` tak, jak je git hooku dává.
# Výstup (stdout, řádky key=value):
#   rezim=vyber          — rozsah i směrování známé; pre-push pustí CÍLENOU dráhu
#   rezim=sirsi          — něco z toho známé není (`duvod=…` vždy přítomen); pre-push pustí
#                          ŠIRŠÍ cílenou dráhu (lehká dráha bran + unit dotčených workspace)
#   rezim=vse            — jen AISHA_PREPUSH_VSE=1: člověk si vynutil PLNOU sadu
#   zmeneno=<n>          — kolik cest se posuzovalo (commity + pracovní strom)
#   slouceni=<n>         — kolik merge commitů je v rozsahu (informace, ne důvod k „vše")
#   baze=<popis>         — proti čemu se který ref posuzoval
#   <příznak>=true|false — směrování ze scripts/ci/zmenene-cesty.sh (týž skript jako CI)
#   cesta=<cesta>        — každá změněná cesta (pro výběr bran a testů v prepush-cilene.mjs)
# Kód: vždy 0, když plán vznikl; ≠ 0 jen při vnitřní chybě — a hook pak pustí ŠIRŠÍ dráhu.
#
# ⭐ ROZHODNUTÍ MAJITELE 2026-10-05: „plné sady jen v CI". Celá sada bran, unit,
# services i build běží na runneru; místně jen cílené testy změněných částí a slučuje
# se podle závěrů jobů v CI (`npm run ci:verdikt`). Důvod: stroj s 11+ relacemi se
# dusil (swap 9,5/11 GB, load 250+) a pre-push integrační dávky spadl na 37 timeoutech
# zátěže. Proto tu už NENÍ „při nejistotě celá sada" — nejistota znamená ŠIRŠÍ cílenou
# dráhu, nikdy „nic" a nikdy tichý přeskok.
#
# ⭐ MERGE COMMIT NENÍ NEJISTOTA. Báze = společný předek s `<remote>/main`, takže
# integrační dávka se posuzuje rozdílem STROMŮ proti mainu: co do mainu přinese
# (včetně řešení konfliktů), ne co si z mainu stáhla. Diff stromů nic neskrývá —
# dřívější „merge → celá sada" pouštěl každou integrační dávku plnou sadou.
#
# PROČ SKRIPT A NE LOGIKA V HOOKU: hook je /bin/sh a netestuje se; tohle měří brány
# smerovani-jeden-domov a prepush-vyber-je-cileny nad dočasným gitem.
#
# KDY JE VÝSLEDEK „ŠIRŠÍ" (každý důvod se vypíše):
#   · ref, ke kterému chybí báze (`<remote>/main` ani dosavadní stav refu lokálně nejsou)
#   · hook nepředal remote / žádný ref / jen mazání větví / prázdný seznam změn
#   · víc než AISHA_PREPUSH_MAX_SOUBORU (výchozí 250) změněných cest
#   · směrování si protiřečí nebo selhalo (zmenene-cesty.sh ≠ 0)
#   · git diff / rev-list / status selhal
#
# ⛔ PRE-PUSH TESTUJE PRACOVNÍ STROM, CI COMMIT (naměřeno 2026-09-23: úprava po
# `git mv` mimo stage → lokálně zelené, CI TS2307). Proto se k diffu commitů
# přidávají i necommitnuté a netrackované cesty: co leží na disku, to se testuje.
# =============================================================================
set -u
REMOTE=${1:-}
# Strop je DEKLAROVANÁ hodnota tohoto skriptu (ne odhad světa); prostředí ji smí jen
# přepsat — a nečíselné přepsání = širší dráha, ne tichý jiný práh.
MAX=250
ZERO=0000000000000000000000000000000000000000
KOREN=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "rezim=sirsi"; echo "duvod=nejsem v git repu"; echo "zmeneno=0"; exit 0; }
cd "$KOREN" || exit 1

if [ "${AISHA_PREPUSH_VSE:-}" = "1" ]; then
  echo "rezim=vse"; echo "duvod=AISHA_PREPUSH_VSE=1 — plná sada vynucena"; echo "zmeneno=0"; exit 0
fi

DUVODY=""
sirsi() { DUVODY="${DUVODY:+$DUVODY; }$1"; }

if [ -n "${AISHA_PREPUSH_MAX_SOUBORU:-}" ]; then
  case "$AISHA_PREPUSH_MAX_SOUBORU" in
    *[!0-9]*) sirsi "AISHA_PREPUSH_MAX_SOUBORU='$AISHA_PREPUSH_MAX_SOUBORU' není číslo" ;;
    *) MAX=$AISHA_PREPUSH_MAX_SOUBORU ;;
  esac
fi
[ -n "$REMOTE" ] || sirsi "hook nepředal jméno remote — báze neznámá"

REFS=$(cat)
[ -n "$(tr -d '[:space:]' <<< "$REFS")" ] || sirsi "hook nedostal žádný ref k posouzení"

CHANGED=""
BAZE=""
POSOUZENO=0
SLOUCENI=0
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "${local_sha:-}" ] || continue
  [ "$local_sha" = "$ZERO" ] && continue            # mazání větve: není co testovat
  base=""
  popis=""
  if [ -n "$REMOTE" ] && git rev-parse --verify -q "refs/remotes/$REMOTE/main" >/dev/null 2>&1; then
    base=$(git merge-base "$local_sha" "refs/remotes/$REMOTE/main" 2>/dev/null) || base=""
    [ -n "$base" ] && popis="společný předek s $REMOTE/main"
  fi
  if [ -z "$base" ] && [ "${remote_sha:-$ZERO}" != "$ZERO" ] && git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
    base=$remote_sha
    popis="dosavadní stav $remote_ref na $REMOTE"
  fi
  if [ -z "$base" ]; then
    sirsi "báze neznámá pro $local_ref (lokálně chybí $REMOTE/main i dosavadní stav refu)"
    continue
  fi
  merges=$(git rev-list --merges --count "$base..$local_sha" 2>/dev/null) || { sirsi "rev-list $local_ref selhal"; continue; }
  diff=$(bash scripts/ci/zmenene-cesty.sh --seznam "$base" "$local_sha" 2>/dev/null) || { sirsi "seznam změn $local_ref nejde sestavit (git diff selhal)"; continue; }
  CHANGED="$CHANGED"$'\n'"$diff"
  BAZE="$BAZE"$'\n'"$local_ref: ${base:0:9} ($popis), merge commitů v rozsahu: $merges"
  SLOUCENI=$((SLOUCENI + merges))
  POSOUZENO=$((POSOUZENO + 1))
done <<< "$REFS"
[ "$POSOUZENO" -gt 0 ] || sirsi "žádný ref s bází k posouzení (jen mazání větví, nebo báze chybí)"

# Pracovní strom: změněné (index i disk) a netrackované cesty. `--no-renames`: přesun se vypíše
# jako smazání + přidání, tedy OBĚ cesty (s detekcí by zůstala jen cílová — viz zmenene-cesty.sh).
if STROM=$(git -c core.quotePath=false status --porcelain=v1 --untracked-files=all --no-renames 2>/dev/null); then
  STROM=$(sed -E 's/^.. //; s/^.* -> //' <<< "$STROM")
  CHANGED="$CHANGED"$'\n'"$STROM"
else
  sirsi "git status selhal — pracovní strom neznámý"
fi
CHANGED=$(grep -v '^[[:space:]]*$' <<< "$CHANGED" | sort -u || true)
N=$(grep -c . <<< "$CHANGED" || true)
[ "$N" -gt 0 ] || sirsi "seznam změn je prázdný — směrovat není podle čeho"
[ "$N" -le "$MAX" ] || sirsi "změněno $N cest > $MAX — příliš velká změna na úzký výběr"

SMEROVANI=""
if [ "$N" -gt 0 ]; then
  SMEROVANI=$(bash scripts/ci/zmenene-cesty.sh <<< "$CHANGED" 2>/dev/null) \
    || { sirsi "směrování si protiřečí nebo selhalo (zmenene-cesty.sh ≠ 0)"; SMEROVANI=""; }
fi

if [ -n "$DUVODY" ]; then
  echo "rezim=sirsi"
  echo "duvod=$DUVODY"
else
  echo "rezim=vyber"
fi
echo "zmeneno=$N"
echo "slouceni=$SLOUCENI"
grep -v '^$' <<< "$BAZE" | sed 's/^/baze=/' || true
[ -n "$SMEROVANI" ] && echo "$SMEROVANI"
[ "$N" -gt 0 ] && sed 's/^/cesta=/' <<< "$CHANGED"
exit 0

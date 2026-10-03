#!/usr/bin/env bash
# =============================================================================
# prepush-vyber.sh — co má pre-push spustit podle změněných cest (FAIL-CLOSED)
# =============================================================================
# Volání (z .husky/pre-push):  bash scripts/ci/prepush-vyber.sh <remote> < <stdin pre-push>
#   stdin = řádky `<local ref> <local sha> <remote ref> <remote sha>` tak, jak je git hooku dává.
# Výstup (stdout, řádky key=value):
#   rezim=vse            — spustit CELOU sadu; `duvod=…` říká proč (vždy přítomen)
#   rezim=vyber          — směrování známé; následují příznaky ze scripts/ci/zmenene-cesty.sh
#                          (app, services_change, extension, n8n_nodes, surfaces, docs_only, …)
#   zmeneno=<n>          — kolik cest se posuzovalo (commit i pracovní strom)
# Kód: vždy 0, když plán vznikl; ≠ 0 jen při vnitřní chybě — a hook pak spustí VŠE.
#
# PROČ SKRIPT A NE LOGIKA V HOOKU: hook je /bin/sh a netestuje se; tohle se měří
# bránou smerovani-jeden-domov nad dočasným gitem (merge commit → vse, nová větev
# bez base → vse, jen services/ → app=false). Tvrzení „při nejistotě celá sada"
# tak není věta v komentáři, ale naměřená vlastnost.
#
# KDY JE VÝSLEDEK „VŠE" (každý důvod se vypíše, žádný tichý přeskok):
#   · AISHA_PREPUSH_VSE=1 (člověk si vynutil plnou sadu)
#   · žádný ref k posouzení / remote sha není lokálně známé / nová větev bez `<remote>/main`
#   · v rozsahu je merge commit (diff proti base by skryl, co merge přinesl)
#   · víc než AISHA_PREPUSH_MAX_SOUBORU (výchozí 250) změněných cest
#   · směrování si protiřečí (zmenene-cesty.sh skončil ≠ 0)
#
# ⛔ PRE-PUSH TESTUJE PRACOVNÍ STROM, CI COMMIT (naměřeno 2026-09-23: úprava po
# `git mv` mimo stage → lokálně zelené, CI TS2307). Proto se k diffu commitů
# přidávají i necommitnuté a netrackované cesty: co leží na disku, to se testuje.
# =============================================================================
set -u
REMOTE=${1:-}
# Strop je DEKLAROVANÁ hodnota tohoto skriptu (ne odhad světa); prostředí ji smí jen
# přepsat — a nečíselné přepsání = plná sada, ne tichý jiný práh.
MAX=250
[ -n "${AISHA_PREPUSH_MAX_SOUBORU:-}" ] && MAX=$AISHA_PREPUSH_MAX_SOUBORU
ZERO=0000000000000000000000000000000000000000
KOREN=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "rezim=vse"; echo "duvod=nejsem v git repu"; exit 0; }
cd "$KOREN" || exit 1

vse() { echo "rezim=vse"; echo "duvod=$1"; echo "zmeneno=${2:-0}"; exit 0; }

[ "${AISHA_PREPUSH_VSE:-}" = "1" ] && vse "AISHA_PREPUSH_VSE=1 — plná sada vynucena"
[ -n "$REMOTE" ] || vse "hook nepředal jméno remote — base neznámý"
case "$MAX" in ''|*[!0-9]*) vse "AISHA_PREPUSH_MAX_SOUBORU='$MAX' není číslo" ;; esac

REFS=$(cat)
[ -n "$(tr -d '[:space:]' <<< "$REFS")" ] || vse "hook nedostal žádný ref k posouzení"

CHANGED=""
POSOUZENO=0
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "${local_sha:-}" ] || continue
  [ "$local_sha" = "$ZERO" ] && continue            # mazání větve: není co testovat
  if [ "${remote_sha:-$ZERO}" = "$ZERO" ]; then
    # nová větev: base = společný předek s <remote>/main; bez něj nevíme, co se posílá
    git rev-parse --verify -q "refs/remotes/$REMOTE/main" >/dev/null 2>&1 \
      || vse "nová větev a lokálně chybí refs/remotes/$REMOTE/main — base neznámý"
    base=$(git merge-base "$local_sha" "refs/remotes/$REMOTE/main" 2>/dev/null) \
      || vse "nová větev bez společného předka s $REMOTE/main"
  else
    git cat-file -e "$remote_sha^{commit}" 2>/dev/null \
      || vse "remote sha ${remote_sha:0:9} není lokálně známé (nefetchnuto) — base neznámý"
    base=$remote_sha
  fi
  merges=$(git rev-list --merges --count "$base..$local_sha" 2>/dev/null) || vse "rev-list selhal"
  [ "$merges" = "0" ] || vse "v rozsahu ${base:0:9}..${local_sha:0:9} je $merges merge commit(ů)"
  diff=$(bash scripts/ci/zmenene-cesty.sh --seznam "$base" "$local_sha" 2>/dev/null) || vse "seznam změn nejde sestavit (git diff selhal)"
  CHANGED="$CHANGED"$'\n'"$diff"
  POSOUZENO=$((POSOUZENO + 1))
done <<< "$REFS"
[ "$POSOUZENO" -gt 0 ] || vse "žádný ref k posouzení (jen mazání větví)"

# Pracovní strom: změněné (index i disk) a netrackované cesty. `--no-renames`: přesun se vypíše
# jako smazání + přidání, tedy OBĚ cesty (s detekcí by zůstala jen cílová — viz zmenene-cesty.sh).
STROM=$(git -c core.quotePath=false status --porcelain=v1 --untracked-files=all --no-renames 2>/dev/null) || vse "git status selhal"
STROM=$(sed -E 's/^.. //; s/^.* -> //' <<< "$STROM")
CHANGED="$CHANGED"$'\n'"$STROM"
CHANGED=$(grep -v '^[[:space:]]*$' <<< "$CHANGED" | sort -u || true)
N=$(grep -c . <<< "$CHANGED" || true)
[ "$N" -gt 0 ] || vse "seznam změn je prázdný — směrovat není podle čeho" "$N"
[ "$N" -le "$MAX" ] || vse "změněno $N cest > $MAX — příliš velká změna na výběr" "$N"

SMEROVANI=$(bash scripts/ci/zmenene-cesty.sh <<< "$CHANGED" 2>/dev/null) \
  || vse "směrování si protiřečí nebo selhalo (zmenene-cesty.sh ≠ 0)" "$N"
echo "rezim=vyber"
echo "zmeneno=$N"
echo "$SMEROVANI"

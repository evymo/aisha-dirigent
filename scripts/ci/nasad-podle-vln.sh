#!/usr/bin/env bash
# ============================================================================
# Nasadit dotčené aplikace PO VLNÁCH — tentýž řád, jakým staví cold-start.
#
# PROČ (naměřeno 2026-09-16)
# --------------------------
# Po merge #993 detektor označil 11 aplikací se změněnou stavbou, ale CI mělo
# nasazovací úlohu jen pro část z nich. Baseline brány `stack-bez-deploy-ulohy`
# vedla 22 stacků s poznámkou „nasazují se ručně přes aisha-redeploy --only".
# Majitel týž den: „nasadit nechceme nic ručně, ale vše automaticky" — a CI má
# nasazovat VŠECHNY dotčené stacky ve vlnách, trezor zůstává mimo CI.
#
# CO DĚLÁ
# -------
#   1. Pořadí bere z `aisha-redeploy.mjs --print-waves` — z téhož pole WAVES,
#      podle kterého nasazuje cold-start. Druhý seznam pořadí tu NENÍ.
#   2. Aplikace, která ve vlnách není, je NÁLEZ: skript skončí DŘÍV, než cokoli
#      nasadí (manifest a vlny se rozešly — brána redeploy-wave-coverage).
#   3. Vlny jdou vzestupně; aplikace jedné vlny souběžně (jako v cold-startu).
#      Každou nasadí `deploy-and-verify.sh`, který čeká na výsledek, měří
#      doručení povinných proměnných a revizi.
#   4. Selže-li cokoli ve vlně, DALŠÍ vlny se nenasazují — stojí na ní.
#
# Použití:
#   nasad-podle-vln.sh --aplikace a,b,c [--vynech x,y] [--vlny OD-DO | OD-]
#     --aplikace  čárkami (obalené čárky z detect výstupu nevadí)
#     --vynech    aplikace, které nasazuje vlastní úloha (verify-url apod.)
#     --vlny      rozsah čísel vln, např. `0-2` nebo `3-` (výchozí všechny)
# ============================================================================
set -uo pipefail

APLIKACE=""
VYNECH=""
VLNY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --aplikace) APLIKACE="${2:-}"; shift 2 ;;
    --vynech)   VYNECH="${2:-}"; shift 2 ;;
    --vlny)     VLNY="${2:-}"; shift 2 ;;
    *) echo "::error title=neznámý přepínač::nasad-podle-vln.sh: $1" >&2; exit 2 ;;
  esac
done

VLNA_OD=0
VLNA_DO=999999
if [ -n "$VLNY" ]; then
  case "$VLNY" in
    *-*)
      VLNA_OD="${VLNY%%-*}"
      [ -n "${VLNY#*-}" ] && VLNA_DO="${VLNY#*-}"
      ;;
    *) VLNA_OD="$VLNY"; VLNA_DO="$VLNY" ;;
  esac
  case "$VLNA_OD$VLNA_DO" in
    *[!0-9]*) echo "::error title=rozsah vln::--vlny '$VLNY' není ve tvaru OD-DO nebo OD-" >&2; exit 2 ;;
  esac
fi

# Seznam „,a,b," → řádky; prázdné položky pryč.
na_radky() { printf '%s' "$1" | tr ',' '\n' | sed 's/[[:space:]]//g' | awk 'NF'; }

CILE="$(na_radky "$APLIKACE" | sort -u)"
if [ -z "$CILE" ]; then
  echo "Žádná aplikace se změněnou stavbou — nic k nasazení."
  exit 0
fi
VYNECHANE="$(na_radky "$VYNECH" | sort -u)"

# ── Pořadí z téhož pole, podle kterého nasazuje cold-start ─────────────────
if ! PORADI="$(node scripts/aisha-redeploy.mjs --print-waves)"; then
  echo "::error title=pořadí vln nejde zjistit::aisha-redeploy.mjs --print-waves skončil nenulově — bez pořadí se nenasazuje (hádané pořadí by mohlo nasadit konzumenta dřív než kořen důvěry)." >&2
  exit 1
fi
if [ -z "$PORADI" ]; then
  echo "::error title=pořadí vln je prázdné::aisha-redeploy.mjs --print-waves nevrátil nic." >&2
  exit 1
fi

# ── Každá cílová aplikace MUSÍ mít vlnu — dřív, než se cokoli nasadí ───────
BEZ_VLNY=""
while IFS= read -r app; do
  [ -z "$app" ] && continue
  if ! awk -F'\t' -v a="$app" '$2 == a { f = 1 } END { exit f ? 0 : 1 }' <<< "$PORADI"; then
    BEZ_VLNY="${BEZ_VLNY} ${app}"
  fi
done <<< "$CILE"
if [ -n "$BEZ_VLNY" ]; then
  echo "::error title=aplikace bez vlny::${BEZ_VLNY# } — detektor ji chce nasadit, ale WAVES v aisha-redeploy.mjs ji neznají. NENASAZUJI NIC: pořadí by bylo hádané. Doplň ji do WAVES (brána redeploy-wave-coverage)." >&2
  exit 1
fi

LOGY="$(mktemp -d)"
trap 'rm -rf "$LOGY"' EXIT
SOUHRN=""
NASAZENO=0

for vlna in $(printf '%s\n' "$PORADI" | cut -f1 | sort -n -u); do
  [ "$vlna" -lt "$VLNA_OD" ] && continue
  [ "$vlna" -gt "$VLNA_DO" ] && continue

  VE_VLNE=""
  # Třetí sloupec (strop práce, jen u appek s doloženě delší stavbou) se tu
  # zahazuje — bez `_strop` by se přilepil ke jménu a appka by „nebyla v cíli".
  while IFS=$'\t' read -r cislo app _strop; do
    [ "$cislo" = "$vlna" ] || continue
    # ⛔ Here-string, ne roura: `printf | grep -q` s pipefail vrací 141, když
    # grep skončí dřív, než printf dopíše — a shoda by se přečetla jako neshoda
    # (naměřeno 2026-09-11, CI routing „zelená bez měření").
    grep -qxF -- "$app" <<< "$CILE" || continue
    if [ -n "$VYNECHANE" ] && grep -qxF -- "$app" <<< "$VYNECHANE"; then
      SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: nasazuje vlastní úloha (--vynech)\n"
      continue
    fi
    VE_VLNE="${VE_VLNE} ${app}"
  done <<< "$PORADI"
  [ -z "$VE_VLNE" ] && continue

  echo "━━ vlna ${vlna}:${VE_VLNE} ━━"
  PIDS=""
  for app in $VE_VLNE; do
    # Strop práce z téhož domova jako pořadí (STROP_PRACE_S vedle WAVES) — jen
    # u appek, které se do výchozího stropu doloženě nevejdou; jinak výchozí.
    STROP=$(awk -F'\t' -v a="$app" '$2 == a { print $3; exit }' <<< "$PORADI")
    if [ -n "$STROP" ]; then
      bash scripts/ci/deploy-and-verify.sh "$app" --optional --timeout-s "$STROP" > "$LOGY/$app.log" 2>&1 &
    else
      bash scripts/ci/deploy-and-verify.sh "$app" --optional > "$LOGY/$app.log" 2>&1 &
    fi
    PIDS="${PIDS} $!:${app}"
  done

  SELHALO=""
  NEDOBEHLO=""
  for par in $PIDS; do
    pid="${par%%:*}"
    app="${par#*:}"
    wait "$pid"
    rc=$?
    echo "::group::vlna ${vlna} — ${app} (rc=${rc})"
    cat "$LOGY/$app.log"
    echo "::endgroup::"
    if [ "$rc" -eq 0 ] && grep -qF "title=appka není nasazena::" "$LOGY/$app.log"; then
      # `--optional`: instance si aplikaci nezapnula. Zeleno, ale NENASAZENO —
      # souhrn to musí říct, jinak by „přeskočeno" vypadalo jako „ověřeno".
      SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: NENASAZENO — v Coolify této instance není (volitelná)\n"
    elif [ "$rc" -eq 0 ]; then
      SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: nasazeno a ověřeno\n"
      NASAZENO=$((NASAZENO + 1))
    elif [ "$rc" -eq 4 ]; then
      # deploy-and-verify kód 4: Coolify nasazení běží dál, CI jen přestalo čekat.
      # Výsledek je NEZNÁMÝ, ne špatný (naměřeno 2026-09-24: tři „SELHALO" z vlny 7
      # Coolify dokončil úspěšně). Další vlny ale stojí dál — závislost nevíme.
      SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: NEDOBĚHLO V ČASE — výsledek NEZNÁMÝ, nasazení v Coolify běží dál (rc=4)\n"
      NEDOBEHLO="${NEDOBEHLO} ${app}"
    else
      SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: SELHALO (rc=${rc})\n"
      SELHALO="${SELHALO} ${app}"
    fi
  done

  if [ -n "$SELHALO" ] || [ -n "$NEDOBEHLO" ]; then
    [ -n "$SELHALO" ] && echo "::error title=vlna ${vlna} selhala::${SELHALO# } — další vlny se NENASAZUJÍ (stojí na téhle)."
    if [ -n "$NEDOBEHLO" ]; then
      echo "::error title=vlna ${vlna} nedoběhla v čase::${NEDOBEHLO# } — výsledek NEZNÁMÝ (Coolify nasazení nezrušil); další vlny se NENASAZUJÍ, dokud se nezměří."
      # Jak dál (recenze aisha-team 2026-09-24): člověk pod tlakem nemá vymýšlet,
      # jestli pouštět všechno znovu. Změřit, pak pokračovat od DALŠÍ vlny.
      echo "  Jak dál: ověř v Coolify stav nasazení (UUID ve výpisu vlny výše; dočte ho deploy-and-verify) — je-li 'finished',"
      echo "  pokračuj od další vlny: bash scripts/ci/nasad-podle-vln.sh --aplikace '${APLIKACE}'${VYNECH:+ --vynech '${VYNECH}'} --vlny $((vlna + 1))-"
      echo "  (znovuspuštění celé úlohy nasadí znovu i vlny, které už doběhly)."
    fi
    printf '\nSouhrn:\n%b' "$SOUHRN"
    exit 1
  fi
done

if [ -z "$SOUHRN" ]; then
  SOUHRN="  v rozsahu vln nebyla žádná cílová aplikace\n"
fi
printf '\nSouhrn (%s nasazeno):\n%b' "$NASAZENO" "$SOUHRN"
exit 0

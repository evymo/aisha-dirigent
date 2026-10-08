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
#     --mekky-termin  epoch (s): na něm se přestane čekat i spouštět. Rozpracované
#                 appky (nasazení v Coolify běží dál) a nespuštěné vlny se vypíšou;
#                 bez --predat je to pád se seznamem, s --predat předání
#     --predat    na měkkém termínu PŘEDAT pokračovacímu jobu: output
#                 `predano=true` + `rozpracovane` + `nespustene`, kód 0. Skutečná
#                 chyba appky je dál pád (kód 1).
#     --navazat-od  epoch (s) začátku běhu (job deploy-zacatek): pokračovací režim
#                 deploy-and-verify.sh — navázat na nasazení tohoto běhu
#     --drzene    JSON pole DEKLAROVANÉHO držení (output deploy-zacatek, ověřený
#                 scripts/lib/nasazeni-drzene.mjs): držená aplikace se NEnasadí,
#                 souhrn ji vypíše „DRŽENO: …“ a další vlny pokračují. Prázdná nebo
#                 nečitelná hodnota = chyba zadání (v CI by znamenala ztracený výstup).
#
# PROČ DRŽENÍ (2026-10-02, dávka #1139): web-render bez deklarovaných HOST_DIR
# preflight správně odmítl — ale aplikace je držená rozhodnutím majitele, takže
# nasazení bylo červené při každém běhu a stálá červená by schovala skutečné chyby.
# Nedeklarovaná chybějící proměnná zůstává fail-closed jako dřív.
#
# PROČ MĚKKÝ TERMÍN (naměřeno 2026-09-30): vlna se 6–9 appkami trvá 35–49 min
# a runner job utne na svém stropu UPROSTŘED operace (2026-09-30: přesně v 60. min,
# vlna 8 nedohlídána). Coolify nasazení přitom dobíhají dál. Úloha, která zná
# svůj strop, má skončit dřív a říct, co zůstalo — ne čekat na zabití.
# ============================================================================
set -uo pipefail

APLIKACE=""
VYNECH=""
VLNY=""
MEKKY_TERMIN=""
PREDAT=0
NAVAZAT_OD=""
DRZENE_JSON=""
DRZENE_ZADANO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --aplikace) APLIKACE="${2:-}"; shift 2 ;;
    --vynech)   VYNECH="${2:-}"; shift 2 ;;
    --vlny)     VLNY="${2:-}"; shift 2 ;;
    --mekky-termin) MEKKY_TERMIN="${2:-}"; shift 2 ;;
    --predat)   PREDAT=1; shift ;;
    --navazat-od) NAVAZAT_OD="${2:-}"; shift 2 ;;
    --drzene)   DRZENE_JSON="${2:-}"; DRZENE_ZADANO=1; shift 2 ;;
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

for _r in "$MEKKY_TERMIN" "$NAVAZAT_OD"; do
  if [ -n "$_r" ] && ! [[ "$_r" =~ ^[0-9]{9,11}$ ]]; then
    echo "::error title=razítko::--mekky-termin / --navazat-od chce epochu v sekundách, dostal '${_r}'" >&2; exit 2
  fi
done
if [ "$PREDAT" -eq 1 ] && [ -z "$MEKKY_TERMIN" ]; then
  echo "::error title=předání bez termínu::--predat dává smysl jen s --mekky-termin" >&2; exit 2
fi

# Držené aplikace: aplikace<TAB>důvod<TAB>kdo<TAB>datum<TAB>odkaz<TAB>dní.
DRZENE_TSV=""
if [ "$DRZENE_ZADANO" -eq 1 ]; then
  if ! DRZENE_TSV="$(node -e '
      const d = JSON.parse(process.argv[1]);
      if (!Array.isArray(d)) throw new Error("není pole");
      const c = (v) => String(v).replace(/[\t\n\r]+/g, " ");
      for (const p of d) {
        if (!p || !p.aplikace || !p.duvod || !p.datum) throw new Error("položka bez aplikace, důvodu nebo data");
        console.log([p.aplikace, p.duvod, p.kdo, p.datum, p.odkaz, p.dni].map(c).join("\t"));
      }' "$DRZENE_JSON" 2>&1)"; then
    echo "::error title=deklarace držení::--drzene '${DRZENE_JSON}' nejde přečíst (${DRZENE_TSV}) — nevíme, co je drženo, NENASAZUJI." >&2
    exit 2
  fi
fi
DRZENE_APLIKACE="$(printf '%s' "$DRZENE_TSV" | cut -f1)"
drzena() { [ -n "$DRZENE_APLIKACE" ] && grep -qxF -- "$1" <<< "$DRZENE_APLIKACE"; }
DRZENO=""

# Výstup pro navazující joby (pokračování, deploy-verdikt). Mimo CI se jen vypíše.
vystup() {
  echo "  výstup: $1=$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; fi
}

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
# Aplikace, které v Coolify této instance NEJSOU (`--optional` je přeskočí zeleně).
# Verdikt je vyjmenuje a spočítá: špatný prefix by jinak vypadal jako „vše ověřeno“.
NENALEZENO=""

# Appky dané vlny, které jsou v cíli a nenasazuje je vlastní úloha (pro výpis
# „nespuštěno“ za měkkým termínem).
cile_vlny() {
  local v="$1" cislo app _s
  while IFS=$'\t' read -r cislo app _s; do
    [ "$cislo" = "$v" ] || continue
    grep -qxF -- "$app" <<< "$CILE" || continue
    if [ -n "$VYNECHANE" ] && grep -qxF -- "$app" <<< "$VYNECHANE"; then continue; fi
    drzena "$app" && continue
    printf '%s ' "$app"
  done <<< "$PORADI"
}
VLNY_V_ROZSAHU=""
for vlna in $(printf '%s\n' "$PORADI" | cut -f1 | sort -n -u); do
  [ "$vlna" -lt "$VLNA_OD" ] && continue
  [ "$vlna" -gt "$VLNA_DO" ] && continue
  VLNY_V_ROZSAHU="${VLNY_V_ROZSAHU} ${vlna}"
done
PREDANO=""
NESPUSTENE=""

for vlna in $VLNY_V_ROZSAHU; do
  # Měkký termín: novou vlnu už nespouštět — co zbývá, převezme pokračování.
  if [ -n "$MEKKY_TERMIN" ] && [ "$(date +%s)" -ge "$MEKKY_TERMIN" ]; then
    for zbyla in $VLNY_V_ROZSAHU; do
      [ "$zbyla" -ge "$vlna" ] || continue
      for app in $(cile_vlny "$zbyla"); do
        NESPUSTENE="${NESPUSTENE} ${app}"
        SOUHRN="${SOUHRN}  vlna ${zbyla}  ${app}: NESPUŠTĚNO — měkký termín úlohy vypršel dřív\n"
      done
    done
    break
  fi

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
    if drzena "$app"; then
      IFS=$'\t' read -r _a d_duvod d_kdo d_datum d_odkaz d_dni <<< "$(awk -F'\t' -v a="$app" '$1 == a' <<< "$DRZENE_TSV")"
      echo "::warning title=DRŽENO: ${app}::${d_duvod} — rozhodnutí ${d_kdo} ${d_datum} (${d_odkaz}); drženo od ${d_datum} (${d_dni} dní). Nenasazuji, další vlny pokračují."
      SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: DRŽENO — ${d_duvod} (rozhodnutí ${d_kdo} ${d_datum}, ${d_odkaz}; drženo od ${d_datum}, ${d_dni} dní)\n"
      DRZENO="${DRZENO} ${app}"
      continue
    fi
    VE_VLNE="${VE_VLNE} ${app}"
  done <<< "$PORADI"
  [ -z "$VE_VLNE" ] && continue

  echo "━━ vlna ${vlna}:${VE_VLNE} ━━"
  # Termín a navázání jen když jsou zadané — bez nich je volání beze změny.
  DALSI=()
  if [ -n "$MEKKY_TERMIN" ]; then DALSI+=(--termin "$MEKKY_TERMIN"); fi
  if [ -n "$NAVAZAT_OD" ]; then DALSI+=(--navazat-od "$NAVAZAT_OD"); fi
  PIDS=""
  for app in $VE_VLNE; do
    # Strop práce z téhož domova jako pořadí (STROP_PRACE_S vedle WAVES) — jen
    # u appek, které se do výchozího stropu doloženě nevejdou; jinak výchozí.
    STROP=$(awk -F'\t' -v a="$app" '$2 == a { print $3; exit }' <<< "$PORADI")
    # `${DALSI[@]+…}`: prázdné pole pod `set -u` shodí bash 3.2 (macOS).
    if [ -n "$STROP" ]; then
      bash scripts/ci/deploy-and-verify.sh "$app" --optional --timeout-s "$STROP" ${DALSI[@]+"${DALSI[@]}"} > "$LOGY/$app.log" 2>&1 &
    else
      bash scripts/ci/deploy-and-verify.sh "$app" --optional ${DALSI[@]+"${DALSI[@]}"} > "$LOGY/$app.log" 2>&1 &
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
      NENALEZENO="${NENALEZENO} ${app}"
    elif [ "$rc" -eq 0 ] && [ -z "$NAVAZAT_OD" ]; then
      SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: nasazeno a ověřeno\n"
      NASAZENO=$((NASAZENO + 1))
    elif [ "$rc" -eq 0 ]; then
      # Pokračování říká, CO udělalo (navázáno / ověřeno hotové / nasazeno znovu + id).
      # Mlčí-li, nevíme, co ověřilo — nejistota = STOP, ne „asi ověřeno".
      POKR=$(sed -n 's/^pokračování-výsledek: //p' "$LOGY/$app.log" | tail -1)
      if [ -n "$POKR" ]; then
        SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: ${POKR}\n"
        NASAZENO=$((NASAZENO + 1))
      else
        SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: NEJASNÉ — pokračování skončilo nulou, ale neřeklo, co udělalo\n"
        SELHALO="${SELHALO} ${app}"
      fi
    elif [ "$rc" -eq 4 ] && [ -n "$MEKKY_TERMIN" ] && grep -qF "title=předáno pokračování::" "$LOGY/$app.log"; then
      # Měkký termín: nasazení v Coolify běží dál; dočká se ho a ověří pokračování.
      SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: PŘEDÁNO — nasazení v Coolify běží dál, měkký termín úlohy vypršel\n"
      PREDANO="${PREDANO} ${app}"
    elif [ "$rc" -eq 4 ]; then
      # deploy-and-verify kód 4: Coolify nasazení běží dál, CI jen přestalo čekat.
      # Výsledek je NEZNÁMÝ, ne špatný (naměřeno 2026-09-24: tři „SELHALO" z vlny 7
      # Coolify dokončil úspěšně). Další vlny ale stojí dál — závislost nevíme.
      SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: NEDOBĚHLO V ČASE — výsledek NEZNÁMÝ, nasazení v Coolify běží dál (rc=4)\n"
      NEDOBEHLO="${NEDOBEHLO} ${app}"
    else
      # Pokračování už jednou nasadilo znovu: souhrn to řekne výslovně i s třídou,
      # aby se druhý pád nečetl jako přechodný (2026-10-02).
      PO_OPAKOVANI=$(sed -n 's/.*title=pád i po opakování::.* Třída: //p' "$LOGY/$app.log" | tail -1)
      if [ -n "$PO_OPAKOVANI" ]; then
        SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: PÁD I PO OPAKOVÁNÍ (rc=${rc}) — třída: ${PO_OPAKOVANI}\n"
      else
        SOUHRN="${SOUHRN}  vlna ${vlna}  ${app}: SELHALO (rc=${rc})\n"
      fi
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

  if [ -n "$PREDANO" ]; then
    # Rozpracovaná vlna: další vlny závisí na ní, takže se nespouští.
    for zbyla in $VLNY_V_ROZSAHU; do
      [ "$zbyla" -gt "$vlna" ] || continue
      for app in $(cile_vlny "$zbyla"); do
        NESPUSTENE="${NESPUSTENE} ${app}"
        SOUHRN="${SOUHRN}  vlna ${zbyla}  ${app}: NESPUŠTĚNO — vlna ${vlna} se předává rozpracovaná\n"
      done
    done
    break
  fi
done

if [ -n "$PREDANO" ] || [ -n "$NESPUSTENE" ]; then
  rozpracovane=$(printf '%s' "${PREDANO# }" | tr ' ' ',')
  nespustene=$(printf '%s' "${NESPUSTENE# }" | tr ' ' ',')
  printf '\nSouhrn (%s nasazeno, měkký termín vypršel):\n%b' "$NASAZENO" "$SOUHRN"
  if [ "$PREDAT" -eq 1 ]; then
    echo "::notice title=předáno pokračování::rozpracované: ${rozpracovane:-žádné} · nespuštěné: ${nespustene:-žádné} — dočká se jich a ověří pokračovací job TÉHOŽ běhu."
    vystup nenalezeno "$(printf '%s' "${NENALEZENO# }" | tr ' ' ',')"
    vystup predano true
    vystup rozpracovane "$rozpracovane"
    vystup nespustene "$nespustene"
    exit 0
  fi
  echo "::error title=měkký termín vypršel::nedokončeno — rozpracované: ${rozpracovane:-žádné} · nespuštěné: ${nespustene:-žádné}. Tahle úloha už nic nepředává (pokračování je jen jedno)."
  exit 1
fi

if [ -z "$SOUHRN" ]; then
  SOUHRN="  v rozsahu vln nebyla žádná cílová aplikace\n"
fi
printf '\nSouhrn (%s nasazeno%s):\n%b' "$NASAZENO" "${DRZENO:+, drženo:${DRZENO}}" "$SOUHRN"
vystup nenalezeno "$(printf '%s' "${NENALEZENO# }" | tr ' ' ',')"
vystup predano false
exit 0

#!/bin/bash
# =============================================================================
# assert-arm64.sh — hotový artefakt nesmí nést x86_64. Nativní arm64, jinak nic.
# =============================================================================
# Použití:   bash scripts/assert-arm64.sh <cesta k .app nebo .xcarchive>
#
# Pravidlo majitele (2026-08-19): „vždy jen a jen bez Rosetty a nativně pro arm,
# a ne jinak." Tenhle skript je jeho druhá polovina — první je nativní tooling
# (viz `pods-install.sh`), tady se měří VÝSLEDEK.
#
# ⛔ PROČ MĚŘIT VÝSTUP, KDYŽ UŽ HLÍDÁME NÁSTROJE. Protože architektura výstupu
# se neodvozuje od toho, čím se stavělo. `EXCLUDED_ARCHS` v cizím podspecu,
# přepnuté `ARCHS`, jiné SDK — kterákoli z těch věcí umí vyrobit x86_64, i když
# všechny nástroje běžely nativně. Naměřeno 2026-08-19: simulátorový build vyšel
# jako x86_64 kvůli `EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64` z MLKitu.
#
# ⭐ MĚŘÍ SE JEN NÁŠ SPUSTITELNÝ SOUBOR, ne pody. Cizí tučné frameworky x86_64
# obsahovat SMÍ (mají v sobě simulátorový řez) — linker si z nich vybere. Vada
# je, až když ho nese to, co se odesílá.
set -u

CIL="${1:-}"
[ -n "$CIL" ] || { echo "[error] assert-arm64.sh: chybí cesta k artefaktu" >&2; exit 2; }

# .xcarchive → najdi v něm .app
if [ -d "$CIL/Products/Applications" ]; then
    CIL="$(ls -d "$CIL/Products/Applications/"*.app 2>/dev/null | head -1)"
fi
[ -d "$CIL" ] || { echo "[error] assert-arm64.sh: $CIL není adresář" >&2; exit 2; }

JMENO="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$CIL/Info.plist" 2>/dev/null)"
BIN="$CIL/$JMENO"
[ -f "$BIN" ] || { echo "[error] assert-arm64.sh: spustitelný soubor nenalezen ($BIN)" >&2; exit 2; }

ARCHS="$(lipo -archs "$BIN" 2>/dev/null)"
PLAT="$(vtool -show-build "$BIN" 2>/dev/null | grep -m1 platform | tr -s ' ' | sed 's/^ *platform *//')"

echo "[info]  $JMENO: archs=[$ARCHS] platform=$PLAT"

case " $ARCHS " in
  *" x86_64 "*|*" i386 "*)
    echo "[error] ARTEFAKT NESE x86_64 — nativní arm64, jinak nic." >&2
    echo "[error]   soubor: $BIN" >&2
    echo "[error]   archs:  $ARCHS" >&2
    echo "[error]" >&2
    echo "[error] CO S TIM:" >&2
    echo "[error]   · zkontroluj EXCLUDED_ARCHS (cizí podspec ho umí vnutit):" >&2
    echo "[error]       xcodebuild -showBuildSettings | grep -E 'ARCHS|EXCLUDED_ARCHS'" >&2
    echo "[error]   · pro simulátor je dnes vynucený x86_64 kvůli MLKitu (nemá" >&2
    echo "[error]     arm64 řez pro simulátor) — takový build se NEODESÍLÁ." >&2
    exit 1
    ;;
esac

case " $ARCHS " in
  *" arm64 "*) ;;
  *) echo "[error] artefakt nenese arm64 vůbec (archs=[$ARCHS])" >&2; exit 1 ;;
esac

echo "[ok]    nativní arm64, bez x86_64"

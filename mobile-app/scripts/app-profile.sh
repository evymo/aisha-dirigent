#!/bin/bash
# =============================================================================
# app-profile.sh — kdo je tenhle build. JEDINÉ místo, kde se to zjišťuje.
# =============================================================================
# Sourcuje se, nespouští:   . "$SCRIPT_DIR/app-profile.sh"
#
# ⛔ PROČ VZNIKL (2026-08-19). Identitu appky si do dneška zjišťoval KAŽDÝ skript
# sám, a všechny stejně špatně — napevno `$PROJECT_DIR/version.json`:
#   · prepare-xcode-build.sh  → poslal operátora otevřít cizí workspace
#   · post-prebuild.sh        → hledal ios/AISHADirigent/ a `cp` spadl,
#                               přestože prebuild vyrobil ios/RIQRidic/
#   · build-ios.sh            → týž vzor
# `app.config.ts` přitom čte `AISHA_APP_VERSION_FILE` a bez fallbacku. Dokud
# existovala JEDNA appka, ukazovaly obě cesty na týž soubor a nešlo to poznat.
# Druhá appka je rozešla — a každý skript se musel opravovat zvlášť, což je
# přesně to, co se tímhle souborem přestává dít.
#
# ⛔ ŽÁDNÝ FALLBACK NA JMÉNO PLATFORMY. `XCODE_NAME:-AISHADirigent` znamenalo
# operátora poslaného do cizího projektu a `cp` do neexistujícího adresáře.
# Chybějící hodnota build ZASTAVÍ, stejně jako to dělá app.config.ts.
#
# Vyváží: VERSION_FILE · XCODE_NAME · GOOGLE_PLIST_SRC (může být prázdné)
# =============================================================================

VERSION_FILE="${AISHA_APP_VERSION_FILE:-$PROJECT_DIR/version.json}"
if [ ! -f "$VERSION_FILE" ]; then
  echo "[error] Profil appky nelze přečíst: $VERSION_FILE" >&2
  echo "        Pro instanční build nastav AISHA_APP_VERSION_FILE." >&2
  exit 1
fi

# Jméno Xcode workspace/scheme = Expo pravidlo (displayName bez nealfanumerik),
# které si profil drží jako `brand.xcodeName`.
XCODE_NAME=$(grep '"xcodeName"' "$VERSION_FILE" | head -1 | sed 's/.*: "\(.*\)".*/\1/')
if [ -z "$XCODE_NAME" ]; then
  echo "[error] $VERSION_FILE neuvádí brand.xcodeName — nevím, jaký workspace vznikne." >&2
  exit 1
fi

# Firebase je INSTANČNÍ a per-bundle: `GOOGLE_APP_ID` v plistu je adresa KONKRÉTNÍ
# appky, takže dvě appky nemůžou sdílet jeden soubor, i když jsou v témž projektu.
GOOGLE_PLIST_SRC="${AISHA_FIREBASE_IOS_FILE:-$PROJECT_DIR/GoogleService-Info.plist}"
if [ -n "${AISHA_FIREBASE_IOS_FILE:-}" ] && [ ! -f "$AISHA_FIREBASE_IOS_FILE" ]; then
  echo "[error] AISHA_FIREBASE_IOS_FILE ukazuje na $AISHA_FIREBASE_IOS_FILE, ale soubor tam není." >&2
  exit 1
fi

# ── Nativní schopnosti, které build NEPOTŘEBUJE ──────────────────────────────
# ⭐ ROZHODUJE ZNAČKA, NE SKRIPT. `brand.nativniSchopnosti` říká, co tahle appka
# umí; autolinking podle toho vynechá nativní knihovny, které by se jinak
# slinkovaly jen proto, že jsou nainstalované (viz react-native.config.js).
#
# ⛔ VÝCHOZÍ STAV JE „LINKUJ". Chybějící deklarace znamená plnou appku, ne
# oholenou — build, který schopnost potřebuje, o ni nesmí přijít mlčky. Proto se
# vyřazuje jen při VÝSLOVNÉM `false`, ne při nepřítomnosti klíče.
#
# NAMĚŘENO 2026-09-22 na `<fork>-ridic`: 86 MB, z toho 31,6 MB nativních knihoven
# bez dosažitelného volajícího. Balíček se přitom stahuje do každého tabletu
# přes LTE při každé aktualizaci a cesta dovnitř má strop ~60 s.
schopnost_vypnuta() {   # $1 = jméno klíče v brand.nativniSchopnosti
  node -e '
    const fs = require("fs");
    try {
      const b = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).brand || {};
      const s = b.nativniSchopnosti || {};
      process.stdout.write(s[process.argv[2]] === false ? "1" : "");
    } catch { process.stdout.write(""); }
  ' "$VERSION_FILE" "$1"
}
export AISHA_SKIP_LIVEKIT="${AISHA_SKIP_LIVEKIT:-$(schopnost_vypnuta hovory)}"
export AISHA_SKIP_MLKIT="${AISHA_SKIP_MLKIT:-$(schopnost_vypnuta ocrVZarizeni)}"
export AISHA_SKIP_SKIA="${AISHA_SKIP_SKIA:-$(schopnost_vypnuta grafy)}"
VYRAZENO=""
[ "${AISHA_SKIP_LIVEKIT:-}" = "1" ] && VYRAZENO="$VYRAZENO hovory"
[ "${AISHA_SKIP_MLKIT:-}" = "1" ] && VYRAZENO="$VYRAZENO OCR"
[ "${AISHA_SKIP_SKIA:-}" = "1" ] && VYRAZENO="$VYRAZENO grafy"
# ⛔ Tenhle soubor se SOURCUJE. Poslední příkaz určuje status sourcování, a
#    volající běží pod `set -e`: `[ -n "$X" ] && echo` by u značky, která
#    nic nevyřazuje, vrátilo 1 a build by TIŠE skončil hned tady.
if [ -n "$VYRAZENO" ]; then
  echo "[info] značka vyřazuje nativní schopnosti:$VYRAZENO"
fi

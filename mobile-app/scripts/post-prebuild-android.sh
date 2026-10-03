#!/bin/bash
#
# post-prebuild-android.sh - Apply Android-specific fixes after expo prebuild
#
# Handles:
#   1. Firebase notification icon color conflict
#   2. google-services.json copying
#   3. cílové architektury a paměť Gradle
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ANDROID_DIR="$PROJECT_DIR/android"

# ⛔ NAMĚŘENO 2026-09-18 na buildu Řidiče (targetSdk 36, overlay <fork>-ridic):
# tenhle skript četl `$VERSION_FILE`, ale NIKDO mu ho nenastavil — `app-profile.sh`
# ho vyváží jako OBYČEJNOU proměnnou a `build-android.sh` tenhle skript spouští
# jako PODPROCES, takže se nedědí. Skript proto grepoval prázdnou cestu, `ABI`
# vyšel prázdný a zvolila se větev „povrch architekturu neuvedl" — ačkoli
# `surfaces/<fork>-ridic/version.json` uvádí `brand.androidAbi: arm64-v8a`.
#
# Výsledek se nedal poznat z chybové hlášky, protože žádná nebyla: APK prostě
# neslo VŠECHNY ČTYŘI architektury. Naměřeno na artefaktu: 258 MB, z toho
# 232 MB nativních knihoven, a x86 i x86_64 jsou EMULÁTOROVÉ — na tabletu
# nikdy neběží. Na LTE tabletech řidičů je to čistá ztráta dat a místa.
#
# ⭐ Profil se proto ČTE TADY, ze stejného jediného zdroje jako jinde. Skript,
# který profil potřebuje, si ho vyžádá sám; hlídat, kdo mu co vyexportoval,
# je ta samá past znovu.
. "$SCRIPT_DIR/app-profile.sh"

echo "Post-prebuild Android"
echo "====================="

# 1. Copy google-services.json
# ⛔ NAMĚŘENO 2026-09-04: tady stála natvrdo cesta do kořene projektu a
# `AISHA_FIREBASE_ANDROID_FILE` skript NEZNAL. Instanční build tedy dostal
# APK BEZ Firebase — a jen s varováním, které se v tisících řádků Gradle
# ztratí. iOS na to má `AISHA_FIREBASE_IOS_FILE` (app-profile.sh), Android
# neměl protějšek: táž appka, dvě platformy, jen jedna uměla identitu.
#
# ⭐ Firebase je PER BUNDLE (`GOOGLE_APP_ID` je adresa konkrétní appky), takže
# ho dvě appky sdílet NEMOHOU — proto se bere z povrchu instance, ne z repa.
# ⭐ NENÍ TO FALLBACK NAD IDENTITOU, a proto je to napsané VĚTVÍ, ne `:-`.
# Nedosazuje se fakt o světě (kdo je instance, jaká zařízení má) — vybírá se
# mezi dvěma DEKLAROVANÝMI cestami: co řekl volající, nebo konvenční místo
# v projektu. Rozdíl je vidět, takže ho jde přezkoumat.
# ⛔ Chybějící soubor se NEDOMÝŠLÍ: níž se z toho stane hlášení, ne tichý běh.
if [ -n "${AISHA_FIREBASE_ANDROID_FILE:-}" ]; then
    GOOGLE_SERVICES_SRC="$AISHA_FIREBASE_ANDROID_FILE"
else
    GOOGLE_SERVICES_SRC="$PROJECT_DIR/google-services.json"
fi
# Ukázala-li proměnná na soubor, který tam není, je to CHYBA, ne „použij jiný":
# tiché pokračování by vyrobilo APK pod cizí Firebase adresou.
if [ -n "${AISHA_FIREBASE_ANDROID_FILE:-}" ] && [ ! -f "$AISHA_FIREBASE_ANDROID_FILE" ]; then
    echo "[error] AISHA_FIREBASE_ANDROID_FILE ukazuje na $AISHA_FIREBASE_ANDROID_FILE, ale soubor tam není." >&2
    exit 1
fi
GOOGLE_SERVICES_DST="$ANDROID_DIR/app/google-services.json"

if [ -f "$GOOGLE_SERVICES_SRC" ]; then
    cp "$GOOGLE_SERVICES_SRC" "$GOOGLE_SERVICES_DST"
    echo "[ok] google-services.json copied"
else
    echo "[warn] google-services.json not found - push notifications won't work"
fi

# 2. Fix Firebase notification color conflict
# (Expo and Firebase both try to define notification_icon color)
COLORS_FILE="$ANDROID_DIR/app/src/main/res/values/colors.xml"
if [ -f "$COLORS_FILE" ]; then
    if grep -c 'notification_icon_color' "$COLORS_FILE" | grep -q '[2-9]'; then
        echo "[info] Fixing duplicate notification_icon_color..."
        # Keep only the first occurrence
        python3 -c "
import re
with open('$COLORS_FILE', 'r') as f:
    content = f.read()
# Remove duplicate entries
seen = set()
lines = []
for line in content.split('\n'):
    match = re.search(r'name=\"([^\"]+)\"', line)
    if match:
        name = match.group(1)
        if name in seen:
            continue
        seen.add(name)
    lines.append(line)
with open('$COLORS_FILE', 'w') as f:
    f.write('\n'.join(lines))
" 2>/dev/null || true
        echo "[ok] Duplicate colors fixed"
    fi
fi

echo "[ok] Post-prebuild Android complete"

# =============================================================================
# 3. CÍLOVÉ ARCHITEKTURY A PAMĚŤ
# =============================================================================
#
# ⛔ `android/` je GENEROVANÝ adresář (`expo prebuild`). Cokoli se v něm nastaví
# ručně, zmizí při příštím `--clean`. Proto to patří sem: hook běží po KAŽDÉM
# prebuildu, takže nastavení přežije regeneraci.
#
# ⭐ JEN arm64-v8a — rozhodnutí majitele 2026-09-04 („arm64-v8a pokud neřekneme
# jinak"). Šablona React Native dává `armeabi-v7a,arm64-v8a,x86,x86_64`, jenže
# `x86` a `x86_64` jsou EMULÁTOROVÉ architektury: na žádném tabletu ani telefonu
# neběží. Stavěla se tedy polovina nativního kódu pro zařízení, které nikdo
# nemá. Nebylo to rozhodnutí, byla to výchozí hodnota, kterou nikdo nevyslovil.
#
# ⚠️ KDYŽ BUDEŠ POTŘEBOVAT EMULÁTOR (x86_64) nebo starší zařízení (armeabi-v7a),
# přidej je sem — ne do `android/gradle.properties`, ten se přepíše.
NASTAV() {  # klíč, hodnota — přepíše existující řádek, jinak přidá
    local k="$1" v="$2" f="$ANDROID_DIR/gradle.properties"
    if grep -qE "^$k=" "$f"; then
        # `sed -i ''` je BSD tvar (macOS); GNU sed by tu prázdný argument vzal
        # jako výraz. Skript běží na obojím, proto přes dočasný soubor.
        grep -vE "^$k=" "$f" > "$f.tmp" && printf '%s=%s\n' "$k" "$v" >> "$f.tmp" && mv "$f.tmp" "$f"
    else
        printf '%s=%s\n' "$k" "$v" >> "$f"
    fi
}

if [ -f "$ANDROID_DIR/gradle.properties" ]; then
    # ⛔ ŽÁDNÝ FALLBACK. Cílová architektura je fakt o světě (jaká zařízení
    # lidé mají), takže se DEKLARUJE v povrchu instance — `brand.androidAbi`.
    # Když ji povrch neuvede, NEDOSAZUJEME za něj: necháme generátoru jeho
    # vlastní sadu a řekneme to nahlas. Dosazená hodnota by tiše rozhodla za
    # instanci, která se nevyjádřila — a přesně to brána
    # `zadny-fallback-nad-identitou` právem zakazuje.
    ABI=$(grep '"androidAbi"' "$VERSION_FILE" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    if [ -n "$ABI" ]; then
        NASTAV reactNativeArchitectures "$ABI"
    else
        echo "[info] Povrch neuvádí brand.androidAbi — architektury nechávám, jak je dal generátor."
    fi
    # ⛔ NAMĚŘENO 2026-09-04: s 2048m/512m Gradle hlásil „Daemon will be stopped
    # after running out of JVM Metaspace" a build se plazil. Metaspace drží
    # načtené třídy — a těch je u RN s desítkami modulů hodně.
    NASTAV org.gradle.jvmargs "-Xmx6144m -XX:MaxMetaspaceSize=2048m"
    NASTAV org.gradle.caching true
    # Popisek se skládá VĚTVÍ, ne dosazením: `${ABI:-…}` by byl literál
    # dosazený za nenastavenou hodnotu — a to je přesně tvar, který brána
    # `zadny-fallback-nad-identitou` hledá. I ve výpisu do logu.
    if [ -n "$ABI" ]; then POPIS="$ABI"; else POPIS="ponechány generátorem"; fi
    echo "[ok] Architektury: $POPIS · halda 6 GB · cache zapnutá"
fi

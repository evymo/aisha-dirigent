#!/bin/bash
#
# build-android.sh - Android build script for AISHA Dirigent
#
# Usage:
#   ./scripts/build-android.sh              # Build APK only
#   ./scripts/build-android.sh --bundle     # Build AAB for Play Store
#   ./scripts/build-android.sh --upload     # Build APK and upload to Firebase
#   ./scripts/build-android.sh --playstore  # Build AAB and upload to Google Play
#   ./scripts/build-android.sh --clean      # Clean build
#   ./scripts/build-android.sh --help       # Show help
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$PROJECT_DIR")"
ANDROID_DIR="$PROJECT_DIR/android"
# Identita z profilu instance — JEDINÉ místo je app-profile.sh (viz jeho hlavička).
. "$SCRIPT_DIR/app-profile.sh"

# Load environment variables
if [ -f "$ROOT_DIR/.env" ]; then
    set -a; source "$ROOT_DIR/.env"; set +a
fi
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a; source "$PROJECT_DIR/.env"; set +a
fi
# ⛔ NAMĚŘENO 2026-09-04: `.env.build.local` četl JEN iOS. Bydlí v něm
# `AISHA_INSTANCE_ENV`, ze kterého `instance-env-derive.sh` odvozuje veřejnou
# bránu — bez něj se „neděje nic" a Android padal na chybějící
# `EXPO_PUBLIC_AISHA_GATEWAY_URL`, zatímco iOS si ji ze stejného stromu odvodil.
# Dvě platformy téže appky si tedy nesměly být rovny jen proto, že jedna
# soubor nečetla.
if [ -f "$PROJECT_DIR/.env.build.local" ]; then
    set -a; source "$PROJECT_DIR/.env.build.local"; set +a
fi

BUILD_APK=true
BUILD_BUNDLE=false
UPLOAD=false
UPLOAD_ONLY=false
CUSTOM_APK_PATH=""
PLAYSTORE=false
PLAYSTORE_TRACK="internal"
CLEAN=false
SKIP_PREBUILD=false

FIREBASE_APP_ID="${FIREBASE_ANDROID_APP_ID:-}"
FIREBASE_GROUPS="${FIREBASE_TESTER_GROUPS:-testers}"

log_info()    { echo -e "${BLUE}[info]  $1${NC}"; }
log_success() { echo -e "${GREEN}[ok]    $1${NC}"; }
log_warning() { echo -e "${YELLOW}[warn]  $1${NC}"; }
log_error()   { echo -e "${RED}[error] $1${NC}"; }

show_help() {
    echo ""
    echo "AISHA Dirigent - Android Build Script"
    echo "======================================="
    echo ""
    echo "Build Options:"
    echo "  --apk             Build APK (default)"
    echo "  --bundle          Build AAB for Google Play Store"
    echo "  --both            Build both APK and AAB"
    echo "  --clean           Clean build (removes android/ folder)"
    echo "  --skip-prebuild   Skip expo prebuild"
    echo ""
    echo "Upload Options:"
    echo "  --upload          Upload APK to Firebase App Distribution"
    echo "  --upload-only     Upload existing APK (no build)"
    echo "  --apk-path <path> Path to APK file (for --upload-only)"
    echo "  --playstore       Build AAB and upload to Google Play Console"
    echo "  --track <track>   Play Store track: internal, alpha, beta, production"
    echo ""
    echo "Other:"
    echo "  --help            Show this help message"
    echo ""
}

get_version_info() {
    if [ -f "$VERSION_FILE" ]; then
        APP_VERSION=$(cat "$VERSION_FILE" | grep '"version"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
        VERSION_CODE=$(cat "$VERSION_FILE" | grep '"versionCode"' | head -1 | sed 's/.*: \([0-9]*\).*/\1/')
    else
        APP_VERSION="1.0.0"
        VERSION_CODE="1"
    fi
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --apk)           BUILD_APK=true; shift ;;
        --bundle)        BUILD_APK=false; BUILD_BUNDLE=true; shift ;;
        --both)          BUILD_APK=true; BUILD_BUNDLE=true; shift ;;
        --upload)        UPLOAD=true; shift ;;
        --upload-only)   UPLOAD_ONLY=true; UPLOAD=true; BUILD_APK=false; BUILD_BUNDLE=false; shift ;;
        --apk-path)      CUSTOM_APK_PATH="$2"; shift 2 ;;
        --playstore)     PLAYSTORE=true; BUILD_BUNDLE=true; shift ;;
        --track)         PLAYSTORE_TRACK="$2"; shift 2 ;;
        --clean)         CLEAN=true; shift ;;
        --skip-prebuild) SKIP_PREBUILD=true; shift ;;
        --help)          show_help; exit 0 ;;
        *)               log_error "Unknown option: $1"; show_help; exit 1 ;;
    esac
done

# ============================================
# Podpis release buildu — rozhoduje se TADY, ne v Gradlu
# ============================================
# ⛔ NAMĚŘENO 2026-09-18: release se podepisoval ladicím klíčem šablony
# (`CN=Android Debug` z `android/app/debug.keystore`, tedy klíčem, který má
# každý se šablonou). Google Play takový build odmítne a mimo obchod ho může
# „aktualizovat" kdokoli. `.env.build.example` přitom ANDROID_KEYSTORE_*
# vyjmenovával, jen je nikdo nečetl.
#
# Klíč do build.gradle zapojuje `plugins/withReleaseSigning.js` (čte ho
# z prostředí). Tady se rozhoduje, jestli build SMÍ vzniknout:
#   · AAB (Play) bez klíče → STOP, dřív než se půl hodiny staví zbytečně,
#   · APK (testy) bez klíče → projde, ale nahlas.
PODPIS_CHYBI=""
for PROMENNA in ANDROID_KEYSTORE_PATH ANDROID_KEYSTORE_ALIAS ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_PASSWORD; do
    [ -n "$(printenv "$PROMENNA")" ] || PODPIS_CHYBI="$PODPIS_CHYBI $PROMENNA"
done
if [ -z "$PODPIS_CHYBI" ] && [ ! -f "$(printenv ANDROID_KEYSTORE_PATH)" ]; then
    log_error "ANDROID_KEYSTORE_PATH ukazuje na $(printenv ANDROID_KEYSTORE_PATH), ale soubor tam není."
    exit 1
fi
if [ "$BUILD_BUNDLE" = true ] && [ -n "$PODPIS_CHYBI" ]; then
    log_error "Build pro Play (AAB) bez vlastního klíče nevznikne — chybí:$PODPIS_CHYBI"
    log_error "  Play build podepsaný ladicím klíčem odmítne. Viz .env.build.example (ANDROID SIGNING)."
    exit 1
fi
if [ -n "$PODPIS_CHYBI" ]; then
    log_warning "APK bude podepsané VEŘEJNÝM ladicím klíčem šablony (chybí:$PODPIS_CHYBI)."
    log_warning "  Jen na testy: na Play nejde a mimo obchod ho může „aktualizovat“ kdokoli."
fi

# ============================================
# Main Build Process
# ============================================

get_version_info

echo ""
echo "============================================"
echo "AISHA Dirigent - Android Build"
echo "============================================"
echo ""
echo "Version:      $APP_VERSION"
echo "Version Code: $VERSION_CODE"
echo "Build APK:    $BUILD_APK"
echo "Build AAB:    $BUILD_BUNDLE"
echo ""

# Handle Upload-Only Mode
if [ "$UPLOAD_ONLY" = true ]; then
    log_info "Upload-only mode - skipping build"

    if [ -n "$CUSTOM_APK_PATH" ]; then
        APK_PATH="$CUSTOM_APK_PATH"
    else
        APK_PATH="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
    fi

    if [ ! -f "$APK_PATH" ]; then
        log_error "APK not found: $APK_PATH"
        exit 1
    fi

    APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
    log_success "Found APK: $APK_PATH ($APK_SIZE)"
fi

# ── Z čeho se staví: kontrola čistoty a razítko ──────────────────────────────
#
# Týž soubor jako iOS. Android ho dosud neměl, takže jeho balíčky nenesly
# záznam o původu — a strom se před buildem nekontroloval vůbec.
. "$SCRIPT_DIR/build-provenance.sh"

# ── Overlay instance: identita, ikona a BARVY ────────────────────────────────
#
# ⛔ NAMĚŘENO 2026-09-04: tenhle krok Android NEMĚL. `AISHA_INSTANCE_OVERLAY`
# v něm nebyl ani jednou, takže se nepřegeneroval `src/theme/index.ts` a APK
# vznikalo v barvách PLATFORMY. Nekřičelo by to — build o barvách nic netvrdí,
# takže by se to poznalo až na zařízení.
#
# ⭐ Týž soubor, jaký volá iOS. Kopie by se rozešla; jeden domov ne.
. "$SCRIPT_DIR/instance-overlay-apply.sh"

# ============================================
# Instance-env derivation (white-label buildy)
# ============================================
# ⛔ NAMĚŘENO 2026-09-04 na PRVNÍM Androidu Řidiče: build spadl na
# „EXPO_PUBLIC_AISHA_GATEWAY_URL is NOT set", zatímco iOS si tutéž hodnotu
# ODVODIL sám („Instance env derived: gateway=…"). Skript na to existuje a jeho
# vlastní hlavička říká, že „bydlí ZVLÁŠŤ, aby existovalo JEDNOU" — jen ho
# `build-ios.sh` volal a tenhle ne. Chybějící článek, ne chybějící schopnost.
#
# ⭐ Důsledek nebyl jen pád: kdo si tu proměnnou dosadil ručně, obešel odvození
# a mohl appce zapéct JINOU bránu, než na jakou je instance nasazená — a to se
# pozná až na telefonu v terénu.
#
# Explicitní hodnota vždy vyhrává; odvození doplňuje jen to, co ještě není.
. "$SCRIPT_DIR/instance-env-derive.sh"

# Clean
if [ "$UPLOAD_ONLY" = false ] && [ "$CLEAN" = true ]; then
    log_info "Cleaning android folder..."
    rm -rf "$ANDROID_DIR"
    log_success "Android folder removed"
fi

# Prebuild
if [ "$UPLOAD_ONLY" = false ] && [ "$SKIP_PREBUILD" = false ]; then
    if [ ! -d "$ANDROID_DIR" ] || [ "$CLEAN" = true ]; then
        # Backend URL: app.config.ts reads EXPO_PUBLIC_AISHA_GATEWAY_URL.
        # Bridge the legacy POSTGREST alias so older .env files keep working.
        : "${EXPO_PUBLIC_AISHA_GATEWAY_URL:=${EXPO_PUBLIC_AISHA_POSTGREST_URL:-}}"
        : "${EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY:=${EXPO_PUBLIC_AISHA_POSTGREST_ANON_KEY:-}}"
        export EXPO_PUBLIC_AISHA_GATEWAY_URL EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY

        if [ -z "$EXPO_PUBLIC_AISHA_GATEWAY_URL" ]; then
            log_error "EXPO_PUBLIC_AISHA_GATEWAY_URL is NOT set (legacy EXPO_PUBLIC_AISHA_POSTGREST_URL also empty)!"
            exit 1
        fi

        log_success "EXPO_PUBLIC_AISHA_GATEWAY_URL=$EXPO_PUBLIC_AISHA_GATEWAY_URL"

        log_info "Running expo prebuild for Android..."
        cd "$PROJECT_DIR"
        npx expo prebuild --platform android --no-install
        log_success "Expo prebuild completed"
    fi

    POST_PREBUILD="$SCRIPT_DIR/post-prebuild-android.sh"
    if [ -f "$POST_PREBUILD" ]; then
        log_info "Running post-prebuild script..."
        chmod +x "$POST_PREBUILD"
        "$POST_PREBUILD"
    fi
fi

# Build
if [ "$UPLOAD_ONLY" = false ]; then
    if [ ! -d "$ANDROID_DIR" ]; then
        log_error "Android folder not found! Run without --skip-prebuild"
        exit 1
    fi

    cd "$ANDROID_DIR"

    if [ "$CLEAN" = true ]; then
        log_info "Cleaning Gradle build..."
        ./gradlew clean
        log_success "Gradle clean completed"
    fi

    # Build APK
    APK_PATH=""
    if [ "$BUILD_APK" = true ]; then
        log_info "Building release APK..."
        ./gradlew assembleRelease

        APK_PATH="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
        if [ -f "$APK_PATH" ]; then
            APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
            log_success "APK built: $APK_SIZE"
        else
            log_error "APK build failed!"
            exit 1
        fi
    fi

    # Build AAB
    AAB_PATH=""
    if [ "$BUILD_BUNDLE" = true ]; then
        log_info "Building release AAB..."
        ./gradlew bundleRelease

        AAB_PATH="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
        if [ -f "$AAB_PATH" ]; then
            AAB_SIZE=$(du -h "$AAB_PATH" | cut -f1)
            log_success "AAB built: $AAB_SIZE"
            # ⛔ Měří se ARTEFAKT, ne nastavení: kdyby se klíč k Gradlu nedostal
            # (plugin, šablona, prostředí), dozví se to tady, ne až od Play.
            # `|| true`: nepodepsaný soubor grep nenajde a `set -e` by skript
            # ukončil DŘÍV, než řekne proč. Prázdný výsledek se rozhoduje níž.
            PODEPSAL=$(keytool -printcert -jarfile "$AAB_PATH" 2>/dev/null | grep -m1 'Owner:' || true)
            if [ -z "$PODEPSAL" ]; then
                log_error "AAB není podepsaný vůbec — Play ho odmítne."
                exit 1
            fi
            if echo "$PODEPSAL" | grep -q 'CN=Android Debug'; then
                log_error "AAB je podepsaný ladicím klíčem šablony ($PODEPSAL) — Play ho odmítne."
                exit 1
            fi
            log_success "AAB podepsán: $PODEPSAL"
        else
            log_error "AAB build failed!"
            exit 1
        fi
    fi
fi

# Upload to Firebase
if [ "$UPLOAD" = true ] && [ -n "$APK_PATH" ]; then
    log_info "Uploading to Firebase App Distribution..."

    if ! command -v firebase &> /dev/null; then
        log_error "Firebase CLI not installed! npm install -g firebase-tools"
        exit 1
    fi

    # ⛔ `head -1` BRAL PRVNÍHO KLIENTA, NE TOHO SPRÁVNÉHO.
    # `google-services.json` nese klienta pro KAŽDOU appku projektu. U RIQ
    # Řidiče je první `cz.riq.app` (Investments) a druhý `cz.riq.ridic` —
    # původní `grep … | head -1` tedy vybral CIZÍ app id a APK by šlo testerům
    # jiné aplikace. Změřeno 2026-09-07:
    #   1:…:785de9482ebf30f0e732bd  cz.riq.app
    #   1:…:107ccfd26f5f386fe732bd  cz.riq.ridic
    # Chyba by se neprojevila selháním — upload by PROŠEL, jen do špatné appky.
    # Klient se proto vybírá podle `applicationId`, ne podle pořadí.
    if [ -z "$FIREBASE_APP_ID" ]; then
        GOOGLE_SERVICES="$ANDROID_DIR/app/google-services.json"
        APP_PKG="$(grep -m1 -E "^[[:space:]]*applicationId" "$ANDROID_DIR/app/build.gradle" 2>/dev/null | sed -E "s/.*['\"]([^'\"]+)['\"].*/\1/")"
        if [ -f "$GOOGLE_SERVICES" ] && [ -n "$APP_PKG" ]; then
            FIREBASE_APP_ID="$(node -e '
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const pkg=process.argv[2];
const c=(d.client||[]).find(x=>x&&x.client_info&&x.client_info.android_client_info&&x.client_info.android_client_info.package_name===pkg);
if(!c){process.stderr.write("google-services.json nema klienta pro "+pkg+"\n");process.exit(3);}
process.stdout.write(c.client_info.mobilesdk_app_id);
' "$GOOGLE_SERVICES" "$APP_PKG")" || FIREBASE_APP_ID=""
            [ -n "$FIREBASE_APP_ID" ] && log_success "Firebase app id pro $APP_PKG: $FIREBASE_APP_ID"
        elif [ -f "$GOOGLE_SERVICES" ]; then
            # Fail-closed: bez balíčku bychom hádali pořadím — a hádání tiše
            # doručí APK cizí aplikaci.
            log_error "applicationId nezjištěn z android/app/build.gradle — app id NEHÁDÁM."
            exit 1
        fi
    fi

    if [ -z "$FIREBASE_APP_ID" ]; then
        log_error "FIREBASE_ANDROID_APP_ID not set!"
        exit 1
    fi

    firebase appdistribution:distribute "$APK_PATH" \
        --app "$FIREBASE_APP_ID" \
        --groups "$FIREBASE_GROUPS" \
        --release-notes "Version $APP_VERSION (Build $VERSION_CODE)"

    log_success "Upload to Firebase completed!"
fi

# Upload to Play Store
if [ "$PLAYSTORE" = true ] && [ -n "$AAB_PATH" ]; then
    log_info "Uploading to Google Play Console ($PLAYSTORE_TRACK track)..."

    UPLOAD_SCRIPT="$SCRIPT_DIR/upload-playstore.sh"
    if [ -f "$UPLOAD_SCRIPT" ]; then
        chmod +x "$UPLOAD_SCRIPT"
        "$UPLOAD_SCRIPT" --track "$PLAYSTORE_TRACK" --aab "$AAB_PATH"
    else
        log_error "upload-playstore.sh not found!"
        exit 1
    fi
fi

# Summary
cd "$PROJECT_DIR"
echo ""
echo "============================================"
log_success "Android Build Complete!"
echo "============================================"
echo "Version: $APP_VERSION (Code: $VERSION_CODE)"
echo ""

#!/bin/bash
#
# build-ios.sh - iOS build script for AISHA Dirigent
#
# Creates a production-ready iOS app archive and optionally uploads to App Store Connect
#
# Usage:
#   ./scripts/build-ios.sh              # Build archive only
#   ./scripts/build-ios.sh --upload     # Build and upload to TestFlight
#   ./scripts/build-ios.sh --clean      # Clean build (removes ios/ and rebuilds)
#   ./scripts/build-ios.sh --help       # Show help
#

set -e

# CocoaPods (Ruby) aborts with Encoding::CompatibilityError when the active
# locale is not UTF-8 (common in minimal shells / CI). Force a sane default.
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$PROJECT_DIR")"
IOS_DIR="$PROJECT_DIR/ios"
# Identita z profilu instance — JEDINÉ místo je app-profile.sh (viz jeho hlavička).
. "$SCRIPT_DIR/app-profile.sh"

UPLOAD=false
CLEAN=false
SKIP_PREBUILD=false

log_info()    { echo -e "${BLUE}[info]  $1${NC}"; }
log_success() { echo -e "${GREEN}[ok]    $1${NC}"; }
log_warning() { echo -e "${YELLOW}[warn]  $1${NC}"; }
log_error()   { echo -e "${RED}[error] $1${NC}"; }

show_help() {
    echo ""
    echo "AISHA Dirigent - iOS Build Script"
    echo "=================================="
    echo ""
    echo "Usage: ./scripts/build-ios.sh [options]"
    echo ""
    echo "Options:"
    echo "  --upload        Build and upload to TestFlight"
    echo "  --clean         Clean build (removes ios/ folder)"
    echo "  --skip-prebuild Skip expo prebuild (use existing ios/)"
    echo "  --help          Show this help message"
    echo ""
    echo "Environment:"
    echo "  Copy .env.build.example to .env.build.local and fill in values"
    echo "  Or set APPLE_TEAM_ID environment variable"
    echo ""
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --upload)        UPLOAD=true; shift ;;
        --clean)         CLEAN=true; shift ;;
        --skip-prebuild) SKIP_PREBUILD=true; shift ;;
        --help)          show_help; exit 0 ;;
        *)               log_error "Unknown option: $1"; show_help; exit 1 ;;
    esac
done

# ============================================
# Load Configuration
# ============================================

log_info "Loading configuration..."

# Load root-level .env first
if [ -f "$ROOT_DIR/.env" ]; then
    set -a; source "$ROOT_DIR/.env"; set +a
fi

# Load mobile-app .env
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a; source "$PROJECT_DIR/.env"; set +a
    log_success "Loaded .env"
fi

# Auto-load production env for release builds
if [ -f "$PROJECT_DIR/.env.production" ]; then
    set -a; source "$PROJECT_DIR/.env.production"; set +a
    log_success "Loaded .env.production (production overrides)"
fi

if [ -f "$PROJECT_DIR/.env.build.local" ]; then
    set -a; source "$PROJECT_DIR/.env.build.local"; set +a
    log_success "Loaded .env.build.local (overrides)"
fi

# ── Z čeho se staví: kontrola čistoty a razítko ──────────────────────────────
#
# Bydlí ZVLÁŠŤ (`build-provenance.sh`), aby to uměly OBĚ platformy. Dokud to
# bylo tady uvnitř, Android stavěl bez záznamu o původu (2026-09-04).
. "$SCRIPT_DIR/build-provenance.sh"

# ── Overlay instance: JEDINÝ kanál pro identitu, verzi a značku ──────────────
#
# Bydlí ZVLÁŠŤ (`instance-overlay-apply.sh`), aby existoval JEDNOU a mohla ho
# použít i druhá platforma. Dokud byl tady uvnitř, Android ho neměl — a APK
# by vzniklo v barvách PLATFORMY, ne instance (naměřeno 2026-09-04).
. "$SCRIPT_DIR/instance-overlay-apply.sh"

# SAFETY: Block builds if .env.local points to localhost
if [ -f "$PROJECT_DIR/.env.local" ]; then
    if grep -q "127.0.0.1\|localhost" "$PROJECT_DIR/.env.local" 2>/dev/null; then
        log_error ".env.local contains localhost URLs!"
        log_error "Expo prebuild reads .env.local with HIGHER PRIORITY than .env"
        echo "To fix: mv .env.local .env.local.bak"
        exit 1
    fi
fi

# Read version + brand info from version.json (the single identity source).
# XCODE_NAME must equal the app displayName with non-alphanumerics stripped —
# Expo derives the workspace/scheme/target that way; version.json.brand.xcodeName
# carries it explicitly so a re-skinned build (e.g. a white-labelled tenant) just works.
if [ -f "$VERSION_FILE" ]; then
    APP_VERSION=$(cat "$VERSION_FILE" | grep '"version"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    BUILD_NUMBER=$(cat "$VERSION_FILE" | grep '"build"' | head -1 | sed 's/.*: \([0-9]*\).*/\1/')
    XCODE_NAME=$(cat "$VERSION_FILE" | grep '"xcodeName"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    VERSION_BUNDLE_ID=$(cat "$VERSION_FILE" | grep '"bundleId"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
else
    APP_VERSION="1.0.0"
    BUILD_NUMBER="1"
fi

# ============================================
# Instance-env derivation (white-label builds)
# ============================================
# AISHA_INSTANCE_ENV=/path/to/.env.coolify derives the runtime EXPO_PUBLIC_*
# set straight from the instance deployment env + version.json brand — a
# re-skinned build then needs NO hand-written .env.production. Explicit values
# (process env or the .env files sourced above) always win; each derivation
# only fills a variable that is still unset.
# Odvození EXPO_PUBLIC_* z instančního env. Bydlí ZVLÁŠŤ, aby existovalo
# JEDNOU a mohl ho použít i prepare-xcode-build.sh (viz hlavička souboru).
. "$SCRIPT_DIR/instance-env-derive.sh"

# ============================================
# Toolchain — recorded, because it is an input
# ============================================
# Xcode updates itself, so the compiler that produced a shipped binary is a fact
# worth writing down. `.xcode-version` records the one this app is known to build
# with; a mismatch is announced rather than discovered later from a broken build.
# Not fatal: a newer Xcode is usually fine, and the real defence against vendored
# C++ breaking on a toolchain bump is not compiling it (see plugins/withBuildSettings.js).
XCODE_NOW="$(xcodebuild -version 2>/dev/null | tr '\n' ' ' | sed -E 's/Xcode ([0-9.]+) Build version ([A-Za-z0-9]+).*/Xcode \1 (\2)/')"
XCODE_PIN_FILE="$PROJECT_DIR/.xcode-version"
if [ -f "$XCODE_PIN_FILE" ]; then
    XCODE_PIN="$(head -1 "$XCODE_PIN_FILE" | tr -d '\r')"
    if [ "$XCODE_NOW" != "$XCODE_PIN" ]; then
        log_warning "Toolchain moved: building with $XCODE_NOW, .xcode-version records $XCODE_PIN"
        log_warning "If this build is good, update .xcode-version deliberately — do not let it drift silently."
    else
        log_success "Toolchain: $XCODE_NOW (matches .xcode-version)"
    fi
else
    log_info "Toolchain: $XCODE_NOW (unpinned — consider recording it in .xcode-version)"
fi

# ============================================
# Vendored C++ comes prebuilt — we do not own it
# ============================================
# React Native ships two independent prebuilt channels, and the Podfile derives
# BOTH from one property:
#
#   ENV['RCT_USE_RN_DEP']          ||= '1' if ios.buildReactNativeFromSource != 'true' && …
#   ENV['RCT_USE_PREBUILT_RNCORE'] ||= '1' if ios.buildReactNativeFromSource != 'true' && …
#
# We want RN CORE from source (dSYMs, and livekit's headers expect that layout),
# but we do NOT want to compile Meta's vendored C++ — folly, glog, boost, fmt.
# Compiling those puts a PINNED library against an UNPINNED compiler: fmt 11.0.2
# is chosen by react-native 0.81.5, while the clang version follows whenever
# Xcode updates itself. Measured 2026-08-03: Apple clang 21 rejects fmt 11.0.2
# outright (format-inl.h:59, consteval) and no archive can be produced. The
# breakage sat latent for eleven days — 07-23 only linked because DerivedData
# still held the objects. Cache is not proof; regeneration is.
#
# Because the Podfile uses `||=`, setting this here wins: core stays from source
# and only the vendored dependencies are taken as published artifacts.
export RCT_USE_RN_DEP="${RCT_USE_RN_DEP:-1}"
log_info "Vendored C++ from RN prebuilt artifacts (RCT_USE_RN_DEP=$RCT_USE_RN_DEP); RN core still from source"

# ============================================
# A re-skinned build must not ship the platform icon
# ============================================
# generate-icons.sh is step 3 of the documented white-label procedure and it is
# the easiest one to forget: nothing depends on it, nothing fails without it, and
# `assets/` already contains perfectly valid icons — the PLATFORM's. Measured
# 2026-08-03: builds 1.0.1(3), 1.0.2(4) and 1.0.3(5) all shipped to TestFlight
# under the AISHA robot, because the step was skipped three times in a row and
# nothing anywhere said so.
#
# So: if this build carries a bundle id other than the platform's, its icons must
# have been regenerated from the brand logo. Set BRAND_LOGO and they are — right
# here, so the step cannot be forgotten again.
PLATFORM_BUNDLE_ID="cz.id3a.aisha.app"
if [ "${VERSION_BUNDLE_ID:-}" != "$PLATFORM_BUNDLE_ID" ]; then
    if [ -n "${BRAND_LOGO:-}" ] && [ -f "${BRAND_LOGO}" ]; then
        log_info "Re-skinned build — regenerating icons from $BRAND_LOGO"
        BRAND_LOGO="$BRAND_LOGO" bash "$SCRIPT_DIR/generate-icons.sh" >/dev/null \
            || { log_error "Icon generation failed for $BRAND_LOGO"; exit 1; }
        log_success "Icons regenerated from the brand logo"
    elif git -C "$PROJECT_DIR" diff --quiet -- assets/icon.png 2>/dev/null; then
        # Untouched since the last commit = still whatever the platform committed.
        log_error "This build is '${VERSION_BUNDLE_ID:-?}', not the platform app, but assets/icon.png is unchanged."
        log_error "It would ship the PLATFORM icon. Set BRAND_LOGO=/path/to/brand/icon.svg and re-run."
        exit 1
    else
        log_warning "BRAND_LOGO unset; assets/ differs from the commit — assuming icons were generated by hand"
    fi
fi

APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"
# The bundle id that actually reaches the binary comes from prebuild → version.json.
# Default the display value to that same source so the summary never lies.
IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-${VERSION_BUNDLE_ID:-cz.id3a.aisha.app}}"
BUILD_CONFIGURATION="${BUILD_CONFIGURATION:-Release}"
XCODE_ARCHIVES_DIR="$HOME/Library/Developer/Xcode/Archives/$(date '+%Y-%m-%d')"
ARCHIVE_PATH="${ARCHIVE_PATH:-$XCODE_ARCHIVES_DIR/$XCODE_NAME $(date '+%d.%m.%Y, %H.%M').xcarchive}"
IPA_PATH="${IPA_PATH:-$PROJECT_DIR/build}"
GOOGLE_PLIST_PATH="$PROJECT_DIR/GoogleService-Info.plist"
PRIVACY_MANIFEST_PATH="$PROJECT_DIR/PrivacyInfo.xcprivacy"

# ============================================
# Validation
# ============================================

log_info "Validating configuration..."

if [ -z "$APPLE_TEAM_ID" ]; then
    log_error "APPLE_TEAM_ID is not set!"
    echo "Set it in .env.build.local or export APPLE_TEAM_ID=YOUR_TEAM_ID"
    exit 1
fi

log_success "Apple Team ID: $APPLE_TEAM_ID"

if [ ! -f "$GOOGLE_PLIST_PATH" ]; then
    log_warning "GoogleService-Info.plist is missing in mobile-app root"
    log_warning "Archive can still build, but Firebase-backed tester features will not be ready"
fi

if [ ! -f "$PRIVACY_MANIFEST_PATH" ]; then
    log_warning "PrivacyInfo.xcprivacy is missing"
    log_warning "App Store/TestFlight upload may fail without a privacy manifest"
fi

# ============================================
# Clean DerivedData
# ============================================

log_info "Cleaning Xcode DerivedData..."
rm -rf ~/Library/Developer/Xcode/DerivedData/"$XCODE_NAME"-* 2>/dev/null || true
log_success "DerivedData cleaned"

if [ "$CLEAN" = true ]; then
    log_info "Clean build - removing ios/ folder..."
    rm -rf "$IOS_DIR"
    log_success "ios/ removed"
fi

# ============================================
# Prebuild
# ============================================

# ============================================
# --skip-prebuild must not ship stale version numbers
# ============================================
# The version a build carries is written into the Xcode project BY PREBUILD.
# Skipping prebuild therefore reuses whatever the previous run left there, and
# an archive comes out with new code under an old build number — which App Store
# Connect rejects as a duplicate, after the whole compile. Measured 2026-08-03:
# version.json said 1.0.3 (5), the archive said 1.0.2 (4).
# Compare before spending twenty minutes, and fail loud with the fix.
if [ "$SKIP_PREBUILD" = true ] && [ -f "$IOS_DIR/$XCODE_NAME/Info.plist" ]; then
    WANT_V=$(node -e "process.stdout.write(String(require('$VERSION_FILE').version||''))" 2>/dev/null)
    WANT_B=$(node -e "process.stdout.write(String((require('$VERSION_FILE').ios||{}).buildNumber||''))" 2>/dev/null)
    HAVE_V=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$IOS_DIR/$XCODE_NAME/Info.plist" 2>/dev/null || echo "")
    HAVE_B=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$IOS_DIR/$XCODE_NAME/Info.plist" 2>/dev/null || echo "")
    if [ -n "$WANT_V" ] && { [ "$WANT_V" != "$HAVE_V" ] || [ "$WANT_B" != "$HAVE_B" ]; }; then
        log_error "--skip-prebuild would archive $HAVE_V ($HAVE_B) while version.json says $WANT_V ($WANT_B)."
        log_error "The version reaches the project through prebuild — re-run without --skip-prebuild."
        exit 1
    fi
    log_success "Version in project matches version.json: $HAVE_V ($HAVE_B)"
fi

if [ "$SKIP_PREBUILD" = false ]; then
    log_info "Running Expo prebuild..."
    cd "$PROJECT_DIR"

    # Most ze staršího jména (POSTGREST → GATEWAY) je v instance-env-derive.sh,
    # aby se obě cesty k buildu chovaly SHODNĚ.

    if [ -z "$EXPO_PUBLIC_AISHA_GATEWAY_URL" ]; then
        log_error "EXPO_PUBLIC_AISHA_GATEWAY_URL is NOT set (legacy EXPO_PUBLIC_AISHA_POSTGREST_URL also empty)!"
        exit 1
    fi

    log_success "EXPO_PUBLIC_AISHA_GATEWAY_URL=$EXPO_PUBLIC_AISHA_GATEWAY_URL"

    npx expo prebuild --platform ios --no-install
    log_success "Prebuild complete"

    # Apply post-prebuild modifications
    if [ -f "$SCRIPT_DIR/post-prebuild.sh" ]; then
        log_info "Applying post-prebuild fixes..."
        chmod +x "$SCRIPT_DIR/post-prebuild.sh"
        "$SCRIPT_DIR/post-prebuild.sh"
    fi

    # CocoaPods — sdílené s prepare-xcode-build.sh, viz pods-install.sh.
    PODS_CLEAN=0 . "$SCRIPT_DIR/pods-install.sh"
else
    log_info "Skipping prebuild (--skip-prebuild)"
fi

# ============================================
# Build Archive
# ============================================

# ⛔ Z ČEHO SE STAVÍ, NE JEN ČÍ APPKA. Identitu (`AISHA_APP_VERSION_FILE`)
# skript hlídá od 2026-08-20, protože bez ní vznikla appka pod cizí značkou.
# OBSAH stromu ale nekontroloval nikdo — a 2026-09-01 to stálo dva buildy:
# pracovní strom byl mezitím přepnut na větev z `main`, skript to mlčky přijal
# a do TestFlightu šla appka BEZ opravy klepání i bez položek. Vada se poznala
# až z fotky obrazovky od majitele, ne z měřidla.
#
# ⭐ Razítko se ZAPISUJE DO ARCHIVU, ne jen vypisuje. Výpis zmizí s oknem
# terminálu; archiv se otevírá za týden, když se ptáme „co v tom vlastně bylo".
# ⛔ ŽÁDNÝ FALLBACK. „?" místo větve by byl dosazený literál, který HÁDÁ fakt
# o světě — a razítko s otazníkem je horší než žádné: tváří se jako doklad.
# Když git neodpoví, nevíme z čeho stavíme, a to je důvod skončit.
log_info "Building iOS archive..."
echo ""
echo "  Bundle ID:     $IOS_BUNDLE_ID"
echo "  Version:       $APP_VERSION ($BUILD_NUMBER)"
echo "  Configuration: $BUILD_CONFIGURATION"
echo "  Team ID:       $APPLE_TEAM_ID"
echo "  Zdroj:         $GIT_VETEV @ $GIT_COMMIT$([ "$GIT_SPINAVY" != "0" ] && echo " (ŠPINAVÝ)")"
echo ""

cd "$IOS_DIR"
mkdir -p "$(dirname "$ARCHIVE_PATH")"

# Souběžnost překladu: Xcode bere všechna jádra a při zaplněném swapu si tím
# shodí vlastní build system ("unexpected service error: The Xcode build system
# has crashed") — pád, který vypadá jako vada projektu, ale měří STROJ.
# XCODE_BUILD_JOBS nechává operátorovi škrticí klapku; bez ní se nic nemění.
XCODE_JOBS_ARG=()
if [ -n "${XCODE_BUILD_JOBS:-}" ]; then
    XCODE_JOBS_ARG=(-jobs "$XCODE_BUILD_JOBS")
    log_info "Omezuji souběžnost překladu na $XCODE_BUILD_JOBS úloh (XCODE_BUILD_JOBS)"
fi

xcodebuild \
    -workspace "$XCODE_NAME.xcworkspace" \
    -scheme "$XCODE_NAME" \
    -configuration "$BUILD_CONFIGURATION" \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE_PATH" \
    -allowProvisioningUpdates \
    "${XCODE_JOBS_ARG[@]}" \
    DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
    CODE_SIGN_STYLE="Automatic" \
    archive

if [ ! -d "$ARCHIVE_PATH" ]; then
    log_error "Archive failed - $ARCHIVE_PATH not found"
    exit 1
fi

log_success "Archive created: $ARCHIVE_PATH"

# Razítko do archivu — aby šlo i za měsíc přečíst, z čeho vznikl.
/usr/libexec/PlistBuddy -c "Add :AishaSourceBranch string $GIT_VETEV" "$ARCHIVE_PATH/Info.plist" >/dev/null 2>&1 \
  || /usr/libexec/PlistBuddy -c "Set :AishaSourceBranch $GIT_VETEV" "$ARCHIVE_PATH/Info.plist" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :AishaSourceCommit string $GIT_COMMIT" "$ARCHIVE_PATH/Info.plist" >/dev/null 2>&1 \
  || /usr/libexec/PlistBuddy -c "Set :AishaSourceCommit $GIT_COMMIT" "$ARCHIVE_PATH/Info.plist" >/dev/null 2>&1 || true
log_info "Zdroj archivu: $GIT_VETEV @ $GIT_COMMIT"

# ============================================
# Upload dSYMs to (self-hosted) Sentry
# ============================================
# BY DESIGN: every archive ships its debug symbols to our self-hosted Sentry
# (org/project/url from mobile-app/sentry.properties / version.json brand.sentry —
# default http://localhost:9000, override with SENTRY_URL for your Sentry).
# A release without dSYMs = unsymbolicated crashes, so a missing token, a missing
# sentry-cli, missing dSYMs, or a failed upload is a HARD build failure — never a
# silent skip. Provide the token via SENTRY_AUTH_TOKEN (or SENTRY_TOKEN), e.g. in
# mobile-app/.env.build.local.
SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN:-${SENTRY_TOKEN:-}}"
SENTRY_CLI="$PROJECT_DIR/node_modules/@sentry/cli/bin/sentry-cli"
if [ -z "$SENTRY_AUTH_TOKEN" ]; then
    log_error "SENTRY_AUTH_TOKEN not set — refusing to ship a build without dSYMs."
    log_error "Set SENTRY_AUTH_TOKEN (or SENTRY_TOKEN) in mobile-app/.env.build.local"
    exit 1
fi
if [ ! -x "$SENTRY_CLI" ]; then
    log_error "sentry-cli missing ($SENTRY_CLI) — run 'npm install' in mobile-app/"
    exit 1
fi
if [ ! -d "$ARCHIVE_PATH/dSYMs" ]; then
    log_error "No dSYMs in archive: $ARCHIVE_PATH/dSYMs"
    exit 1
fi
log_info "Uploading dSYMs to Sentry (self-hosted)…"
# SENTRY_PROPERTIES makes sentry-cli read org/project/url from a properties file
# (this CLI version does not auto-discover them for `debug-files upload`).
# Generate that file from version.json `brand.sentry` so a re-skinned build reports
# under ITS Sentry project; fall back to the committed sentry.properties on any error.
SENTRY_PROPS_FILE="$PROJECT_DIR/sentry.properties"
SENTRY_PROPS_GEN="$(node -e '
  try {
    const v = require("./version.json").brand.sentry;
    if (v && v.url && v.organization && v.project) {
      const os = require("os"), fs = require("fs"), path = require("path");
      const f = path.join(os.tmpdir(), "sentry-" + v.project + ".properties");
      fs.writeFileSync(f, `defaults.url=${v.url}\ndefaults.org=${v.organization}\ndefaults.project=${v.project}\n`);
      process.stdout.write(f);
    }
  } catch (e) { /* emit nothing → caller keeps the committed file */ }
' 2>/dev/null)"
if [ -n "$SENTRY_PROPS_GEN" ] && [ -f "$SENTRY_PROPS_GEN" ]; then
    SENTRY_PROPS_FILE="$SENTRY_PROPS_GEN"
fi
if ( cd "$PROJECT_DIR" && SENTRY_AUTH_TOKEN="$SENTRY_AUTH_TOKEN" \
        SENTRY_PROPERTIES="$SENTRY_PROPS_FILE" \
        "$SENTRY_CLI" debug-files upload "$ARCHIVE_PATH/dSYMs" ); then
    log_success "dSYMs uploaded to Sentry"
else
    log_error "Sentry dSYM upload FAILED — aborting (release must be symbolicated)"
    exit 1
fi

# Native Hermes dSYM: the prebuilt release hermes.framework is stripped, so RN's
# matching dSYM is fetched from its published Maven artifact and pushed to Sentry.
# Idempotent per RN version (marker-cached); non-fatal — the symbols are
# version-stable, so a transient failure here doesn't lose coverage.
SENTRY_AUTH_TOKEN="$SENTRY_AUTH_TOKEN" "$SCRIPT_DIR/upload-hermes-dsym.sh" \
    || log_warning "Hermes dSYM upload skipped/failed (non-fatal — likely already in Sentry)"

# ============================================
# Export IPA + Upload (optional)
# ============================================

if [ "$UPLOAD" = true ]; then
    log_info "Exporting IPA for App Store..."

    mkdir -p "$PROJECT_DIR/build"
    EXPORT_OPTIONS="$PROJECT_DIR/build/ExportOptions.plist"
    cat > "$EXPORT_OPTIONS" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>teamID</key>
    <string>$APPLE_TEAM_ID</string>
    <key>uploadSymbols</key>
    <true/>
    <key>compileBitcode</key>
    <false/>
    <key>destination</key>
    <string>upload</string>
</dict>
</plist>
EOF

    xcodebuild \
        -exportArchive \
        -archivePath "$ARCHIVE_PATH" \
        -exportPath "$IPA_PATH" \
        -exportOptionsPlist "$EXPORT_OPTIONS" \
        -allowProvisioningUpdates

    log_success "Build exported and uploaded to App Store Connect!"
    log_info "Check App Store Connect -> TestFlight for processing status"
fi

# ============================================
# Summary
# ============================================

echo ""
echo "============================================"
log_success "Build Complete!"
echo "============================================"
echo ""
echo "Archive: $ARCHIVE_PATH"
echo ""
if [ "$UPLOAD" = false ]; then
    echo "Next steps:"
    echo "  1. Open Xcode -> Window -> Organizer"
    echo "  2. Select '$XCODE_NAME' archive"
    echo "  3. Click 'Distribute App' -> App Store Connect"
    echo ""
    echo "Or run with --upload flag:"
    echo "  ./scripts/build-ios.sh --upload"
fi

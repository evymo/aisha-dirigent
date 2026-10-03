#!/bin/bash
#
# post-prebuild.sh - Apply iOS build fixes after expo prebuild
#
# Handles:
#   1. Firebase modular headers in Podfile
#   2. dSYM generation settings
#   3. Development Team ID in xcodeproj
#   4. GoogleService-Info.plist copying
#   5. PrivacyInfo.xcprivacy copying
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
IOS_DIR="$PROJECT_DIR/ios"
PODFILE="$IOS_DIR/Podfile"
# Identita z profilu — sdíleno se všemi build skripty (viz app-profile.sh).
. "$SCRIPT_DIR/app-profile.sh"

if [ -f "$VERSION_FILE" ]; then
    APP_VERSION=$(cat "$VERSION_FILE" | grep '"version"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    BUILD_NUMBER=$(cat "$VERSION_FILE" | grep '"build"' | head -1 | sed 's/.*: \([0-9]*\).*/\1/')
    MARKETING_VERSION=$(cat "$VERSION_FILE" | grep '"marketingVersion"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    DISPLAY_NAME=$(cat "$VERSION_FILE" | grep '"displayName"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    BUNDLE_ID=$(cat "$VERSION_FILE" | grep '"bundleId"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    APP_CATEGORY=$(cat "$VERSION_FILE" | grep '"category"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    DEPLOYMENT_TARGET=$(cat "$VERSION_FILE" | grep '"deploymentTarget"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
else
    # ⛔ SEM SE UŽ NEDÁ DOJÍT. `app-profile.sh` nepřečtený profil zastaví, takže
    # tahle větev by dosadila identitu PLATFORMY do instančního buildu — přesně
    # to, co 2026-08-19 poslalo `cp` do ios/AISHADirigent/, zatímco prebuild
    # vyrobil ios/RIQRidic/. Ponecháno jen jako pojistka pro cizí volání.
    echo "[error] Profil appky se nepodařilo přečíst — build zastaven." >&2
    exit 1
fi
XCODEPROJ="$IOS_DIR/$XCODE_NAME.xcodeproj/project.pbxproj"

DEVELOPMENT_TEAM="${APPLE_TEAM_ID:-}"

echo "Post-prebuild script"
echo "========================"
echo "Version:    $APP_VERSION"
echo "Build:      $BUILD_NUMBER"
echo "iOS Target: $DEPLOYMENT_TARGET"
echo ""

if [ ! -f "$PODFILE" ]; then
    echo "[error] Podfile not found. Run 'npx expo prebuild --platform ios' first"
    exit 1
fi

# 1. Firebase modular headers
if grep -q "# \[PLUGIN\] Firebase modular headers" "$PODFILE"; then
    echo "[ok] Firebase modular headers already present"
else
    echo "[info] Adding Firebase modular headers..."
    sed -i.bak '/prepare_react_native_project!/a\
\
# [PLUGIN] Firebase modular headers\
pod '\''GoogleUtilities'\'', :modular_headers => true\
pod '\''FirebaseCore'\'', :modular_headers => true\
pod '\''FirebaseCoreInternal'\'', :modular_headers => true\
pod '\''FirebaseMessaging'\'', :modular_headers => true
' "$PODFILE"
    echo "[ok] Firebase modular headers added"
fi

# 2. dSYM generation
if grep -q "# \[PLUGIN\] dSYM generation" "$PODFILE"; then
    echo "[ok] dSYM settings already present"
else
    echo "[info] Adding dSYM generation settings..."
    ruby -i.bak2 -e '
      content = File.read(ARGV[0])
      dsym_code = <<~DSYM

    # [PLUGIN] dSYM generation
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings["DEBUG_INFORMATION_FORMAT"] = "dwarf-with-dsym"
        config.build_settings["DWARF_DSYM_FOLDER_PATH"] = "$(CONFIGURATION_BUILD_DIR)"
        if target.name == "hermes-engine"
          config.build_settings["GCC_GENERATE_DEBUGGING_SYMBOLS"] = "YES"
        end
        third_party_prefixes = ["Expo", "RN", "React", "hermes", "Firebase", "Google"]
        if third_party_prefixes.any? { |prefix| target.name.start_with?(prefix) }
          config.build_settings["GCC_WARN_INHIBIT_ALL_WARNINGS"] = "YES"
        end
      end
    end
DSYM
      content.gsub!(/(:ccache_enabled => ccache_enabled\?\(podfile_properties\),?\s*\))(\s*\n\s*end\s*\nend)/) do
        "#{$1}#{dsym_code}  #{$2}"
      end
      File.write(ARGV[0], content)
    ' "$PODFILE"
    echo "[ok] dSYM settings added"
fi

# 3. Xcode project settings
if [ -f "$XCODEPROJ" ] && [ -n "$DEVELOPMENT_TEAM" ]; then
    echo "[info] Configuring Xcode project..."

    # ⛔ DO 2026-08-19 TU BYLA JEN VĚTEV „NAHRAĎ". `expo prebuild` ale
    # DEVELOPMENT_TEAM nevydává vůbec, takže `grep -q` vždy selhal a tým se
    # NENASTAVIL NIKDY — mlčky, protože chybějící klíč vypadá jako obsloužený
    # případ. Archiv se pak podepisoval tím, co měl člověk vybrané v Xcode,
    # ne tím, co říká `.env.build.local`. U jedné appky to nevadilo (tým tam
    # sedí ručně), u druhé je to tichá záměna účtu.
    if grep -q "DEVELOPMENT_TEAM" "$XCODEPROJ"; then
        sed -i.bak3 "s/DEVELOPMENT_TEAM = [^;]*;/DEVELOPMENT_TEAM = $DEVELOPMENT_TEAM;/g" "$XCODEPROJ"
        echo "   [ok] DEVELOPMENT_TEAM = $DEVELOPMENT_TEAM (nahrazeno)"
    else
        # Klíč chybí → VLOŽIT do každé build konfigurace vedle bundle ID.
        sed -i.bak3 "s/\(PRODUCT_BUNDLE_IDENTIFIER = [^;]*;\)/\1\n\t\t\t\tDEVELOPMENT_TEAM = $DEVELOPMENT_TEAM;/g" "$XCODEPROJ"
        echo "   [ok] DEVELOPMENT_TEAM = $DEVELOPMENT_TEAM (doplněno)"
    fi
    if ! grep -q "DEVELOPMENT_TEAM = $DEVELOPMENT_TEAM;" "$XCODEPROJ"; then
        echo "[error] DEVELOPMENT_TEAM se do projektu nezapsal — archiv by se podepsal cizím účtem." >&2
        exit 1
    fi

    sed -i.bak4 "s/IPHONEOS_DEPLOYMENT_TARGET = [^;]*;/IPHONEOS_DEPLOYMENT_TARGET = $DEPLOYMENT_TARGET;/g" "$XCODEPROJ"
    echo "   [ok] IPHONEOS_DEPLOYMENT_TARGET = $DEPLOYMENT_TARGET"

    sed -i.bak5 "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $MARKETING_VERSION;/g" "$XCODEPROJ"
    echo "   [ok] MARKETING_VERSION = $MARKETING_VERSION"

    echo "[ok] Xcode project configured"
fi

# 4. Copy GoogleService-Info.plist
# GOOGLE_PLIST_SRC dodává app-profile.sh — ctí AISHA_FIREBASE_IOS_FILE.
GOOGLE_PLIST_DST="$IOS_DIR/GoogleService-Info.plist"
GOOGLE_PLIST_APP="$IOS_DIR/$XCODE_NAME/GoogleService-Info.plist"
PRIVACY_MANIFEST_SRC="$PROJECT_DIR/PrivacyInfo.xcprivacy"
PRIVACY_MANIFEST_APP="$IOS_DIR/$XCODE_NAME/PrivacyInfo.xcprivacy"

if [ -f "$GOOGLE_PLIST_SRC" ]; then
    [ ! -f "$GOOGLE_PLIST_DST" ] && cp "$GOOGLE_PLIST_SRC" "$GOOGLE_PLIST_DST"
    [ ! -f "$GOOGLE_PLIST_APP" ] && cp "$GOOGLE_PLIST_SRC" "$GOOGLE_PLIST_APP"
    echo "[ok] GoogleService-Info.plist ready"
else
    echo "[warn] GoogleService-Info.plist not found - push notifications won't work"
fi

# 5. Copy PrivacyInfo.xcprivacy
if [ -f "$PRIVACY_MANIFEST_SRC" ]; then
    cp "$PRIVACY_MANIFEST_SRC" "$PRIVACY_MANIFEST_APP"
    echo "[ok] PrivacyInfo.xcprivacy copied"
else
    echo "[warn] PrivacyInfo.xcprivacy not found - App Store upload may be rejected"
fi

# 6. Info.plist
INFO_PLIST="$IOS_DIR/$XCODE_NAME/Info.plist"
if [ -f "$INFO_PLIST" ]; then
    echo "[info] Updating Info.plist..."

    /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName '$DISPLAY_NAME'" "$INFO_PLIST" 2>/dev/null || \
        /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string '$DISPLAY_NAME'" "$INFO_PLIST"

    /usr/libexec/PlistBuddy -c "Set :LSApplicationCategoryType '$APP_CATEGORY'" "$INFO_PLIST" 2>/dev/null || \
        /usr/libexec/PlistBuddy -c "Add :LSApplicationCategoryType string '$APP_CATEGORY'" "$INFO_PLIST"

    # Background modes for push notifications
    if ! /usr/libexec/PlistBuddy -c "Print :UIBackgroundModes" "$INFO_PLIST" 2>/dev/null | grep -q "remote-notification"; then
        /usr/libexec/PlistBuddy -c "Delete :UIBackgroundModes" "$INFO_PLIST" 2>/dev/null || true
        /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes array" "$INFO_PLIST"
        /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes:0 string fetch" "$INFO_PLIST"
        /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes:1 string remote-notification" "$INFO_PLIST"
    fi

    echo "[ok] Info.plist updated"
fi

echo ""
echo "[ok] Post-prebuild complete"

#!/usr/bin/env bash
#
# capture-screenshots-maestro.sh — FULLY AUTOMATED App Store screenshots.
#
# Unlike the interactive capture-screenshots.sh (manual OAuth login + per-screen
# keypress), this drives everything via Maestro using the in-app PASSWORD login
# form — so it runs unattended. A simulator screenshot is native-resolution =
# exactly the App Store required size; no resizing.
#
# Prereqs (one-time per simulator):
#   - the app installed on the target sim:  npx expo run:ios --device "<sim name>"
#     (or build once + `xcrun simctl install <udid> <App.app>`)
#   - maestro CLI + JDK (already installed)
#   - a demo/test account WITH populated data (story, studies, health, consents)
#
# Usage:
#   E2E_USER_EMAIL=demo-user5@example.com E2E_USER_PASSWORD=… \
#     ./store/capture-screenshots-maestro.sh en-US iphone69
#   …                                        cs    ipad13
#
set -euo pipefail

LOCALE="${1:-en-US}"
DEVICE_KEY="${2:-iphone69}"

case "$DEVICE_KEY" in
  iphone69) SIM_NAME="iPhone 17 Pro Max" ;;        # 6.9" → 1320×2868
  iphone67) SIM_NAME="iPhone 16 Plus" ;;           # 6.7" → 1290×2796 (alt)
  ipad13)   SIM_NAME="iPad Pro 13-inch (M5)" ;;    # 13"  → 2064×2752
  *) echo "Unknown device key: $DEVICE_KEY (iphone69 | iphone67 | ipad13)"; exit 1 ;;
esac

case "$LOCALE" in
  en-US|en) APP_LANG="en"; APP_LOCALE="en_US" ;;
  cs)       APP_LANG="cs"; APP_LOCALE="cs_CZ" ;;
  de)       APP_LANG="de"; APP_LOCALE="de_DE" ;;
  *)        APP_LANG="${LOCALE%%-*}"; APP_LOCALE="$APP_LANG" ;;
esac

# Sign-in is performed OUT-OF-BAND via Keycloak OAuth (the app's only auth path):
# either drive it once with the computer-use MCP, or sign in by hand in the booted
# simulator. The session persists in the keychain, so capture reuses it across runs
# and locales. The demo account + LOCAL password live in mobile-app/.env.e2e.local
# (gitignored). No password is typed by this script.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BUNDLE_ID="cz.id3a.aisha.app"
# Reuse the E2E test for capture: the post-login navigation test walks + screenshots
# every marketing screen. PREREQUISITE: the app must already be in a signed-in
# session. Sign-in is Keycloak OAuth (the app's single auth abstraction); for fully
# unattended capture, seed a session token for the demo user via that SAME
# abstraction (controlled by enabling/disabling the demo user in Keycloak) — NOT an
# app-side test exception. Until that token seed is wired, sign in once manually in
# the booted simulator, then re-run this script.
NAV_FLOW="$APP_DIR/e2e/flows/smoke/post-login-navigation.yaml"
export SHOT_DIR="$SCRIPT_DIR/screenshots/$LOCALE/$DEVICE_KEY"
mkdir -p "$SHOT_DIR"

UDID="$(xcrun simctl list devices available | awk -v n="$SIM_NAME" 'index($0, n"(")>0 || index($0, n" (")>0 {match($0,/\(([-0-9A-F]{36})\)/,a); print a[1]; exit}')"
[[ -z "$UDID" ]] && UDID="$(xcrun simctl list devices available | grep -F "$SIM_NAME (" | head -1 | grep -oE '[0-9A-F-]{36}')"
if [[ -z "$UDID" ]]; then echo "❌ Simulator not found: $SIM_NAME"; exit 1; fi
echo "→ $SIM_NAME ($UDID)  locale=$LOCALE  out=$SHOT_DIR"

xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator --args -CurrentDeviceUDID "$UDID" >/dev/null 2>&1 || true
sleep 4

# Force app language/region (expo-localization reads device AppleLanguages).
xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl spawn "$UDID" defaults write -g AppleLanguages -array "$APP_LANG" 2>/dev/null || true
xcrun simctl spawn "$UDID" defaults write -g AppleLocale -string "$APP_LOCALE" 2>/dev/null || true

# Clean marketing status bar (9:41, full battery/signal).
xcrun simctl status_bar "$UDID" override \
  --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularBars 4 --wifiBars 3 2>/dev/null || true

if ! xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" >/dev/null 2>&1; then
  echo "❌ App not installed on $SIM_NAME. Build+install first:"
  echo "     npx expo run:ios --device \"$SIM_NAME\""
  exit 1
fi

# Login is OAuth (out-of-band — see header). This assumes the app is ALREADY signed
# in on this simulator; the navigation flow then walks + screenshots every marketing
# screen at native (= App Store) resolution.
if ! xcrun simctl spawn "$UDID" log show --last 1m 2>/dev/null | grep -q .; then :; fi
echo "→ Navigate + capture (post-login-navigation test)…"
maestro --device "$UDID" test "$NAV_FLOW"

xcrun simctl status_bar "$UDID" clear 2>/dev/null || true

echo ""
echo "✅ Screenshots → $SHOT_DIR"
ls -1 "$SHOT_DIR" 2>/dev/null || true
echo "   (native resolution = App Store-correct; repeat for other locale/device)"

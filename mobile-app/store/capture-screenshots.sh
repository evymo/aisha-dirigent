#!/bin/bash
#
# capture-screenshots.sh — generate App Store screenshots from the iOS Simulator.
#
# The framework CAN do this: a simulator screenshot (`xcrun simctl io screenshot`)
# comes out at the device's exact native resolution — which is exactly the App
# Store required size. This script boots the right device, sets a clean 9:41
# status bar, deep-links to each screen (the app's expo-router scheme), and
# captures — writing correctly-named, correctly-sized PNGs.
#
# The ONE thing that can't be automated headlessly is the OAuth (Keycloak) login
# — the system auth sheet isn't scriptable. So: log in ONCE when prompted, then
# the rest of the run is automatic.
#
# Usage:
#   ./store/capture-screenshots.sh en-US iphone69
#   ./store/capture-screenshots.sh cs    ipad13
#
# Prereq — the app must be installed on the simulator first (one-time, per device):
#   npx expo run:ios --device "iPhone 17 Pro Max"     # builds + installs + launches
#   # (or for iPad)  npx expo run:ios --device "iPad Pro 13-inch (M5)"
#
set -euo pipefail

LOCALE="${1:-en-US}"
DEVICE_KEY="${2:-iphone69}"
BUNDLE_ID="cz.id3a.aisha.app"
SCHEME="aisha-dirigent"

case "$DEVICE_KEY" in
  iphone69) SIM_NAME="iPhone 17 Pro Max" ;;        # 6.9" → 1320×2868
  iphone67) SIM_NAME="iPhone 16 Plus" ;;           # 6.7" → 1290×2796 (alt)
  ipad13)   SIM_NAME="iPad Pro 13-inch (M5)" ;;    # 13"  → 2064×2752
  *) echo "Unknown device key: $DEVICE_KEY (iphone69 | iphone67 | ipad13)"; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/screenshots/$LOCALE/$DEVICE_KEY"
mkdir -p "$OUT_DIR"

# Screen name : deep-link path (empty = navigate manually). Order = marketing order.
SCREENS=(
  "01_home:"                 # tab home — usually the landing screen after login
  "02_story:projects"        # story board / kanban
  "03_studies:studies"       # studies discovery
  "04_health:health"         # health check-ins + trends
  "05_aisha:"                # open a story → Chat/AISHA tab (manual: needs a story id)
  "06_privacy:privacy"       # privacy & consents
)

echo "→ Booting simulator: $SIM_NAME"
xcrun simctl boot "$SIM_NAME" 2>/dev/null || true
open -a Simulator
sleep 3
xcrun simctl status_bar "$SIM_NAME" override \
  --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularBars 4 --wifiBars 3 2>/dev/null || true

echo "→ Launching app ($BUNDLE_ID)"
xcrun simctl launch "$SIM_NAME" "$BUNDLE_ID" 2>/dev/null || {
  echo "  ⚠️ app not installed on $SIM_NAME. Install it first:"
  echo "      npx expo run:ios --device \"$SIM_NAME\""
  exit 1
}

echo ""
echo "🔐 Log in NOW in the simulator (one-time — OAuth can't be automated)."
read -r -p "   Press Enter once you're signed in and on the home screen… " _

echo ""
echo "Output: $OUT_DIR"
for entry in "${SCREENS[@]}"; do
  name="${entry%%:*}"; path="${entry#*:}"
  if [ -n "$path" ]; then
    echo "  → deep-link: $SCHEME://$path"
    xcrun simctl openurl "$SIM_NAME" "$SCHEME://$path" 2>/dev/null || true
    sleep 2
  fi
  read -r -p "  [$name] adjust/navigate if needed, Enter to capture (or 's' to skip)… " ans
  [ "$ans" = "s" ] && { echo "    skipped"; continue; }
  xcrun simctl io "$SIM_NAME" screenshot "$OUT_DIR/$name.png"
  echo "    ✓ $OUT_DIR/$name.png"
done

# Restore the real status bar.
xcrun simctl status_bar "$SIM_NAME" clear 2>/dev/null || true

echo ""
echo "Done → $OUT_DIR (sizes are native = App Store-correct)."
echo "Repeat for the other device/locale, then upload in App Store Connect."
echo ""
echo "Fully-automated alternative (after a one-time login): a Maestro flow"
echo "(github.com/mobile-dev-inc/maestro, Apache-2.0) can tap + screenshot every"
echo "screen unattended — see SCREENSHOTS_PLAN.md."

#!/usr/bin/env bash
#
# upload-hermes-dsym.sh — push the native Hermes debug symbols to our Sentry.
#
# The prebuilt hermes.framework that ships in iOS RELEASE builds is stripped, so
# no dSYM lands in the archive (Xcode warns "did not include a dSYM for
# hermes.framework"). React Native, however, publishes the matching release dSYM
# as a separate Maven artifact. We download it and upload the iOS (arm64) variant
# to Sentry so native frames inside the Hermes engine symbolicate — without
# building Hermes from source.
#
# The Hermes UUID is stable across builds of the same react-native version, so
# this only needs to run once per RN version. A marker file makes it idempotent
# (cheap no-op on subsequent builds); build-ios.sh calls it non-fatally.
#
# Env: SENTRY_AUTH_TOKEN (or SENTRY_TOKEN) required. SENTRY_URL/ORG/PROJECT
# default to the self-hosted values (overridable; org/project also in
# sentry.properties).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# Identita z profilu instance — JEDINÉ místo je app-profile.sh (viz jeho hlavička).
. "$SCRIPT_DIR/app-profile.sh"

RN="$(node -e "console.log(require('react-native/package.json').version)")"
SENTRY_CLI="$PROJECT_DIR/node_modules/@sentry/cli/bin/sentry-cli"
TOKEN="${SENTRY_AUTH_TOKEN:-${SENTRY_TOKEN:-}}"

# ⛔ Do 2026-08-19 tu stálo `require('./version.json')` napevno, takže dSYM
# druhé appky by odešly do Sentry projektu RIQ Investments. Profil rozhoduje.
# Sentry target from version.json brand (env still overrides) so a re-skinned build
# uploads under ITS project. Falls back to the AISHA defaults on any read error.
BRAND_SENTRY_URL="$(node -e "try{process.stdout.write(require('$VERSION_FILE').brand.sentry.url||'')}catch(e){}" 2>/dev/null)"
BRAND_SENTRY_ORG="$(node -e "try{process.stdout.write(require('$VERSION_FILE').brand.sentry.organization||'')}catch(e){}" 2>/dev/null)"
BRAND_SENTRY_PROJECT="$(node -e "try{process.stdout.write(require('$VERSION_FILE').brand.sentry.project||'')}catch(e){}" 2>/dev/null)"

MARKER_DIR="$HOME/Library/Caches/${BRAND_SENTRY_PROJECT:-aisha-dirigent}"
MARKER="$MARKER_DIR/hermes-dsym-${RN}.done"

if [ -z "$TOKEN" ]; then
  echo "[hermes-dsym] SENTRY_AUTH_TOKEN/SENTRY_TOKEN not set — skipping." >&2
  exit 1
fi
if [ ! -x "$SENTRY_CLI" ]; then
  echo "[hermes-dsym] sentry-cli missing ($SENTRY_CLI) — run npm install." >&2
  exit 1
fi
if [ -f "$MARKER" ]; then
  echo "[hermes-dsym] RN $RN hermes dSYM already uploaded (marker present) — skip."
  exit 0
fi

URL="https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/${RN}/react-native-artifacts-${RN}-hermes-framework-dSYM-release.tar.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[hermes-dsym] Downloading Hermes release dSYM for react-native ${RN}…"
curl -fsSL "$URL" -o "$TMP/hermes-dsym.tar.gz"
tar -xzf "$TMP/hermes-dsym.tar.gz" -C "$TMP"

DSYM="$TMP/iphoneos/hermes.framework.dSYM"
[ -d "$DSYM" ] || DSYM="$(find "$TMP" -path '*iphoneos*' -iname 'hermes.framework.dSYM' -type d | head -1)"
if [ ! -d "$DSYM" ]; then
  echo "[hermes-dsym] iphoneos hermes.framework.dSYM not found in artifact." >&2
  exit 1
fi

echo "[hermes-dsym] Uploading $(dwarfdump --uuid "$DSYM" 2>/dev/null | grep -oE '[0-9A-F-]{36}' | head -1) to Sentry…"
SENTRY_URL="${SENTRY_URL:-${BRAND_SENTRY_URL:-https://sentry.id3a.cz}}" \
SENTRY_ORG="${SENTRY_ORG:-${BRAND_SENTRY_ORG:-sentry}}" \
SENTRY_PROJECT="${SENTRY_PROJECT:-${BRAND_SENTRY_PROJECT:-aisha-dirigent}}" \
SENTRY_AUTH_TOKEN="$TOKEN" \
  "$SENTRY_CLI" debug-files upload "$DSYM"

mkdir -p "$MARKER_DIR" && touch "$MARKER"
echo "[hermes-dsym] ✓ Hermes dSYM uploaded for RN ${RN}"

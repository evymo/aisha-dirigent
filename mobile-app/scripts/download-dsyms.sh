#!/bin/bash
#
# download-dsyms.sh
#
# Downloads release dSYM bundles for React Native prebuilt iOS artifacts.
# Useful before App Store/TestFlight upload if archive is missing third-party symbols.

set -e

RN_VERSION="0.81.5"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSYM_DIR="$PROJECT_DIR/ios/build/dsyms"

mkdir -p "$DSYM_DIR"
cd "$DSYM_DIR"

echo "Downloading dSYM bundles for React Native $RN_VERSION..."

curl -LO "https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/${RN_VERSION}/react-native-artifacts-${RN_VERSION}-reactnative-core-release-dsym.tar.gz"
tar -xzf "react-native-artifacts-${RN_VERSION}-reactnative-core-release-dsym.tar.gz" 2>/dev/null || true

curl -LO "https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/${RN_VERSION}/react-native-artifacts-${RN_VERSION}-reactnative-dependencies-release-dsym.tar.gz"
tar -xzf "react-native-artifacts-${RN_VERSION}-reactnative-dependencies-release-dsym.tar.gz" 2>/dev/null || true

curl -LO "https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/${RN_VERSION}/react-native-artifacts-${RN_VERSION}-hermes-ios-release-dsym.tar.gz"
tar -xzf "react-native-artifacts-${RN_VERSION}-hermes-ios-release-dsym.tar.gz" 2>/dev/null || true

rm -f *.tar.gz

echo ""
echo "dSYM bundles downloaded to: $DSYM_DIR"
echo "Copy them into the .xcarchive/dSYMs directory if Organizer reports missing symbols."

#!/usr/bin/env bash
# android-prostredi.sh — JDK 17 a Android SDK pro buildy v CI.
#
#   bash scripts/ci/android-prostredi.sh "platforms;android-35" "build-tools;35.0.0" …
#
# ⭐ JEDEN DOMOV. Kroky bydlely v mobile-android.yml; build Kiosk Admina
#    (kiosk-balicky.yml) potřebuje totéž, jen s jinou platformou. Kopie by se
#    rozešla — a opravu v jedné by druhá nikdy nedostala.
#
# Zapíše JAVA_HOME, ANDROID_HOME a ANDROID_SDK_ROOT do $GITHUB_ENV.
set -euo pipefail
[ $# -gt 0 ] || { echo "::error title=android::android-prostredi: chybí seznam balíčků SDK" >&2; exit 1; }
: "${GITHUB_ENV:?android-prostredi běží v CI (chybí GITHUB_ENV)}"

# ⛔ BEZ `sudo`. Runner běží jako root a `sudo` na image NENÍ — naměřeno
# 2026-09-08: první běh mobile-android spadl okamžitě, protože tenhle krok byl
# JEDINÝ v celém repu, který ho volal.
if ! command -v javac >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends openjdk-17-jdk-headless
fi
echo "JAVA_HOME=$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")" >> "$GITHUB_ENV"

# ⛔ ANDROID_HOME MUSÍ BÝT NASTAVENÉ, JINAK GRADLE HLÁSÍ „SDK location not
# found" — tedy chybu, která zní jako chybějící konfigurace, ačkoli jde
# o nedoručenou.
SDK="$HOME/android-sdk"
if [ ! -d "$SDK/cmdline-tools/latest" ]; then
  mkdir -p "$SDK/cmdline-tools"
  curl -sSLo /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q /tmp/tools.zip -d "$SDK/cmdline-tools"
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
fi
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
"$SDK/cmdline-tools/latest/bin/sdkmanager" --install "$@" >/dev/null
{
  echo "ANDROID_HOME=$SDK"
  echo "ANDROID_SDK_ROOT=$SDK"
} >> "$GITHUB_ENV"

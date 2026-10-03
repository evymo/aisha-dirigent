#!/bin/bash
# build.sh — postaví hlídače pro instanci.
#
#   HLIDAC_INSTANCE=<fork>-instance-data/zarizeni/hlidac.json \
#   HLIDAC_KEYSTORE_PATH=… HLIDAC_KEY_ALIAS=… HLIDAC_KEYSTORE_PASSWORD=… \
#     apps/hlidac/scripts/build.sh            # podepsané release APK
#   apps/hlidac/scripts/build.sh --test       # jen jednotkové testy (stačí vzor identity)
#
# ⛔ Release bez klíče se NEPOSTAVÍ: ladicí podpis by na tabletu nešel
# aktualizovat a otisk v QR by patřil klíči, který nikdo nemá v trezoru.
# Po buildu se otisk certifikátu porovná se `signing.certSha256` instance —
# jiný klíč = tablety nastavené dřív by novou verzi odmítly.
set -euo pipefail
KOREN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KOREN"

TEST=0
[ "${1:-}" = "--test" ] && TEST=1

if [ "$TEST" = 1 ]; then
  export HLIDAC_INSTANCE="${HLIDAC_INSTANCE:-$KOREN/hlidac.example.json}"
fi
: "${HLIDAC_INSTANCE:?HLIDAC_INSTANCE musí ukazovat na hlidac.json instance}"
[ -f "$HLIDAC_INSTANCE" ] || { echo "⛔ HLIDAC_INSTANCE: soubor neexistuje: $HLIDAC_INSTANCE" >&2; exit 1; }
export HLIDAC_INSTANCE="$(cd "$(dirname "$HLIDAC_INSTANCE")" && pwd)/$(basename "$HLIDAC_INSTANCE")"

# Java 17+ (AGP 8.13).
if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
fi
[ -n "${JAVA_HOME:-}" ] || { echo "⛔ JAVA_HOME není nastavené (potřeba JDK 17)" >&2; exit 1; }
export JAVA_HOME

# Android SDK → local.properties (build ho jinak nenajde).
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
[ -d "$SDK/platforms" ] || { echo "⛔ Android SDK nenalezen ($SDK); nastav ANDROID_HOME" >&2; exit 1; }
echo "sdk.dir=$SDK" > local.properties

# Gradle: repo nenese wrapper (žádné binárky v gitu). Pořadí: $GRADLE → cache
# wrapperu 8.14.3 → gradle z PATH, pokud je aspoň 8.13.
najdi_gradle() {
  if [ -n "${GRADLE:-}" ]; then echo "$GRADLE"; return; fi
  local g
  for g in "$HOME"/.gradle/wrapper/dists/gradle-8.14.3-bin/*/gradle-8.14.3/bin/gradle \
           "$HOME"/.gradle/wrapper/dists/gradle-8.14.3-all/*/gradle-8.14.3/bin/gradle; do
    [ -x "$g" ] && { echo "$g"; return; }
  done
  if command -v gradle >/dev/null; then
    local v; v="$(gradle --version 2>/dev/null | sed -n 's/^Gradle \([0-9]*\)\.\([0-9]*\).*/\1 \2/p')"
    set -- $v
    if [ "${1:-0}" -gt 8 ] || { [ "${1:-0}" -eq 8 ] && [ "${2:-0}" -ge 13 ]; }; then command -v gradle; return; fi
  fi
  echo ""
}
GRADLE_BIN="$(najdi_gradle)"
[ -n "$GRADLE_BIN" ] || { echo "⛔ Gradle 8.13+ nenalezen; nastav GRADLE=/cesta/k/gradle" >&2; exit 1; }

if [ "$TEST" = 1 ]; then
  "$GRADLE_BIN" --no-daemon -q :app:testDebugUnitTest
  echo "✅ jednotkové testy hlídače prošly"
  exit 0
fi

: "${HLIDAC_KEYSTORE_PATH:?⛔ chybí HLIDAC_KEYSTORE_PATH — release se ladicím klíčem nestaví}"
: "${HLIDAC_KEY_ALIAS:?⛔ chybí HLIDAC_KEY_ALIAS}"
: "${HLIDAC_KEYSTORE_PASSWORD:?⛔ chybí HLIDAC_KEYSTORE_PASSWORD}"

"$GRADLE_BIN" --no-daemon -q clean :app:testDebugUnitTest :app:assembleRelease

APK="$KOREN/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "⛔ release APK nevzniklo" >&2; exit 1; }

BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
OTISK="$("$BT/apksigner" verify --print-certs "$APK" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')"
[ ${#OTISK} -eq 64 ] || { echo "⛔ APK není podepsané (apksigner nevrátil otisk)" >&2; exit 1; }
OTISK_DVOJTECKY="$(echo "$OTISK" | tr 'a-f' 'A-F' | sed 's/../&:/g; s/:$//')"

OCEKAVANY="$(node -e 'const j=require(process.argv[1]);process.stdout.write(String((j.signing||{}).certSha256||""))' "$HLIDAC_INSTANCE")"
if [ -z "$OCEKAVANY" ] || [ "$OCEKAVANY" = "null" ]; then
  echo "⚠️  signing.certSha256 v instanci chybí. Zapiš ho tam (QR bez něj nevznikne):"
  echo "    \"certSha256\": \"$OTISK_DVOJTECKY\""
elif [ "$(echo "$OCEKAVANY" | tr 'a-f' 'A-F')" != "$OTISK_DVOJTECKY" ]; then
  echo "⛔ APK je podepsané JINÝM klíčem, než instance deklaruje." >&2
  echo "   instance: $OCEKAVANY" >&2
  echo "   APK:      $OTISK_DVOJTECKY" >&2
  exit 1
fi

echo "✅ $APK"
echo "   SHA-256 souboru: $(shasum -a 256 "$APK" | cut -d' ' -f1)"
echo "   otisk podpisu:   $OTISK_DVOJTECKY"

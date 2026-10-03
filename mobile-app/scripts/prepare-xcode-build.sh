#!/bin/bash
#
# prepare-xcode-build.sh
#
# Prepares the iOS project for manual archive/upload in Xcode.
#
# Usage:
#   ./scripts/prepare-xcode-build.sh
#   ./scripts/prepare-xcode-build.sh --bump
#
# After success:
#   1. open ios/$XCODE_NAME.xcworkspace
#   2. Product -> Archive
#   3. Window -> Organizer -> Distribute App

set -e

# CocoaPods (Ruby) aborts with Encoding::CompatibilityError when the active
# locale is not UTF-8 (common in minimal shells / CI). Force a sane default.
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
# `instance-overlay-apply.sh` ho VYŽADUJE (píše `$ROOT_DIR/instances/_overlay`).
# Bez něj se cesta složí od kořene disku — naměřeno 2026-09-06:
# `mkdir: /instances: Read-only file system`. Že to nespadlo hůř, je jen
# náhoda: na zapisovatelném svazku by to založilo `/instances/_overlay`.
ROOT_DIR="$(dirname "$PROJECT_DIR")"
IOS_DIR="$PROJECT_DIR/ios"
# Identita z profilu — sdíleno se všemi build skripty (viz app-profile.sh).
. "$SCRIPT_DIR/app-profile.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[info]  $1${NC}"; }
log_success() { echo -e "${GREEN}[ok]    $1${NC}"; }
log_warning() { echo -e "${YELLOW}[warn]  $1${NC}"; }
log_error() { echo -e "${RED}[error] $1${NC}"; }

# ⭐ TÁŽ KONFIGURACE JAKO `build-ios.sh` (2026-08-19). Tenhle skript odvození
# instančních hodnot NEMĚL — vyrobil by projekt bez adresy brány, bez realmu
# a bez redirect URI, a poznalo by se to teprve přihlášením z TestFlightu.
# Sdílený soubor znamená, že „archivuj z Xcode" a „build-ios.sh" nemůžou vyrobit
# dvě různě nakonfigurované aplikace.
#
# ⛔ OVERLAY MUSÍ BÝT PŘED ODVOZENÍM — a dřív tu nebyl vůbec.
#
# NAMĚŘENO 2026-09-06: s `AISHA_INSTANCE_OVERLAY=…/surfaces/<fork>-ridic` vyrobil
# tenhle skript `ios/AISHADirigent.xcworkspace`, tedy projekt PLATFORMNÍ appky.
# Nespadl — jen postavil cizí aplikaci, a poznalo se to až podle jména souboru.
#
# ⭐ Je to TÁŽ vada, kterou komentář v `build-ios.sh` popisuje o dva měsíce
# dřív: overlay se vytáhl do sdíleného souboru právě proto, „aby existoval
# JEDNOU a mohla ho použít i druhá platforma — dokud byl uvnitř, Android ho
# neměl a APK by vzniklo v barvách PLATFORMY, ne instance". Při tom vytažení
# se na tuhle třetí cestu k buildu zapomnělo.
#
# ⭐ Pořadí není libovolné: overlay teprve DOSAZUJE `version.json` (a s ním
# `brand.oauthClientId`), ze kterého odvození níž čte. Obráceně by odvození
# četlo ještě platformní hodnoty — a stráž „identita není deklarovaná" by
# hlásila chybějící proměnnou místo chybějícího overlaye.
. "$SCRIPT_DIR/instance-overlay-apply.sh"

# ⚠️ Volitelné: bez AISHA_INSTANCE_ENV se neděje nic a platí .env / prostředí.
. "$SCRIPT_DIR/instance-env-derive.sh"

cd "$PROJECT_DIR"

if [[ "$1" == "--bump" ]]; then
  log_info "Incrementing build number..."
  ./scripts/bump-version.sh build
  log_success "Build number incremented"
fi

if [ -f "$VERSION_FILE" ]; then
  APP_VERSION=$(grep '"version"' "$VERSION_FILE" | head -1 | sed 's/.*: "\(.*\)".*/\1/')
  BUILD_NUMBER=$(grep '"build"' "$VERSION_FILE" | head -1 | sed 's/.*: \([0-9]*\).*/\1/')
else
  APP_VERSION="1.0.0"
  BUILD_NUMBER="1"
fi

log_info "Preparing iOS project for Xcode"
log_info "Version: $APP_VERSION ($BUILD_NUMBER)"

log_info "Cleaning DerivedData..."
rm -rf ~/Library/Developer/Xcode/DerivedData/"$XCODE_NAME"-* 2>/dev/null || true
log_success "DerivedData cleaned"

log_info "Running clean iOS prebuild..."
npx expo prebuild --platform ios --clean --no-install
log_success "Expo prebuild finished"

if [ -f "$SCRIPT_DIR/post-prebuild.sh" ]; then
  log_info "Applying post-prebuild fixes..."
  bash "$SCRIPT_DIR/post-prebuild.sh"
  log_success "Post-prebuild fixes applied"
fi

# ⛔ INSTANČNÍ HODNOTY MUSÍ PŘEŽÍT KONEC TOHOTO SKRIPTU (naměřeno 2026-08-19)
#
# `instance-env-derive.sh` je exportuje do NAŠEHO shellu — ten skončí a Xcode
# pak archivuje bez nich. Naměřený následek: archiv appky řidiče se podepsal,
# měl správnou verzi, bundle i ikonu, a přitom v celém `.app` NEBYLA ani
# jednou adresa brány instance. Tedy appka bez ní, bez OIDC klienta a bez
# redirect URI — cihla, která vypadá hotově.
#
# ⭐ A pojistka v `app.config.ts` to nechytila, protože hlídá JINÝ KROK, než
# který ta data zapéká: guard se vyhodnocuje ve fázi `Generate app.config`,
# hodnoty se do appky dostávají při balení JS. U jedné appky vykřičel, u druhé
# mlčel — a mlčení se čte jako úspěch.
#
# `.xcode.env.local` sourcují OBĚ tyhle fáze (`expo-constants/scripts/with-node.sh`
# i `react-native/scripts/xcode/with-environment.sh`), takže hodnoty zapsané sem
# platí bez ohledu na to, jestli archivuje skript, nebo člověk z Xcode.
XCODE_ENV_LOCAL="$IOS_DIR/.xcode.env.local"
{
  echo ""
  echo "# --- instanční hodnoty (doplnil prepare-xcode-build.sh) ---"
  # ⛔ UNIVERZUM SE ODVOZUJE, NEPÍŠE. Tady stál RUČNÍ SEZNAM šesti klíčů —
  # a `instance-env-derive.sh` jich mezitím odvozoval podstatně víc. Co v tom
  # seznamu nebylo, tiše nedoletělo do Xcode:
  #
  #   EXPO_PUBLIC_KNOCK_*      → appka bez dveří (naměřeno 2026-08-20 v archivu
  #                              `cz.riq.ridic` 1.0.0(3): všechny čtyři `None`,
  #                              přestože odvození o řádek výš uspělo)
  #   EXPO_PUBLIC_LIVEKIT_URL  → hovory by nešly
  #   EXPO_PUBLIC_KC_AUTHORITY, _BOOTSTRAP_URL, _APP_URL, _WEB_URL
  #
  # Nejzákeřnější na tom bylo, že se NIC neozvalo: derivace hlásila úspěch,
  # archiv vznikl, a chybějící hodnoty by se poznaly až z TestFlightu.
  #
  # `EXPO_PUBLIC_*` je z definice VEŘEJNÁ hodnota buildu, takže správné
  # univerzum je „všechny, co jsou nastavené" — ne výběr, který někdo udržuje.
  for k in $(compgen -v | grep '^EXPO_PUBLIC_' | sort); do
    v=$(eval "printf '%s' \"\${$k:-}\"")
    # Uvozovky v hodnotě by rozbily `export` řádek; escapují se.
    [ -n "$v" ] && printf 'export %s="%s"\n' "$k" "$(printf '%s' "$v" | sed 's/"/\\"/g')"
  done
  # ⛔ IDENTITA APPKY MUSÍ PŘEŽÍT DO XCODE. Tenhle skript slibuje „připraveno
  # pro archiv z Xcode" — jenže `Product → Archive` běží BEZ našeho prostředí,
  # takže `app.config.ts` nevidí AISHA_APP_VERSION_FILE a fail-closed guard
  # build zastaví („XCODE STAVÍ, ALE NIKDO NEŘEKL ČÍ APPKU"). Slib bez tohohle
  # řádku neplatil: z Xcode šlo archivovat jen to, co se zrovna stavělo
  # z terminálu.
  #
  # ⚠️ Píše se ABSOLUTNÍ cesta: fáze bundlu běží s jiným `cwd` (SRCROOT je
  # ios/Pods) a relativní by tam neukázala nikam.
  for k in AISHA_APP_VERSION_FILE AISHA_FIREBASE_IOS_FILE; do
    v=$(eval "printf '%s' \"\${$k:-}\"")
    if [ -n "$v" ]; then
      case "$v" in /*) : ;; *) v="$(cd "$(dirname "$v")" && pwd)/$(basename "$v")" ;; esac
      echo "export $k=\"$v\""
    fi
  done
} >> "$XCODE_ENV_LOCAL"
log_success "Instanční hodnoty zapsány do ios/.xcode.env.local ($(grep -c '^export ' "$XCODE_ENV_LOCAL") klíčů)"

# ⛔ IDENTITA SE MĚŘÍ, NE PŘEDPOKLÁDÁ. Bez tohohle řádku by chybějící
# AISHA_APP_VERSION_FILE prošla tiše až do Xcode, kde se projeví jako záhadně
# spadlý archiv. Tady se to řekne hned a jménem.
if ! grep -q '^export AISHA_APP_VERSION_FILE=' "$XCODE_ENV_LOCAL"; then
  log_warning "ios/.xcode.env.local NEUVÁDÍ AISHA_APP_VERSION_FILE."
  log_warning "  Archiv z Xcode (Product → Archive) proto SPADNE — app.config.ts"
  log_warning "  odmítne stavět appku, jejíž identitu nikdo neřekl."
  log_warning "  Spusť tenhle skript s AISHA_APP_VERSION_FILE=<profil instance>."
fi

# CocoaPods — sdílené s build-ios.sh, viz pods-install.sh.
# Čistá instalace: tahle cesta vyrábí projekt k RELEASE ARCHIVU, kde zbytek
# po předchozím profilu (jiný Pods/, jiný Podfile.lock) znamená archiv,
# který se od zdrojáku liší a nikdo to nepozná.
PODS_CLEAN=1 . "$SCRIPT_DIR/pods-install.sh"

if [ -f "$IOS_DIR/$XCODE_NAME.xcworkspace/contents.xcworkspacedata" ]; then
  log_success "Workspace ready: ios/$XCODE_NAME.xcworkspace"
else
  log_error "Workspace not found after pod install"
  exit 1
fi

echo ""
echo -e "${GREEN}Project is ready for Xcode archive${NC}"
echo ""
echo "  open ios/$XCODE_NAME.xcworkspace"
echo "  Scheme: $XCODE_NAME"
echo "  Destination: Any iOS Device (arm64)"
echo "  Product -> Archive"
echo "  Organizer -> Distribute App -> App Store Connect"

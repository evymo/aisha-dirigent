#!/bin/bash
# =============================================================================
# pods-install.sh — instalace CocoaPods. JEDINÉ místo, kde se to dělá.
# =============================================================================
# Sourcuje se, nespouští:
#
#     IOS_DIR=… ; PODS_CLEAN=1 ; . "$SCRIPT_DIR/pods-install.sh"
#
# Vyžaduje: IOS_DIR. Volitelně PODS_CLEAN=1 (smaže Pods/ a Podfile.lock, tedy
# čistá instalace — používá to cesta pro release archiv).
#
# ⛔ PROČ SAMOSTATNĚ (naměřeno 2026-08-19)
# ----------------------------------------
# Tenhle blok byl OPSANÝ ve dvou build cestách a ROZEŠEL SE — přesně tím
# způsobem, který se nedá poznat čtením jedné z nich:
#
#   build-ios.sh            arm64 → /usr/bin/arch -arm64 pod install   ✅
#   prepare-xcode-build.sh  arm64 → pod install                        ⛔ Rosetta
#                           jinak → arch -arm64 … || pod install       ⛔ fallback
#
# Druhá cesta („připrav projekt a archivuj z Xcode") měla obě větve obrácené
# a k tomu fallback, který ústup na x86 jen ztišuje. Opravená byla ta, kterou
# jsem tehdy četl; ta druhá zůstala vadná a čekala na první archiv.
#
# ⭐ ARCHITEKTURU ROZHODUJE INTERPRET, NE SHELL.
#
# Dřív se ptalo `uname -m`, tedy na architekturu SHELLU — a když vyšla arm64,
# spustilo se holé `pod install`. Jenže `pod` je ruby skript a spouští ho ten
# ruby, který je první v PATH. Na tomhle stroji je to `/usr/local/bin/ruby`
# z Intel Homebrew, a ten je `Mach-O 64-bit executable x86_64`. CocoaPods tedy
# běžely pod Rosettou i přesto, že test „jsme na arm64" prošel — a samy to
# ohlásily:
#     [!] Do not use "pod install" from inside Rosetta2
#     [!] May result in mixed architectures in rubygems
# Následek byl matoucí: podspec, který na disku PROKAZATELNĚ je
# (react-native-udp, QuickCrypto), hlásil pod x86 CocoaPods jako
# „mistyped the name or version".
#
# `arch -arm64` se proto vynucuje VŽDY. Není to fallback: na arm64 stroji je
# nativní běh jediný správný a je jedno, co si myslí shell. Selhání se
# NEPOLYKÁ — `|| pod install` by vrátilo přesně ten stav, který tohle
# odstraňuje, jen tišeji.
# =============================================================================

command -v log_error >/dev/null 2>&1 || log_error() { echo "[error] $1" >&2; }
command -v log_info  >/dev/null 2>&1 || log_info()  { echo "[info]  $1"; }
command -v log_success >/dev/null 2>&1 || log_success() { echo "[ok]    $1"; }

if [ -z "${IOS_DIR:-}" ] || [ ! -d "$IOS_DIR" ]; then
    log_error "pods-install.sh: IOS_DIR není adresář (${IOS_DIR:-nenastaveno})"
    exit 1
fi

log_info "Installing CocoaPods..."
cd "$IOS_DIR"

# ⛔ REACT NATIVE SE NESMÍ KOMPILOVAT ZE ZDROJE (naměřeno 2026-08-19)
#
# Bez tohohle archiv PADNE, a to hluboko v cizím kódu:
#     Pods/fmt/include/fmt/format-inl.h:59:24: error: call to consteval
#     function 'fmt::basic_format_string<…>' is not a constant expression
# `fmt 11.0.2` se nesnese s clangem z Xcode 26.6. Nejde o naši chybu — jde
# o to, že se vendorovaný C++ Reactu vůbec KOMPILUJE. Když se místo toho
# vezmou publikované artefakty (`ReactNativeDependencies`), nekompiluje se
# nic a problém neexistuje. Táž oprava už jednou proběhla (changelog 1.0.2).
#
# Podfile ty proměnné nastavuje přes `||=` a jen tehdy, když
# `ios.buildReactNativeFromSource != 'true'`. V `Podfile.properties.json` ale
# `true` JE, takže by se stavělo ze zdroje. Vynucujeme je proto zvenčí —
# `||=` naši hodnotu respektuje.
# ⛔ JEN `RCT_USE_RN_DEP`, NIKDY `RCT_USE_PREBUILT_RNCORE` (naměřeno 2026-08-19).
#
# Podfile je nastavuje spolu, ale dělají RŮZNÉ věci a jen první je ta žádaná:
#   RCT_USE_RN_DEP=1        → vendorovaný C++ z artefaktů (fmt/Folly se NESTAVÍ)
#   RCT_USE_PREBUILT_RNCORE → nahradí i samotný React-Core xcframeworkem
#
# Se druhou přibude do locku `React-Core-prebuilt (0.81.5)` — a pak `livekit`
# a `RNFBMessaging`, které importují `<React/RCTBridgeModule.h>`, nemají co
# modulárně najít:
#     error: include of non-modular header inside framework module
#            'livekit_react_native_webrtc.WebRTCModule'
# Rozdíl proti funkčnímu buildu byl PŘESNĚ TENHLE JEDEN řádek v Podfile.lock.
export RCT_USE_RN_DEP="${RCT_USE_RN_DEP:-1}"

if [ "${PODS_CLEAN:-0}" = "1" ]; then
    # ⛔ `Podfile.lock` SE NEMAŽE. Lock je to, co verze DRŽÍ; smazat ho
    # neznamená „čistá instalace", ale „vyřeš znovu na nejnovější" — a přesně
    # tím se sem `fmt 11.0.2` dostal. Čistota se dělá smazáním `Pods/`,
    # reprodukovatelnost zachováním locku.
    log_info "CocoaPods: čistá instalace (Pods/ pryč, lock ZŮSTÁVÁ)"
    rm -rf Pods 2>/dev/null || true
fi

# CocoaPods VYŽADUJÍ UTF-8 locale. Neinteraktivní shell (agent, nohup, CI) ji
# nemá, a následek je zákeřný: spadne i samotný REPORTÉR chyb
#   unicode_normalize: Unicode Normalization not appropriate for ASCII-8BIT
# takže se pravá příčina do logu vůbec nedostane. Varování o tom CocoaPods
# vypíšou na PRVNÍM řádku — pod haldou stack trace ho ale nikdo nečte.
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

# ⛔ NATIVNÍ ARM64, JINAK SE NESTAVÍ. Pravidlo majitele 2026-08-19:
# „vždy jen a jen bez Rosetty a nativně pro arm, a ne jinak."
#
# ⛔ PROČ NESTAČÍ `arch -arm64`. `pod` má shebang `#!/bin/bash` a ruby si najde
# z PATH. Když je tam první Intel `/usr/local/bin/ruby`, spustí se PŘES ROSETTU
# i pod `arch -arm64` — ten architekturu jen PREFERUJE, x86_64-only binárku
# stejně pustí. Naměřeno u OBOU archivů 2026-08-19:
#     CocoaPods: ruby=/usr/local/bin/ruby (x86_64)
# Skript to tehdy VYPSAL a pokračoval. Měřidlo, které jen mluví a nic
# nezastaví, je dekorace — proto se tu teď končí nenulově.
#
# Nativní řetěz má přednost v PATH; `/usr/local` (Intel Homebrew) je až za ním.
[ -x /opt/homebrew/bin/pod ] && PATH="/opt/homebrew/bin:$PATH" && export PATH

pods_ruby_bin="$(command -v ruby || echo '?')"
pods_ruby_arch="$(file -b "$pods_ruby_bin" 2>/dev/null | grep -o 'x86_64\|arm64' | head -1)"
pods_pod_bin="$(command -v pod || echo '?')"
log_info "CocoaPods: pod=${pods_pod_bin} ruby=${pods_ruby_bin} (${pods_ruby_arch:-neznámá arch})"

if [ "$(uname -m)" = "arm64" ] && [ "$pods_ruby_arch" != "arm64" ]; then
    log_error "RUBY NENÍ NATIVNÍ (${pods_ruby_arch:-neznámá}) — CocoaPods by jely pod Rosettou."
    log_error "  ruby: $pods_ruby_bin"
    log_error ""
    log_error "CO S TIM:"
    log_error "  1) nainstaluj nativní řetěz:  brew install cocoapods   (arm64 Homebrew)"
    log_error "  2) nebo dej /opt/homebrew/bin před /usr/local/bin v PATH"
    log_error ""
    log_error "  Rosetta se tu NEOBCHÁZÍ příznakem — buď je nativní, nebo se nestaví."
    exit 1
fi

# `--repo-update` jen když lock NENÍ — nad existujícím lockem si vynucuje nové
# řešení závislostí, tedy přesně to, čemu se lock brání.
#
# ⛔ ŽÁDNÉ `$args` BEZ UVOZOVEK. Dřív tu stálo `pod $pods_args` a spoléhalo se
# na dělení slov. Pod bashem to funguje, pod zsh NE — celý řetězec dorazí jako
# JEDEN argument, `pod` na něj odpoví NÁPOVĚDOU a skončí nenulově. Větve jsou
# proto vypsané, ne skládané.
pods_rc=0
if [ -f Podfile.lock ]; then
    if [[ "$(uname -m)" == "arm64" ]]; then /usr/bin/arch -arm64 pod install || pods_rc=$?
    else pod install || pods_rc=$?; fi
else
    if [[ "$(uname -m)" == "arm64" ]]; then /usr/bin/arch -arm64 pod install --repo-update || pods_rc=$?
    else pod install --repo-update || pods_rc=$?; fi
fi

# ⛔ NÁVRATOVÝ KÓD SE MUSÍ ČÍST. Dřív se sem psalo „CocoaPods installed" i po
# pádu `pod` — a build pak padl o deset minut později v Xcode, kde už nebylo
# poznat, že pody nikdy nedoběhly. Hlásit úspěch bez měření je totéž jako
# neměřit (naměřeno 2026-08-19: `pod` vypsal nápovědu a skript řekl „ok").
if [ "$pods_rc" -ne 0 ] || [ ! -f Podfile.lock ]; then
    log_error "CocoaPods SELHALY (rc=$pods_rc, Podfile.lock $([ -f Podfile.lock ] && echo je || echo CHYBÍ))"
    exit 1
fi

log_success "CocoaPods installed ($(grep -c '^  - ' Podfile.lock) podů)"

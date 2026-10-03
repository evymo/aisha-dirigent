#!/bin/bash
#
# instance-overlay-apply.sh — overlay instance JEDNOU, pro OBĚ platformy
#
# ⛔ PROČ TENHLE SOUBOR VZNIKL (2026-09-04)
# Tenhle blok bydlel UVNITŘ `build-ios.sh`. Android ho tedy neměl — a nešlo
# o opomenutí jednoho řádku: za jediný den se táž vada ukázala ČTYŘIKRÁT,
# pokaždé jako „iOS to umí, Android ne":
#
#   · `instance-env-derive.sh` volal jen iOS  → Android padal na chybějící bráně
#   · `.env.build.local` četl jen iOS         → a je v něm AISHA_INSTANCE_ENV
#   · `AISHA_FIREBASE_*_FILE` znal jen iOS    → APK by vzniklo BEZ Firebase
#   · overlay (identita, ikona, barvy)        → tenhle soubor
#
# ⭐ KOPIE DO ANDROIDU BY PŘÍČINU ZOPAKOVALA. Dvě kopie téhož pravidla se
# rozejdou — přesně jako se rozešla build čísla (14 vs 24), když identita
# bydlela na dvou místech. Proto to má JEDEN domov a obě platformy ho volají,
# stejně jako už dřív `instance-env-derive.sh` (jeho hlavička říká totéž).
#
# Vyžaduje od volajícího: ROOT_DIR, PROJECT_DIR, VERSION_FILE, log_* funkce.
# Vyváží: přegenerovaný `src/theme/index.ts`, `version.json` a případně
# BRAND_LOGO — tedy stav, ze kterého smí stavět kterákoli platforma.

# ⛔ IDENTITU SI BEREME SAMI, NESPOLÉHÁME NA VOLAJÍCÍHO.
# Brána `mobil-identita-jeden-zdroj` to vyžaduje právem: skript, který na
# identitu SAHÁ, ale její zdroj neurčuje, jde zavolat s ručně nastaveným
# `VERSION_FILE` — a pravidlo „jeden zdroj identity" tím tiše padne.
# `app-profile.sh` je jen přiřazení proměnných s kontrolami, takže druhé
# načtení nic nerozbije; naopak zaručí, že hodnoty jsou odvozené, ne podstrčené.
. "$SCRIPT_DIR/app-profile.sh"

# ── Overlay instance: JEDINÝ kanál pro identitu, verzi a značku ──────────────
#
# ⭐ FORK MÁ BÝT SHODNÝ S UPSTREAMEM, aby šel jednoduše aktualizovat. Nesmí tedy
# nosit `version.json` ani ikonu konkrétní instance — obojí žije v datovém repu
# instance, vedle `app.config.json` a `brand.tokens.json`, které už tudy chodí.
#
# `AISHA_INSTANCE_OVERLAY` = cesta k `<instance-data>/surfaces/<slug>`.
# Bez něj se build chová jako dřív (co je v pracovním stromě, to platí), takže
# upstream build ani ruční pokus se nerozbijí.
#
# ⛔ ALE KDYŽ JE NASTAVENÝ A NEÚPLNÝ, JE TO PÁD. Overlay, který má být „kompletní
# odpověď na otázku, co dělá povrch instance-specific", a přitom neobsahuje
# identitu, není konfigurace — je to nedorozumění. Tiše sáhnout po tom, co leží
# v pracovním stromě, by znamenalo postavit appku pod cizí identitou; přesně to
# už jednou poslalo do TestFlightu tři buildy s platformní ikonou.
# ⛔ POŽADAVEK NA VOLAJÍCÍHO SE VYMÁHÁ, NEPÍŠE SE JEN DO KOMENTÁŘE.
#
# Hlavička výš `ROOT_DIR` vyžaduje od začátku — a přesto ho třetí cesta
# (`prepare-xcode-build.sh`) nedodávala. Prázdná proměnná pak složila cestu od
# KOŘENE DISKU: `mkdir: /instances: Read-only file system` (2026-09-06).
# Na zapisovatelném svazku by to tiše založilo `/instances/_overlay`.
#
# ⭐ Komentář popisuje, stráž vymáhá. Padá TADY a se jménem chybějící
# proměnné, ne o třicet řádků dál na nesrozumitelném `mkdir`.
for _pozadovana in ROOT_DIR PROJECT_DIR; do
    if [ -z "${!_pozadovana:-}" ]; then
        echo "[error] instance-overlay-apply.sh: volající nedodal \$$_pozadovana" >&2
        echo "[error]   Nastav ji před sourcováním — viz hlavička tohoto souboru." >&2
        exit 1
    fi
done
unset _pozadovana

if [ -n "${AISHA_INSTANCE_OVERLAY:-}" ]; then
    if [ ! -d "$AISHA_INSTANCE_OVERLAY" ]; then
        log_error "AISHA_INSTANCE_OVERLAY není adresář: $AISHA_INSTANCE_OVERLAY"
        exit 1
    fi
    OV_VERSION="$AISHA_INSTANCE_OVERLAY/version.json"
    OV_ICON="$AISHA_INSTANCE_OVERLAY/icon.svg"
    if [ ! -f "$OV_VERSION" ]; then
        log_error "Overlay instance nemá version.json: $OV_VERSION"
        log_error "  Identita buildu (verze, klient, scheme) patří do datového repa instance."
        exit 1
    fi
    # ⛔ INSTANČNÍ BUILD MUSÍ STROM VRÁTIT, JAK HO NAŠEL.
    # Přepisuje `version.json` (identita instance, včetně její DOMÉNY) a `assets/`
    # (ikony ze značky). Když to nechá ležet, generický strom nese instanční data:
    # brána `legacy-domains` spadne na instanční doméně ve `version.json` a ikony
    # čekají, až je někdo omylem commitne. Naměřeno 2026-09-03.
    # ⭐ Obnova je BEZPEČNÁ právě proto, že kontrola VÝŠ ověřila čistotu týchž
    # cest — nemáme co přepsat, protože tam nic rozpracovaného nebylo.
    # ⭐ Trap, ne řádek na konci: strom se musí vrátit i když archivace SPADNE.
    trap 'git -C "$PROJECT_DIR" checkout -- version.json assets src/theme/index.ts 2>/dev/null || true' EXIT
    cp "$OV_VERSION" "$VERSION_FILE"
    log_success "Identita z overlaye instance: $(basename "$AISHA_INSTANCE_OVERLAY")/version.json"
    # ⛔ POSLEDNÍ ČLÁNEK: overlay identitu vyslovil, ale `app.config.ts` ji čte
    # z `AISHA_APP_VERSION_FILE` — a tu nikdo nenastavoval. Xcode proto spadl až
    # ve skriptové fázi `Generate app.config`, tedy po 40 minutách kompilace
    # (naměřeno 2026-09-03). Overlay má být „JEDINÝ kanál pro identitu"; žádat
    # ji podruhé zvlášť je redundance, ne opatrnost.
    # ⭐ Volajícího NEPŘEBÍJÍME: když si proměnnou nastavil sám, platí jeho.
    if [ -z "${AISHA_APP_VERSION_FILE:-}" ]; then
        AISHA_APP_VERSION_FILE="$OV_VERSION"
        export AISHA_APP_VERSION_FILE
        log_info "AISHA_APP_VERSION_FILE odvozena z overlaye: $OV_VERSION"
    fi
    # Ikona: overlay ji dodá, pokud si ji volající nepředepsal sám.
    if [ -z "${BRAND_LOGO:-}" ] && [ -f "$OV_ICON" ]; then
        BRAND_LOGO="$OV_ICON"
        export BRAND_LOGO
        log_success "Značka z overlaye instance: $(basename "$AISHA_INSTANCE_OVERLAY")/icon.svg"
    fi

    # ── Barvy: motiv se MUSÍ přegenerovat, jinak se veze ten zacommitovaný ──
    #
    # ⛔ NAMĚŘENO 2026-08-09. `mobile-app/src/theme/index.ts` je GENEROVANÝ
    # soubor. Do PR #168 byl zacommitovaný s barvami forku, takže build vycházel
    # správně NÁHODOU. #168 ho přegeneroval na platformní (`#FF6A1A`) — a od té
    # chvíle by build s overlayem forku postavil appku v barvách AISHA, protože
    # tenhle skript identitu a ikonu z overlaye bere, ale TOKENY ne.
    #
    # A nekřičelo by to: build o barvách nic netvrdí, takže by se to poznalo
    # až v TestFlightu.
    #
    # Generátor bere značku z `instances/_overlay/brand.tokens.json` — týmž
    # kanálem, jakým ji dostává extranet (SURFACE_OVERLAY_GIT_URL). Materializace
    # patří sem, protože overlay má být „kompletní odpověď na otázku, co dělá
    # povrch instance-specific" — a barvy do té odpovědi patří.
    OV_TOKENS="$AISHA_INSTANCE_OVERLAY/brand.tokens.json"
    if [ ! -f "$OV_TOKENS" ]; then
        log_error "Overlay instance nemá brand.tokens.json: $OV_TOKENS"
        log_error "  Bez něj by se appka postavila v barvách PLATFORMY, ne instance."
        log_error "  Tiše pokračovat nelze: špatná značka se pozná až v obchodě."
        exit 1
    fi
    mkdir -p "$ROOT_DIR/instances/_overlay"
    cp "$OV_TOKENS" "$ROOT_DIR/instances/_overlay/brand.tokens.json"
    if ! (cd "$ROOT_DIR" && npm run gen:tokens >/dev/null 2>&1); then
        log_error "Přegenerování motivu z overlaye SELHALO — nestavím."
        # Adresně, ne rekurzivně — týž důvod jako u úklidu níž.
        rm -f "$ROOT_DIR/instances/_overlay/brand.tokens.json"
        rmdir "$ROOT_DIR/instances/_overlay" 2>/dev/null || true
        exit 1
    fi
    # ⛔ ODKLIDIT HNED, NE „někdy potom". Odkladiště je vstup pro `gen:tokens`
    # a po něm už ho nikdo nečte. Když zůstane ležet, chová se jako INSTANCE:
    # `split-rule` přepne do větve „tenant overlay" a začne hlásit literály,
    # které v repu byly celou dobu, a `check-i18n-parity` v něm hledá i18n.json.
    # Naměřeno 2026-09-03: po prvním instančním buildu nešlo repo COMMITNOUT,
    # a obě hlášky přitom ukazovaly úplně jinam než na příčinu.
    #
    # ⭐ ADRESNĚ, NE `rm -rf`. Mažeme JEN to, co jsme sami vyrobili — rekurzivní
    # smazání cesty v repu je operace, kterou brána `destructive-ops` právem
    # hlídá, a tady pro ni není důvod: víme přesně, co tam leží.
    rm -f "$ROOT_DIR/instances/_overlay/brand.tokens.json"
    rmdir "$ROOT_DIR/instances/_overlay" 2>/dev/null || true
    # Ověřit VÝSLEDEK, ne návratový kód: razítko musí ukazovat na overlay.
    RAZITKO=$(grep -m1 "@brand" "$PROJECT_DIR/src/theme/index.ts" 2>/dev/null || true)
    case "$RAZITKO" in
        *instances/_overlay/brand.tokens.json*)
            log_success "Barvy z overlaye instance: $(grep -m1 'primary:' "$PROJECT_DIR/src/theme/index.ts" | tr -d ' ')" ;;
        *)
            # Popisek se skládá VĚTVÍ, ne dosazením. `${RAZITKO:-žádné}` je
            # literál dosazený za prázdnou hodnotu — a to je přesně tvar, který
            # brána `zadny-fallback-nad-identitou` hledá, i v chybové hlášce.
            # (Zděděno z `build-ios.sh`; při vytažení do vlastního souboru to
            # račna spravedlivě označila za nový dluh.)
            if [ -n "$RAZITKO" ]; then POPIS_RAZITKA="$RAZITKO"; else POPIS_RAZITKA="žádné"; fi
            log_error "Motiv se nepřegeneroval z overlaye — razítko: $POPIS_RAZITKA"
            log_error "  Appka by nesla cizí barvy. Nestavím."
            exit 1 ;;
    esac
elif [ -f "$PROJECT_DIR/.env.build" ]; then
    set -a; source "$PROJECT_DIR/.env.build"; set +a
    log_success "Loaded .env.build"
fi

# ⭐ PŘEPOČET IDENTITY PATŘÍ SEM, ne do každého volajícího.
#
# `app-profile.sh` počítá `XCODE_NAME` a spol. ze SOUČASNÉHO `version.json` —
# jenže volající ho sourcují DŘÍV, než tenhle overlay `version.json` vymění.
# Po výměně jsou tedy zastaralé a ukazují na PLATFORMNÍ appku.
#
# ⛔ NAMĚŘENO 2026-09-06: `prepare-xcode-build.sh` vyrobil SPRÁVNÝ projekt
# `RIQidi.xcworkspace`, ale kontrola na konci hledala platformní jméno
# a skončila „Workspace not found after pod install" — nad workspace, který
# vedle ní ležel. `build-ios.sh` tu vadu neměl JEN proto, že si přepočet
# opisoval u sebe; třetí cesta ho neopsala.
#
# ⭐ Táž třída jako samotný overlay: co má platit pro všechny cesty k buildu,
# musí bydlet JEDNOU. Opisovaný krok se v třetí kopii zapomene.
#
# ⛔ NAMĚŘENO 2026-09-23: týž blok přepočítával jen VYJMENOVANÉ proměnné.
# 22. 9. přibyly do `app-profile.sh` nativní schopnosti (`AISHA_SKIP_*` z
# `brand.nativniSchopnosti`) — a do výčtu tady se nedopsaly. Build řidiče
# 1.1.0 (14) proto vyšel 89,6 MB místo ~50: `build-android.sh` načetl profil
# na ř. 27 z PLATFORMNÍHO `version.json`, spočítal „linkuj vše" a gradle to
# zdědil; správné vyhodnocení proběhlo až v podprocesu prebuildu a ztratilo se.
# Přesně ta „třetí kopie", před kterou varuje odstavec výš — jen v čase:
# nový odvozený údaj se nedopíše do starého opisu.
#
# ⭐ Proto se profil po výměně NAČTE ZNOVU, celý. Všechno, co `app-profile.sh`
# z `version.json` odvozuje — dnes i to, co v něm přibude — se přepočítá, bez
# výčtu, který by šlo zapomenout. Druhé načtení je bezpečné: profil jen
# přiřazuje proměnné s kontrolami (viz poznámka u prvního načtení výše).
# ⚠️ Hodnota, kterou si volající nastavil SÁM (`AISHA_SKIP_*=1`/`0`), vyhrává
# i tady — profil ji přebírá přes `${…:-…}`. Prázdná hodnota se bere jako
# nenastavená a odvodí se ze značky.
if [ -n "${AISHA_INSTANCE_OVERLAY:-}" ] && [ -f "$VERSION_FILE" ]; then
    . "$SCRIPT_DIR/app-profile.sh"
    XCODE_NAME=$(grep '"xcodeName"' "$VERSION_FILE" | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    APP_VERSION=$(grep '"version"' "$VERSION_FILE" | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    BUILD_NUMBER=$(grep '"build"' "$VERSION_FILE" | head -1 | sed 's/.*: \([0-9]*\).*/\1/')
    log_info "Identita přepočtena z overlaye: $XCODE_NAME $APP_VERSION ($BUILD_NUMBER)"
fi

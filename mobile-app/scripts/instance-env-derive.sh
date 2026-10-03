#!/bin/bash
# =============================================================================
# instance-env-derive.sh — odvození EXPO_PUBLIC_* z instančního nasazení
# =============================================================================
# JEDINÉ místo, kde se z `AISHA_INSTANCE_ENV` a z profilu appky odvozují veřejné
# hodnoty buildu. SOURCUJE se, nespouští:
#
#     . "$SCRIPT_DIR/instance-env-derive.sh"
#
# ⭐ PROČ SAMOSTATNĚ (2026-08-19). Tenhle blok žil uvnitř `build-ios.sh`, takže
# `prepare-xcode-build.sh` — cesta „připrav projekt a archivuj z Xcode" — ho
# NEMĚL vůbec (`grep AISHA_INSTANCE_ENV` v něm vracel nulu). Vyrobil by projekt
# bez adresy brány, bez realmu a bez redirect URI, a poznalo by se to teprve
# přihlášením z TestFlightu. Zkopírovat ten blok by znamenalo dvě pravdy
# o tomtéž odvození — rozešly by se při první změně a nikdo by si toho nevšiml.
#
# ⭐ NAVRŽENO PRO N APPEK, NE PRO JEDNU. Všechno instanční jde z `VERSION_FILE`
# (profil, který dosazuje `AISHA_APP_VERSION_FILE`): schéma deep linku, OIDC
# klient, jméno. Nová dedikovaná appka je tedy DALŠÍ PROFIL, ne další větev tady.
# `<fork>-ridic`, `<fork>-meraky` i cokoli příštího projde beze změny tohoto souboru.
#
# ⚠️ VOLITELNÉ. Bez `AISHA_INSTANCE_ENV` se neděje nic a build jede na
# explicitních hodnotách (.env / prostředí). Odvození jen DOPLŇUJE nevyplněné:
# každý řádek používá `: "${VAR:=…}"`, takže explicitní hodnota vždy vyhrává.
#
# Vyžaduje: VERSION_FILE (cesta k profilu appky) a log_error/log_info od volajícího.
# =============================================================================

# Volající nemusí mít logovací funkce (prepare-xcode-build.sh je má, jiný nemusí).
command -v log_error >/dev/null 2>&1 || log_error() { echo "[error] $1" >&2; }
command -v log_info  >/dev/null 2>&1 || log_info()  { echo "[info]  $1"; }
command -v log_success >/dev/null 2>&1 || log_success() { echo "[ok]    $1"; }
command -v log_warning >/dev/null 2>&1 || log_warning() { echo "[warn]  $1"; }

if [ -n "${AISHA_INSTANCE_ENV:-}" ]; then
    if [ ! -f "$AISHA_INSTANCE_ENV" ]; then
        log_error "AISHA_INSTANCE_ENV set but not a file: $AISHA_INSTANCE_ENV"
        exit 1
    fi
    ienv() { grep -E "^$1=" "$AISHA_INSTANCE_ENV" | head -1 | cut -d= -f2- | tr -d '"'; }
    IE_TLD=$(ienv PUBLIC_TLD);          [ -n "$IE_TLD" ]   && : "${EXPO_PUBLIC_PUBLIC_TLD:=$IE_TLD}"
    IE_API=$(ienv API_DOMAIN_PUBLIC);   [ -n "$IE_API" ]   && : "${EXPO_PUBLIC_AISHA_GATEWAY_URL:=https://$IE_API}"
    IE_ANON=$(ienv ANON_KEY);           [ -n "$IE_ANON" ]  && : "${EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY:=$IE_ANON}"
    IE_REALM=$(ienv KEYCLOAK_REALM);    [ -n "$IE_REALM" ] && : "${EXPO_PUBLIC_KC_REALM:=$IE_REALM}"

    # ── Zbytek instančních adres ─────────────────────────────────────────
    # ⛔ NAMĚŘENO 2026-08-19 bránou `mobilni-konfigurace-musi-mit-producenta`:
    # tyhle klíče nemají v repu producenta. Fungovaly jen proto, že je člověk
    # ručně vypsal do NETRACKOVANÉHO `mobile-app/.env` — build na čistém stroji
    # nebo v CI je nedostane. Odvozují se proto ze SoT instance; explicitní
    # hodnota (prostředí / .env) dál vyhrává, protože `:=` dosazuje jen prázdné.
    IE_APP=$(ienv APP_DOMAIN);          [ -n "$IE_APP" ]   && : "${EXPO_PUBLIC_APP_URL:=https://$IE_APP}"
    [ -n "$IE_APP" ]  && : "${EXPO_PUBLIC_WEB_URL:=https://$IE_APP}"
    [ -n "$IE_API" ]  && : "${EXPO_PUBLIC_AISHA_POSTGREST_URL:=https://$IE_API}"
    [ -n "$IE_ANON" ] && : "${EXPO_PUBLIC_AISHA_POSTGREST_ANON_KEY:=$IE_ANON}"
    IE_AUTH=$(ienv AUTH_DOMAIN_PUBLIC)
    [ -n "$IE_AUTH" ] && [ -n "$IE_REALM" ] && : "${EXPO_PUBLIC_KC_AUTHORITY:=https://${IE_AUTH}/realms/${IE_REALM}}"
    # ⛔ NAMĚŘENO 2026-08-20: tady stálo `ienv LIVEKIT_DOMAIN` a appka se stavěla
    # s `wss://livekit.backend.<INTERNAL_TLD>` — jméno, které telefon nerozloží.
    # `config/domains.env` u `LIVEKIT_DOMAIN` self-healuje právě na vnitřní tvář
    # („když operátor nevyplní"), což je pro služby UVNITŘ meshe správně. Telefon
    # je ale VENKU. Týž vstup byl pro jednoho konzumenta správný a pro druhého
    # nedosažitelný a nikdo ten rozdíl neměřil; projevilo by se to až v terénu
    # hláškou „cannot join the call room".
    #
    # Bere se proto VEŘEJNÁ tvář, podle konvence `_PUBLIC` (jako API_DOMAIN_PUBLIC
    # / KEYCLOAK_DOMAIN_PUBLIC). Ta self-heal NEMÁ — mlčení znamená „tahle
    # instance LiveKit nepublikuje", ne „nějakou si vymysli".
    IE_LIVEKIT=$(ienv LIVEKIT_DOMAIN_PUBLIC); [ -n "$IE_LIVEKIT" ] && : "${EXPO_PUBLIC_LIVEKIT_URL:=wss://$IE_LIVEKIT}"
    if [ -z "${EXPO_PUBLIC_LIVEKIT_URL:-}" ]; then
        log_warning "LiveKit: instance nepublikuje veřejnou tvář (LIVEKIT_DOMAIN_PUBLIC je prázdné)."
        log_warning "  Build vznikne, ale hovory v něm NEPŮJDOU — appka to řekne rovnou,"
        log_warning "  místo aby vytáčela nedosažitelné jméno."
        log_warning "  CO S TÍM: dej LiveKitu veřejnou tvář a route na edge, pak nastav"
        log_warning "  LIVEKIT_DOMAIN_PUBLIC. NEDĚLEJ: nedosazuj sem LIVEKIT_DOMAIN — to je"
        log_warning "  vnitřní jméno meshe a telefon je venku."
    fi
    export EXPO_PUBLIC_APP_URL EXPO_PUBLIC_WEB_URL EXPO_PUBLIC_AISHA_POSTGREST_URL \
           EXPO_PUBLIC_AISHA_POSTGREST_ANON_KEY EXPO_PUBLIC_KC_AUTHORITY EXPO_PUBLIC_LIVEKIT_URL

    # ── Dveře (SPA knock) ────────────────────────────────────────────────
    # ⛔ NAMĚŘENO 2026-08-19: build 13 odešel do TestFlightu BEZ těchto hodnot.
    # `mobile-app/src/config/knock.ts` je zásadně nedosazuje (uhodnutý `kid` je
    # sůl odvození klíče → server odmítne na `unknown-kid` a mlčí), takže
    # `maDvere()` vrátilo false a appka nabídku klepání vůbec nezobrazila.
    # Jediný producent je `scripts/knock-provision.mjs`, který týmiž hodnotami
    # zakládá i roster na serveru; shoda `kid`/`scope` proto plyne Z KONSTRUKCE.
    IE_KNOCK_HOST=$(ienv SPA_KNOCK_PUBLIC_HOST);   [ -n "$IE_KNOCK_HOST" ]  && : "${EXPO_PUBLIC_KNOCK_HOST:=$IE_KNOCK_HOST}"
    IE_KNOCK_PORT=$(ienv SPA_KNOCK_PUBLIC_PORT);   [ -n "$IE_KNOCK_PORT" ]  && : "${EXPO_PUBLIC_KNOCK_PORT:=$IE_KNOCK_PORT}"
    # ⛔ `kid`/`scope` se tu jen ČTOU pro KONTROLU, NEPŘIŘAZUJÍ se. Přiřazuje je
    #    blok „DVEŘE (SPA)" níž z `brand.slug` / `brand.knock.scope`, protože jsou
    #    to PROFIL APPKY, ne instance.
    #    NAMĚŘENO 2026-09-21: stálo tu `: "${EXPO_PUBLIC_KNOCK_KID:=…}"`, a protože
    #    `:=` přiřadí jen do PRÁZDNA, vyhrálo PRVNÍ přiřazení — brandový blok se ke
    #    slovu nedostal a appka se u vrátného hlásila `ops-<instance>` místo svým
    #    slugem. Nešlo o pád: dveře otevíraly, jen komu jinému.
    #    Obě místa byla napsaná správně; vadné bylo jen jejich POŘADÍ.
    IE_INSTANCE_KID=$(ienv SPA_KNOCK_MOBILE_KID)
    IE_INSTANCE_SCOPE=$(ienv SPA_KNOCK_MOBILE_SCOPE)
    export EXPO_PUBLIC_KNOCK_HOST EXPO_PUBLIC_KNOCK_PORT EXPO_PUBLIC_KNOCK_KID EXPO_PUBLIC_KNOCK_SCOPE
    # Brand-derived OAuth wiring: redirect follows the registered deep-link
    # scheme (they MUST match or the browser cannot reopen the app after
    # login), the OIDC client id is brand data (dedicated builds set
    # brand.oauthClientId; unset → oidc.ts default aisha-app = umbrella).
    IE_SCHEME=$(node -e "process.stdout.write(((require('$VERSION_FILE').brand||{}).scheme)||'')" 2>/dev/null)
    IE_OAUTH_CLIENT=$(node -e "process.stdout.write(((require('$VERSION_FILE').brand||{}).oauthClientId)||'')" 2>/dev/null)
    [ -n "$IE_SCHEME" ] && : "${EXPO_PUBLIC_REDIRECT_URL:=${IE_SCHEME}://oauth-callback}"
    [ -n "$IE_OAUTH_CLIENT" ] && : "${EXPO_PUBLIC_KC_CLIENT_ID:=$IE_OAUTH_CLIENT}"

    # ── DVEŘE (SPA) ────────────────────────────────────────────────────────
    #
    # ⛔ ŽÁDNÁ HODNOTA SE NEVYMÝŠLÍ. Dveře mlčí i při úspěchu, takže zaťukání na
    # uhodnutou adresu, port nebo `kid` vypadá úplně stejně jako zaťukání
    # správné: nijak. Chybí-li kterákoli ze čtyř, appka NEŤUKÁ a řekne, co jí
    # schází (`config/knock.ts`). Proto se tu jen ČTE, co instance a profil
    # appky DEKLARUJÍ.
    #
    # ⭐ HOST: přednost má výslovná deklarace; teprve když chybí, odvodí se
    # z veřejné domény instance (`PUBLIC_TLD`). Že to odvození DRŽÍ, je změřeno,
    # ne odhadnuto: 2026-08-20 zaťukání z vývojářského stroje na PUBLIC_TLD
    # a `SPA_KNOCK_PUBLIC_PORT` skončilo v logu `svc-knock` jako
    # `{"ev":"drop","reason":"unknown-kid"}` — paket tedy DOLETĚL a neznámý kid
    # správně spadl. UDP jde napřímo, HAProxy se obchází.
    #
    # ⛔ Konkrétní doména instance sem NEPATŘÍ (a brána `legacy-domains` ji
    # nepustí): tenhle strom je platforma, ne zákazník. Naměřené hodnoty jsou
    # v `docs/dvere-flow-2026-08-20.md`.
    #
    # ⚠️ Která cesta se použila, se VYSLOVÍ. Tiché odvození by u dveří byla ta
    # nejhorší vlastnost: nikdo by nepoznal rozdíl mezi „ťukám jinam" a
    # „ťukám správně a je zavřeno".
    IE_KNOCK_HOST=$(ienv KNOCK_HOST_PUBLIC)
    if [ -n "$IE_KNOCK_HOST" ]; then
        : "${EXPO_PUBLIC_KNOCK_HOST:=$IE_KNOCK_HOST}"
        log_info "dveře: host z KNOCK_HOST_PUBLIC"
    elif [ -n "$IE_TLD" ]; then
        : "${EXPO_PUBLIC_KNOCK_HOST:=$IE_TLD}"
        log_info "dveře: host ODVOZEN z PUBLIC_TLD ($IE_TLD) — instance s dveřmi jinde ať deklaruje KNOCK_HOST_PUBLIC"
    fi

    IE_KNOCK_PORT=$(ienv SPA_KNOCK_PUBLIC_PORT)
    [ -n "$IE_KNOCK_PORT" ] && : "${EXPO_PUBLIC_KNOCK_PORT:=$IE_KNOCK_PORT}"

    # `kid` a `scope` jsou PROFIL APPKY, ne instance: ať je z logu dveří poznat,
    # KDO ťukal. Nová dedikovaná appka je další profil, ne další větev tady.
    #
    # ⭐ `kid` SE ODVOZUJE ZE `slug`, NEDEKLARUJE SE (majitel, 2026-09-10:
    # „proč ne app id také automaticky?"). `kid` JE identita appky u dveří —
    # a tu overlay už nese jako `brand.slug`. Vlastní `brand.knock.kid` by byl
    # DRUHÝ DOMOV téhož faktu: naměřeno na `<fork>-ridic`, kde jsem vedle slugu
    # vymyslel `ridic-<fork>`, tedy totéž jméno pozpátku. Dvě jména jedné věci se
    # rozejdou a projeví se to jako `unknown-kid`, tedy MLČENÍM.
    #
    # ⛔ `scope` se NEODVOZUJE a je to rozdíl podstaty: neříká, KDO appka je,
    # ale CO SMÍ — a to je vlastnost instance, ne sestavení. Zůstává deklarovaný.
    IE_KNOCK_KID=$(node -e "
      const b = (require('$VERSION_FILE').brand || {});
      // Výslovný \`knock.kid\` má přednost kvůli instancím, které ho už mají
      // v rosteru pod jiným jménem; nové appky ho psát NEMUSÍ.
      process.stdout.write((b.knock || {}).kid || b.slug || '');
    " 2>/dev/null)
    IE_KNOCK_SCOPE=$(node -e "process.stdout.write(((require('$VERSION_FILE').brand||{}).knock||{}).scope||'')" 2>/dev/null)
    [ -n "$IE_KNOCK_KID" ] && : "${EXPO_PUBLIC_KNOCK_KID:=$IE_KNOCK_KID}"
    [ -n "$IE_KNOCK_SCOPE" ] && : "${EXPO_PUBLIC_KNOCK_SCOPE:=$IE_KNOCK_SCOPE}"
    # ⛔ KONTROLA ÚPLNOSTI AŽ TADY. Host a port dává instance, `kid` a `scope`
    #    profil appky — kontrola u instančního bloku by měřila POLOTOVAR a
    #    fail-closed by odmítl build, kterému nic nechybí (naměřeno při přesunu).
    #
    # ⛔ A SHODA S ROSTEREM: `kid` je sůl odvození klíče, takže se musí shodovat
    #    s tím, co do rosteru zapsal `knock-provision.mjs --app <slug>` — týž
    #    `brand.slug`. Rozejdou-li se, telefon vyrobí jiné klíče, než server čeká,
    #    a zaťukání padne na `unknown-kid`, tedy MLČENÍM.
    if [ -n "$IE_INSTANCE_KID" ] && [ -n "$EXPO_PUBLIC_KNOCK_KID" ] \
       && [ "$IE_INSTANCE_KID" != "$EXPO_PUBLIC_KNOCK_KID" ]; then
        log_warning "dveře: instance nese kid '$IE_INSTANCE_KID', appka staví s '$EXPO_PUBLIC_KNOCK_KID'"
        log_warning "  Roster musí mít OBA, jinak jeden z nich klepe do ticha."
        log_warning "  Doplň: node scripts/knock-provision.mjs --app <slug> --merge"
    fi
    # Dveře jsou volitelné (instance bez `knock` profilu je nemá), ale ČÁSTEČNÁ
    # sada je vždy vada: appka by nabídku skryla a nikdo by se nedozvěděl proč.
    # ⛔ O EXISTENCI DVEŘÍ rozhodují DEKLAROVANÉ hodnoty, ne odvozený host.
    #    `EXPO_PUBLIC_KNOCK_HOST` se umí odvodit z `PUBLIC_TLD`, takže instance BEZ
    #    dveří ho stejně dostane — a kdyby se počítal do „něco tu je", vypadala by
    #    každá taková instance jako částečná sada a build by se odmítl.
    #    NAMĚŘENO 2026-09-21 při přesunu téhle kontroly za brandový blok: pět bran
    #    najednou zčervenalo na instancích, které dveře vůbec nedeklarují.
    # ⛔ O EXISTENCI DVEŘÍ rozhoduje PORT — jediná hodnota, která se NIKDY
    #    neodvozuje. Host se umí odvodit z `PUBLIC_TLD` a `kid` ze `slug` (ten má
    #    KAŽDÁ appka), takže obojí je nastavené i u instance, která dveře nemá.
    #    Port je ruční deklarace operátora (viz knock-provision: „na sdíleném
    #    serveru má každá instance jiný a forward nastavuje člověk"), takže jeho
    #    přítomnost JE ta deklarace.
    #    NAMĚŘENO 2026-09-21 při přesunu téhle kontroly za brandový blok: pět bran
    #    zčervenalo na instancích, které dveře vůbec nedeklarují.
    __knock_ma=0; __knock_chybi=""
    [ -n "${EXPO_PUBLIC_KNOCK_PORT:-}" ] && __knock_ma=1
    if [ "$__knock_ma" = "1" ]; then
        for __k in EXPO_PUBLIC_KNOCK_HOST EXPO_PUBLIC_KNOCK_PORT EXPO_PUBLIC_KNOCK_KID EXPO_PUBLIC_KNOCK_SCOPE; do
            [ -z "$(eval "printf '%s' \"\${$__k:-}\"")" ] && __knock_chybi="${__knock_chybi}$__k "
        done
    fi
    if [ "$__knock_ma" = "1" ] && [ -n "$__knock_chybi" ]; then
        log_error "Dveře: část hodnot chybí — ${__knock_chybi}"
        log_error "  Appka by nabídku klepání SKRYLA a důvod by se nikde neobjevil."
        exit 1
    fi
    export EXPO_PUBLIC_PUBLIC_TLD EXPO_PUBLIC_AISHA_GATEWAY_URL EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY \
           EXPO_PUBLIC_KC_REALM EXPO_PUBLIC_REDIRECT_URL EXPO_PUBLIC_KC_CLIENT_ID \
           EXPO_PUBLIC_KNOCK_HOST EXPO_PUBLIC_KNOCK_PORT EXPO_PUBLIC_KNOCK_KID EXPO_PUBLIC_KNOCK_SCOPE
    # ⭐ FAIL-CLOSED: build, ktery nevi, ci identitu stavi, NESMI stavet nic.
    #
    # Drive se sem napsalo `client=aisha-app (default)` a pokracovalo se dal.
    # Tichy rozumny default je horsi nez chybejici vstup: nevynuti si pozornost.
    # Namereno 2026-08-07 DVAKRAT po sobe — skript zacal stavet AISHA Dirigent
    # 1.0.0(12) misto instancni verze 1.0.11(13) a zachytilo to jen to, ze jsem
    # cetl prvnich dvanact radku logu. Tataz trida uz jednou poslala do
    # TestFlightu tri buildy s platformni ikonou.
    if [ -z "${EXPO_PUBLIC_KC_CLIENT_ID:-}" ]; then
        log_error "IDENTITA BUILDU NENI DEKLAROVANA — odmitam stavet."
        log_error ""
        log_error "  version.json ($VERSION_FILE) nema brand.oauthClientId a"
        log_error "  EXPO_PUBLIC_KC_CLIENT_ID neni v prostredi. Build by se prihlasoval"
        log_error "  jako platformni klient 'aisha-app' misto klienta instance."
        log_error ""
        log_error "CO S TIM:"
        log_error "  1) instancni build — podstrc brand overlay a znovu spust:"
        log_error "       cp <instance-data>/brand/<instance>.version.json mobile-app/version.json"
        log_error "  2) platformni build — deklaruj to VYSLOVNE:"
        log_error "       EXPO_PUBLIC_KC_CLIENT_ID=aisha-app bash scripts/build-ios.sh"
        exit 1
    fi
    # ── Vnitřní jméno se do telefonu NESMÍ dostat ────────────────────────
    #
    # Obecná pojistka nad VŠEMI odvozenými `EXPO_PUBLIC_*`, ne jen nad LiveKitem.
    # LiveKit byl jen ten, kdo to prozradil: appka odešla s adresou v mesh zóně,
    # kterou telefon nerozloží, a poznalo by se to až v terénu.
    #
    # Univerzum se HLEDÁ v prostředí (`compgen -v EXPO_PUBLIC_`), nevypisuje se —
    # jinak pojistka zdědí díry seznamu a příští klíč proklouzne.
    #
    # Rozhoduje HOSTITEL, ne celý řetězec: `https://api.<TLD>/x?y=z.internal`
    # je v pořádku, `wss://livekit.backend.<INTERNAL_TLD>` není.
    IE_INTERNAL_TLD=$(ienv INTERNAL_TLD)
    __vnitrni_ven=""
    for __k in $(compgen -v EXPO_PUBLIC_ 2>/dev/null); do
        __v=$(eval "printf '%s' \"\${$__k:-}\"")
        case "$__v" in *://*) ;; *) continue ;; esac
        __host=${__v#*://}; __host=${__host%%/*}; __host=${__host%%\?*}; __host=${__host%%:*}
        __je_vnitrni=0
        case "$__host" in *.internal) __je_vnitrni=1 ;; esac
        if [ "$__je_vnitrni" = "0" ] && [ -n "$IE_INTERNAL_TLD" ]; then
            case "$__host" in
                *".$IE_INTERNAL_TLD"|"$IE_INTERNAL_TLD") __je_vnitrni=1 ;;
            esac
        fi
        [ "$__je_vnitrni" = "1" ] && __vnitrni_ven="${__vnitrni_ven}      $__k = $__v
"
    done
    if [ -n "$__vnitrni_ven" ]; then
        log_error "VNITŘNÍ ADRESA V BUILDU APPKY — odmítám stavět."
        log_error ""
        log_error "  Tyhle hodnoty míří do mesh zóny, kterou telefon NEROZLOŽÍ:"
        printf '%s' "$__vnitrni_ven" >&2
        log_error ""
        log_error "  Mesh je jediná cesta dovnitř a vnitřní jména se ven nepublikují."
        log_error "  Appka běží VENKU, takže smí dostat jen veřejnou tvář."
        log_error ""
        log_error "CO S TÍM:"
        log_error "  1) dej té službě veřejnou tvář a route na edge, pak ji odvozuj"
        log_error "     z klíče s příponou _PUBLIC (API_DOMAIN_PUBLIC, KEYCLOAK_DOMAIN_PUBLIC…),"
        log_error "  2) nebo ten klíč neodvozuj vůbec — appka pak řekne rovnou, že"
        log_error "     funkce není nastavená, místo aby vytáčela nedosažitelné jméno."
        log_error "NEDĚLEJ: nepřidávej sem výjimku a nepřepínej appku na vnitřní jméno"
        log_error "  proto, že je zevnitř dosažitelné — opravuje se ZDROJ, ne cesta."
        exit 1
    fi

    log_success "Instance env derived: TLD=${EXPO_PUBLIC_PUBLIC_TLD:-?} gateway=${EXPO_PUBLIC_AISHA_GATEWAY_URL:-?} client=${EXPO_PUBLIC_KC_CLIENT_ID}"
fi

# ── Most ze staršího jména ────────────────────────────────────────────────────
# `app.config.ts` čte `EXPO_PUBLIC_AISHA_GATEWAY_URL`; starší .env soubory nesou
# `..._POSTGREST_URL`. Most bydlí TADY, a ne v jednom ze skriptů, aby se cesta
# „archivuj z Xcode" nechovala jinak než „build-ios.sh" — rozdíl mezi nimi by se
# projevil jako appka, která se v jednom případě připojí a v druhém ne.
: "${EXPO_PUBLIC_AISHA_GATEWAY_URL:=${EXPO_PUBLIC_AISHA_POSTGREST_URL:-}}"
: "${EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY:=${EXPO_PUBLIC_AISHA_POSTGREST_ANON_KEY:-}}"
export EXPO_PUBLIC_AISHA_GATEWAY_URL EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY

# =============================================================================
# NEVEŘEJNÉ hodnoty buildu — podpis, SDK, distribuce
# =============================================================================
# ⛔ TYHLE SE NESMÍ JMENOVAT `EXPO_PUBLIC_*`. Cokoli s tou předponou Expo zapeče
# do balíku aplikace, kde si to přečte kdokoli. Podpisový tým ani cesta k SDK do
# appky nepatří — potřebují je jen build skripty.
#
# ⭐ PROČ TADY (2026-09-07). Tenhle soubor už sourcují VŠECHNY tři cesty
# k buildu (`prepare-xcode-build.sh`, `build-ios.sh`, `build-android.sh`), takže
# je to jediné místo, kde spojka vznikne jednou pro všechny. Bez toho se to
# řešilo ad hoc u každé zvlášť — a projevilo se to takhle:
#
#   APPLE_TEAM_ID  v `.env.coolify` BYL, `post-prebuild.sh` ho ČEKAL, ale
#                  derive exportoval jen `EXPO_PUBLIC_*`, takže nedorazil.
#                  Archiv spadl na `Signing requires a development team`.
#   ANDROID_HOME   SDK nainstalované, Gradle hlásil `SDK location not found`.
#
# Obojí vypadalo jako CHYBĚJÍCÍ konfigurace, ačkoli hodnota existovala —
# nedoručila se. Přes Xcode GUI a z vývojářského shellu spojka nechyběla nikomu,
# kdo skripty pouštěl ručně, takže vada žila jen na cestě, kterou nikdo nedošel.

# Čte se `grep|cut`, ne `source`: sourcování env souboru tiše ztrácí hodnoty
# s mezerami i s komentářem na řádku a chybu ohlásí až daleko od příčiny.
__z_env() {
  [ -n "${AISHA_INSTANCE_ENV:-}" ] && [ -f "$AISHA_INSTANCE_ENV" ] || return 0
  grep -m1 "^$1=" "$AISHA_INSTANCE_ENV" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'\r'
}

for __k in APPLE_TEAM_ID FIREBASE_ANDROID_APP_ID FIREBASE_TESTER_GROUPS; do
  # Prostředí má přednost — kdo si hodnotu nastaví sám, má na to právo.
  if [ -z "$(eval "printf '%s' \"\${$__k:-}\"")" ]; then
    __v="$(__z_env "$__k")"
    if [ -n "$__v" ]; then eval "$__k=\"\$__v\""; export "$__k"; fi
  fi
done
unset __k __v

# ANDROID_HOME je vlastnost STROJE, ne instance — proto se smí i najít.
# Pořadí: prostředí → instanční env → obvyklé umístění. Fail-loud se nechává na
# Gradlu, který má vlastní srozumitelnou hlášku; tady jen doplníme, co jde.
if [ -z "${ANDROID_HOME:-}" ]; then
  ANDROID_HOME="$(__z_env ANDROID_HOME)"
  if [ -z "$ANDROID_HOME" ] && [ -d "$HOME/Library/Android/sdk" ]; then ANDROID_HOME="$HOME/Library/Android/sdk"; fi
  if [ -n "$ANDROID_HOME" ]; then export ANDROID_HOME; fi
fi
if [ -n "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then export ANDROID_SDK_ROOT="$ANDROID_HOME"; fi

# ⛔ BEZ TOKENU SE UPLOAD VYPÍNÁ, JINAK BUILD SPADNE NA KONCI.
# `sentry.gradle` čte `System.getenv('SENTRY_DISABLE_AUTO_UPLOAD')` — tedy
# PROMĚNNOU PROSTŘEDÍ, ne soubor. Bez tokenu úloha
# `createBundleReleaseJsAndAssets_SentryUpload_*` spadne na
# `Auth token is required` až po patnácti minutách překladu.
#
# Plugin `withSentryAuth` tohle řeší pro iOS (`configureIOSWithoutToken`
# zapíše vlajku do `.xcode.env.local`), ale pro Android jen VYPÍŠE VAROVÁNÍ
# a vrátí config — upload nechá zapnutý. Naměřeno 2026-09-07: iOS archiv
# prošel, androidí build spadl na témž chybějícím tokenu.
#
# Symbolizace se tím ztrácí, a to je skutečná ztráta — proto se to hlásí
# nahlas. Ale shodit hotový build kvůli nahrávání map je horší.
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  SENTRY_AUTH_TOKEN="$(__z_env SENTRY_AUTH_TOKEN)"
  if [ -n "$SENTRY_AUTH_TOKEN" ]; then export SENTRY_AUTH_TOKEN; fi
fi
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true
  echo "[instance-env] SENTRY_AUTH_TOKEN prázdný → upload map VYPNUT (pády nebudou symbolizované)" >&2
fi

# Sourcovaný soubor NESMÍ skončit nenulovým kódem — pod `set -e` by shodil
# volajícího. (Naměřeno 2026-09-07: `[ -n "$X" ] && export X` s prázdným X
# vrátí 1 a derive tiše ukončil celý build skript.)
:

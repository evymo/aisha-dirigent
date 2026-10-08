#!/usr/bin/env bash
# registr-prihlaseni.sh — přihlášení CI k registru balíčků: token tam, kde ho npm
# ČTE, předaný dalším krokům, a důkaz, že přihlášení funguje.
#
# ⛔ NAMĚŘENO 2026-10-04: vydávání balíčků v CI končilo E401 i u balíčku, který se
# sestavil (doloženo logy od 2026-06-11). Tři vrstvy téže vady:
#   1. Token se zapisoval ručně do ~/.npmrc. Akce setup-node s `registry-url` ale
#      npm přesměruje proměnnou NPM_CONFIG_USERCONFIG na vlastní soubor — a npm čte
#      právě JEDEN uživatelský soubor. Změřeno: s přesměrováním npm platné
#      přihlášení v ~/.npmrc nevidí.
#   2. Čerstvě vyražený token zůstal uvnitř kroku; krok vydání dostal statický
#      secret, který mezitím vypršel (registr podepisuje tokeny na 30 dní).
#   3. Nic neověřilo, že přihlášení funguje — pád přišel až u `npm publish`, po
#      minutách instalace, a vypadal stejně jako vypršelý token.
#
# Proto: do souboru, který npm čte (zápis přes `npm config set --location=user`
# ctí NPM_CONFIG_USERCONFIG), jde jen ODKAZ `_authToken=${NODE_AUTH_TOKEN}` —
# tak ho po sobě nechává i setup-node. Token sám jde dalším krokům jen prostředím
# přes $GITHUB_ENV (maskovaný): není na disku ani v argumentech, které jsou vidět
# ve výpisu procesů. `over` hned změří `npm whoami`. Vypršelý statický token se
# ohlásí TADY, s datem, ne až při vydání.
#
# ⛔ „Tento repozitář nevydává“ platí JEN když není nastavený žádný údaj. Jsou-li
# údaje nastavené a token se nezískal (změněné heslo, nedostupný registr, jen půlka
# údajů), je to PÁD: zelený běh bez vydání je přesně ten tichý zastaralý registr,
# který workflow zavírá (nedůvěřivé čtení, 2026-10-04).
#
# Kroky workflow:
#   bash scripts/ci/registr-prihlaseni.sh nastav   # ražení nebo záloha, zápis, výstup publish=true|false
#   bash scripts/ci/registr-prihlaseni.sh over     # npm whoami proti registru; nenulový kód = pád
#
# Prostředí: VERDACCIO_URL (povinné), VERDACCIO_USER + VERDACCIO_PASSWORD (ražení),
#   VERDACCIO_TOKEN (statická záloha), GITHUB_OUTPUT, GITHUB_ENV.
# Kódy: 0 ok (i „tento repozitář nevydává“) · 1 přihlášení nejde nastavit nebo
#   nefunguje · 2 špatné použití.
set -euo pipefail

# Soubor, který npm jako uživatelskou konfiguraci opravdu čte (`npm config get
# userconfig` je chráněná volba a cestu nevydá).
soubor_npm() { printf '%s' "${NPM_CONFIG_USERCONFIG:-${HOME}/.npmrc}"; }

# Klíč, pod kterým npm hledá token registru: adresa bez schématu, s lomítkem na konci.
klic_registru() {
  local bez_schematu="${1#*://}"
  printf '//%s/' "${bez_schematu%/}"
}

# Konec platnosti tokenu (pole `exp` v JWT) jako epocha; prázdné = nejde zjistit.
# Token jde prostředím, ne argumentem — argumenty jsou vidět ve výpisu procesů.
konec_platnosti() {
  TOKEN_KE_CTENI="$1" node -e '
    const cast = (process.env.TOKEN_KE_CTENI || "").split(".")[1] || "";
    try {
      const exp = JSON.parse(Buffer.from(cast, "base64url").toString("utf8")).exp;
      if (Number.isFinite(exp)) process.stdout.write(String(Math.floor(exp)));
    } catch {}
  '
}

datum() { node -e 'process.stdout.write(new Date(Number(process.argv[1]) * 1000).toISOString().slice(0, 16) + "Z")' "$1"; }

# Token je jeden řádek z bezpečné abecedy. Cokoli jiného (víc řádků, mezery) by
# do $GITHUB_ENV zapsalo víc proměnných a maska by kryla jen první řádek.
ma_tvar_tokenu() {
  case "$1" in
    "" | *[!A-Za-z0-9._~+/=-]*) return 1 ;;
  esac
  return 0
}

# Statický token musí platit ještě po dobu úlohy; kratší zbytek je totéž co vypršelý.
REZERVA_PLATNOSTI_S=3600

nastav() {
  if [ -z "${VERDACCIO_URL:-}" ]; then
    echo "::error title=registr::VERDACCIO_URL není nastavená — adresu registru nese proměnná Actions na úrovni organizace (vars.VERDACCIO_URL)"
    exit 1
  fi

  local udaje=ne
  if [ -n "${VERDACCIO_USER:-}" ] || [ -n "${VERDACCIO_PASSWORD:-}" ] || [ -n "${VERDACCIO_TOKEN:-}" ]; then
    udaje=ano
  fi

  local token="" zdroj=""
  if [ -n "${VERDACCIO_USER:-}" ] && [ -n "${VERDACCIO_PASSWORD:-}" ]; then
    # stderr se NEZAHAZUJE: kód přihlášení a odpověď registru jsou jediná stopa,
    # proč ražení selhalo. Skript heslo nevypisuje; token jde jen na stdout.
    if token="$(node scripts/verdaccio-mint-token.mjs --check)" && [ -n "$token" ]; then
      if ! ma_tvar_tokenu "$token"; then
        echo "::error title=registr::ražení vrátilo něco, co nemá tvar tokenu (víc řádků nebo nepovolené znaky) — nezapisuji to"
        exit 1
      fi
      zdroj="čerstvě vyražený pro účet ${VERDACCIO_USER}"
    else
      token=""
      echo "::warning title=registr::ražení čerstvého tokenu selhalo (důvod je o řádek výš) — zkouším statický VERDACCIO_TOKEN"
    fi
  elif [ -n "${VERDACCIO_USER:-}" ] || [ -n "${VERDACCIO_PASSWORD:-}" ]; then
    echo "::warning title=registr::z dvojice VERDACCIO_USER / VERDACCIO_PASSWORD je nastavená jen půlka — token se razit nedá, zkouším statický VERDACCIO_TOKEN"
  fi

  if [ -z "$token" ] && [ -n "${VERDACCIO_TOKEN:-}" ]; then
    if ! ma_tvar_tokenu "$VERDACCIO_TOKEN"; then
      echo "::error title=registr::statický VERDACCIO_TOKEN nemá tvar tokenu (víc řádků nebo nepovolené znaky) — nezapisuji ho"
      exit 1
    fi
    token="$VERDACCIO_TOKEN"
    local exp ted
    exp="$(konec_platnosti "$token")"
    ted="$(date +%s)"
    if [ -z "$exp" ]; then
      zdroj="statický secret (konec platnosti nejde z tokenu zjistit)"
    elif [ "$exp" -le "$ted" ]; then
      echo "::error title=registr::statický VERDACCIO_TOKEN vypršel $(datum "$exp") a čerstvý se nevyrazil — nastav VERDACCIO_USER a VERDACCIO_PASSWORD (token se pak razí při každém běhu), nebo statický token vyměň"
      exit 1
    elif [ "$exp" -le "$((ted + REZERVA_PLATNOSTI_S))" ]; then
      echo "::error title=registr::statický VERDACCIO_TOKEN vyprší $(datum "$exp"), dřív než by vydání bezpečně doběhlo, a čerstvý se nevyrazil — nastav VERDACCIO_USER a VERDACCIO_PASSWORD, nebo statický token vyměň"
      exit 1
    else
      zdroj="statický secret, platí do $(datum "$exp")"
    fi
  fi

  if [ -z "$token" ]; then
    if [ "$udaje" = ano ]; then
      echo "::error title=registr::údaje k registru jsou nastavené, ale token se nezískal (ražení selhalo nebo jsou údaje neúplné, záloha není) — tento repozitář VYDÁVAT MÁ a nemůže; zelený běh bez vydání by znamenal tichý zastaralý registr"
      exit 1
    fi
    # Žádný údaj = TENTO REPOZITÁŘ NEVYDÁVÁ, což je běžný stav forku: sdílený
    # registr plní upstream. Přeskočeno, ne spadlé — ale NAHLAS.
    echo "::warning title=publish skipped::V tomto repozitáři nejsou přihlašovací údaje k registru — nevydává, přeskakuji. Na forku je to očekávané; vydavatel má VERDACCIO_USER + VERDACCIO_PASSWORD (nebo VERDACCIO_TOKEN)."
    echo "publish=false" >> "$GITHUB_OUTPUT"
    exit 0
  fi

  # Maska dřív než cokoli, co by token mohlo vypsat: vyražený token není secret
  # Actions, runner ho sám neskryje. (`echo` je vestavěný — do argumentů procesu nejde.)
  echo "::add-mask::${token}"
  # Do souboru jen ODKAZ na proměnnou; apostrofy drží `${NODE_AUTH_TOKEN}` doslova.
  npm config set --location=user \
    "$(klic_registru "$VERDACCIO_URL")"':_authToken=${NODE_AUTH_TOKEN}' \
    "@aisha:registry=${VERDACCIO_URL}" \
    "registry=${VERDACCIO_URL}"
  # Token jen prostředím dalších kroků: npm ho čte přes odkaz výš, dotaz na verzi
  # v registru přes VERDACCIO_TOKEN — obojí TÝŽ token, ne statický secret.
  {
    echo "NODE_AUTH_TOKEN=${token}"
    echo "VERDACCIO_TOKEN=${token}"
  } >> "$GITHUB_ENV"
  echo "publish=true" >> "$GITHUB_OUTPUT"
  echo "Přihlášení k registru nastaveno — token: ${zdroj}; odkaz zapsán do $(soubor_npm), token jde jen prostředím"
}

over() {
  if [ -z "${VERDACCIO_URL:-}" ]; then
    echo "::error title=registr::VERDACCIO_URL není nastavená"
    exit 1
  fi
  if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
    echo "::error title=registr::NODE_AUTH_TOKEN v prostředí kroku chybí — krok přihlášení token dalším krokům nepředal"
    exit 1
  fi
  local kdo
  if kdo="$(npm whoami --registry "$VERDACCIO_URL" 2>&1)"; then
    echo "Přihlášení k registru funguje: účet ${kdo}"
    return 0
  fi
  printf '%s\n' "$kdo" | tail -5
  echo "::error title=registr::přihlášení k registru NEFUNGUJE (npm whoami) — npm čte $(soubor_npm); vydání by skončilo E401"
  exit 1
}

case "${1:-}" in
  nastav) nastav ;;
  over) over ;;
  *)
    echo "registr-prihlaseni: nastav | over" >&2
    exit 2
    ;;
esac

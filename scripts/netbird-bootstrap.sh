#!/usr/bin/env bash
# ==============================================================================
# netbird-bootstrap.sh — idempotentní NetBird bootstrap bez dashboard click-pathu
# ==============================================================================
#
# Vytvoří základní NetBird skupiny a setup keys pro AISHA multi-server stack:
#   - aisha-frontend      → NETBIRD_STACK_KEY_FRONTEND
#   - aisha-backend       → NETBIRD_STACK_KEY_BACKEND + NETBIRD_STACK_KEY_INTEGRATION
#   - aisha-experimental      → NETBIRD_STACK_KEY_EXPERIMENTAL
#   - sandbox-run      → runtime ephemeral group for svc-agent-runner
#
# Auth preference:
#   1. Bearer token z Keycloak real useru aisha-bootstrap (ROPC)
#   2. Bearer token z Keycloak service accountu netbird-backend
#   3. NETBIRD_API_TOKEN fallback (Token nebo Bearer dle NETBIRD_AUTH_SCHEME)
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/env-zapis.sh
source "$ROOT/scripts/lib/env-zapis.sh"
ENV_FILE="${ENV_FILE:-$ROOT/.env.coolify}"
TOKEN_FILE="${TOKEN_FILE:-$ROOT/.env-prod-backup}"
COOLIFY_API="${COOLIFY_API:-}"
DRY_RUN="${DRY_RUN:-0}"
SYNC_COOLIFY="${SYNC_COOLIFY:-1}"
REDEPLOY_AFTER_NETBIRD="${REDEPLOY_AFTER_NETBIRD:-0}"
FORCE_RECREATE_SETUP_KEYS="${FORCE_RECREATE_SETUP_KEYS:-0}"
# Tracks how many setup keys were regenerated this run (incremented inside
# ensure_setup_key_env). Read by the SYNC_COOLIFY block below to decide
# whether redeploy is worthwhile — if no key changed, env values in Coolify
# are already up to date and a redeploy would be churn.
SETUP_KEYS_REGENERATED=0

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'; N='\033[0m'
info()   { echo -e "${B}ℹ${N}  $*" >&2; }
ok()     { echo -e "${G}✅${N} $*" >&2; }
warn()   { echo -e "${Y}⚠️${N}  $*" >&2; }
err()    { echo -e "${R}❌${N} $*" >&2; }
banner() { echo -e "\n${C}═══ $* ═══${N}" >&2; }

[ -f "$ENV_FILE" ] || { err "$ENV_FILE neexistuje — spusť nejdřív scripts/aisha-cold-start.sh"; exit 1; }

env_value() {
  local key="$1"
  local value="${!key-}"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return 0
  fi
  # Pipefail-safe: grep returns 1 when no match → would kill script under
  # `set -euo pipefail`. The trailing `|| true` makes a missing key just
  # return empty instead of erroring.
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

required_env() {
  local key="$1"
  local value
  value="$(env_value "$key")"
  if [ -z "$value" ]; then
    err "$key is required"
    exit 1
  fi
  printf '%s' "$value"
}

upsert_env_file() {
  local key="$1"
  local value="$2"
  local tmp

  if [ "$DRY_RUN" = "1" ]; then
    info "[DRY RUN] $key=<generated>"
    return 0
  fi

  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { done = 0 }
    $0 ~ "^" key "=" { print key "=" value; done = 1; next }
    { print }
    END { if (done == 0) print key "=" value }
  ' "$ENV_FILE" > "$tmp"
  env_zapis_atomicky "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

KEYCLOAK_REALM="$(env_value KEYCLOAK_REALM)"
KEYCLOAK_REALM="${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}"

# STANOVIŠTĚ: tenhle skript běží na OPERÁTORSKÉM stroji — mluví s NetBirdem
# přes jeho veřejnou tvář (`NETBIRD_API_URL`, typicky netbird.<public-tld>).
# Keycloak proto musí oslovit ze stejného místa: VEŘEJNOU tváří.
#
# Do 2026-08-14 tu stálo `env_value KEYCLOAK_URL`, tedy hodnota z vaultu —
# a ta nese jméno UVNITŘ mesh (naměřeno: https://aisha-auth.mesh.aisha.internal).
# Zvenčí se nepřeloží, takže brána Keycloaku 183 s sbírala HTTP 000 a pak
# odmítla bootstrap:
#     ⚠️ /health/ready: 000 (url=https://aisha-auth.mesh.aisha.internal/health/ready)
#     ❌ Keycloak smoke FAILED after 183s
# Z cold-startu to přitom procházelo — ten si `KEYCLOAK_URL` exportoval jinak.
# Adresa tedy záležela na tom, KDO skript zavolal, ne na tom, KDE běží. To je
# ta vada: stanoviště je vlastnost skriptu, ne jeho volajícího.
#
# ⛔ DOMĚŘENO 2026-08-14: „veřejná" nestačí. Tenhle skript RAZÍ setup keys, bez
# kterých se do mesh nepřipojí ani jeden agent. Veřejnou tvář ale obsluhuje
# edge, a ten routuje na mesh IP, které vzniknou až z těch klíčů. Kruh:
#     agent: „couldn't add peer: setup key is invalid"   (mesh prázdná)
#     https://auth.aisha.guru/ → HTTP 404 od Caddy       (edge nemá kam)
#     https://aisha-auth.backend.<internal-tld>/ → 200   (přímá tvář žije)
# Bootstrap proto NESMÍ stát na tváři, kterou sám teprve umožňuje. Přímou tvář
# routuje proxy Coolify — nepotřebuje mesh ani edge — a z operátorského stroje
# je dosažitelná v OBOU stavech, takže je bezpečná i po vzniku mesh.
# Táž třída jako `pki-init` (#912); tam se to řešilo uvnitř clusteru, tady
# zvenčí.
#
# Pořadí: výslovný operátorský override → PŘÍMÁ → veřejná → hodnota volajícího.
KEYCLOAK_PUBLIC_DOMAIN="$(env_value KEYCLOAK_DOMAIN_PUBLIC)"
KEYCLOAK_URL="${KEYCLOAK_PUBLIC_URL:-}"
# ⛔ NAMĚŘENO 2026-08-19: tady se skládalo `https://${KEYCLOAK_DIRECT_DOMAIN}`,
# tedy TLS na jméno pod vnitřní TLD. Pro takové jméno nevydá certifikát žádná
# veřejná CA a vnitřní CA je právě to, co teprve vzniká — takže se vrátí cizí
# cert toho, kdo na adrese odpovídá:
#     x509: certificate is valid for *.evymo.com, not <fork>-auth.backend.<fork>.internal
# Týž tvar položil pki-init i netbird-management (ten odmítl KAŽDÝ token, takže
# nevznikl účet ani setup key a mesh nevstal vůbec).
#
# ⭐ Kdo Keycloak potřebuje ZEVNITŘ, jde NAPŘÍMO kontejnerovou sítí. Vnitřní
# URL má proto přednost před PŘÍMOU doménou — a bere se CELÁ, ne jako doména,
# ke které si někdo dolepí schéma.
if [ -z "$KEYCLOAK_URL" ]; then
  KEYCLOAK_URL="$(env_value KEYCLOAK_INTERNAL_URL)"
fi
# PŘÍMÁ tvář (`KEYCLOAK_DOMAIN_DIRECT`) se sem VĚDOMĚ nevrací jako záloha:
# byla by to tichá domněnka, že pro jméno pod vnitřní TLD existuje ověřitelný
# certifikát — a přesně ta stála mesh tři dny. Kdo je uvnitř, má
# `KEYCLOAK_INTERNAL_URL`; kdo je venku, má veřejnou tvář níž. Třetí cesta není.
if [ -z "$KEYCLOAK_URL" ] && [ -n "$KEYCLOAK_PUBLIC_DOMAIN" ]; then
  KEYCLOAK_URL="https://${KEYCLOAK_PUBLIC_DOMAIN}"
fi
if [ -z "$KEYCLOAK_URL" ]; then
  KEYCLOAK_URL="$(env_value KEYCLOAK_URL)"
fi
# Prázdno se tu NEŘEŠÍ: skript má cesty, které Keycloak vůbec nepotřebují
# (SKIP_KEYCLOAK_GATE, statický NETBIRD_API_TOKEN, a taky režim, ve kterém si
# ho brána jen NASOURCUJE kvůli jedné funkci). Odmítnout start kvůli hodnotě,
# která se nemusí použít, je stejná chyba jako mlčet o té chybějící —
# fail-loud patří k MÍSTU POUŽITÍ, ne k místu odvození.
KEYCLOAK_URL="${KEYCLOAK_URL%/}"

# ── DVĚ RŮZNÉ OTÁZKY, DVĚ RŮZNÉ ODPOVĚDI ─────────────────────────
# KEYCLOAK_URL odpovídá na „kde Keycloak DOSÁHNU“. Issuer odpovídá na „co token
# NESE“. Do 2026-08-25 tu na obojí byla JEDNA proměnná: token se razil na
# veřejné tváři, aby `iss` seděl s tím, co NetBird management ověřuje
#     AUTH_AUTHORITY: https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}
#
# Ten důvod platil 2026-08-18, kdy `KC_HOSTNAME` bylo bez schématu a vnitřní
# volání dostávalo `http://` issuer. Ta vada byla mezitím odstraněna — pravidlo
# ale zůstalo, a tím se stalo NESPLNITELNÝM: veřejnou tvář obsluhuje edge,
# který podle mapy přichází až PO meshi, a fáze D běží PŘED ním.
#
# ⛔ NAMĚŘENO 2026-08-25 na studeném startu, týz uživatel, týz realm:
#     veřejné dveře  https://auth.<public>   → HTTP 503 „no available server“
#     vnitřní dveře  http://127.0.0.1:<tunel> → token vydán, a nese
#                                                iss=https://auth.<public>/realms/<realm>
#     Issuer tedy na dveřích NEZÁVISÍ — raží ho Keycloak z KC_HOSTNAME.
#
# Proto: dveře podle DOSAŽITELNOSTI, issuer se MĚŘÍ z vyraženého tokenu.
# Předpoklad se tím mění v tvrzení: kdyby se KC_HOSTNAME zase pokazilo, ozve se
# to TADY a jmenovitě, ne o tři vrstvy dál jako NetBirdí „token invalid“.
# Jen PŮVOD (schéma+host). Realm se dolepí až v assert_issuer, tedy v místě
# POROVNÁNÍ — tenhle blok odvozuje ADRESY a nesmí sahat na nic mimo sebe.
# (Brána `bootstrap-nestoji-na-tvari-kterou-sam-tvori` ho spouští samostatně
# pod `set -u`; odkaz na KEYCLOAK_REALM ji shodil na `unbound variable`.)
KEYCLOAK_EXPECTED_ORIGIN=""
if [ -n "$KEYCLOAK_PUBLIC_DOMAIN" ]; then
  KEYCLOAK_EXPECTED_ORIGIN="https://${KEYCLOAK_PUBLIC_DOMAIN#https://}"
  KEYCLOAK_EXPECTED_ORIGIN="${KEYCLOAK_EXPECTED_ORIGIN%/}"
fi

# Nárok z vyraženého tokenu. Podpis se NIKDY nevypisuje, nároky tajemství nejsou.
jwt_claim() {
  local payload
  payload="$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+')"
  case $(( ${#payload} % 4 )) in
    2) payload="${payload}==" ;;
    3) payload="${payload}=" ;;
  esac
  printf '%s' "$payload" | base64 -d 2>/dev/null | jq -r --arg c "$2" '.[$c] // empty' 2>/dev/null
}

# Issuer je TVRZENÍ O TOKENU, ne o cestě. Když nesedí, NetBird ho odmítne
# o tři vrstvy dál — takže se ptám tady, kde ještě vím proč.
assert_issuer() {
  local token="$1" role="$2" videny cekany
  [ -n "$KEYCLOAK_EXPECTED_ORIGIN" ] || return 0
  cekany="${KEYCLOAK_EXPECTED_ORIGIN}/realms/${KEYCLOAK_REALM}"
  videny="$(jwt_claim "$token" iss)"
  [ "$videny" = "$cekany" ] && return 0
  err "Token ($role) nese jiný issuer, než jaký NetBird ověřuje."
  err "  vydán:    ${videny:-<žádný>}"
  err "  očekáván: $cekany"
  err "  Dveře příčina NEJSOU (raženo přes $KEYCLOAK_URL) — issuer určuje KC_HOSTNAME."
  err "  Zkontroluj KC_HOSTNAME v docker-compose.coolify-keycloak.yml a KEYCLOAK_DOMAIN_PUBLIC."
  return 1
}
# Ponecháno pro hlášky a odvozeniny níž; už NEROZHODUJE o adrese sondy.
KEYCLOAK_DOMAIN="${KEYCLOAK_PUBLIC_DOMAIN:-$(env_value KEYCLOAK_DOMAIN)}"

NETBIRD_API_URL="$(required_env NETBIRD_API_URL)"
NETBIRD_API_URL="${NETBIRD_API_URL%/}"

# ⭐ TÝŽ KRUH JAKO U KEYCLOAKU, TÁŽ ODPOVĚĎ: MĚŘENÍ (2026-08-27).
#
# `NETBIRD_API_URL` je VEŘEJNÁ tvář (netbird.<public-tld>) — a tu servíruje edge.
# Jenže edge se nasazuje až v POSLEDNÍ vlně, protože potřebuje mesh, kterou tenhle
# skript teprve zakládá. Při náběhu ze studeného stavu tedy veřejná tvář ještě
# neexistuje a sonda 5 minut sbírá HTTP 404, aby pak prohlásila za nedostupné
# něco, co běží (naměřeno 2026-08-27: přímá tvář vracela 401, tedy živá a chráněná).
#
# Nejde o fallback nad identitou: instance se nemění, mění se jen TVÁŘ, kterou
# se k téže službě jde. Volba se navíc neodhaduje — ověří se dotazem.
case "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "${NETBIRD_API_URL}/api/peers" 2>/dev/null || true)" in
  200|401|403) : ;;   # živé (401/403 = chráněné, tedy správně směrované)
  *)
    _nb_direct="$(env_value NETBIRD_DOMAIN_DIRECT)"
    if [ -n "$_nb_direct" ]; then
      info "NetBird na ${NETBIRD_API_URL} neodpovídá; zkouším PŘÍMOU tvář https://${_nb_direct}"
      _nb_kod="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://${_nb_direct}/api/peers" 2>/dev/null || true)"
      case "$_nb_kod" in
        200|401|403)
          NETBIRD_API_URL="https://${_nb_direct}"
          ok "PŘÍMÁ tvář NetBirdu ověřena (HTTP ${_nb_kod}) — používám ji: $NETBIRD_API_URL"
          ;;
        *)
          err "PŘÍMÁ tvář NetBirdu neodpověděla použitelně (HTTP ${_nb_kod}) — nepoužívám ji"
          ;;
      esac
    fi
    ;;
esac
NETBIRD_AUTH_SCHEME="$(env_value NETBIRD_AUTH_SCHEME)"
NETBIRD_AUTH_SCHEME="${NETBIRD_AUTH_SCHEME:-Bearer}"
NETBIRD_API_TOKEN="$(env_value NETBIRD_API_TOKEN)"
NETBIRD_MGMT_SECRET="$(env_value NETBIRD_MGMT_SECRET)"
AISHA_BOOTSTRAP_PASSWORD="$(env_value AISHA_BOOTSTRAP_PASSWORD)"
AISHA_BOOTSTRAP_CLIENT_SECRET="$(env_value AISHA_BOOTSTRAP_CLIENT_SECRET)"
NETBIRD_SANDBOX_GROUP="$(env_value NETBIRD_SANDBOX_GROUP)"
NETBIRD_SANDBOX_GROUP="${NETBIRD_SANDBOX_GROUP:-sandbox-run}"

COOLIFY_API_TOKEN="$(env_value COOLIFY_API_TOKEN)"
if [ -z "$COOLIFY_API_TOKEN" ] && [ -f "$TOKEN_FILE" ]; then
  COOLIFY_API_TOKEN="$(grep -E '^COOLIFY_API_TOKEN=' "$TOKEN_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '[:space:]')"
fi

keycloak_token() {
  local _t
  [ -n "$NETBIRD_MGMT_SECRET" ] || return 1
  _t="$(curl -fsS --http1.1 --max-time 30 \
    -X POST "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials" \
    -d "client_id=netbird-backend" \
    --data-urlencode "client_secret=${NETBIRD_MGMT_SECRET}" \
    | jq -r '.access_token // empty')"
  [ -n "$_t" ] || return 1
  assert_issuer "$_t" "netbird-backend" || return 1
  printf '%s' "$_t"
}

bootstrap_user_token() {
  local _t
  [ -n "$AISHA_BOOTSTRAP_PASSWORD" ] || return 1
  [ -n "$AISHA_BOOTSTRAP_CLIENT_SECRET" ] || return 1
  _t="$(curl -fsS --http1.1 --max-time 30 \
    -X POST "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=password" \
    -d "client_id=aisha-bootstrap" \
    --data-urlencode "client_secret=${AISHA_BOOTSTRAP_CLIENT_SECRET}" \
    -d "username=aisha-bootstrap" \
    --data-urlencode "password=${AISHA_BOOTSTRAP_PASSWORD}" \
    -d "scope=openid" \
    | jq -r '.access_token // empty')"
  [ -n "$_t" ] || return 1
  assert_issuer "$_t" "aisha-bootstrap" || return 1
  printf '%s' "$_t"
}

resolve_auth_header() {
  if [ "$NETBIRD_AUTH_SCHEME" = "Token" ]; then
    [ -n "$NETBIRD_API_TOKEN" ] || { err "NETBIRD_API_TOKEN is required for Token auth"; exit 1; }
    printf 'Authorization: Token %s' "$NETBIRD_API_TOKEN"
    return 0
  fi

  local token=""
  # ⛔ ŽÁDNÉ 2>/dev/null: tady se rozhoduje o vlastnictví účtu, a když ražba
  # selže, JEDINÁ stopa po důvodu je stderr — curl i assert_issuer píšou tam.
  # Do 2026-08-25 se zahazoval a zbyla jen věta „token se nepodařilo získat“.
  token="$(bootstrap_user_token || true)"
  if [ -n "$token" ]; then
    printf 'Authorization: Bearer %s' "$token"
    return 0
  fi

  # ⛔ ZDE BÝVAL TICHÝ ÚSTUP NA SERVISNÍ ÚČET (keycloak_token). ODSTRANĚN 2026-08-20.
  #
  # Ten ústup byl PŘÍČINOU, ne pojistkou. Mesh management zakládá účet při PRVNÍM
  # ověřeném dotazu a zapíše volajícího jako vlastníka. Hlavička se tu vyzvedává
  # o stovky řádků DŘÍV, než se uplatní nárok na vlastnictví — takže když se
  # bootstrap token nepovede, ozve se servisní účet, účet je jeho, a pozdější
  # nárok přichází k hotovému. Nevratně.
  #
  # A ta identita je navíc pro IdP neviditelná: servisní účty Keycloak do výpisu
  # uživatelů nedává, takže management hlásí "not found in IDP" a na každý dotaz
  # odpovídá 403 "user is pending approval". Vypadá to jako čekání na schválení,
  # jenže schválit může jen vlastník — a vlastník je právě ta neviditelná identita.
  #
  # Naměřeno 2026-08-20: tímhle způsobem stála mesh a api vracelo 502, protože
  # peer discovery nedostala adresu jádra a mesh-router neměl cíl pro DNAT.
  #
  # Nejistota znamená STOP. Náhradní identita tu není menší zlo — je to to zlo.
  if [ -z "$NETBIRD_API_TOKEN" ]; then
    err "Token bootstrap uživatele se nepodařilo získat."
    err "  NEUSTUPUJI na servisní účet: na prázdném datastoru by se stal VLASTNÍKEM"
    err "  účtu, je pro IdP neviditelný a schválit ho pak nemá kdo. To je nevratné."
    err "  CO S TÍM: ověř, že v prostředí jsou AISHA_BOOTSTRAP_PASSWORD i"
    err "  AISHA_BOOTSTRAP_CLIENT_SECRET (vyrábí je scripts/aisha-bootstrap-user-init.sh),"
    err "  a že Keycloak už ROPC pro toho uživatele obsluhuje. Pak spusť tenhle skript znovu."
    err "  NEDĚLEJ: nenastavuj NETBIRD_AUTH_SCHEME=Token 'aby to prošlo' — statický token"
    err "  je jiná identita a vlastnictví účtu neřeší."
    exit 1
  fi

  [ -n "$NETBIRD_API_TOKEN" ] || { err "Bearer auth requires netbird-backend client credentials or NETBIRD_API_TOKEN fallback"; exit 1; }
  printf 'Authorization: Bearer %s' "$NETBIRD_API_TOKEN"
}

# Gate: Keycloak public OIDC must be ready before NetBird bootstrap. The
# `netbird-backend` service account token call (`keycloak_token`) and NetBird
# management itself both rely on the public Keycloak discovery URL — bootstrap
# loops on 503 if KC is not yet healthy.
if [ "${SKIP_KEYCLOAK_GATE:-0}" != "1" ]; then
  banner "Gate: Keycloak public OIDC"
  # Tady se adresa POUŽÍVÁ — a tady se pozná, že chybí. Bez veřejné tváře by
  # sonda sáhla na vnitřní jméno a 183 s sbírala HTTP 000 (naměřeno na aishe),
  # aby pak vyslovila výrok o službě, která je ve skutečnosti v pořádku.
  if [ -z "$KEYCLOAK_URL" ]; then
    err "dosažitelná tvář Keycloaku není deklarovaná (KEYCLOAK_DOMAIN_DIRECT, KEYCLOAK_DOMAIN_PUBLIC ani KEYCLOAK_PUBLIC_URL)"
    err "  tenhle skript běží MIMO mesh — vnitřní jméno se odsud nepřeloží a sonda by jen mlčela"
    exit 1
  fi
  # ⛔ PRÁZDNOTA NENÍ JEDINÝ ZPŮSOB, JAK MÍT ŠPATNOU ADRESU (naměřeno 2026-08-27).
  #
  # Kontrola výš hlídala jen `-z`. Meshová adresa prázdná NENÍ, takže prošla —
  # a sonda pak dělala přesně to, před čím komentář o tři řádky výš varuje:
  #
  #     /health/ready: 000 (url=https://<prefix>-auth.mesh.<instance>.internal/health/ready)
  #     ❌ Keycloak smoke FAILED after 183s
  #
  # Sto osmdesát tři sekund mlčení a pak výrok o službě, která byla po celou dobu
  # v pořádku (přímá tvář vracela 200). Mesh je přitom to, co tenhle skript
  # teprve VYTVÁŘÍ — ptát se na ni před bootstrapem je kruh, ne konfigurace.
  #
  # Pojistka proto testuje ZÓNU, ne přítomnost hodnoty. Táž třída jako
  # `audit-zona-ve-jmene`: jméno i hodnota existují, jen si neodpovídají.
  # ⭐ DOMNĚNKU NAHRADÍ MĚŘENÍ (2026-08-27).
  #
  # Odvození výš vylučuje PŘÍMOU tvář (`KEYCLOAK_DOMAIN_DIRECT`) s odůvodněním,
  # že by šlo o „tichou domněnku, že pro jméno pod vnitřní TLD existuje
  # ověřitelný certifikát" — a ta domněnka kdysi stála mesh tři dny
  # (`x509: certificate is valid for *.evymo.com, not …`).
  #
  # Ta námitka platí proti DOMNĚNCE, ne proti té adrese. Když se certifikát
  # OVĚŘÍ (curl BEZ `-k`, takže neplatný cert = neúspěch), není to už domněnka
  # ale zjištění — a instance, kde přímá tvář certifikát má, nemá důvod uvíznout
  # v kruhu „mesh potřebuje Keycloak přes mesh".
  #
  # Sonda běží JEN když je jinak adresa meshová, tedy v situaci, která by
  # skončila pádem. Nemůže tedy nic zhoršit: buď najde použitelnou tvář, nebo
  # se propadne do hlášky pod sebou.
  case "$KEYCLOAK_URL" in
    *.internal|*.internal/*|*.internal:*)
      _direct="$(env_value KEYCLOAK_DOMAIN_DIRECT)"
      if [ -n "$_direct" ]; then
        info "Keycloak vyšel meshově; zkouším PŘÍMOU tvář https://${_direct} (ověřuji certifikát)"
        _kod="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
                 "https://${_direct}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 2>/dev/null || true)"
        if [ "$_kod" = "200" ]; then
          KEYCLOAK_URL="https://${_direct}"
          ok "PŘÍMÁ tvář ověřena (HTTP 200, platný certifikát) — používám ji: $KEYCLOAK_URL"
        else
          err "PŘÍMÁ tvář neodpověděla použitelně (HTTP ${_kod}) — nepoužívám ji"
        fi
      fi
      ;;
  esac

  case "$KEYCLOAK_URL" in
    *.internal|*.internal/*|*.internal:*)
      err "Keycloak je adresovaný MESHOVÝM jménem: $KEYCLOAK_URL"
      err "  Mesh ale teprve vzniká TÍMHLE skriptem — sonda by jen 180 s sbírala HTTP 000."
      err "  CO S TÍM: deklaruj dosažitelnou tvář, např."
      err "    KEYCLOAK_PUBLIC_URL=https://<auth.veřejná-doména> bash scripts/netbird-bootstrap.sh"
      err "  (nebo KEYCLOAK_DOMAIN_PUBLIC v prostředí). NEobcházej to SKIP_KEYCLOAK_GATE=1 —"
      err "  brána by mlčela a bootstrap by se zacyklil na 503."
      exit 1
      ;;
  esac
  KC_URL="$KEYCLOAK_URL" KC_REALM="$KEYCLOAK_REALM" \
    TIMEOUT_SECONDS="${KEYCLOAK_GATE_TIMEOUT:-180}" \
    SLEEP_SECONDS="${KEYCLOAK_GATE_SLEEP:-5}" \
    bash "$ROOT/scripts/smoke-keycloak.sh" >&2 || {
      err "Keycloak gate failed — refusing NetBird bootstrap (would loop on 503)"
      err "Bypass (NOT recommended): SKIP_KEYCLOAK_GATE=1 bash scripts/netbird-bootstrap.sh"
      exit 1
    }
fi

AUTH_HEADER="$(resolve_auth_header)"

netbird_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local args=(-sS --http1.1 --max-time 30 -X "$method" -H "$AUTH_HEADER" -H "Accept: application/json" -H "Content-Type: application/json")
  if [ -n "$data" ]; then
    args+=(-d "$data")
  fi
  curl "${args[@]}" "${NETBIRD_API_URL}${path}" | tr -d '\000-\037'
}

wait_for_netbird() {
  banner "Wait for NetBird API"
  local attempt http_code refreshed=0
  for attempt in $(seq 1 60); do
    http_code="$(curl -sS --http1.1 --max-time 5 -o /dev/null -w '%{http_code}' -H "$AUTH_HEADER" "${NETBIRD_API_URL}/api/groups" 2>/dev/null || true)"
    case "$http_code" in
      200)
        ok "NetBird API ready (${NETBIRD_API_URL})"
        return 0
        ;;
      401)
        # 401 may mean the Bearer token expired while we were waiting for
        # NetBird OIDC config to load (403 transient phase can take 2-3 min).
        # Refresh the token once and continue the loop; a second 401 is fatal.
        if [ "$refreshed" = "0" ]; then
          info "NetBird API returned 401 (attempt ${attempt}/60) — refreshing auth token"
          local new_header
          new_header="$(resolve_auth_header 2>/dev/null || true)"
          if [ -n "$new_header" ]; then
            AUTH_HEADER="$new_header"
            refreshed=1
            info "Auth token refreshed — retrying"
            sleep 2
            continue
          fi
        fi
        err "NetBird API auth failed (HTTP 401 — invalid/missing token)"
        return 1
        ;;
      403)
        # 403 can be transient during management startup (OIDC config still loading)
        info "NetBird API returned 403 (attempt ${attempt}/60 — may be startup transient)"
        # Reset refresh guard: another 403 burst may follow a token refresh
        refreshed=0
        sleep 5
        ;;
      *)
        info "NetBird not ready yet (HTTP ${http_code}, attempt ${attempt}/60)"
        sleep 5
        ;;
    esac
  done
  err "NetBird API not ready after 5 minutes"
  return 1
}

get_group_id() {
  local name="$1"
  netbird_api GET "/api/groups" | jq -r --arg name "$name" '.[] | select(.name == $name or .id == $name) | .id' | head -1
}

ensure_group() {
  local name="$1"
  local id
  id="$(get_group_id "$name")"
  if [ -n "$id" ]; then
    ok "Group exists: $name ($id)"
    printf '%s' "$id"
    return 0
  fi

  info "Creating group: $name"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'dry-run-%s' "$name"
    return 0
  fi

  local payload response
  payload="$(jq -n --arg name "$name" '{name: $name}')"
  response="$(netbird_api POST "/api/groups" "$payload")"
  id="$(echo "$response" | jq -r '.id // empty')"
  if [ -z "$id" ]; then
    id="$(get_group_id "$name")"
  fi
  [ -n "$id" ] || { err "Failed to create NetBird group: $name"; echo "$response" >&2; exit 1; }
  ok "Group created: $name ($id)"
  printf '%s' "$id"
}

setup_key_id_is_valid_in_netbird() {
  # Validate by the key's own ID — NOT by its name.
  #
  # WHY NOT BY NAME (wipe-breaking defect, measured on tenant 2026-07-21):
  # NetBird's GET /api/setup-keys never returns the secret `key` value, only the
  # metadata, so an earlier revision matched on `name` and reasoned "env value
  # should match the latest creation". That is an ASSUMPTION, not a check, and a
  # wipe falsifies it: the netbird DB is recreated and fresh keys are minted under
  # the SAME NAMES, while the env is deliberately preserved
  # (PRESERVE_STATEFUL_SECRETS). The name then matches, validation passes, the
  # stale value is kept — and every agent presenting it gets
  #   rpc error: code = NotFound desc = couldn't add peer: setup key is invalid
  # A stack redeploy cannot fix it either, because this function keeps answering
  # "validated". tenant-potok and tenant-local-ingest sat like this with their key
  # showing used_times=0 on the management side.
  #
  # The ID IS returned by both the create response and the list, so it identifies
  # the exact record our stored value came from. A name says a key of that role
  # exists; an ID says the key we hold is that key.
  local id="$1"
  local response valid_count
  [ -n "$id" ] || return 1
  response="$(netbird_api GET "/api/setup-keys" 2>/dev/null)"
  if [ -z "$response" ] || ! echo "$response" | jq -e 'type == "array"' >/dev/null 2>&1; then
    warn "  validate_setup_key(id=$id): API response not parseable — assuming invalid"
    return 1
  fi
  valid_count="$(echo "$response" | jq --arg id "$id" '
    [.[] | select((.id // "") == $id and .revoked == false and (.state // "valid") == "valid")] | length
  ' 2>/dev/null)"
  [ "${valid_count:-0}" -gt 0 ]
}

# --- which Coolify stacks must receive NetBird env, DERIVED not listed --------
# A regenerated setup key is useless to a stack that never receives it. The list
# used to be hand-written as "core edge integration ledger exec netbird", and it
# had drifted: svc-local-ingest and svc-potok were added later, consume
# NETBIRD_STACK_KEY_* in their compose, and were in NEITHER branch below. Their
# agents therefore kept a key from a previous management DB and failed enrolment
# with "couldn't add peer: setup key is invalid" — measured on tenant 2026-07-21,
# aisha-backend-host showing used_times=0 while tenant-potok retried forever.
#
# The membership test is a property, not a roster: a stack needs NetBird env iff
# its compose references NETBIRD_*. Derived from the same manifest that maps
# app -> compose, so a new mesh consumer is covered the moment it is declared.
netbird_env_stacks() {
  # ⛔ MANIFEST INSTANCE, NE ŠABLONA (naměřeno 2026-09-25). Tady stála natvrdo
  # cesta `coolify/manifests/aisha.manifest` — šablona se 32 stacky s NETBIRD_,
  # kdežto instance forku jich nasazuje 13 (a jeden z nich s vypnutou lane).
  # Dokud se jména jen předávala do env-syncu, cizí jména prošla bez povšimnutí;
  # `aisha-redeploy --only` je právem odmítá. Inventář instance má JEDNY dveře
  # — týž resolver, jaký používá coolify-sync-envs.sh a aisha-redeploy.
  local manifest="${MANIFEST_FILE:-}"
  if [ -z "$manifest" ]; then
    manifest="$(node "$ROOT/scripts/lib/coolify-instance-scope.mjs" --manifest-path)" || {
      err "manifest instance nejde určit (coolify-instance-scope --manifest-path) — nevím, které stacky nesou NETBIRD_"
      return 1
    }
  fi
  [ -f "$manifest" ] || { err "manifest not found: $manifest"; return 1; }
  local line rest name tail compose
  while IFS= read -r line; do
    case "$line" in "app:"*) ;; *) continue ;; esac
    rest="${line#app:}"; rest="${rest# }"
    name="${rest%%:*}"; tail="${rest#*:}"; compose="${tail#*:}"
    # Manifest rows are name:slot:compose[:opt=val...] — keep ONLY the compose
    # field. Taking the rest of the line silently dropped the one row that
    # carries a trailing option (keycloak ... :bluegreen=on), because the path
    # then failed the -f test and the row was skipped without a word.
    compose="${compose%%:*}"
    compose="${compose%%[[:space:]]*}"
    [ -n "$name" ] && [ -f "$ROOT/$compose" ] || continue
    grep -q "NETBIRD_" "$ROOT/$compose" && printf '%s\n' "$name"
  done < "$manifest" | sort -u
}

ensure_setup_key_env() {
  local env_key="$1"
  local name="$2"
  local group_id="$3"
  local id_key="${env_key}_ID"
  local existing existing_id api_valid=0
  existing="$(env_value "$env_key")"
  existing_id="$(env_value "$id_key")"

  # Self-heal validation: if env value present, verify THAT VALUE is still the
  # live key, by its ID. Skip the API call if FORCE_RECREATE (we regenerate
  # regardless) or in DRY_RUN (no side-effect probes).
  if [ -n "$existing" ] && [ "$FORCE_RECREATE_SETUP_KEYS" != "1" ] && [ "$DRY_RUN" != "1" ]; then
    if [ -z "$existing_id" ]; then
      # Written before the ID was recorded. The value cannot be tied to any live
      # record, and a name match is not evidence (see the function above), so the
      # only honest answer is "unknown" — which must regenerate, not assume-good.
      # One-time churn per install; afterwards the ID is stored and this is silent.
      warn "$env_key present but $id_key is missing — cannot verify WHICH key this is; regenerating so the value and NetBird agree"
    elif setup_key_id_is_valid_in_netbird "$existing_id"; then
      api_valid=1
    fi
  fi

  if [ -n "$existing" ] && [ "$api_valid" = "1" ] && [ "$FORCE_RECREATE_SETUP_KEYS" != "1" ]; then
    ok "$env_key already present + validated in NetBird"
    return 0
  fi
  if [ -n "$existing" ] && [ -n "$existing_id" ] && [ "$api_valid" = "0" ] && [ "$FORCE_RECREATE_SETUP_KEYS" != "1" ] && [ "$DRY_RUN" != "1" ]; then
    warn "$env_key value present but its key (id=$existing_id) is gone/revoked in NetBird → auto-regenerating (self-heal)"
  fi
  if [ -n "$existing" ] && [ "$FORCE_RECREATE_SETUP_KEYS" = "1" ]; then
    warn "$env_key already present but FORCE_RECREATE_SETUP_KEYS=1 — minting replacement key"
  fi

  # ⛔ STARÝ KLÍČ SE MUSÍ ODVOLAT, JINAK ZŮSTANE DRUHÝ TÉHOŽ JMÉNA.
  # Regenerace zakládala nový klíč a ten starý nechávala žít. Jméno tím
  # přestává klíč jednoznačně určovat a kdo se ptá jménem, dostane jeden ze dvou.
  #
  # ⛔ NAMĚŘENO 2026-08-25: v NetBirdu byly DVA `aisha-backend-integration`
  # (jeden použitý 1×, druhý 0×), oba `valid`. Diagnostika tím ztratí oporu:
  # hláška agenta „setup key is invalid" pak NEznamená vypršelý ani zrušený
  # klíč — všechny jsou platné — ale klíč, který v účtu není. Hledá se špatným
  # směrem (expirace) místo správným (hodnota vs. živý klíč).
  #
  # Maže se podle ID, ne podle jména: jméno je právě ta nejednoznačnost.
  if [ -n "$existing_id" ] && [ "$DRY_RUN" != "1" ]; then
    if netbird_api DELETE "/api/setup-keys/${existing_id}" >/dev/null 2>&1; then
      info "  starý klíč odvolán (id=$existing_id) — jméno zůstane jednoznačné"
    else
      # Nezdar tu není fatální: klíč už mohl být pryč (wipe NetBirdu), nebo API
      # mazání nepovoluje. Musí to ale být SLYŠET — jinak duplikáty přibývají tiše.
      warn "  starý klíč (id=$existing_id) se nepodařilo odvolat — zkontroluj duplicity jména '$name'"
    fi
  fi

  info "Creating setup key: $name"
  if [ "$DRY_RUN" = "1" ]; then
    upsert_env_file "$env_key" "dry-run-${name}"
    upsert_env_file "$id_key" "dry-run-${name}-id"
    return 0
  fi

  local payload response setup_key setup_key_id
  payload="$(jq -n \
    --arg name "$name" \
    --arg group_id "$group_id" \
    '{name: $name, type: "reusable", expires_in: 315360000, auto_groups: [$group_id]}')"
  response="$(netbird_api POST "/api/setup-keys" "$payload")"
  setup_key="$(echo "$response" | jq -r '.key // empty')"
  setup_key_id="$(echo "$response" | jq -r '.id // empty')"
  [ -n "$setup_key" ] || { err "Failed to create setup key: $name"; echo "$response" >&2; exit 1; }
  # The ID is what makes the value verifiable later. Without it the next run can
  # only match on name, which is exactly the assumption that survives a wipe and
  # keeps a dead key. Fail loudly rather than store an unverifiable secret.
  [ -n "$setup_key_id" ] || { err "Setup key '$name' created but the API returned no id — refusing to store a value that cannot be verified"; exit 1; }
  upsert_env_file "$env_key" "$setup_key"
  upsert_env_file "$id_key" "$setup_key_id"
  SETUP_KEYS_REGENERATED=$((SETUP_KEYS_REGENERATED + 1))
  ok "$env_key (+ $id_key) written to $(basename "$ENV_FILE")"
}

# Test seam: `NETBIRD_BOOTSTRAP_LIB_ONLY=1 . netbird-bootstrap.sh` loads the
# functions above and stops before the first side effect, so a gate can drive
# ensure_setup_key_env() against a stubbed NetBird API and assert BEHAVIOUR
# (does a stale value get regenerated?) instead of grepping for a spelling.
#
# Discriminates on $0, NOT on whether `return` fails: a top-level `return`
# SUCCEEDS and terminates the script in dash/zsh/busybox-ash, so the "it errors
# when executed, therefore we fall through" trick is a bash-only accident. Here
# an executed run ignores the variable and proceeds, so a stray value of this
# name in the environment can never stop the bootstrap silently.
case "$0" in
  */netbird-bootstrap.sh|netbird-bootstrap.sh) : ;;
  *) [ "${NETBIRD_BOOTSTRAP_LIB_ONLY:-0}" = "1" ] && return 0 ;;
esac

# Runtime prerequisites — checked here, AFTER the lib-only seam, so a gate can
# source the functions above without jq/curl on the box (busybox CI runners lack
# jq). A real execution reaches this point and still fails fast before any work.
command -v jq >/dev/null || { err "jq není nainstalován"; exit 1; }
command -v curl >/dev/null || { err "curl není nainstalován"; exit 1; }

banner "NetBird bootstrap"
info "API: ${NETBIRD_API_URL}"
info "Auth: ${NETBIRD_AUTH_SCHEME}"
wait_for_netbird

# ─────────────────────────────────────────────────────────────────────────────
# Cold-start account ownership claim
# ─────────────────────────────────────────────────────────────────────────────
# NetBird's first authenticated request creates an account with the requester
# as owner. Without this step, the netbird-backend service-account user becomes
# owner — its UUID resolves to a Keycloak service account, which NetBird's IDP
# user-sync cannot enumerate, blocking heartbeats forever.
#
# We claim ownership as the `aisha-bootstrap` system user (provisioned by
# scripts/aisha-bootstrap-user-init.sh) via Resource Owner Password Credentials
# grant on the `aisha-bootstrap` Keycloak client.
#
# Idempotent: if the account already exists with aisha-bootstrap as owner,
# this is a no-op. If the account already exists with a different owner,
# this just adds aisha-bootstrap as a regular user (won't fix existing
# misconfiguration — wipe NetBird DB to re-bootstrap).
# ─────────────────────────────────────────────────────────────────────────────
claim_account_ownership_as_bootstrap_user() {
  local pw secret token http_code telo telo_tmp
  pw="$(env_value AISHA_BOOTSTRAP_PASSWORD)"
  secret="$(env_value AISHA_BOOTSTRAP_CLIENT_SECRET)"

  if [ -z "$pw" ] || [ -z "$secret" ]; then
    warn "AISHA_BOOTSTRAP_PASSWORD/CLIENT_SECRET missing — run scripts/aisha-bootstrap-user-init.sh first"
    warn "Skipping account ownership claim → service-account-netbird-backend will be account owner (known broken)"
    return 1
  fi

  token="$(curl -fsS --http1.1 --max-time 30 \
    -X POST "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=password" \
    -d "client_id=aisha-bootstrap" \
    --data-urlencode "client_secret=${secret}" \
    -d "username=aisha-bootstrap" \
    --data-urlencode "password=${pw}" \
    -d "scope=openid" \
    | jq -r '.access_token // empty')"

  if [ -z "$token" ]; then
    err "ROPC failed for aisha-bootstrap — refusing to proceed (would leave service-account as owner)"
    return 1
  fi
  # Nárok na vlastnictví se uplatňuje TÍMHLE tokenem — ať je ověřený dřív, než
  # ho NetBird odmítne a my budeme hádat, co se stalo.
  assert_issuer "$token" "aisha-bootstrap (nárok na vlastnictví)" || return 1

  # Light idempotent endpoint that triggers account creation if needed.
  # /api/users returns 200 on a healthy account; first call as a NEW user
  # to a virgin NetBird DB creates the account with that user as owner.
  # ⛔ TĚLO ODPOVĚDI SE MUSÍ PŘEČÍST, ne jen kód. Naměřeno 2026-08-18: fáze D
  # spálila 60 pokusů na HTTP 403, jehož příčina stála v těle — `user is pending
  # approval` — zatímco hláška tvrdila „check audience claim + token validity".
  # Poslala tím operátora ověřovat audience, který byl v pořádku. Chybová hláška
  # nesmí předpokládat příčinu, když ji server posílá s sebou.
  telo_tmp="$(mktemp)"
  http_code="$(curl -sS -o "$telo_tmp" -w '%{http_code}' --http1.1 --max-time 30 \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/json" \
    "${NETBIRD_API_URL}/api/users" 2>/dev/null)"
  telo="$(cat "$telo_tmp" 2>/dev/null)"
  rm -f "$telo_tmp"

  case "$http_code" in
    200)
      ok "Account ownership claim succeeded (HTTP 200) — aisha-bootstrap is account owner or member"
      ;;
    401|403)
      # `pending approval` je DETERMINISTICKÝ stav, ne startovací přechodovka:
      # účet už má vlastníka a náš uživatel do něj přichází jako cizí. Opakování
      # dotazu ho nezmění — schválit nás může jen vlastník. Když ten vlastník
      # navíc v IDP neexistuje (přeprovisionovaný realm mu přerazil ID), není
      # koho žádat a je to UZAMČENÍ. Náprava je ta, kterou zná už komentář nad
      # touhle funkcí: přestavět NetBird datastore.
      if printf '%s' "$telo" | grep -qi 'pending approval'; then
        err "NetBird: aisha-bootstrap je v účtu ve stavu 'pending approval' (HTTP $http_code)."
        err "  To NENÍ přechodný stav — účet už má vlastníka a schválit nás může jen on."
        err "  Nejčastější příčina: realm se přeprovisionoval a vlastník má v IDP nové ID,"
        err "  takže původní vlastník už neexistuje a nemá kdo schvalovat."
        err "  Ověř vlastníka:  docker logs <netbird-management> 2>&1 | grep 'not found in IDP'"
        err "  Náprava:         přestavět NetBird datastore (rewarmup), pak spustit bootstrap znovu."
        return 2
      fi
      # ⛔ ROZLIŠIT DVĚ VĚCI, KTERÉ OBĚ CHODÍ JAKO 401/403.
      # `pending approval` (výš) je deterministické. TOHLE ale deterministické
      # NENÍ: management po startu teprve nahřívá IdP cache z Keycloaku
      # („warmed up IDP cache with N entries"), a dokud v ní náš uživatel není,
      # odmítne jeho platný token jako `token invalid`.
      #
      # NAMĚŘENO 2026-08-18: v běhu fáze D dostal ROPC token 401; o pár minut
      # později TÝŽ token na TÝŽ endpoint vrátil 200. Ráno jsem opačnou hlášku
      # („may be startup transient") označil za domněnku — u `pending approval`
      # jí byla, tady ne. Přeopravil jsem to a udělal deterministickým i to, co
      # deterministické není. Proto omezené okno, ne okamžitý pád ani 60 slepých
      # pokusů.
      # ⛔ HLÁŠKA MUSÍ NÉST, CO JSME POSLALI. Bez toho jsem 2026-08-18 na jedné
      # poruše vystřídal tři různé hypotézy (pending approval → nahřívání IdP
      # cache → špatné dveře), protože jsem viděl jen návratový kód. Nároky
      # tokenu nejsou tajemství — podpis ano, ten se nevypisuje.
      _n=$(printf '%s' "$token" | cut -d. -f2 | tr '_-' '/+' | sed 's/$/===/' | base64 -d 2>/dev/null)
      warn "  poslaný token: iss=$(printf '%s' "$_n" | jq -r '.iss // "?"' 2>/dev/null) · azp=$(printf '%s' "$_n" | jq -r '.azp // "?"' 2>/dev/null) · aud=$(printf '%s' "$_n" | jq -r '(.aud|if type=="array" then join(",") else . end) // "?"' 2>/dev/null)"
      warn "  ražen přes:    ${KEYCLOAK_URL}"
      warn "  NetBird ověřuje AUTH_AUTHORITY z KEYCLOAK_DOMAIN_PUBLIC — issuer se MUSÍ shodovat."
      if [ "${_narok_pokus:-1}" -lt "${AISHA_NETBIRD_CLAIM_RETRIES:-12}" ]; then
        warn "NetBird zatím token neuznal (HTTP $http_code) — IdP cache se možná ještě nahřívá."
        warn "  Odpověď serveru: ${telo:-<prázdná>}"
        warn "  Pokus ${_narok_pokus:-1}/${AISHA_NETBIRD_CLAIM_RETRIES:-12}, zkouším za 10 s."
        return 3
      fi
      err "NetBird odmítl token aisha-bootstrap (HTTP $http_code) i po ${AISHA_NETBIRD_CLAIM_RETRIES:-12} pokusech."
      err "  Odpověď serveru: ${telo:-<prázdná>}"
      err "  To už není nahřívání cache — ověř audience, issuer a že uživatel v realmu existuje."
      return 1
      ;;
    *)
      warn "Unexpected HTTP $http_code from /api/users — proceeding but verify owner with: curl -H 'Authorization: Bearer \$ADMIN_TOKEN' \$NETBIRD_API_URL/api/users"
      ;;
  esac

  return 0
}

banner "Cold-start account ownership claim (aisha-bootstrap)"
# ⛔ NÁROK NA VLASTNICTVÍ JE PŘEDPOKLAD, NE KROK NAVÍC. Dřív tu stálo
# `|| warn "…incomplete"` a běh šel dál — razit setup keys do účtu, který nám
# nepatří, znamená rozdat klíče, jež management později odmítne. Přesně tak
# vznikla 2026-08-18 mesh, kde každý agent hlásil „setup key is invalid".
# Komentář nad funkcí to věděl („known broken"), jen to nikdy neovlivnilo běh.
# Omezené okno na nahřátí IdP cache (rc=3 = „ještě neuznal, zkus znovu").
_narok_pokus=1
while :; do
  claim_account_ownership_as_bootstrap_user
  _narok_rc=$?
  [ "$_narok_rc" -ne 3 ] && break
  _narok_pokus=$(( _narok_pokus + 1 ))
  sleep 10
done
if [ "$_narok_rc" -eq 2 ]; then
  err "Zastavuji: účet má cizího (a nejspíš neexistujícího) vlastníka — viz náprava výš."
  err "  Pokračovat by znamenalo razit klíče do účtu, který nám nepatří."
  exit 1
elif [ "$_narok_rc" -ne 0 ]; then
  err "Zastavuji: nárok na vlastnictví účtu neprošel (rc=$_narok_rc)."
  err "  Bez vlastnictví by vlastníkem zůstal service-account-netbird-backend (známo jako rozbité)."
  exit 1
fi

FRONTEND_GROUP_ID="$(ensure_group aisha-frontend)"
BACKEND_GROUP_ID="$(ensure_group aisha-backend)"
EXPERIMENTAL_GROUP_ID="$(ensure_group aisha-experimental)"
SANDBOX_GROUP_ID="$(ensure_group "$NETBIRD_SANDBOX_GROUP")"
ok "Sandbox group ready: ${NETBIRD_SANDBOX_GROUP} (${SANDBOX_GROUP_ID})"

ensure_setup_key_env NETBIRD_STACK_KEY_FRONTEND "aisha-frontend-core" "$FRONTEND_GROUP_ID"
ensure_setup_key_env NETBIRD_STACK_KEY_BACKEND "aisha-backend-host" "$BACKEND_GROUP_ID"
ensure_setup_key_env NETBIRD_STACK_KEY_INTEGRATION "aisha-backend-integration" "$BACKEND_GROUP_ID"
ensure_setup_key_env NETBIRD_STACK_KEY_EXPERIMENTAL "aisha-experimental-ledger" "$EXPERIMENTAL_GROUP_ID"

if [ "$SYNC_COOLIFY" = "1" ]; then
  if [ -z "$COOLIFY_API_TOKEN" ]; then
    warn "COOLIFY_API_TOKEN not found — $(basename "$ENV_FILE") updated, Coolify env sync skipped"
  else
    banner "Coolify env sync"
    export COOLIFY_API_TOKEN
    # Stacky s NETBIRD_ se určí JEDNOU a výslovně: pod `set -euo pipefail` by
    # neúspěch uvnitř `$(…)` v přiřazení ukončil skript bez jediného řádku,
    # a v argumentech příkazu by se naopak tiše změnil v prázdný seznam.
    if ! _nb_stacky="$(netbird_env_stacks | paste -sd, -)"; then
      err "nepodařilo se určit stacky s NETBIRD_ z manifestu instance — klíče NEROZNESENY"
      exit 1
    fi
    if [ -z "$_nb_stacky" ]; then
      err "žádný stack z manifestu instance nenese NETBIRD_ — klíče nemá kdo nést, a to je vada manifestu"
      exit 1
    fi
    _nb_stacky_args="${_nb_stacky//,/ }"
    # Self-heal redeploy logic:
    #   - If REDEPLOY_AFTER_NETBIRD=1 explicitly set → always redeploy (cold-start path).
    #   - If any setup key was regenerated this run → propagate + redeploy
    #     (so agents pick up the new key without manual intervention).
    #   - Otherwise → just sync env metadata, no redeploy churn.
    # SKIP_ENV_PREFLIGHT=1 mirrors the cold-start's own policy for this exact context
    # (aisha-cold-start.sh: "Skip strict preflight here — the heal pass in step 2 already
    # wrote everything we can derive. External-only secrets ... cannot be auto-generated;
    # they're either in .env-prod-backup or set manually after first deploy").
    # This script is invoked BY that cold-start, so it must not apply a stricter rule than
    # its caller: the strict preflight fails on any `external`-classified key that is
    # legitimately absent on a fresh instance (observed 2026-07-17: N8N_API_KEY — an n8n
    # key that can only be minted from inside a running n8n, and which is empty in prod
    # too). That abort killed the netbird self-heal redeploy AFTER the setup keys had
    # already been regenerated, stranding Phase D and every downstream wave behind it.
    if [ "$REDEPLOY_AFTER_NETBIRD" = "1" ] || [ "$SETUP_KEYS_REGENERATED" -gt 0 ]; then
      if [ "$SETUP_KEYS_REGENERATED" -gt 0 ] && [ "$REDEPLOY_AFTER_NETBIRD" != "1" ]; then
        info "$SETUP_KEYS_REGENERATED setup key(s) regenerated — triggering redeploy of affected stacks"
      fi
      # Klíče se roznesou BEZ nasazení; nasazuje až aisha-redeploy níž.
      # shellcheck disable=SC2086 # word-splitting is the intent: one arg per stack
      SKIP_ENV_PREFLIGHT=1 bash "$ROOT/scripts/coolify-sync-envs.sh" $_nb_stacky_args

      # ── PŘENASAZENÍ HLÍDANĚ, NE `REDEPLOY=1` ──────────────────────────────
      #
      # ⛔ NAMĚŘENO 2026-09-24 (fork, sdílený hostitel): tady stálo
      # `REDEPLOY=1 coolify-sync-envs.sh <stacky>`, které zařadí nasazení VŠECH
      # dotčených stacků naráz. Osm stacků si souběžně stáhlo a postavilo
      # obrazy, disk uzlu došel (ENOSPC, 100 %) a kaskáda shodila i to, co
      # předtím běželo. Opakovaný pokus narazil na pomocné kontejnery po
      # přerušených nasazeních („Conflict … already in use").
      #
      # aisha-redeploy nasazuje v pořadí vln, nejvýš `deploy_concurrency`
      # (profil; výchozí 1) v letu, každé za diskovou bránou, a čeká na
      # doběhnutí i zdraví. Samostatné čekání přes coolify-deploy-watch tím
      # odpadá — volající se smí ptát, až se tenhle příkaz vrátí.
      #
      # ⛔ NAMĚŘENO 2026-08-15 (proč se vůbec čeká): hned po zafrontování se
      # fáze D2 ptala Keycloaku, kterého skript sám poslal do restartu —
      # `fetch failed: This operation was aborted` a konec cold-startu.
      #
      # NEBLOKUJÍCÍ (jako dřívější čekání): nezdar přenasazení není důkaz vady
      # klíčů — bootstrap svou práci odvedl, klíče JSOU vyražené a doručené.
      # Tvrdý exit by je zahodil kvůli pomalé nebo zastavené frontě; volající
      # (cold-start) si stav služeb měří sám a D2 bez peerů spadne nahlas.
      # Opakovaný bootstrap ale klíče nepřegeneruje, takže by stacky sám
      # NEPŘENASADIL — varování proto vydá příkaz k dokončení.
      # Návratové kódy aisha-redeploy: 0 čisto · 3 dokončeno, ale NE čisto
      # (měkké appky, disk NEZMĚŘEN) · 1 tvrdý problém včetně STOPu diskové
      # brány · 2 chyba vstupu.
      banner "Přenasazení stacků s novými klíči (aisha-redeploy --only=${_nb_stacky})"
      if (cd "$ROOT" && node scripts/aisha-redeploy.mjs --only="$_nb_stacky" </dev/null); then
        ok "stacky s novými klíči přenasazené a zdravé — volající se smí ptát"
      else
        _nb_rc=$?
        warn "přenasazení stacků s novými klíči neskončilo čistě (aisha-redeploy exit $_nb_rc, souhrn výš) —"
        warn "  klíče JSOU vyražené a doručené do Coolify, služby je ale možná ještě nenesou."
        warn "  Opakovaný bootstrap je nepřenasadí; dokonči: node scripts/aisha-redeploy.mjs --only=${_nb_stacky}"
      fi
    else
      info "No setup keys regenerated and REDEPLOY_AFTER_NETBIRD=0 — env sync only"
      # shellcheck disable=SC2086 # word-splitting is the intent: one arg per stack
      SKIP_ENV_PREFLIGHT=1 bash "$ROOT/scripts/coolify-sync-envs.sh" $_nb_stacky_args
    fi
  fi
fi

if [ "$SETUP_KEYS_REGENERATED" -gt 0 ]; then
  ok "NetBird bootstrap complete (self-heal: $SETUP_KEYS_REGENERATED key(s) regenerated)"
else
  ok "NetBird bootstrap complete (all keys validated, no regeneration needed)"
fi

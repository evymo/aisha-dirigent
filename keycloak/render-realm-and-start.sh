#!/bin/sh
# =============================================================================
# render-realm-and-start.sh — Keycloak entrypoint wrapper.
#
# Renders the realm import file from the committed TEMPLATE, substituting the
# platform-admin identity from the environment, then hands off to kc.sh. This
# keeps every personal/account identity OUT of git: the committed realm carries
# only `__PLATFORM_ADMIN_*__` placeholders; the real admin is whatever the
# operator sets (or a lockout-safe default).
#
# Env (all optional — what you don't set is derived/defaulted):
#   PLATFORM_ADMIN_EMAIL     admin account email   (default: $ADMIN_EMAIL or admin@$PUBLIC_TLD)
#   PLATFORM_ADMIN_USERNAME  admin username        (default: email local-part)
#   PLATFORM_ADMIN_PASSWORD  TEMPORARY password     (default: changeme — must change at first login)
#
# `--import-realm` only imports on an empty realm (first boot), so re-deploys
# never clobber an admin who already changed their password.
# =============================================================================
set -eu

TEMPLATE="/opt/keycloak/aisha-realm.template.json"
TARGET_DIR="/opt/keycloak/data/import"
TARGET="${TARGET_DIR}/aisha-realm.json"

ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-${ADMIN_EMAIL:-admin@${PUBLIC_TLD:-}}}"
ADMIN_USERNAME="${PLATFORM_ADMIN_USERNAME:-${ADMIN_EMAIL%@*}}"
ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-changeme}"

if [ -f "$TEMPLATE" ]; then
  mkdir -p "$TARGET_DIR"
  # Pass 1: admin identity placeholders (__ delimiters — no collision with ${VAR})
  sed -e "s|__PLATFORM_ADMIN_EMAIL__|${ADMIN_EMAIL}|g" \
      -e "s|__PLATFORM_ADMIN_USERNAME__|${ADMIN_USERNAME}|g" \
      -e "s|__PLATFORM_ADMIN_PASSWORD__|${ADMIN_PASSWORD}|g" \
      "$TEMPLATE" > "${TARGET}.pass1"
  # Pass 2: every ${VAR} the ENVIRONMENT actually defines — derived from the
  # template, not from a hand-kept list.
  #
  # It WAS a hand-kept list of 16 names, and the failure mode is exactly what you
  # would expect: a fork sync added the openclaw-proxy client using
  # ${COMPANION_DOMAIN}, nobody added that name to the list, the placeholder
  # survived into the rendered realm, and Keycloak refused to start with
  # "Invalid client openclaw-proxy: A redirect URI is not a valid URI".
  # It only fires on a FRESH database, so the list can drift for months unnoticed
  # and then block a rebuild at the worst moment.
  #
  # Substituting only NAMES THE ENVIRONMENT DEFINES is what makes this safe:
  # Keycloak's own message-bundle placeholders (${client_id}, ${role_...}) are
  # not environment variables, so they pass through untouched. A blanket
  # substitution would destroy them — the same trap the PKI config render hit
  # with OpenXPKI's $cert_profile shorthand.
  _tmpl_vars=$(grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*\}' "$TEMPLATE" | sort -u | tr -d '${}')
  _sed_script=""
  _unset_vars=""
  for _v in $_tmpl_vars; do
    eval "_val=\${$_v-__RENDER_UNSET__}"
    if [ "$_val" = "__RENDER_UNSET__" ]; then
      # Only UPPER_CASE names are configuration. Keycloak's own placeholders are
      # lower-case (${client_id}, ${role_...}) and are SUPPOSED to stay literal,
      # so warning about them would be noise that hides a real missing value.
      case "$_v" in
        *[a-z]*) : ;;
        *) _unset_vars="$_unset_vars $_v" ;;
      esac
      continue
    fi
    # Escape sed metacharacters in the VALUE (\ & and the | delimiter) so a
    # client secret or a JWT survives verbatim.
    _esc=$(printf '%s' "$_val" | sed -e 's/[\\&|]/\\&/g')
    _sed_script="${_sed_script}s|\${${_v}}|${_esc}|g;"
  done
  if [ -n "$_sed_script" ]; then
    sed -e "$_sed_script" "${TARGET}.pass1" > "${TARGET}.pass2"
  else
    cp "${TARGET}.pass1" "${TARGET}.pass2"
  fi
  if [ -n "$_unset_vars" ]; then
    # Loud, because an unset name leaves a literal ${VAR} in the realm and the
    # import fails later with a message that names the CLIENT, not the variable.
    echo "[render-realm] WARN: template placeholders with no environment value:${_unset_vars}" >&2
    echo "[render-realm]       they stay literal and will break realm import if used in a URI" >&2
    # ⛔ TAJEMSTVÍ JE VÝJIMKA: u něj se NEVARUJE, KONČÍ SE.
    #
    # Compose je secretům důvěrných klientů předává tvarem `${VAR:-}`, protože
    # pojistka `:?` uvnitř `environment:` protlačí hodnotu do buildu a skončí
    # v `docker history` (brána build-time-mnozina-vsech-compose). Fail-closed
    # tedy nesmí být tam — musí být TADY, kde se hodnota spotřebuje.
    #
    # Bez toho by realm naimportoval klienta s heslem `${N8N_OIDC_SECRET}`
    # doslova, Keycloak by nastartoval ZDRAVÝ a přihlášení přes proxy by padalo
    # na `unauthorized_client` — o dvě vrstvy dál, než kde je příčina. Přesně
    # ta vada, kvůli které komentář u provision-sso mluví o „11 kopiích napříč
    # 7 aplikacemi, o kterých nikdo nevěděl".
    #
    # Měří se TVAR JMÉNA, ne seznam: cokoli, co nese SECRET/PASSWORD/TOKEN/KEY,
    # je tajemství. Nový klient se pod tuhle pojistku dostane tím, že VZNIKNE,
    # ne tím, že si na něj někdo vzpomene.
    _chybi_tajemstvi=""
    for _v in $_unset_vars; do
      case "$_v" in
        *SECRET*|*PASSWORD*|*TOKEN*|*_KEY|*_KEY_*|*CREDENTIAL*)
          _chybi_tajemstvi="$_chybi_tajemstvi $_v" ;;
      esac
    done
    if [ -n "$_chybi_tajemstvi" ]; then
      echo "[render-realm] FATAL: tajemství bez hodnoty:${_chybi_tajemstvi}" >&2
      echo "[render-realm]        Realm by se naimportoval s literálem místo hesla a klient by" >&2
      echo "[render-realm]        se nikdy nepřihlásil ('unauthorized_client'), zatímco Keycloak" >&2
      echo "[render-realm]        by hlásil zdraví. Doplň hodnoty do env aplikace v Coolify" >&2
      echo "[render-realm]        (generuje je scripts/generate-secrets.mjs do .env.coolify)." >&2
      exit 1
    fi
  fi
  # Pass 3: social IdP credentials (apple/google identityProviders in the
  # template). Values are sed-escaped (\ | &) so an ES256 client-secret JWT or
  # any client id survives the replacement; the values are single-line by
  # nature (base64url/reverse-domain). Unset vars → empty string, and
  # configure-realms.sh disables that IdP post-boot (no dead login button).
  esc() { printf '%s' "${1:-}" | sed -e 's/[\\|&]/\\&/g'; }
  sed \
    -e "s|\${OAUTH_APPLE_CLIENT_ID}|$(esc "${OAUTH_APPLE_CLIENT_ID:-}")|g" \
    -e "s|\${OAUTH_APPLE_CLIENT_SECRET}|$(esc "${OAUTH_APPLE_CLIENT_SECRET:-}")|g" \
    -e "s|\${OAUTH_GOOGLE_CLIENT_ID}|$(esc "${OAUTH_GOOGLE_CLIENT_ID:-}")|g" \
    -e "s|\${OAUTH_GOOGLE_CLIENT_SECRET}|$(esc "${OAUTH_GOOGLE_CLIENT_SECRET:-}")|g" \
    "${TARGET}.pass2" > "$TARGET"
  rm -f "${TARGET}.pass2"
  rm -f "${TARGET}.pass1"
  echo "[render-realm] platform admin = ${ADMIN_USERNAME} <${ADMIN_EMAIL}> (temporary password from env)"
else
  echo "[render-realm] WARN: template missing at ${TEMPLATE}; leaving any existing import file as-is" >&2
fi

# ── Email theme: per-instance support contact ────────────────────────────────
# The branded email footer ships a __SUPPORT_EMAIL__ placeholder (no company
# literal in git). Substitute it per-instance at container start, same pattern as
# the realm above. Default is the instance's own domain (support@<PUBLIC_TLD>) so
# a white-label deploy never shows another tenant's mailbox; operator can pin
# SUPPORT_EMAIL. Idempotent: once substituted the placeholder is gone, so a later
# start no-ops; a redeploy rebuilds the image (placeholder back) and re-derives.
SUPPORT_EMAIL="${SUPPORT_EMAIL:-support@${PUBLIC_TLD:-localhost}}"
EMAIL_THEME="/opt/keycloak/themes/aisha/email/html/template.ftl"
if [ -f "$EMAIL_THEME" ] && grep -q '__SUPPORT_EMAIL__' "$EMAIL_THEME" 2>/dev/null; then
  # sed -i creates its temp file inside the (image-owned, possibly read-only)
  # theme directory — under `set -eu` that crash-looped Keycloak on a root-owned
  # theme. Render via /tmp and overwrite the file; if the theme is not writable,
  # degrade to the placeholder footer and KEEP BOOTING — a cosmetic email footer
  # must never take the whole auth plane down.
  if sed "s|__SUPPORT_EMAIL__|${SUPPORT_EMAIL}|g" "$EMAIL_THEME" > /tmp/email-template.ftl 2>/dev/null \
     && cat /tmp/email-template.ftl > "$EMAIL_THEME" 2>/dev/null; then
    echo "[render-realm] email theme support contact = ${SUPPORT_EMAIL}"
  else
    echo "[render-realm] WARN: email theme not writable — __SUPPORT_EMAIL__ left as-is" >&2
  fi
  rm -f /tmp/email-template.ftl
fi

# ⛔ RE-IMPORT NENÍ NO-OP (naměřeno 2026-08-26 na ostrém --wipe).
#
# Komentář výš předpokládá, že `--import-realm` importuje jen do prázdného
# realmu. Log to VYVRACÍ: importuje při KAŽDÉM startu se strategií
# OVERWRITE_EXISTING a hned poté padá:
#
#   INFO  Realm '<instance>-realm' imported
#   WARN  Datasource '<default>': JDBC resources leaked: 3 ResultSet(s)
#   ERROR Failed to start server in (production) mode
#   ERROR Session not bound to a realm
#
# Následek: PRVNÍ boot po wipe projde, každý DALŠÍ start crash-loopuje. Nikdo si
# toho nevšiml, protože se Keycloak restartuje zřídka — po wipe ale musí, a tím
# padá celý bring-up (auth 404 → pki bez tokenu → mesh bez certifikátu → vlna 5
# zastaví zbytek).
#
# ⭐ OPRAVA: IMPORT JE IDEMPOTENTNÍ, NE PODMÍNĚNÝ VYPÍNAČEM.
#
# Do 2026-08-27 tu stál ruční vypínač `KC_SKIP_REALM_IMPORT`. Držel instanci
# nahoře, ale zaplatilo se za to hůř, než co řešil: po `--wipe` zůstal zapnutý,
# realm se proto NIKDY nenaimportoval a `/realms/<instance>-realm` vracel 404.
# Tím padl celý řetěz — bez realmu není token, bez tokenu netbird discovery,
# bez discovery `CORE_MESH_IP`, a brána vlny 6 odmítla nasadit edge. Web
# i extranet vracely 404 kvůli přepínači, který měl „jen" potlačit crash-loop.
#
# Poučení: dočasné opatření, které přežije důvod svého vzniku, je horší než vada,
# kterou tlumilo — protože příště už nikdo neví, že je zapnuté.
#
# Keycloak 26 má na to vlastní primitiv (ověřeno `kc.sh import --help` v 26.0.7):
#
#   kc.sh import --file <realm.json> --override false
#
# `--override false` znamená: chybějící realm založ, existující NEPŘEPISUJ.
# Tím odpadá důvod, proč re-import padal — `--import-realm` při startu jel se
# strategií OVERWRITE_EXISTING a druhý start končil `Session not bound to a realm`.
#
# `--import-realm` se proto ze startovních argumentů ODSTRANÍ vždy a import se
# udělá zvlášť, PŘED startem serveru.
_kc_args=""
_mel_importovat=0
for _a in "$@"; do
  if [ "$_a" = "--import-realm" ]; then
    _mel_importovat=1
    continue
  fi
  _kc_args="${_kc_args} ${_a}"
done

if [ "${KC_SKIP_REALM_IMPORT:-}" = "true" ]; then
  # ⛔ Nezůstat zticha. Vypínač je zrušený; kdyby se tiše ignoroval, operátor by
  # dál věřil, že něco dělá — a to je táž třída vady, jakou právě odstraňujeme.
  echo "[render-realm] KC_SKIP_REALM_IMPORT=true je ZRUŠENÝ a IGNORUJE SE — import je nově idempotentní. Odstraň tu proměnnou z prostředí." >&2
fi

if [ "$_mel_importovat" = "1" ]; then
  if [ -f "$TARGET" ]; then
    echo "[render-realm] idempotentní import realmu z ${TARGET} (--override false)" >&2
    # ⛔ Selhání importu NESMÍ shodit start. Když realm už existuje, import
    # skončí nenulově u některých verzí — a to je PRÁVĚ ten stav, který chceme.
    # Rozhodnout, jestli je realm použitelný, umí až běžící server; tady by
    # tvrdý pád jen vyměnil jednu crash-loop smyčku za druhou.
    if /opt/keycloak/bin/kc.sh import --file "$TARGET" --override false; then
      echo "[render-realm] import hotov" >&2
    else
      echo "[render-realm] WARN: import skončil nenulově (nejspíš realm už existuje) — startuji server" >&2
    fi
  else
    echo "[render-realm] WARN: ${TARGET} neexistuje — import přeskočen, server startuje bez něj" >&2
  fi
fi

# shellcheck disable=SC2086
exec /opt/keycloak/bin/kc.sh $_kc_args

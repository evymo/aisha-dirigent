#!/bin/bash
# keycloak/configure-realms.sh
# Post-start configuration for Keycloak realms.
# Sets AISHA ID branding + WebAuthn on both master and aisha realms.
# Called by entrypoint wrapper or manually after KC starts.
# Requires: KC_ADMIN_USER, KC_ADMIN_PASS, KC_URL (defaults below)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SEED_SANITIZER="${AISHA_KEYCLOAK_SEED_SANITIZER:-${SCRIPT_DIR}/sanitize-keycloak-seed.py}"

sanitize_seed_json() {
  python3 "$SEED_SANITIZER" "$@"
}

KC_URL="${KC_URL:-${KEYCLOAK_URL:-http://localhost:8080}}"
KC_ADMIN_USER="${KC_ADMIN_USER:-${KEYCLOAK_ADMIN:-admin}}"
KC_ADMIN_PASS="${KC_ADMIN_PASS:-${KEYCLOAK_ADMIN_PASSWORD:-}}"

if [ -z "$KC_ADMIN_PASS" ]; then
  echo "[AISHA] Missing KC_ADMIN_PASS or KEYCLOAK_ADMIN_PASSWORD."
  exit 1
fi

echo "[AISHA] Waiting for Keycloak to be ready..."
for i in $(seq 1 60); do
  if curl -sf "${KC_URL}/health/ready" > /dev/null 2>&1; then
    echo "[AISHA] Keycloak is ready."
    break
  fi
  [ "$i" -eq 60 ] && { echo "[AISHA] Keycloak not ready after 60s, aborting."; exit 1; }
  sleep 2
done

# Obtain admin token
TOKEN=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=${KC_ADMIN_USER}" \
  -d "password=${KC_ADMIN_PASS}" \
  -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null) \
  || { echo "[AISHA] Failed to obtain admin token."; exit 1; }

AUTH="Authorization: Bearer ${TOKEN}"

# The application realm this deployment serves (env-driven; default 'aisha').
APP_REALM="${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}"

# ── Import the tenant realm (a non-default KEYCLOAK_REALM) if not present ─────
# The keycloak image's --import-realm only seeds the 'aisha' realm on first boot
# (render-realm-and-start.sh bakes aisha-realm.json only). A tenant fork sets
# KEYCLOAK_REALM=<tenant>-realm and ships keycloak/<tenant>-realm.json in the
# repo; create it here via the Admin API (idempotent) so the account-console +
# instance-client steps below — and every service that targets
# https://<kc>/realms/${APP_REALM} — have a realm to bind to. This script runs
# from ${REPO_ROOT}/keycloak (aisha-cold-start.sh), so the file is on disk next
# to it. Override with TENANT_REALM_FILE.
TENANT_REALM_FILE="${TENANT_REALM_FILE:-$(dirname "$0")/${APP_REALM}.json}"
if [ "$APP_REALM" != "aisha" ] && [ "$APP_REALM" != "master" ]; then
  EXISTS=$(curl -s -o /dev/null -w "%{http_code}" -H "${AUTH}" "${KC_URL}/admin/realms/${APP_REALM}" 2>/dev/null || true)
  if [ "$EXISTS" = "200" ]; then
    echo "[AISHA] tenant realm '${APP_REALM}' already exists — skipping import"
  elif [ -f "$TENANT_REALM_FILE" ]; then
    TENANT_CLEAN=$(mktemp)
    sanitize_seed_json "$TENANT_REALM_FILE" "$TENANT_CLEAN" \
      || { echo "[AISHA] ⚠️ tenant realm '${APP_REALM}' sanitize failed"; rm -f "$TENANT_CLEAN"; exit 1; }
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${KC_URL}/admin/realms" \
      -H "${AUTH}" -H "Content-Type: application/json" --data-binary @"$TENANT_CLEAN" 2>/dev/null || true)
    rm -f "$TENANT_CLEAN"
    case "$HTTP" in
      2*)  echo "[AISHA] ✅ tenant realm '${APP_REALM}' imported (${TENANT_REALM_FILE##*/} → HTTP ${HTTP})" ;;
      409) echo "[AISHA] tenant realm '${APP_REALM}' already exists (409) — ok" ;;
      *)   echo "[AISHA] ⚠️ tenant realm '${APP_REALM}' import failed: HTTP ${HTTP}"; exit 1 ;;
    esac
  else
    echo "[AISHA] ⚠️ tenant realm '${APP_REALM}' configured but ${TENANT_REALM_FILE} not found — every service expects it; aborting"; exit 1
  fi
fi

# ── Configure the platform realms ──────────────────────────────────
# `${APP_REALM}`, ne literál `aisha`: branding se má nanést na realm, který
# instance SKUTEČNĚ používá. S pojmenovaným realmem sahal literál na realm, který
# tu být nemusí — PUT vrátil 404, krok vypsal varování a realm instance zůstal
# bez tématu (⛔ 2026-08-25). Duplicita `master aisha` při výchozím nastavení
# nevzniká: `APP_REALM` je tam právě `aisha`.
for REALM in master "${APP_REALM}"; do
  echo "[AISHA] Configuring realm: ${REALM}"
  
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    "${KC_URL}/admin/realms/${REALM}" \
    -H "${AUTH}" \
    -H "Content-Type: application/json" \
    -d "{
      \"displayName\": \"AISHA ID\",
      \"loginTheme\": \"aisha\",
      \"accountTheme\": \"aisha\"
    }")
  
  if [ "$HTTP" = "204" ]; then
    echo "[AISHA] ✅ ${REALM} realm: theme + branding set"
  else
    echo "[AISHA] ⚠️ ${REALM} realm: HTTP ${HTTP}"
  fi
done

# ── Self-service registration (app realm) ────────────────────────────────────
# `registrationAllowed` je v realm šabloně `true`, ale ta se aplikuje JEN na
# prázdný realm (první boot) — na běžícím nasazení ji nemá kdo změnit. Pro
# instanci, kde realm obsluhuje FIREMNÍ extranet, je samoobslužná registrace
# rozhodnutí, ne výchozí stav: kdokoli si jinak založí účet do realmu, který
# vydává tokeny pro data zákazníka.
#
# Sociální přihlášení (Google/Apple) je něco JINÉHO než tohle a zůstává zapnuté —
# váže se na existující identitu, nezakládá ji.
#
# Default `true` = dnešní chování, takže komunitní i upstream nasazení se nemění.
# Účty pak zakládá roster (`operators.json` → provision-operators.mjs), který
# umí jednorázové heslo s vynuceným resetem.
KC_REGISTRATION_ALLOWED="${KC_REGISTRATION_ALLOWED:-true}"
case "$KC_REGISTRATION_ALLOWED" in
  true|false) ;;
  *) echo "[AISHA] ⚠️ KC_REGISTRATION_ALLOWED='${KC_REGISTRATION_ALLOWED}' není true/false — beru true"
     KC_REGISTRATION_ALLOWED=true ;;
esac
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  "${KC_URL}/admin/realms/${APP_REALM}" \
  -H "${AUTH}" \
  -H "Content-Type: application/json" \
  -d "{\"registrationAllowed\": ${KC_REGISTRATION_ALLOWED}}")
if [ "$HTTP" = "204" ]; then
  echo "[AISHA] ✅ ${APP_REALM} realm: registrationAllowed=${KC_REGISTRATION_ALLOWED}"
else
  echo "[AISHA] ⚠️ ${APP_REALM} realm: registrationAllowed → HTTP ${HTTP}"
fi

# ── account console webOrigins (aisha realm) ─────────────────────────────────
# Keycloak's built-in `account` / `account-console` clients are created with
# EMPTY webOrigins on a fresh realm → the account console SPA's CORS init fails
# after login ("Something went wrong", HTTP 401). Set the realm's own public
# origin (NOT a wildcard) so self-service credential/passkey management loads.
# Soft-fail: never aborts cold-start (set -e is relaxed per-step with || true).
# Bez deklarované domény = lokální stack (Keycloak na :8180), nikdy cizí instance.
if [ -n "${KEYCLOAK_DOMAIN_PUBLIC:-${KC_HOSTNAME:-}}" ]; then
  ACCOUNT_ORIGIN="https://${KEYCLOAK_DOMAIN_PUBLIC:-${KC_HOSTNAME}}"
else
  ACCOUNT_ORIGIN="http://localhost:8180"
fi
for CLIENT_ID in account account-console; do
  CUUID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${APP_REALM}/clients?clientId=${CLIENT_ID}" 2>/dev/null \
    | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0]['id'] if a else '')" 2>/dev/null || true)
  if [ -z "$CUUID" ]; then
    echo "[AISHA] ⚠️ ${CLIENT_ID}: client not found (skipping webOrigins)"
    continue
  fi
  REP=$(curl -sf -H "${AUTH}" "${KC_URL}/admin/realms/${APP_REALM}/clients/${CUUID}" 2>/dev/null || true)
  NEWREP=$(printf '%s' "$REP" | ACCOUNT_ORIGIN="$ACCOUNT_ORIGIN" python3 -c \
    "import sys,json,os; c=json.load(sys.stdin); c['webOrigins']=[os.environ['ACCOUNT_ORIGIN']]; print(json.dumps(c))" 2>/dev/null || true)
  if [ -z "$NEWREP" ]; then
    echo "[AISHA] ⚠️ ${CLIENT_ID}: could not build client rep (skipping)"
    continue
  fi
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    "${KC_URL}/admin/realms/${APP_REALM}/clients/${CUUID}" \
    -H "${AUTH}" -H "Content-Type: application/json" -d "$NEWREP" 2>/dev/null || true)
  echo "[AISHA] ${CLIENT_ID} webOrigins=${ACCOUNT_ORIGIN} → HTTP ${HTTP}"
done

# ── Platform clients: doplnit CHYBĚJÍCÍ do živého realmu ─────────────────────
# `--import-realm` se pouští jen nad PRÁZDNÝM realmem (viz render-realm-and-start.sh).
# Nový platformní klient přidaný do keycloak/aisha-realm.json se tedy do už
# běžícího Keycloaku nikdy nedostane — a nikdo si toho nevšimne, dokud si o něj
# někdo neřekne. Instanční klienti tuhle cestu mají (níž, přes Admin API),
# platformní ji do 2026-08-04 neměli.
#
# Naměřeno při zavádění `extranet-proxy`: klient by v produkci prostě nebyl,
# `provision-sso.sh` by mu heslo nenastavil (volá se s `|| true`, takže TIŠE)
# a oauth2-proxy před extranetem by se nepřihlásil — povrch nedostupný.
#
# ZÁMĚRNĚ JEN ZAKLÁDÁ, NEPŘEPISUJE. Existující klient se nechá být: nese
# heslo od provision-sso.sh a případné doladění operátorem, a PUT ze šablony
# by obojí zahodil. Chybějící klient je mezera v dodávce; existující je stav.
# Zdroj klientů se liší podle toho, ODKUD se skript pouští, a na tom už jsem
# jednou uklouzl: cold-start ho volá z HOSTITELE (bash $REPO_ROOT/keycloak/…),
# kde cesta do kontejneru neexistuje. Napevno zadaná container-cesta by celý
# blok poslala do větve „nenalezeno → přeskočeno" — tedy přesně to tiché
# přeskočení, kvůli kterému tenhle kód vznikl.
#
# Pořadí: vyrenderovaný realm v kontejneru (má ${VAR} dosazené) → šablona
# v obrazu → soubor v repu vedle skriptu. Substituce níž doplní zbytek.
REALM_SRC="${REALM_IMPORT:-}"
if [ -z "$REALM_SRC" ]; then
  for _c in /opt/keycloak/data/import/aisha-realm.json \
            /opt/keycloak/aisha-realm.template.json \
            "$(dirname "$0")/aisha-realm.json"; do
    [ -f "$_c" ] && { REALM_SRC="$_c"; break; }
  done
fi
# ${VAR} → hodnota z prostředí, JEN pro velká písmena. Keycloak má vlastní
# placeholdery malými (${client_id}, ${role_…}) a ty musí zůstat doslovné —
# plošná substituce by je zničila (táž past, kterou popisuje render-realm).
# Nad už vyrenderovaným souborem tenhle krok nic nezmění.
if [ -n "$REALM_SRC" ] && [ -f "$REALM_SRC" ]; then
  REALM_IMPORT=$(mktemp)
  python3 -c "
import json,os,re,sys
raw=open(sys.argv[1],encoding='utf-8').read()
def sub(m):
    n=m.group(1)
    if not n.isupper(): return m.group(0)     # placeholder Keycloaku
    return os.environ.get(n, m.group(0))
open(sys.argv[2],'w',encoding='utf-8').write(re.sub(r'\\\$\{([A-Za-z_][A-Za-z0-9_]*)\}', sub, raw))
" "$REALM_SRC" "$REALM_IMPORT" || REALM_IMPORT="$REALM_SRC"
  echo "[AISHA] Platform clients: zdroj ${REALM_SRC}"
fi
if [ -n "$REALM_IMPORT" ] && [ -f "$REALM_IMPORT" ]; then
  PC_CREATED=0
  PC_SKIPPED=0
  PC_IDS=$(python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
for c in d.get('clients',[]):
    cid=c.get('clientId')
    if cid: print(cid)
" "$REALM_IMPORT" 2>/dev/null) || PC_IDS=""
  for CID in $PC_IDS; do
    CUUID=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${APP_REALM}/clients?clientId=${CID}" \
      | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0]['id'] if a else '')" 2>/dev/null) || CUUID=""
    if [ -n "$CUUID" ]; then
      PC_SKIPPED=$((PC_SKIPPED + 1))
      continue
    fi
    CLEAN=$(mktemp)
    sanitize_seed_json "$REALM_IMPORT" "$CLEAN" "$CID" \
      || { echo "[AISHA] ⚠️ platform client '${CID}': nelze připravit"; rm -f "$CLEAN"; exit 1; }
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
      "${KC_URL}/admin/realms/${APP_REALM}/clients" \
      -H "${AUTH}" -H "Content-Type: application/json" --data-binary @"$CLEAN" 2>/dev/null || true)
    rm -f "$CLEAN"
    case "$HTTP" in
      2*) echo "[AISHA] ✅ platform client '${CID}' založen (chyběl v živém realmu → HTTP ${HTTP})"
          PC_CREATED=$((PC_CREATED + 1)) ;;
      *)  echo "[AISHA] ⚠️ platform client '${CID}': HTTP ${HTTP}"; exit 1 ;;
    esac
  done
  echo "[AISHA] Platform clients: ${PC_CREATED} založeno, ${PC_SKIPPED} už existovalo"
else
  echo "[AISHA] ⚠️ platform clients: rendered realm nenalezen (${REALM_IMPORT}) — přeskočeno"
fi

# ── Instance clients (private overlay) ───────────────────────────────────────
# KC-plane mirror of scripts/deploy/instance-data-hook.sh: OIDC clients that
# belong to THIS deployment (not the platform — e.g. a hosted side app) live in
# the private aisha-instance-data repo as keycloak/NN_*-client.json and are
# upserted here through the Admin API. The realm import can't carry them (the
# keycloak image builds from the public repo — no private content), and
# --import-realm only fires on an empty realm anyway; the Admin API path is
# idempotent and works on every re-run. Empty/unset URL = community install →
# section no-ops. Failures exit non-zero AFTER the platform branding above so
# the cold-start wrapper (`|| warn`) surfaces them without nuking branding.
URL_RAW="${AISHA_INSTANCE_DATA_GIT_URL:-}"
if [ -n "$URL_RAW" ]; then
  # Self-heal JSON-escaped slashes (`https:\/\/…` from a raw Coolify API dump —
  # PHP json_encode escapes `/` as `\/`); same guard as instance-data-hook.sh.
  URL_RAW=$(printf '%s' "$URL_RAW" | sed 's|\\/|/|g')
  if ! command -v git >/dev/null 2>&1; then
    echo "[AISHA] ⚠️ instance clients: git not available on this host — skipping"
  else
    REF=""
    IC_URL="$URL_RAW"
    case "$URL_RAW" in
      *"#"*) REF="${URL_RAW##*#}"; IC_URL="${URL_RAW%#*}" ;;
    esac
    IC_REDACTED=$(printf '%s' "$IC_URL" | sed -E 's|(://)[^@/]+@|\1***@|')
    IC_WORKDIR=$(mktemp -d /tmp/instance-kc.XXXXXX)
    trap 'rm -rf "$IC_WORKDIR"' EXIT
    echo "[AISHA] Instance clients: cloning ${IC_REDACTED}${REF:+ (ref: $REF)} …"
    # ⛔ `2>/dev/null` skrylo důvod; velký overlay se přes jedno spojení trhá.
    # Běží uvnitř obrazu, kde lib/git-klon.sh není — týž tvar inline.
    _ic_err="$(mktemp)"
    # shellcheck disable=SC2086 # prázdný přepínač se NESMÍ uvozovkovat
    if git clone --quiet --depth 1 --filter=blob:none ${REF:+--branch "$REF"} "$IC_URL" "$IC_WORKDIR/repo" 2>"$_ic_err"; then
      # Master-realm admin tokens default to 60 s lifetime — the branding steps
      # + clone may have consumed it. Re-mint for this section.
      TOKEN=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
        -d "client_id=admin-cli" \
        -d "username=${KC_ADMIN_USER}" \
        -d "password=${KC_ADMIN_PASS}" \
        -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null) \
        || { echo "[AISHA] ⚠️ instance clients: token refresh failed"; exit 1; }
      AUTH="Authorization: Bearer ${TOKEN}"
      # ── Consumer realms — realms this KC PROVIDES to other stacks ────────────
      # A shared Keycloak is a service: other stacks (forks/verticals) consume a
      # realm here and must never administer this KC themselves. Each such realm is
      # declared as keycloak/<NN>-<realm>-realm.json in THIS stack's instance-data,
      # so every deploy of the OWNER re-establishes the service it provides — no
      # consumer ever needs this stack's admin credentials.
      # CREATE-IF-MISSING only: a live consumer realm carries its own clients, users
      # and sessions, so it is never overwritten from a file.
      CR_COUNT=0
      for f in "$IC_WORKDIR"/repo/keycloak/*-realm.json; do
        [ -e "$f" ] || break
        RID=$(python3 -c "import sys,json; print(json.load(open(sys.argv[1]))['realm'])" "$f" 2>/dev/null) \
          || { echo "[AISHA] ⚠️ consumer realms: $(basename "$f") is not valid JSON with a 'realm' key"; exit 1; }
        REXISTS=$(curl -s -o /dev/null -w "%{http_code}" -H "${AUTH}" \
          "${KC_URL}/admin/realms/${RID}" 2>/dev/null || true)
        if [ "$REXISTS" = "200" ]; then
          echo "[AISHA] consumer realm '${RID}' already served — left untouched"
          CR_COUNT=$((CR_COUNT + 1))
          continue
        fi
        # KC RealmRepresentation rejects unknown fields (HTTP 400). Strip
        # documentation keys recursively: clients and nested protocol mapper
        # objects may carry _comment fields too, not only the realm root.
        RCLEAN=$(mktemp)
        sanitize_seed_json "$f" "$RCLEAN" \
          || { echo "[AISHA] ⚠️ consumer realms: $(basename "$f") strip failed"; rm -f "$RCLEAN"; exit 1; }
        HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${KC_URL}/admin/realms" \
          -H "${AUTH}" -H "Content-Type: application/json" --data-binary @"$RCLEAN" 2>/dev/null || true)
        rm -f "$RCLEAN"
        case "$HTTP" in
          2*)  echo "[AISHA] ✅ consumer realm '${RID}' provisioned ($(basename "$f") → HTTP ${HTTP})"; CR_COUNT=$((CR_COUNT + 1)) ;;
          409) echo "[AISHA] consumer realm '${RID}' already exists (409) — ok"; CR_COUNT=$((CR_COUNT + 1)) ;;
          *)   echo "[AISHA] ⚠️ consumer realm '${RID}': HTTP ${HTTP}"; exit 1 ;;
        esac
      done
      if [ "$CR_COUNT" -eq 0 ]; then
        echo "[AISHA] Consumer realms: none declared in overlay — this KC serves only its own realm"
      fi

      IC_COUNT=0
      for f in "$IC_WORKDIR"/repo/keycloak/*-client.json; do
        [ -e "$f" ] || break
        CID=$(python3 -c "import sys,json; print(json.load(open(sys.argv[1]))['clientId'])" "$f" 2>/dev/null) \
          || { echo "[AISHA] ⚠️ instance clients: $(basename "$f") is not valid JSON with clientId"; exit 1; }
        # KC ClientRepresentation rejects unknown fields (HTTP 400) — strip _-prefixed
        # doc keys (e.g. "_note") so instance-client seeds can carry documentation and
        # still upsert cleanly on every cold-start. (Fixes <fork>-app HTTP 400, 2026-07-23.)
        CLEAN=$(mktemp)
        sanitize_seed_json "$f" "$CLEAN" \
          || { echo "[AISHA] ⚠️ instance clients: $(basename "$f") strip failed"; rm -f "$CLEAN"; exit 1; }
        CUUID=$(curl -sf -H "${AUTH}" \
          "${KC_URL}/admin/realms/${APP_REALM}/clients?clientId=${CID}" \
          | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0]['id'] if a else '')") || CUUID=""
        if [ -n "$CUUID" ]; then
          HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
            "${KC_URL}/admin/realms/${APP_REALM}/clients/${CUUID}" \
            -H "${AUTH}" -H "Content-Type: application/json" --data-binary @"$CLEAN" 2>/dev/null || true)
        else
          HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
            "${KC_URL}/admin/realms/${APP_REALM}/clients" \
            -H "${AUTH}" -H "Content-Type: application/json" --data-binary @"$CLEAN" 2>/dev/null || true)
        fi
        rm -f "$CLEAN"
        case "$HTTP" in
          2*) echo "[AISHA] ✅ instance client '${CID}' upserted ($(basename "$f") → HTTP ${HTTP})"; IC_COUNT=$((IC_COUNT + 1)) ;;
          *)  echo "[AISHA] ⚠️ instance client '${CID}': HTTP ${HTTP}"; exit 1 ;;
        esac

        # ── Client scopes: reprezentace je NEUMÍ ─────────────────────────────
        # Keycloak `defaultClientScopes`/`optionalClientScopes` v reprezentaci
        # při POST i PUT IGNORUJE — spravují se jen přes vlastní sub-resource
        # `/clients/{uuid}/{default|optional}-client-scopes/{scopeId}`.
        # Naměřeno 2026-08-02 na produkci: `10-<instance>-app-client.json` (instanční overlay) deklaruje
        # ["openid","email","profile"], upsertuje se při každém rolloutu, a živý
        # klient má `defaultClientScopes: []`. Deklarace v souboru tedy měsíce
        # nedělala NIC a nikdo se to nedozvěděl — soubor sliboval, co kanál
        # neuměl doručit. Dorovnáváme to tady, aby seed znamenal, co říká.
        # Ověřeno experimentem (KC 26.0.7): POST scopy z reprezentace aplikuje,
        # PUT je IGNORUJE — ani nepřidá, ani neodebere. Existující klient se
        # proto seedem nikdy nedorovnal.
        # Sémantika je ZÁMĚRNĚ ADITIVNÍ: seed říká, co tam být MUSÍ, ne co tam
        # smí být samo. Neodebíráme scopy, které soubor nezmiňuje — odebírání
        # by z dokumentu udělalo výhradní pravdu o něčem, co spravuje i konzole.
        # Idempotentní PUT; scope, který v realmu není, je hlasitá vada seedu.
        CUUID=$(curl -sf -H "${AUTH}" \
          "${KC_URL}/admin/realms/${APP_REALM}/clients?clientId=${CID}" \
          | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0]['id'] if a else '')") || CUUID=""
        if [ -n "$CUUID" ]; then
          SCOPES_JSON=$(curl -sf -H "${AUTH}" "${KC_URL}/admin/realms/${APP_REALM}/client-scopes" 2>/dev/null) || SCOPES_JSON=""
          for KIND in default optional; do
            WANTED=$(python3 -c "
import json,sys
d=json.load(open(sys.argv[1])); k=sys.argv[2]+'ClientScopes'
print('\n'.join(d.get(k) or []))" "$f" "$KIND" 2>/dev/null) || WANTED=""
            [ -n "$WANTED" ] || continue
            echo "$WANTED" | while IFS= read -r SCOPE; do
              [ -n "$SCOPE" ] || continue
              SID=$(printf '%s' "$SCOPES_JSON" | SCOPE="$SCOPE" python3 -c "
import json,os,sys
try: d=json.load(sys.stdin)
except Exception: d=[]
print(next((s['id'] for s in d if s['name']==os.environ['SCOPE']), ''))" 2>/dev/null) || SID=""
              if [ -z "$SID" ]; then
                echo "[AISHA] ⚠️ instance client '${CID}': ${KIND} scope '${SCOPE}' v realmu neexistuje — seed slibuje, co realm nemá"
                continue
              fi
              SC_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
                "${KC_URL}/admin/realms/${APP_REALM}/clients/${CUUID}/${KIND}-client-scopes/${SID}" \
                -H "${AUTH}" 2>/dev/null || true)
              case "$SC_HTTP" in
                2*) echo "[AISHA]    ${KIND} scope '${SCOPE}' → ${CID}" ;;
                *)  echo "[AISHA] ⚠️ instance client '${CID}': ${KIND} scope '${SCOPE}' → HTTP ${SC_HTTP}" ;;
              esac
            done
          done
        fi
      done
      if [ "$IC_COUNT" -eq 0 ]; then
        echo "[AISHA] Instance clients: no keycloak/*-client.json in overlay — nothing to do"
      fi
    else
      echo "[AISHA] ⚠️ instance clients: clone of ${IC_REDACTED} failed"
      exit 1
    fi
  fi
fi

# ── Apple client secret: mint fresh from key material when available ─────────
# Apple caps the Sign-in-with-Apple client secret at a 6-month ES256 JWT, so a
# static OAUTH_APPLE_CLIENT_SECRET in env always expires eventually (dead Apple
# login, no error anywhere). When the signing material is in env —
# APPLE_TEAM_ID (iss) + APPLE_KEY_ID (kid) + APPLE_AUTH_KEY_B64 (base64 of the
# AuthKey_*.p8 PEM) + OAUTH_APPLE_CLIENT_ID (sub = Services ID) — mint a fresh
# ~6-month JWT on every run instead; the static env secret stays as fallback.
# stdlib-only: openssl signs, python converts DER → raw JOSE signature.
if [ -n "${APPLE_AUTH_KEY_B64:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] \
   && [ -n "${APPLE_KEY_ID:-}" ] && [ -n "${OAUTH_APPLE_CLIENT_ID:-}" ]; then
  # ⭐ JEDNO MÍSTO PRAVDY: tutéž ražbu volá i scripts/instance-rollout.sh.
  # Převod podpisu DER → JOSE je dost jemný na to, aby se dvě kopie časem
  # rozešly, a rozdíl by se projevil až tím, že Apple přestane přijímat secret.
  APPLE_MINTER="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/mint-apple-secret.py"
  if [ ! -f "$APPLE_MINTER" ]; then
    echo "[AISHA] ⚠️ mint-apple-secret.py chybí vedle configure-realms.sh — Apple secret se nerazí"
  else
    APPLE_MINT_ERR=$(mktemp)
    MINTED=$(python3 "$APPLE_MINTER" 2>"$APPLE_MINT_ERR" || true)
    if [ -n "$MINTED" ]; then
      OAUTH_APPLE_CLIENT_SECRET="$MINTED"
      echo "[AISHA] Apple client secret minted fresh from APPLE_AUTH_KEY_B64 (valid ~6 months)"
    else
      # Nezdar se VYSLOVÍ i s důvodem. Tichý fallback na prázdnou statickou
      # hodnotu je přesně to, co by z „Apple nefunguje" udělalo neviditelnou vadu.
      echo "[AISHA] ⚠️ Apple client secret mint failed: $(tr '\n' ' ' < "$APPLE_MINT_ERR")"
      echo "[AISHA]    padá se zpět na statický OAUTH_APPLE_CLIENT_SECRET (u nás prázdný ⇒ IdP se nechá beze změny)"
    fi
    rm -f "$APPLE_MINT_ERR"
  fi
fi

# ── Social identity providers (apple / google) from env ──────────────────────
# The realm template ships both IdPs with ${OAUTH_*_CLIENT_ID/SECRET}
# placeholders, but --import-realm fires only on an EMPTY realm and the KC
# container never receives those env vars (render-realm-and-start.sh
# substitutes domains only) — so every wipe left the IdPs unconfigured until an
# operator patched them in the admin console by hand. Reconcile them here from
# env on every run: credentials present → upsert config + enable; credentials
# absent → disable an existing IdP (no dead button on the login page) or skip.
# Secrets travel via env into python and a tmp file — never through argv/logs.
TOKEN=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=${KC_ADMIN_USER}" \
  -d "password=${KC_ADMIN_PASS}" \
  -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null) \
  || { echo "[AISHA] ⚠️ social IdPs: token refresh failed"; exit 1; }
AUTH="Authorization: Bearer ${TOKEN}"
IDP_TMP=$(mktemp -d /tmp/idp-kc.XXXXXX)
IDP_BASE="${KC_URL}/admin/realms/${APP_REALM}/identity-provider/instances"
for IDP_ALIAS in apple google; do
  case "$IDP_ALIAS" in
    apple)  IDP_CLIENT_ID="${OAUTH_APPLE_CLIENT_ID:-}";  IDP_CLIENT_SECRET="${OAUTH_APPLE_CLIENT_SECRET:-}";  IDP_SCOPE="openid email name";    IDP_ORDER="2" ;;
    google) IDP_CLIENT_ID="${OAUTH_GOOGLE_CLIENT_ID:-}"; IDP_CLIENT_SECRET="${OAUTH_GOOGLE_CLIENT_SECRET:-}"; IDP_SCOPE="openid email profile"; IDP_ORDER="1" ;;
  esac
  IDP_CODE=$(curl -s -o "${IDP_TMP}/cur.json" -w "%{http_code}" -H "${AUTH}" "${IDP_BASE}/${IDP_ALIAS}" 2>/dev/null || true)
  if [ -z "$IDP_CLIENT_ID" ] || [ -z "$IDP_CLIENT_SECRET" ]; then
    if [ "$IDP_CODE" = "200" ]; then
      # „Nemám to v env" NENÍ totéž co „ten poskytovatel je mrtvý".
      # Rozhoduje, co má KEYCLOAK: bez clientId je to opravdu mrtvé tlačítko
      # a patří vypnout (původní záměr). S nastaveným clientId je přihlášení
      # ŽIVÉ a env o něm jen neví — sáhnout na něj by byla ztráta funkce.
      #
      # A hlavně: PUT by tu byl NIČIVÝ. Keycloak vydává `clientSecret`
      # MASKOVANÝ (samé hvězdičky), takže „načti a zapiš zpátky" přepíše
      # skutečné heslo literálem `**********`. Naměřeno na produkci
      # 2026-08-04: apple mělo clientId 21 znaků a secret maskovaný, a to
      # heslo neexistuje nikde jinde — ani v .env.coolify, ani v
      # .env-prod-backup, ani v záloze (API ho nevydá).
      IDP_LIVE_ID=$(python3 -c "
import json,sys
print(json.load(open(sys.argv[1])).get('config',{}).get('clientId','') or '')" "${IDP_TMP}/cur.json" 2>/dev/null || echo "")
      if [ -n "$IDP_LIVE_ID" ]; then
        echo "[AISHA] IdP ${IDP_ALIAS}: bez údajů v env, ale v Keycloaku NAKONFIGUROVANÝ — ponechán beze změny"
      else
        python3 -c "
import json,sys
b=json.load(open(sys.argv[1])); b['enabled']=False
# Maskovaný secret se nikdy neposílá zpět — jinak by se jím přepsal skutečný.
c=b.get('config') or {}
s=c.get('clientSecret')
if isinstance(s,str) and s and set(s)=={'*'}: c.pop('clientSecret',None)
json.dump(b,open(sys.argv[2],'w'))" "${IDP_TMP}/cur.json" "${IDP_TMP}/new.json"
        HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "${IDP_BASE}/${IDP_ALIAS}" \
          -H "${AUTH}" -H "Content-Type: application/json" --data-binary @"${IDP_TMP}/new.json" 2>/dev/null || true)
        echo "[AISHA] IdP ${IDP_ALIAS}: bez údajů v env i v Keycloaku — vypnut (HTTP ${HTTP})"
      fi
    else
      echo "[AISHA] IdP ${IDP_ALIAS}: no env credentials — skipping"
    fi
    continue
  fi
  if [ "$IDP_CODE" = "200" ]; then
    IDP_CLIENT_ID="$IDP_CLIENT_ID" IDP_CLIENT_SECRET="$IDP_CLIENT_SECRET" IDP_SCOPE="$IDP_SCOPE" python3 -c "
import json,os,sys
b=json.load(open(sys.argv[1])); b['enabled']=True
c=b.setdefault('config',{})
c['clientId']=os.environ['IDP_CLIENT_ID']; c['clientSecret']=os.environ['IDP_CLIENT_SECRET']
c.setdefault('defaultScope',os.environ['IDP_SCOPE'])
json.dump(b,open(sys.argv[2],'w'))" "${IDP_TMP}/cur.json" "${IDP_TMP}/new.json"
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "${IDP_BASE}/${IDP_ALIAS}" \
      -H "${AUTH}" -H "Content-Type: application/json" --data-binary @"${IDP_TMP}/new.json" 2>/dev/null || true)
  else
    IDP_ALIAS="$IDP_ALIAS" IDP_CLIENT_ID="$IDP_CLIENT_ID" IDP_CLIENT_SECRET="$IDP_CLIENT_SECRET" IDP_SCOPE="$IDP_SCOPE" IDP_ORDER="$IDP_ORDER" python3 -c "
import json,os
a=os.environ['IDP_ALIAS']
json.dump({'alias':a,'displayName':a.capitalize(),'providerId':a,'enabled':True,
  'trustEmail':True,'storeToken':False,'linkOnly':False,
  'firstBrokerLoginFlowAlias':'aisha first broker login',
  'config':{'clientId':os.environ['IDP_CLIENT_ID'],'clientSecret':os.environ['IDP_CLIENT_SECRET'],
    'defaultScope':os.environ['IDP_SCOPE'],'syncMode':'IMPORT',
    'guiOrder':os.environ['IDP_ORDER'],'useJwksUrl':'true'}},
  open('${IDP_TMP}/new.json','w'))"
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${IDP_BASE}" \
      -H "${AUTH}" -H "Content-Type: application/json" --data-binary @"${IDP_TMP}/new.json" 2>/dev/null || true)
  fi
  case "$HTTP" in
    2*) echo "[AISHA] ✅ IdP ${IDP_ALIAS} configured from env (HTTP ${HTTP})" ;;
    *)  echo "[AISHA] ⚠️ IdP ${IDP_ALIAS}: HTTP ${HTTP}"; rm -rf "$IDP_TMP"; exit 1 ;;
  esac
done
rm -rf "$IDP_TMP"

echo "[AISHA] Realm configuration complete."

#!/usr/bin/env bash
# =============================================================================
# provision-sso.sh — Provision SSO federation for admin services
# =============================================================================
# Configures Keycloak OIDC clients for all admin services.
#
# SSO Architecture:
#   • Appsmith CE  → OAuth2 Proxy (appsmith-auth)  → KC client: appsmith-proxy (admin/staff)
#   • Intranet     → OAuth2 Proxy (intranet-auth)  → KC client: appsmith-intranet-proxy (all roles)
#   • NocoDB OSS   → OAuth2 Proxy (nocodb-auth)    → KC client: nocodb-proxy
#   • Langfuse v3  → native AUTH_CUSTOM_* env vars → KC client: langfuse
#   • Studio       → OAuth2 Proxy (studio-auth)    → KC client: studio-proxy
#   • Extranet     → OAuth2 Proxy (extranet-auth)  → KC client: extranet-proxy
#   • n8n          → OAuth2 Proxy (n8n-auth)        → KC client: n8n-proxy
#
# Usage:
#   bash scripts/provision-sso.sh                     # auto-detect local/prod
#   bash scripts/provision-sso.sh --local             # force local mode
#   bash scripts/provision-sso.sh --prod              # force production mode
#   bash scripts/provision-sso.sh --check             # verify SSO status only
#   bash scripts/provision-sso.sh --keycloak-only     # only provision Keycloak
#
# Prerequisites:
#   1. Keycloak running and realm "aisha" imported
#   2. For production: KEYCLOAK_ADMIN_PASSWORD, APPSMITH_OIDC_SECRET,
  #      LANGFUSE_OIDC_SECRET, NOCODB_OIDC_SECRET,
  #      STUDIO_OIDC_SECRET, N8N_OIDC_SECRET, EXTRANET_OIDC_SECRET set in environment
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib/kc-modelovy-mesh.sh
source "$PROJECT_ROOT/scripts/lib/kc-modelovy-mesh.sh"

# ─── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

ok()      { echo -e "  ${GREEN}✓${NC} $*"; }
fail()    { echo -e "  ${RED}✗${NC} $*"; }
info()    { echo -e "  ${BLUE}ℹ${NC} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $*"; }
skip()    { echo -e "  ${DIM}○ $*${NC}"; }
section() { echo ""; echo -e "${BLUE}═══ $* ═══${NC}"; }

# ─── Argument parsing ─────────────────────────────────────────
MODE=""
CHECK_ONLY=false
KC_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --local)         MODE="local" ;;
    --prod)          MODE="prod" ;;
    --check)         CHECK_ONLY=true ;;
    --keycloak-only) KC_ONLY=true ;;
    --help|-h)
      echo "Usage: $0 [--local|--prod] [--check] [--keycloak-only]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--local|--prod] [--check] [--keycloak-only]"
      exit 1
      ;;
  esac
done

# ─── Auto-detect mode ────────────────────────────────────────
if [[ -z "$MODE" ]]; then
  if curl -sf --max-time 10 "http://localhost:8180/health/ready" &>/dev/null; then
    MODE="local"
  elif [[ -n "${KEYCLOAK_URL:-}" ]] && curl -sf --max-time 10 "${KEYCLOAK_URL}/health/ready" &>/dev/null; then
    MODE="prod"
  else
    fail "Cannot detect Keycloak — specify --local or --prod"
    exit 1
  fi
fi

# ─── Mode-specific config ────────────────────────────────────
if [[ "$MODE" == "local" ]]; then
  KC_URL="http://localhost:8180"
  KC_ADMIN="admin"
  KC_PASS="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
  APPSMITH_PROXY_URL="http://localhost:4180"
  NOCODB_PROXY_URL="http://localhost:4181"
  LANGFUSE_URL="http://localhost:3100"
  STUDIO_PROXY_URL="http://localhost:4182"
  N8N_PROXY_URL="http://localhost:4183"
  INTRANET_PROXY_URL="http://localhost:4185"
  # Local secrets (not sensitive — local dev only)
  AISHA_APP_SECRET="aisha-app-local-secret-2026"
  APPSMITH_SECRET="appsmith-proxy-local-secret-2026"
  LANGFUSE_SECRET="langfuse-local-secret-2026"
  NOCODB_SECRET="nocodb-local-secret-2026"
  STUDIO_SECRET="studio-proxy-local-secret-2026"
  N8N_SECRET="n8n-proxy-local-secret-2026"
  OPENCLAW_PROXY_SECRET="openclaw-proxy-local-secret-2026"
  NETBIRD_BACKEND_SECRET="netbird-backend-local-secret-2026"
  INTRANET_SECRET="intranet-proxy-local-secret-2026"
  EXTRANET_SECRET="extranet-proxy-local-secret-2026"
else
  KC_URL="${KEYCLOAK_URL:?KEYCLOAK_URL required for prod (e.g. https://auth.<your-domain>)}"
  KC_ADMIN="admin"
  KC_PASS="${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD is required for production}"
  APPSMITH_PROXY_URL="https://${APPSMITH_DOMAIN:?APPSMITH_DOMAIN required}"
  NOCODB_PROXY_URL="https://${NOCODB_DOMAIN:?NOCODB_DOMAIN required}"
  LANGFUSE_URL="https://${LANGFUSE_DOMAIN:?LANGFUSE_DOMAIN required}"
  STUDIO_PROXY_URL="https://${STUDIO_DOMAIN:?STUDIO_DOMAIN required}"
  N8N_PROXY_URL="https://${N8N_DOMAIN:?N8N_DOMAIN required}"
  AISHA_APP_SECRET="${KEYCLOAK_CLIENT_SECRET:?KEYCLOAK_CLIENT_SECRET is required for production}"
  APPSMITH_SECRET="${APPSMITH_OIDC_SECRET:?APPSMITH_OIDC_SECRET is required for production}"
  LANGFUSE_SECRET="${LANGFUSE_OIDC_SECRET:?LANGFUSE_OIDC_SECRET is required for production}"
  NOCODB_SECRET="${NOCODB_OIDC_SECRET:?NOCODB_OIDC_SECRET is required for production}"
  STUDIO_SECRET="${STUDIO_OIDC_SECRET:?STUDIO_OIDC_SECRET is required for production}"
  N8N_SECRET="${N8N_OIDC_SECRET:?N8N_OIDC_SECRET is required for production}"
  OPENCLAW_PROXY_SECRET="${OPENCLAW_OIDC_SECRET:?OPENCLAW_OIDC_SECRET is required for production}"
  NETBIRD_BACKEND_SECRET="${NETBIRD_MGMT_SECRET:?NETBIRD_MGMT_SECRET is required for production}"
  INTRANET_SECRET="${APPSMITH_INTRANET_OIDC_SECRET:?APPSMITH_INTRANET_OIDC_SECRET is required for production}"
  INTRANET_PROXY_URL="https://${INTRANET_DOMAIN:?INTRANET_DOMAIN required}"
  EXTRANET_SECRET="${EXTRANET_OIDC_SECRET:?EXTRANET_OIDC_SECRET is required for production}"
  EXTRANET_PROXY_URL="https://${EXTRANET_DOMAIN:?EXTRANET_DOMAIN required}"
fi

REALM="${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}"

section "SSO Federation Provisioning ($MODE)"

# ─── Keycloak admin token ────────────────────────────────────
get_kc_token() {
  local token
  token=$(curl -sf --max-time 20 -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=${KC_ADMIN}" \
    -d "password=${KC_PASS}" \
    -d "grant_type=password" \
    -d "client_id=admin-cli" 2>/dev/null \
    | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
  echo "$token"
}

# ─── Token, který nestihne vypršet uprostřed práce ───────────────────────────
#
# Keycloak vydává admin tokenu master/admin-cli životnost 60 SEKUND (změřeno
# 2026-08-14 na živé instanci: expires_in=60). Tenhle skript ho ale bral JEDNOU
# a pak s ním obcházel deset klientů, každého třemi HTTPS okružními cestami na
# vzdálený Keycloak. Zhruba od třetího klienta odpovídal každý dotaz 401.
#
# `curl -sf` na chybu MLČÍ, takže z toho nevznikla chyba, ale PRÁZDNÝ VÝSTUP —
# a ten se o pár řádků níž vyhodnotil jako „Client 'X' not found in Keycloak
# realm". Tvrzení o OBSAHU Keycloaku vyrobené ze selhání DOTAZU. Ověřeno:
# `GET /clients?max=200` v téže chvíli vracel 23 klientů včetně všech osmi
# „nenalezených".
#
# Cena té záměny nebyla kosmetická: přeskočil se zápis secretu klienta
# `netbird-backend`, takže Keycloak si nechal svůj vygenerovaný (32 znaků hex)
# a stack nesl náš (43 znaků base64url). NetBird se neautentizoval → mesh
# nenaběhl → *_MESH_IP zůstalo neznámé → edge nemá kudy na core → veřejné tváře
# 503 → každý stack se sidecarem hlásí unhealthy.
KC_TOKEN_MAX_AGE_S="${KC_TOKEN_MAX_AGE_S:-40}"
KC_TOKEN_FILE="$(mktemp -t aisha-kc-token.XXXXXX)"
# ⛔ NAMĚŘENO 2026-08-24: `KC_API_HTTP_CODE` se nastavovalo UVNITŘ `kc_api`, ale
# volá se `x=$(kc_api …)`, tedy v SUBSHELLU — přiřazení tam zůstalo a rodič ho
# nikdy neviděl. Každá chybová větev, která chtěla vypsat `HTTP ${…}`, proto
# místo diagnostiky SPADLA na `set -u` a razítkování secretů skončilo uprostřed
# s návratovým kódem 0. Keycloak si pak držel vlastní náhodný secret a
# oauth2-proxy dostával „unauthorized_client" (extranet 500, 2026-08-24).
#
# Diagnostika nesmí zabíjet chybu, kterou popisuje. Kód proto jde přes SOUBOR,
# který subshell přežije — týž vzor, jaký tu už drží token.
KC_API_CODE_FILE="$(mktemp -t aisha-kc-code.XXXXXX)"
kc_code() { cat "$KC_API_CODE_FILE" 2>/dev/null || printf '000'; }
chmod 600 "$KC_TOKEN_FILE"
trap 'rm -f "$KC_TOKEN_FILE" "${KC_TOKEN_FILE}.at"' EXIT

# Proč SOUBOR a ne proměnná: `kc_token` se volá uvnitř `$( … )`, a to je
# SUBSHELL — přiřazení do proměnné se z něj do rodiče nikdy nevrátí. Cache
# v proměnné by tedy nikdy nedržela: každý dotaz by si sáhl pro nový token
# (funguje to, ale je to desítky zbytečných kol) a hlavně by nešlo poznat,
# jestli obnova po 401 vůbec něco dělá. Soubor subshell přežije.
kc_token() {
  local now stari
  now=$(date +%s)
  if [[ -s "$KC_TOKEN_FILE" ]]; then
    stari=$(( now - $(cat "${KC_TOKEN_FILE}.at" 2>/dev/null || echo 0) ))
    if [[ $stari -lt $KC_TOKEN_MAX_AGE_S ]]; then
      cat "$KC_TOKEN_FILE"; return 0
    fi
  fi
  get_kc_token > "$KC_TOKEN_FILE"
  printf '%s' "$now" > "${KC_TOKEN_FILE}.at"
  cat "$KC_TOKEN_FILE"
}

# ─── Jeden dotaz na Keycloak, jedna odpověď o tom, jak dopadl ────────────────
#
# Vrací TĚLO na stdout a návratový kód říká, jestli se vůbec podařilo zeptat:
#   0  … 2xx, tělo je odpověď (i prázdné tělo je pak platná odpověď)
#   1  … dotaz selhal (non-2xx nebo curl vůbec nedojel) — HTTP kód jde na stderr
#
# Rozdíl mezi „zeptal jsem se a Keycloak řekl NIC" a „nepodařilo se zeptat" je
# celý rozdíl mezi nálezem a mlčením. Volající ho musí mít jak poznat.
kc_api() {
  local method="$1" path="$2" data="${3:-}"
  local tmp; tmp="$(mktemp)"
  # `|| true`, ne `|| echo "000"`: curl na transportní selhání SÁM vytiskne 000,
  # takže by se sentinel PŘILEPIL (000 → 000000) a větev na 000 by byla mrtvá.
  local code pokus
  # Dva pokusy: stáří tokenu se hlídá dopředu (kc_token), ale hádat cizí
  # životnost je slabší než ji ZMĚŘIT. Když Keycloak odpoví 401, token je
  # neplatný bez ohledu na to, co jsme si o něm mysleli — zahodí se a dotaz
  # se zopakuje s čerstvým. Druhá 401 už je odpověď, ne zdržení.
  for pokus in 1 2; do
    if [[ -n "$data" ]]; then
      code=$(curl -s -o "$tmp" -w '%{http_code}' --max-time 30 -X "$method" \
        "${KC_URL}${path}" -H "Authorization: Bearer $(kc_token)" \
        -H "Content-Type: application/json" --data-binary "$data" 2>/dev/null || true)
    else
      code=$(curl -s -o "$tmp" -w '%{http_code}' --max-time 30 -X "$method" \
        "${KC_URL}${path}" -H "Authorization: Bearer $(kc_token)" 2>/dev/null || true)
    fi
    [[ "$code" == "401" && $pokus -eq 1 ]] || break
    : > "$KC_TOKEN_FILE"   # zahodí token → kc_token si vyžádá nový
  done
  KC_API_HTTP_CODE="$code"
  printf '%s' "$code" > "$KC_API_CODE_FILE"
  if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
    cat "$tmp"; rm -f "$tmp"; return 0
  fi
  rm -f "$tmp"
  return 1
}

# ─── Set client secret in Keycloak ───────────────────────────
set_client_secret() {
  local client_id="$1"
  local secret="$2"
  # Token si tahle funkce bere sama (kc_token → obnova po 40 s). Kdo ho podával
  # zvenčí, podával hodnotu, která mu mezitím vypršela pod rukama.

  # Get internal client UUID.
  # Nejdřív se musí podařit ZEPTAT. Teprve prázdný seznam z ÚSPĚŠNÉHO dotazu
  # znamená „klient neexistuje"; selhavší dotaz neznamená o obsahu realmy nic.
  local listing
  if ! listing=$(kc_api GET "/admin/realms/${REALM}/clients?clientId=${client_id}"); then
    fail "Client '${client_id}': na Keycloak se nepodařilo zeptat (HTTP $(kc_code)) — o obsahu realmy '${REALM}' tím nevíme nic"
    return 1
  fi
  local client_uuid
  client_uuid=$(printf '%s' "$listing" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [[ -z "$client_uuid" ]]; then
    fail "Client '${client_id}' not found in Keycloak realm '${REALM}'"
    return 1
  fi

  # PUBLIC klient ŽÁDNÝ secret nemá — a nastavovat mu ho není chyba k opravě,
  # ale k přeskočení. Změřeno 2026-08-10 na čisté instalaci: `aisha-app` má
  # `publicClient: true`, takže Keycloak secret neuloží, zpětné čtení je prázdné
  # a tenhle skript to hlásil jako selhání. Operátor pak honil neexistující vadu.
  local client_json is_public
  if ! client_json=$(kc_api GET "/admin/realms/${REALM}/clients/${client_uuid}"); then
    fail "Client '${client_id}': reprezentaci nelze načíst (HTTP $(kc_code)) — bez ní se secret nastavit nedá"
    return 1
  fi
  is_public=$(printf '%s' "$client_json" | jq -r '.publicClient // false' 2>/dev/null)
  if [[ "$is_public" == "true" ]]; then
    info "Client '${client_id}' je PUBLIC — Keycloak u něj secret neukládá, přeskakuji (není to vada)"
    return 0
  fi

  # ── Nastavení secretu: CELÁ reprezentace klienta, ne dva dřívější pokusy ────
  #
  # PŮVODNÍ KÓD DĚLAL DVĚ VĚCI A PRVNÍ Z NICH ŠKODILA:
  #   1. PUT /clients/{id}/client-secret  → Keycloak tělo IGNORUJE a vygeneruje
  #      NÁHODNÝ secret. Vlastní komentář to přiznával („returns 204 when it
  #      generates new"), ale volalo se to stejně.
  #   2. PUT /clients/{id} s částečným `{"secret": …}` → tahle verze Keycloaku
  #      částečnou reprezentaci ignoruje a odpoví 204.
  # Výsledek: v KC zůstala náhodná hodnota z kroku 1, zatímco .env.coolify a
  # kontejnery nesly tu naši. Naměřeno 2026-08-10 po --wipe u `netbird-backend`:
  #   KC eafca793aaf1  vs  NETBIRD_MGMT_SECRET 59d4df26da79
  # NetBird se tím pádem nemohl autentizovat → mesh nenaběhl.
  #
  # Co funguje (ověřeno na živém KC): GET klienta, doplnit `secret`, PUT CELOU
  # reprezentaci — přesně to dělá `kcadm update clients/{id} -s secret=…`.
  # Po zápisu KC vrátil 59d4df26da79, tedy shodu.
  local rep="$client_json"
  local merged
  merged=$(printf '%s' "$rep" | jq -c --arg s "$secret" '.secret = $s' 2>/dev/null)
  if [[ -z "$merged" ]]; then
    fail "Client '${client_id}': reprezentaci se nepodařilo složit (jq)"
    return 1
  fi
  kc_api PUT "/admin/realms/${REALM}/clients/${client_uuid}" "$merged" >/dev/null || true
  local http_code="$(kc_code)"

  # READ-BACK VERIFY — the 204/200 above is NOT proof the secret is now `${secret}`.
  # Some Keycloak versions silently ignore a client-secret UPDATE (the inline note
  # above admits "Keycloak doesn't have a direct 'set secret to X' API") and answer
  # 204 while keeping their OWN value. If we trusted the code and then persisted
  # `${secret}` to .env.coolify + the container env, KC and the app would hold
  # DIFFERENT secrets → every OIDC consumer (oauth2-proxy, gateway, and the
  # `netbird-backend` service account that netbird-bootstrap depends on) gets
  # `invalid_client`, surfacing only later as a wave-4/Phase-D auth failure that is
  # very hard to trace back here. GET the secret and confirm it actually stuck.
  local actual_secret=""
  local secret_json
  if secret_json=$(kc_api GET "/admin/realms/${REALM}/clients/${client_uuid}/client-secret"); then
    actual_secret=$(printf '%s' "$secret_json" | jq -r '.value // empty' 2>/dev/null)
  else
    fail "Client '${client_id}': zpětné čtení secretu selhalo (HTTP $(kc_code)) — nevíme, jestli se zápis chytil"
    return 1
  fi

  if [[ -n "$actual_secret" && "$actual_secret" == "$secret" ]]; then
    ok "Client '${client_id}' secret set + verified (read-back matches)"
    return 0
  fi
  # Fail LOUD with the exact consumer impact — never report success over a secret
  # that did not persist (that is what turns into an untraceable invalid_client).
  if [[ -n "$actual_secret" ]]; then
    fail "Client '${client_id}' secret did NOT persist — Keycloak kept a DIFFERENT value (PUT HTTP ${http_code}); OIDC consumers will get invalid_client. Rotate via generate-secrets + re-run, or set the secret in the KC admin console."
  else
    fail "Client '${client_id}' secret set FAILED / unreadable (PUT HTTP ${http_code}, read-back empty)."
  fi
  return 1
}

# ─── Check client exists ─────────────────────────────────────
check_client() {
  local client_id="$1"
  local token="$2"

  local result
  if ! result=$(kc_api GET "/admin/realms/${REALM}/clients?clientId=${client_id}"); then
    fail "Client '${client_id}': na Keycloak se nepodařilo zeptat (HTTP $(kc_code))"
    return 1
  fi

  if echo "$result" | grep -q "\"clientId\":\"${client_id}\""; then
    ok "Client '${client_id}' exists"
    return 0
  else
    fail "Client '${client_id}' NOT found"
    return 1
  fi
}

# ═══════════════════════════════════════════════════════════════
# KEYCLOAK: Client secret provisioning
# ═══════════════════════════════════════════════════════════════
section "Keycloak Client Secrets"

info "Getting admin token from ${KC_URL}..."
KC_TOKEN=$(get_kc_token)

if [[ -z "$KC_TOKEN" ]]; then
  fail "Cannot authenticate to Keycloak admin API"
  fail "Check KEYCLOAK_ADMIN_PASSWORD and that Keycloak is running"
  exit 1
fi
ok "Keycloak admin token acquired"

# ─── Ensure 'groups' client scope exists ──────────────────────
# OAuth2 Proxy requests scope=openid+email+profile+groups
# KC must have a 'groups' scope that maps realm roles to the 'groups' claim
ensure_groups_scope() {
  local token="$1"
  local existing
  if ! existing=$(kc_api GET "/admin/realms/${REALM}/client-scopes"); then
    fail "client-scopes nelze načíst (HTTP $(kc_code)) — o tom, co v realmě je, tím nevíme nic"
    return 1
  fi

  if echo "$existing" | grep -q '"name":"groups"'; then
    ok "'groups' client scope already exists"
    return 0
  fi

  info "Creating 'groups' client scope with realm-roles mapper..."
  local http_code
  http_code=$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
    -X POST "${KC_URL}/admin/realms/${REALM}/client-scopes" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "groups",
      "description": "Maps realm roles to groups claim for OAuth2 Proxy",
      "protocol": "openid-connect",
      "attributes": {"include.in.token.scope": "true", "display.on.consent.screen": "false"},
      "protocolMappers": [{
        "name": "realm-roles-groups",
        "protocol": "openid-connect",
        "protocolMapper": "oidc-usermodel-realm-role-mapper",
        "consentRequired": false,
        "config": {
          "multivalued": "true",
          "claim.name": "groups",
          "jsonType.label": "String",
          "id.token.claim": "true",
          "access.token.claim": "true",
          "userinfo.token.claim": "true"
        }
      }]
    }' 2>/dev/null || true)

  if [[ "$http_code" == "201" ]]; then
    ok "'groups' client scope created"
  else
    fail "Failed to create 'groups' scope (HTTP ${http_code})"
  fi
}

# ─── Assign scope to client ──────────────────────────────────
assign_groups_scope() {
  local client_id="$1"
  local token="$2"

  # Get groups scope ID
  local scopes_json scope_id
  if ! scopes_json=$(kc_api GET "/admin/realms/${REALM}/client-scopes"); then
    fail "client-scopes nelze načíst (HTTP $(kc_code))"
    return 1
  fi
  scope_id=$(printf '%s' "$scopes_json" | grep -o '"id":"[^"]*","name":"groups"' | head -1 | cut -d'"' -f4)
  [[ -z "$scope_id" ]] && return 1

  # Get client UUID
  local clients_json client_uuid
  if ! clients_json=$(kc_api GET "/admin/realms/${REALM}/clients?clientId=${client_id}"); then
    fail "Client '${client_id}': na Keycloak se nepodařilo zeptat (HTTP $(kc_code))"
    return 1
  fi
  client_uuid=$(printf '%s' "$clients_json" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [[ -z "$client_uuid" ]] && return 1

  # Check if already assigned
  local current
  if ! current=$(kc_api GET "/admin/realms/${REALM}/clients/${client_uuid}/default-client-scopes"); then
    fail "Client '${client_id}': přiřazené scopes nelze načíst (HTTP $(kc_code))"
    return 1
  fi
  if echo "$current" | grep -q '"name":"groups"'; then
    skip "'groups' already assigned to ${client_id}"
    return 0
  fi

  # Assign
  local http_code
  http_code=$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
    -X PUT "${KC_URL}/admin/realms/${REALM}/clients/${client_uuid}/default-client-scopes/${scope_id}" \
    -H "Authorization: Bearer ${token}" 2>/dev/null || true)

  if [[ "$http_code" == "204" || "$http_code" == "200" ]]; then
    ok "'groups' scope assigned to ${client_id}"
  else
    warn "Could not assign 'groups' scope to ${client_id} (HTTP ${http_code})"
  fi
}

ensure_groups_scope "$KC_TOKEN"

# ─── Ensure 'roles' client scope exists ──────────────────────
# Service accounts (e.g. netbird-backend) need realm_access and
# resource_access claims in their JWT to call Keycloak Admin API.
# Keycloak doesn't include these by default without a scope with
# the matching protocol mappers.
ensure_roles_scope() {
  local token="$1"
  local existing
  if ! existing=$(kc_api GET "/admin/realms/${REALM}/client-scopes"); then
    fail "client-scopes nelze načíst (HTTP $(kc_code)) — o tom, co v realmě je, tím nevíme nic"
    return 1
  fi

  if echo "$existing" | grep -q '"name":"roles"'; then
    ok "'roles' client scope already exists"
    return 0
  fi

  info "Creating 'roles' client scope with realm+client role mappers..."
  local http_code
  http_code=$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
    -X POST "${KC_URL}/admin/realms/${REALM}/client-scopes" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "roles",
      "description": "Maps realm and client roles into access token for service accounts",
      "protocol": "openid-connect",
      "attributes": {"include.in.token.scope": "false", "display.on.consent.screen": "false"},
      "protocolMappers": [
        {
          "name": "realm-roles",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-usermodel-realm-role-mapper",
          "consentRequired": false,
          "config": {
            "multivalued": "true",
            "claim.name": "realm_access.roles",
            "jsonType.label": "String",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "userinfo.token.claim": "true"
          }
        },
        {
          "name": "client-roles",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-usermodel-client-role-mapper",
          "consentRequired": false,
          "config": {
            "multivalued": "true",
            "claim.name": "resource_access.${client_id}.roles",
            "jsonType.label": "String",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "userinfo.token.claim": "true"
          }
        }
      ]
    }' 2>/dev/null || echo "000")

  if [[ "$http_code" == "201" ]]; then
    ok "'roles' client scope created"
  else
    fail "Failed to create 'roles' scope (HTTP ${http_code})"
  fi
}

# ─── Assign a named scope to a client ────────────────────────
# ⛔ BEZ AUDIENCE MAPPERU JE TOKEN PRO PROXY NEPOUŽITELNÝ.
#
# NAMĚŘENO 2026-08-26 po wipu: `extra.<veřejná doména>` vracelo 500 a v logu
# `extranet-auth` stálo
#
#   Error creating session during OAuth2 callback:
#     audience claims [aud] do not exist in claims: map[azp:extranet-proxy email:…]
#
# Přihlášení proběhlo (e-mail v tokenu byl), ale token neměl `aud`. OAuth2 Proxy
# ověřuje, že `aud` obsahuje jeho `client_id`; Keycloak sám od sebe vydá jen
# `azp`. Chybělo to u VŠECH OSMI proxy klientů — a nebyl to rozchod, chybělo to
# i v `keycloak/aisha-realm.json`, tedy ve zdroji pravdy. Doplněno na obou
# místech: realm JSON pro nové realmy, tahle funkce pro ty už existující
# (import realm nepřepíše).
#
# Idempotentní: mapper se zakládá jen když tam není.
ensure_audience_mapper() {
  local client_id="$1"
  local token="$2"

  local clients_json client_uuid
  if ! clients_json=$(kc_api GET "/admin/realms/${REALM}/clients?clientId=${client_id}"); then
    fail "Client '${client_id}': na Keycloak se nepodařilo zeptat (HTTP $(kc_code))"
    return 1
  fi
  client_uuid=$(printf '%s' "$clients_json" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [[ -z "$client_uuid" ]] && { warn "Client '${client_id}' not found — audience mapper nepřidán"; return 1; }

  local mappers
  if ! mappers=$(kc_api GET "/admin/realms/${REALM}/clients/${client_uuid}/protocol-mappers/models"); then
    fail "Client '${client_id}': protocol-mappers nelze načíst (HTTP $(kc_code)) — o tom, co tam je, tím nevíme nic"
    return 1
  fi
  if printf '%s' "$mappers" | grep -q '"protocolMapper":"oidc-audience-mapper"'; then
    ok "Client '${client_id}': audience mapper already present"
    return 0
  fi

  info "Client '${client_id}': přidávám audience mapper (aud → ${client_id})"
  local http_code
  http_code=$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
    -X POST "${KC_URL}/admin/realms/${REALM}/clients/${client_uuid}/protocol-mappers/models" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"audience\",
      \"protocol\": \"openid-connect\",
      \"protocolMapper\": \"oidc-audience-mapper\",
      \"config\": {
        \"included.client.audience\": \"${client_id}\",
        \"id.token.claim\": \"true\",
        \"access.token.claim\": \"true\",
        \"introspection.token.claim\": \"true\"
      }
    }")
  case "$http_code" in
    201|204) ok "Client '${client_id}': audience mapper vytvořen" ;;
    409)     ok "Client '${client_id}': audience mapper už existuje (409)" ;;
    *)       fail "Client '${client_id}': audience mapper se nepodařilo vytvořit (HTTP ${http_code})"; return 1 ;;
  esac
}

assign_scope_to_client() {
  local scope_name="$1"
  local client_id="$2"
  local token="$3"

  local scopes_json scope_id
  if ! scopes_json=$(kc_api GET "/admin/realms/${REALM}/client-scopes"); then
    fail "Scope '${scope_name}': client-scopes nelze načíst (HTTP $(kc_code))"
    return 1
  fi
  scope_id=$(printf '%s' "$scopes_json" | grep -o "\"id\":\"[^\"]*\",\"name\":\"${scope_name}\"" | head -1 | cut -d'"' -f4)
  [[ -z "$scope_id" ]] && { warn "Scope '${scope_name}' not found"; return 1; }

  local clients_json client_uuid
  if ! clients_json=$(kc_api GET "/admin/realms/${REALM}/clients?clientId=${client_id}"); then
    fail "Client '${client_id}': na Keycloak se nepodařilo zeptat (HTTP $(kc_code))"
    return 1
  fi
  client_uuid=$(printf '%s' "$clients_json" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [[ -z "$client_uuid" ]] && { warn "Client '${client_id}' not found"; return 1; }

  local current
  if ! current=$(kc_api GET "/admin/realms/${REALM}/clients/${client_uuid}/default-client-scopes"); then
    fail "Client '${client_id}': přiřazené scopes nelze načíst (HTTP $(kc_code))"
    return 1
  fi
  if echo "$current" | grep -q "\"name\":\"${scope_name}\""; then
    skip "'${scope_name}' already assigned to ${client_id}"
    return 0
  fi

  local http_code
  http_code=$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
    -X PUT "${KC_URL}/admin/realms/${REALM}/clients/${client_uuid}/default-client-scopes/${scope_id}" \
    -H "Authorization: Bearer ${token}" 2>/dev/null || true)

  if [[ "$http_code" == "204" || "$http_code" == "200" ]]; then
    ok "'${scope_name}' scope assigned to ${client_id}"
  else
    warn "Could not assign '${scope_name}' scope to ${client_id} (HTTP ${http_code})"
  fi
}

# ─── Provision NetBird admin access ──────────────────────────
# netbird-backend SA needs realm-management roles (manage-users,
# view-users, query-users) to sync users/groups from Keycloak.
ensure_netbird_admin_roles() {
  local token="$1"
  # Klient se předává VÝSLOVNĚ: hlavní mesh `netbird-backend`, modelový `netbird-model-backend`.
  local klient="${2:?ensure_netbird_admin_roles: chybí klient (netbird-backend | netbird-model-backend)}"

  # Get ${klient} client UUID
  local nb_json nb_uuid
  if ! nb_json=$(kc_api GET "/admin/realms/${REALM}/clients?clientId=${klient}"); then
    fail "${klient}: na Keycloak se nepodařilo zeptat (HTTP $(kc_code)) — role SA tím nejsou ověřené"
    return 1
  fi
  nb_uuid=$(printf '%s' "$nb_json" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ -z "$nb_uuid" ]]; then
    warn "${klient} client not found — skipping admin role setup"
    return 1
  fi

  # Set fullScopeAllowed = true
  kc_api PUT "/admin/realms/${REALM}/clients/${nb_uuid}" '{"fullScopeAllowed": true}' >/dev/null || true
  local http_code="$(kc_code)"
  if [[ "$http_code" == "204" || "$http_code" == "200" ]]; then
    ok "${klient} fullScopeAllowed=true"
  else
    warn "Failed to set fullScopeAllowed on ${klient} (HTTP ${http_code})"
  fi

  # Get realm-management client UUID
  local rm_json rm_uuid
  if ! rm_json=$(kc_api GET "/admin/realms/${REALM}/clients?clientId=realm-management"); then
    fail "realm-management: na Keycloak se nepodařilo zeptat (HTTP $(kc_code))"
    return 1
  fi
  rm_uuid=$(printf '%s' "$rm_json" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ -z "$rm_uuid" ]]; then
    warn "realm-management client not found — skipping admin role assignment"
    return 1
  fi

  # Get SA user ID
  local sa_json sa_user_id
  if ! sa_json=$(kc_api GET "/admin/realms/${REALM}/clients/${nb_uuid}/service-account-user"); then
    fail "${klient} SA: na Keycloak se nepodařilo zeptat (HTTP $(kc_code))"
    return 1
  fi
  sa_user_id=$(printf '%s' "$sa_json" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ -z "$sa_user_id" ]]; then
    warn "${klient} service account user not found"
    return 1
  fi

  # Get available realm-management roles
  local available_roles
  if ! available_roles=$(kc_api GET "/admin/realms/${REALM}/users/${sa_user_id}/role-mappings/clients/${rm_uuid}/available"); then
    fail "dostupné role SA nelze načíst (HTTP $(kc_code))"
    return 1
  fi

  # Build JSON array of roles to assign
  local roles_payload="["
  local first=true
  for role_name in manage-users view-users query-users; do
    local role_id
    role_id=$(echo "$available_roles" | grep -o "\"id\":\"[^\"]*\",\"name\":\"${role_name}\"" | head -1 | cut -d'"' -f4)
    if [[ -n "$role_id" ]]; then
      [[ "$first" == "true" ]] && first=false || roles_payload+=","
      roles_payload+="{\"id\":\"${role_id}\",\"name\":\"${role_name}\"}"
    else
      # Role might already be assigned — check effective roles
      local effective
      effective=$(curl -sf --max-time 30 \
        "${KC_URL}/admin/realms/${REALM}/users/${sa_user_id}/role-mappings/clients/${rm_uuid}" \
        -H "Authorization: Bearer ${token}" 2>/dev/null || echo "[]")
      if grep -q "\"name\":\"${role_name}\"" <<< "$effective"; then
        skip "Role '${role_name}' already assigned to ${klient} SA"
      else
        warn "Role '${role_name}' not found in realm-management"
      fi
    fi
  done
  roles_payload+="]"

  # Assign roles (skip if none to assign)
  if [[ "$roles_payload" != "[]" ]]; then
    http_code=$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
      -X POST "${KC_URL}/admin/realms/${REALM}/users/${sa_user_id}/role-mappings/clients/${rm_uuid}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -d "$roles_payload" 2>/dev/null || true)
    if [[ "$http_code" == "204" || "$http_code" == "200" ]]; then
      ok "realm-management roles assigned to ${klient} SA"
    else
      warn "Failed to assign realm-management roles (HTTP ${http_code})"
    fi
  fi
}

ensure_roles_scope "$KC_TOKEN"

if [[ "$CHECK_ONLY" == "true" ]]; then
  info "Checking client existence..."
  check_client "aisha-app" "$KC_TOKEN"
  check_client "appsmith-proxy" "$KC_TOKEN"
  check_client "nocodb-proxy" "$KC_TOKEN"
  check_client "langfuse" "$KC_TOKEN"
  check_client "studio-proxy" "$KC_TOKEN"
  check_client "n8n-proxy" "$KC_TOKEN"
  check_client "openclaw-proxy" "$KC_TOKEN"
  check_client "netbird-backend" "$KC_TOKEN"
  check_client "appsmith-intranet-proxy" "$KC_TOKEN"
  check_client "extranet-proxy" "$KC_TOKEN"

else
  # ⛔ NAMĚŘENO 2026-08-20. Tady stálo `|| true` u VŠECH DESETI volání.
  # `set_client_secret` přitom umí selhat s přesnou hláškou — má ji i ve svém
  # komentáři: „never report success over a secret that did not persist (that is
  # what turns into an untraceable invalid_client)". Jenže `fail()` jen VYPISUJE
  # a funkce končí `return 1` — a `|| true` ten návratový kód zahodilo.
  # Funkce tedy poctivě hlásila vadu do prázdna.
  #
  # Následek: Keycloak si u klientů ponechal vlastní vygenerované secrety,
  # konzumenti drželi jiné a přihlášení do extranetu končilo na
  # `unauthorized_client`. Rozešlo se 11 kopií napříč 7 aplikacemi.
  #
  # Zkoušejí se VŠICHNI klienti (jeden vadný nesmí schovat ostatní) a teprve
  # potom se končí pádem, se jmenným výčtem.
  info "Setting client secrets..."
  _secret_failed=""
  _try_secret() {
    if set_client_secret "$1" "$2"; then return 0; fi
    _secret_failed="${_secret_failed} $1"
  }
  _try_secret "aisha-app" "$AISHA_APP_SECRET"
  _try_secret "appsmith-proxy" "$APPSMITH_SECRET"
  _try_secret "nocodb-proxy" "$NOCODB_SECRET"
  _try_secret "langfuse" "$LANGFUSE_SECRET"
  _try_secret "studio-proxy" "$STUDIO_SECRET"
  _try_secret "n8n-proxy" "$N8N_SECRET"
  _try_secret "openclaw-proxy" "$OPENCLAW_PROXY_SECRET"
  _try_secret "netbird-backend" "$NETBIRD_BACKEND_SECRET"
  _try_secret "appsmith-intranet-proxy" "$INTRANET_SECRET"
  _try_secret "extranet-proxy" "$EXTRANET_SECRET"

  # Každý `*-proxy` klient musí mít `aud` = své vlastní clientId, jinak
  # OAuth2 Proxy odmítne token v callbacku a povrch skončí na 500.
  # Univerzum se ČTE z realmu, neopisuje se — jinak by nový proxy klient
  # tichounce vypadl (týž tvar chyby jako ruční seznamy jinde v repu).
  section "Audience mappery proxy klientů"
  _proxy_clients=$(kc_api GET "/admin/realms/${REALM}/clients" \
    | grep -o '"clientId":"[^"]*-proxy"' | cut -d'"' -f4 | sort -u)
  if [ -z "$_proxy_clients" ]; then
    fail "V realmu '${REALM}' není ANI JEDEN *-proxy klient — buď se realm nenačetl, nebo je prázdný"
  else
    for _pc in $_proxy_clients; do
      ensure_audience_mapper "$_pc" "$KC_TOKEN" || true
    done
  fi

  if [[ -n "$_secret_failed" ]]; then
    fail "Secrety se NEZAPSALY u:${_secret_failed}"
    fail "Keycloak si u nich ponechá vlastní hodnoty, takže konzumenti dostanou"
    fail "'unauthorized_client' při výměně kódu za token. Pokračovat by znamenalo"
    fail "nasadit stack, který vypadá zdravě a nepustí nikoho dovnitř."
    exit 1
  fi

  # Sync aisha-app (Keycloak client) secret to local env.
  # Legacy env var name SUPABASE_OAUTH_KEYCLOAK_SECRET is still written for
  # very old .env consumers; prefer KEYCLOAK_CLIENT_SECRET going forward.
  if [[ "$MODE" == "local" ]]; then
    env_file="${PROJECT_ROOT}/.env.local"
    if [[ -f "$env_file" ]]; then
      # Write modern name
      if grep -q "^KEYCLOAK_CLIENT_SECRET=" "$env_file" 2>/dev/null; then
        current="$(grep "^KEYCLOAK_CLIENT_SECRET=" "$env_file" | cut -d= -f2-)"
        if [[ "$current" != "$AISHA_APP_SECRET" ]]; then
          sed -i '' "s|^KEYCLOAK_CLIENT_SECRET=.*|KEYCLOAK_CLIENT_SECRET=${AISHA_APP_SECRET}|" "$env_file"
          ok "Updated KEYCLOAK_CLIENT_SECRET in .env.local"
        else
          skip "KEYCLOAK_CLIENT_SECRET already synced"
        fi
      else
        echo "KEYCLOAK_CLIENT_SECRET=${AISHA_APP_SECRET}" >> "$env_file"
        ok "Added KEYCLOAK_CLIENT_SECRET to .env.local"
      fi

      # Also maintain the old name for compatibility with any remaining consumers
      if grep -q "^SUPABASE_OAUTH_KEYCLOAK_SECRET=" "$env_file" 2>/dev/null; then
        sed -i '' "s|^SUPABASE_OAUTH_KEYCLOAK_SECRET=.*|SUPABASE_OAUTH_KEYCLOAK_SECRET=${AISHA_APP_SECRET}|" "$env_file"
      else
        echo "SUPABASE_OAUTH_KEYCLOAK_SECRET=${AISHA_APP_SECRET}" >> "$env_file"
      fi
    else
      echo "KEYCLOAK_CLIENT_SECRET=${AISHA_APP_SECRET}" > "$env_file"
      echo "SUPABASE_OAUTH_KEYCLOAK_SECRET=${AISHA_APP_SECRET}" >> "$env_file"
      ok "Created .env.local with Keycloak client secret (and legacy alias)"
    fi
  fi

  info "Ensuring 'groups' scope assigned to proxy clients..."
  assign_groups_scope "appsmith-proxy" "$KC_TOKEN"
  assign_groups_scope "nocodb-proxy" "$KC_TOKEN"
  assign_groups_scope "langfuse" "$KC_TOKEN"
  assign_groups_scope "studio-proxy" "$KC_TOKEN"
  assign_groups_scope "n8n-proxy" "$KC_TOKEN"
  assign_groups_scope "openclaw-proxy" "$KC_TOKEN"
  assign_groups_scope "appsmith-intranet-proxy" "$KC_TOKEN"
  assign_groups_scope "extranet-proxy" "$KC_TOKEN"

  info "Ensuring 'roles' scope assigned to netbird-backend..."
  assign_scope_to_client "roles" "netbird-backend" "$KC_TOKEN"

  info "Provisioning NetBird admin API access..."
  ensure_netbird_admin_roles "$KC_TOKEN" netbird-backend

  # ── Modelový mesh forku (varianta C) — klienti JEN s lane MODEL_MESH ─────
  if [[ -n "${MODEL_MESH:-}" ]]; then
    section "Modelový mesh forku: klienti Keycloaku"
    if ! kc_zajisti_klienty_modeloveho_meshe "${NETBIRD_MODEL_DOMAIN:-}" \
         "${NETBIRD_MODEL_OIDC_SECRET:-}" "${NETBIRD_MODEL_MGMT_SECRET:-}" "${NETBIRD_MODEL_BOOTSTRAP_SECRET:-}"; then
      fail "Modelový mesh: klienti Keycloaku nejsou v pořádku — řídicí rovina by neověřila žádný token"
      exit 1
    fi
  else
    info "Modelový mesh: instance ho nemá (MODEL_MESH prázdná) — klienti netbird-model* se nezakládají"
  fi
fi

# ═══════════════════════════════════════════════════════════════
# OAuth2 PROXY: Health verification for Appsmith + NocoDB
# ═══════════════════════════════════════════════════════════════
if [[ "$KC_ONLY" != "true" ]]; then
  section "OAuth2 Proxy Health"

  # Check Appsmith proxy
  if curl -sf --max-time 30 "${APPSMITH_PROXY_URL}/ping" &>/dev/null; then
    ok "Appsmith OAuth2 Proxy healthy at ${APPSMITH_PROXY_URL}"
  else
    warn "Appsmith OAuth2 Proxy not reachable at ${APPSMITH_PROXY_URL}"
  fi

  # Check NocoDB proxy
  if curl -sf --max-time 30 "${NOCODB_PROXY_URL}/ping" &>/dev/null; then
    ok "NocoDB OAuth2 Proxy healthy at ${NOCODB_PROXY_URL}"
  else
    warn "NocoDB OAuth2 Proxy not reachable at ${NOCODB_PROXY_URL}"
  fi

  # Check Langfuse (native OIDC)
  if curl -sf --max-time 30 "${LANGFUSE_URL}/api/public/health" &>/dev/null; then
    ok "Langfuse healthy at ${LANGFUSE_URL}"
  else
    warn "Langfuse not reachable at ${LANGFUSE_URL}"
  fi

  # Check Studio proxy
  if curl -sf --max-time 30 "${STUDIO_PROXY_URL}/ping" &>/dev/null; then
    ok "Studio OAuth2 Proxy healthy at ${STUDIO_PROXY_URL}"
  else
    warn "Studio OAuth2 Proxy not reachable at ${STUDIO_PROXY_URL}"
  fi

  # Check n8n proxy
  if curl -sf --max-time 30 "${N8N_PROXY_URL}/ping" &>/dev/null; then
    ok "n8n OAuth2 Proxy healthy at ${N8N_PROXY_URL}"
  else
    warn "n8n OAuth2 Proxy not reachable at ${N8N_PROXY_URL}"
  fi

  # Check Intranet proxy
  if curl -sf --max-time 30 "${INTRANET_PROXY_URL}/ping" &>/dev/null; then
    ok "Intranet OAuth2 Proxy healthy at ${INTRANET_PROXY_URL}"
  else
    warn "Intranet OAuth2 Proxy not reachable at ${INTRANET_PROXY_URL}"
  fi

  # Verify SSO redirects
  if [[ "$CHECK_ONLY" == "true" ]]; then
    info "Verifying SSO redirects..."

    # Appsmith: should redirect to Keycloak login
    APPSMITH_STATUS=$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' "${APPSMITH_PROXY_URL}/" 2>/dev/null || true)
    if [[ "$APPSMITH_STATUS" == "302" || "$APPSMITH_STATUS" == "403" ]]; then
      ok "Appsmith SSO redirect active (HTTP ${APPSMITH_STATUS})"
    else
      warn "Appsmith SSO may not be working (HTTP ${APPSMITH_STATUS})"
    fi

    # NocoDB: should redirect to Keycloak login
    NOCODB_STATUS=$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' "${NOCODB_PROXY_URL}/" 2>/dev/null || true)
    if [[ "$NOCODB_STATUS" == "302" || "$NOCODB_STATUS" == "403" ]]; then
      ok "NocoDB SSO redirect active (HTTP ${NOCODB_STATUS})"
    else
      warn "NocoDB SSO may not be working (HTTP ${NOCODB_STATUS})"
    fi
  fi
fi

# ═══════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════
section "SSO Summary"
echo ""
echo -e "  ${GREEN}Keycloak realm:${NC}   ${KC_URL}/realms/${REALM}"
echo -e "  ${GREEN}Clients:${NC}"
echo -e "    aisha-app       — React application (Keycloak RS256)"
echo -e "    appsmith-proxy  — OAuth2 Proxy → Appsmith CE"
echo -e "    nocodb-proxy    — OAuth2 Proxy → NocoDB OSS"
echo -e "    langfuse        — Langfuse native OIDC (AUTH_CUSTOM_*)"
echo -e "    studio-proxy    — OAuth2 Proxy → AISHA Studio"
echo -e "    extranet-proxy  — OAuth2 Proxy → Extranet"
echo -e "    n8n-proxy       — OAuth2 Proxy → n8n workflow engine"
echo -e "    netbird-backend — NetBird Management API service account"
echo -e "    appsmith-intranet-proxy — OAuth2 Proxy → Appsmith CE (intranet, all users)"
echo ""
echo -e "  ${GREEN}Service URLs:${NC}"
echo -e "    Appsmith  ${APPSMITH_PROXY_URL}  (via OAuth2 Proxy)"
echo -e "    NocoDB    ${NOCODB_PROXY_URL}  (via OAuth2 Proxy)"
echo -e "    Langfuse  ${LANGFUSE_URL}  (native OIDC)"
echo -e "    Studio    ${STUDIO_PROXY_URL}  (via OAuth2 Proxy)"
echo -e "    n8n       ${N8N_PROXY_URL}  (via OAuth2 Proxy)"
echo -e "    Intranet  ${INTRANET_PROXY_URL}  (via OAuth2 Proxy, all roles)"
echo ""
if [[ "$MODE" == "local" ]]; then
  echo -e "  ${YELLOW}Note:${NC} Local SSO requires Keycloak to be accessible"
  echo -e "  from inside the Docker network as ${DIM}http://keycloak:8080${NC}"
  echo -e "  Run with: ${DIM}docker compose --profile admin --profile keycloak up${NC}"
fi
echo ""
ok "SSO provisioning complete ($MODE)"

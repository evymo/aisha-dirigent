#!/usr/bin/env bash
# ==============================================================================
# aisha-bootstrap-user-init.sh — Provision the system user that owns NetBird
# ==============================================================================
#
# WHY THIS EXISTS
# ----------------
# NetBird's first authenticated request creates an account and stores the
# requester as account owner in PG. Our cold-start runs netbird-bootstrap.sh
# with `netbird-backend` service-account M2M token → service-account user UUID
# becomes account owner → NetBird's IDP user-sync (which lists Keycloak's
# regular users, not service accounts) cannot resolve that owner UUID → loops
# on `user not found in IDP` → cache exhausts → gRPC streams cancel → peers
# enroll once but never heartbeat → mesh stays broken.
#
# This script provisions a REAL Keycloak user (`aisha-bootstrap`) and obtains
# its credentials so `netbird-bootstrap.sh` can perform the FIRST NetBird API
# call as that user (Resource Owner Password Credentials grant via the
# `aisha-bootstrap` Keycloak client). The aisha-bootstrap user thus becomes
# the NetBird account owner — fully visible to IDP user-sync, no warning loop,
# stable gRPC heartbeats.
#
# WHAT IT DOES (idempotent)
# -------------------------
# 1. Reads KEYCLOAK_DOMAIN, NETBIRD_MGMT_SECRET (netbird-backend client) from
#    .env.coolify.
# 2. Generates `AISHA_BOOTSTRAP_PASSWORD` (32-char random) if not already set,
#    and persists it to .env.coolify.
# 3. Retrieves the `aisha-bootstrap` Keycloak client secret (auto-generated on
#    realm import) via the Keycloak admin API → persists as
#    `AISHA_BOOTSTRAP_CLIENT_SECRET` in .env.coolify.
# 4. Sets the user password on the `aisha-bootstrap` Keycloak user via the
#    admin API (uses the `netbird-backend` service account, which has
#    realm-management `manage-users` role).
# 5. Pushes both env vars to Coolify (aisha-netbird app) so the netbird stack
#    has them at runtime if needed.
#
# Safe to re-run: idempotent on every step. If the password is already set,
# it's NOT regenerated. If the client secret is already cached locally, it's
# verified against Keycloak and re-fetched only if drift is detected.
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.coolify}"
TOKEN_FILE="${TOKEN_FILE:-$ROOT/.env-prod-backup}"
# COOLIFY_API = full Coolify API base (host + /api/v1). Derive from COOLIFY_URL /
# COOLIFY_BASE_URL when not explicitly set — env-name drift: cold-start exports
# COOLIFY_URL (the operator's Coolify host), not COOLIFY_API, so the old `:?` here
# aborted bootstrap → aisha-pki-bootstrap creds never provisioned in Keycloak →
# netbird mesh-cert ROPC 401 → netbird-internal-tls self-signed loop → wave-4
# gate stop. Same normalization as aisha-redeploy.mjs (COOLIFY_BASE_URL→COOLIFY_URL).
# Idempotent normalization (COOLIFY_API|COOLIFY_URL|COOLIFY_BASE_URL → <host>/api/v1).
# Upgrades the old derive-only-when-empty guard, which left a SET-but-bare
# COOLIFY_API unnormalized → /applications 404.
# shellcheck source=scripts/lib/coolify-api-base.sh
source "$ROOT/scripts/lib/coolify-api-base.sh"
# shellcheck source=scripts/lib/env-zapis.sh
source "$ROOT/scripts/lib/env-zapis.sh"
COOLIFY_API="$(resolve_coolify_api)" || exit 1
DRY_RUN="${DRY_RUN:-0}"
SYNC_COOLIFY="${SYNC_COOLIFY:-1}"

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'; N='\033[0m'
info()   { echo -e "${B}ℹ${N}  $*" >&2; }
ok()     { echo -e "${G}✅${N} $*" >&2; }
warn()   { echo -e "${Y}⚠${N}  $*" >&2; }
err()    { echo -e "${R}❌${N} $*" >&2; }
banner() { echo -e "\n${C}═══ $* ═══${N}" >&2; }

command -v jq >/dev/null   || { err "jq missing";   exit 1; }
command -v curl >/dev/null || { err "curl missing"; exit 1; }
command -v openssl >/dev/null || { err "openssl missing"; exit 1; }

# Load shared fingerprint helpers (fp, fp_jwt, fp_file) for diagnostic
# tracing of secrets across components without leaking raw values.
# Path-rooted to repo so this works whether script runs from repo or
# anywhere else.
FP_HELPER="$(dirname "$0")/../infra/lib/fingerprint.sh"
if [ -f "$FP_HELPER" ]; then
  # shellcheck source=/dev/null
  . "$FP_HELPER"
else
  warn "fingerprint helper missing at $FP_HELPER — falling back to inline"
  fp() {
    [ -z "$1" ] && { echo "(empty)"; return; }
    printf '%s/%d' "$(printf '%s' "$1" | sha256sum | cut -c1-12)" "$(printf '%s' "$1" | wc -c | tr -d ' ')"
  }
  fp_jwt() {
    [ -z "$1" ] && { echo "(empty)"; return; }
    SIG="$(printf '%s' "$1" | cut -d. -f3)"
    fp "$SIG"
  }
fi

[ -f "$ENV_FILE" ] || { err "$ENV_FILE missing — run aisha-cold-start.sh first"; exit 1; }

env_value() {
  local key="$1"
  local v="${!key-}"
  if [ -n "$v" ]; then printf '%s' "$v"; return 0; fi
  # Pipefail-safe: grep returns 1 when no match, which would kill the
  # script under `set -euo pipefail`. The trailing `|| true` makes a
  # missing key just return empty instead of erroring.
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

upsert_env() {
  local key="$1" value="$2" tmp
  if [ "$DRY_RUN" = "1" ]; then info "[DRY] $key=<set>"; return 0; fi
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { done=0 }
    $0 ~ "^" key "=" { print key "=" value; done=1; next }
    { print }
    END { if (done==0) print key "=" value }
  ' "$ENV_FILE" > "$tmp"
  env_zapis_atomicky "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

# This script runs OPERATOR-SIDE (off-mesh), in Phase B — BEFORE the mesh (netbird,
# wave 4) is even up. Under MESH_ENABLED=true the canonical KEYCLOAK_DOMAIN is the
# mesh name (auth.mesh.<tld>) — unreachable here. Reach KC at its DIRECT backend host
# (KEYCLOAK_DOMAIN_DIRECT = auth.backend.<tld>) — the host KC's own Coolify Traefik
# actually serves (registered by coolify-domain-doctor); independent of the edge/
# pfSense chain. Fall back to the public edge face, then the canonical (mesh-off).
# All endpoints used below (master token, /admin/realms, ROPC/client_credentials
# verify) are served on any host KC receives; iss stays KC_HOSTNAME (public).
KEYCLOAK_DOMAIN="$(env_value KEYCLOAK_DOMAIN_DIRECT)"
[ -n "$KEYCLOAK_DOMAIN" ] || KEYCLOAK_DOMAIN="$(env_value KEYCLOAK_DOMAIN_PUBLIC)"
[ -n "$KEYCLOAK_DOMAIN" ] || KEYCLOAK_DOMAIN="$(env_value KEYCLOAK_DOMAIN)"
KEYCLOAK_DOMAIN="${KEYCLOAK_DOMAIN:?KEYCLOAK_DOMAIN_DIRECT/_PUBLIC or KEYCLOAK_DOMAIN required (e.g. auth.<your-domain>)}"
# BOOTSTRAP DEADLOCK ESCAPE HATCH — honour an explicit endpoint before deriving
# https://<domain>. Every https:// face of KC is served with a cert that PKI
# issues, and PKI's issuer (aisha-pki-renewer) cannot mint one until THIS script
# has created the `aisha-pki-issuer` client (Step 10b). So on a cold start the
# only reachable face is KC's plain-HTTP service alias on the compose network
# (http://keycloak:80) — every https:// candidate answers with Traefik's
# self-signed default cert and curl -fsS (no -k, by design) refuses it:
#     x509: certificate is valid for TRAEFIK DEFAULT CERT, not auth.<...>
# Verified on riq 2026-07-16: renewer looped 60s forever on
# "client_credentials token acquisition failed (client=aisha-pki-issuer)"
# → no cert → edge-proxy 502 on auth → netbird OIDC discovery failed (168
# restarts) → mesh never enrolled. One missing client, six symptoms.
# Default is unchanged (public/direct https) — this only lets cold-start pass
# the internal endpoint it already knows.
KEYCLOAK_URL="${KEYCLOAK_URL:-${KEYCLOAK_INTERNAL_URL:-https://${KEYCLOAK_DOMAIN}}}"
# The realm is instance configuration, not a constant: defaulting it to the
# upstream name points admin-API writes at whatever realm happens to carry that
# name. Same rule as the app prefix below — resolve, or stop.
KEYCLOAK_REALM="${KEYCLOAK_REALM:-$(env_value KEYCLOAK_REALM)}"
if [ -z "$KEYCLOAK_REALM" ]; then
  err "KEYCLOAK_REALM is not set and not present in $ENV_FILE — refusing to guess the realm."
  exit 2
fi

# ── Which instance's apps may this run write to? ─────────────────────────────
# The Coolify sync steps look apps up by "<prefix>-netbird" / "<prefix>-pki".
# Resolving that prefix with a `:-aisha` default is NOT a harmless fallback:
# when APP_NAME_PREFIX is absent from the shell (it usually lives in the env
# FILE, not the environment) the lookup silently lands on the UPSTREAM stack and
# this instance's bootstrap credentials get written into a DIFFERENT
# deployment's apps. That happened on 2026-07-26 — RIQ's AISHA_PKI_BOOTSTRAP_*
# were upserted into aisha-netbird and aisha-pki.
#
# So: resolve it from the same config chain everything else uses, and if it
# cannot be determined, refuse to sync rather than guess. An unknown identity is
# a reason to stop, never a reason to pick someone else's.
APP_NAME_PREFIX="${APP_NAME_PREFIX:-$(env_value APP_NAME_PREFIX)}"
if [ -z "$APP_NAME_PREFIX" ]; then
  err "APP_NAME_PREFIX is not set and not present in $ENV_FILE."
  err "Refusing to guess it: a wrong prefix writes this instance's secrets into another deployment's apps."
  exit 2
fi
ok "Instance identity: APP_NAME_PREFIX=${APP_NAME_PREFIX} (Coolify apps: ${APP_NAME_PREFIX}-netbird, ${APP_NAME_PREFIX}-pki)"

# ── Je za těmi dveřmi NÁŠ Keycloak? ──────────────────────────────────────────
#
# ⛔ NAMĚŘENO 2026-08-21 na riqi. Tenhle skript posílá admin heslo a zakládá
# pověření. Adresu si přitom skládá z KEYCLOAK_DOMAIN_DIRECT, což je vnitřní
# jméno — a v tomhle prostředí vnitřní jména NESELHÁVAJÍ. Router doplňuje
# vyhledávací doménu s wildcardem, takže se přeloží ÚPLNĚ COKOLI:
#
#   getent hosts naprosty-nesmysl.riq.internal  ->  sdílená veřejná IP
#   openssl s_client ...                        ->  subject=CN=*.evymo.com
#
# Spuštění na serveru by tedy NESPADLO — v klidu by se přihlásilo k CIZÍMU
# stroji a založilo tam uživatele. Že mi to z notebooku vrátilo "nelze přeložit
# jméno", byla náhoda, ne pojistka.
#
# Proto se kontrakt hranice MĚŘÍ PŘED ODESLÁNÍM: ať klepeme na kterékoli dveře,
# musí za nimi stát NÁŠ vydavatel. Issuer je na to správné měřidlo — Keycloak
# ho hlásí podle KC_HOSTNAME, tedy nezávisle na tom, kudy klient přišel.
_ocekavany_issuer="https://$(env_value KEYCLOAK_DOMAIN_PUBLIC)/realms/${KEYCLOAK_REALM}"
if [ "$_ocekavany_issuer" = "https:///realms/${KEYCLOAK_REALM}" ]; then
  err "KEYCLOAK_DOMAIN_PUBLIC není znám — nemám s čím porovnat, koho jsem oslovil."
  err "  Bez toho nelze rozlišit náš Keycloak od cizího, který odpoví přes wildcard."
  exit 2
fi
_videny_issuer="$(curl -fsS --max-time 15 "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 2>/dev/null   | jq -r '.issuer // empty' 2>/dev/null || true)"
if [ -z "$_videny_issuer" ]; then
  err "Na ${KEYCLOAK_URL} se nikdo nepředstavil (discovery nevrátila issuer)."
  err "  CO S TÍM: spusť to odtud, kde je ta tvář dosažitelná, nebo předej ověřenou:"
  err "  KEYCLOAK_URL=https://\$(grep -m1 '^KEYCLOAK_DOMAIN_PUBLIC=' .env.coolify | cut -d= -f2-) bash \$0"
  exit 2
fi
if [ "$_videny_issuer" != "$_ocekavany_issuer" ]; then
  err "ZA TĚMI DVEŘMI NESTOJÍ NÁŠ KEYCLOAK — pověření NEODESÍLÁM."
  err "  oslovil jsem : ${KEYCLOAK_URL}"
  err "  představil se: ${_videny_issuer}"
  err "  čekal jsem   : ${_ocekavany_issuer}"
  err "  Nejčastější příčina: vnitřní jméno se přeložilo přes wildcard vyhledávací"
  err "  domény na cizí stroj. Vnitřní jména tu NESELHÁVAJÍ, ona odpoví někým jiným."
  err "  CO S TÍM: naprav DNS pro to jméno, nebo předej ověřenou tvář v KEYCLOAK_URL."
  err "  NEDĚLEJ: nepřidávej -k ani nevypínej kontrolu, ať to 'projde'."
  exit 2
fi
ok "Keycloak ověřen: ${KEYCLOAK_URL} se hlásí jako ${_videny_issuer}"

# Master admin credentials — used to access KC admin API. Same pattern as
# provision-sso.sh (which uses admin-cli on master realm). Cleaner than
# coupling to netbird-backend's service account: that service account is
# IDP-sync infra and shouldn't need realm-management role assignments
# beyond manage-users (its actual job). Master admin is universally
# privileged and exists by definition (KEYCLOAK_ADMIN env on first start).
KC_ADMIN_USER="$(env_value KEYCLOAK_ADMIN)"
KC_ADMIN_USER="${KC_ADMIN_USER:-admin}"
KC_ADMIN_PASSWORD="$(env_value KEYCLOAK_ADMIN_PASSWORD)"
[ -n "$KC_ADMIN_PASSWORD" ] || { err "KEYCLOAK_ADMIN_PASSWORD missing — required for Keycloak admin API access"; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Get Keycloak admin token via master realm admin-cli (matches
#         provision-sso.sh pattern — universal privileges, no role coupling)
# ─────────────────────────────────────────────────────────────────────────────
banner "Step 1 — Keycloak admin token (master realm admin-cli)"

ADMIN_TOKEN="$(curl -fsS --http1.1 --max-time 30 \
  -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=${KC_ADMIN_USER}" \
  --data-urlencode "password=${KC_ADMIN_PASSWORD}" \
  2>/dev/null | jq -r '.access_token // empty')"

[ -n "$ADMIN_TOKEN" ] || { err "Failed to acquire Keycloak admin token (check KEYCLOAK_ADMIN_PASSWORD + Keycloak health)"; exit 1; }
ok "Keycloak admin token acquired (master/admin-cli)"

KC_ADMIN="${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}"
auth_header() { printf 'Authorization: Bearer %s' "$ADMIN_TOKEN"; }

# ─── Steps 2-10 (mesh-owner user bootstrap) run only in the FULL flow ─────────
# --issuer-only (used by the in-cluster migrate one-shot) provisions ONLY the
# aisha-pki-issuer service-account client (Step 10b) with the PRE-GENERATED
# secret, reached over http://aisha-keycloak:80 — so a locked-down operator never
# needs a KC tunnel to break the PKI-issuer chicken-and-egg (Step 10b creates the
# client the renewer needs before any cert exists). Step 10b needs only Step 1's
# admin token + AISHA_PKI_ISSUER_CLIENT_SECRET, nothing from Steps 2-10.
ISSUER_ONLY=0
for _a in "$@"; do [ "$_a" = "--issuer-only" ] && ISSUER_ONLY=1; done
[ "$ISSUER_ONLY" = "1" ] && info "--issuer-only: running Step 1 + Step 10b/10c only (in-cluster aisha-pki-issuer)"
if [ "$ISSUER_ONLY" != "1" ]; then
# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Resolve (or create) aisha-bootstrap user
# ─────────────────────────────────────────────────────────────────────────────
banner "Step 2 — Resolve/create aisha-bootstrap user"

USER_ID="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/users?username=aisha-bootstrap&exact=true" 2>/dev/null \
  | jq -r '.[0].id // empty')"

if [ -z "$USER_ID" ]; then
  info "User 'aisha-bootstrap' not found — creating via admin API (realm.json must have been imported in earlier KC bootstrap; this fallback handles existing Keycloak instances that pre-date the realm.json change)"
  USER_BODY="$(jq -n '{
    username: "aisha-bootstrap",
    email: "aisha-bootstrap@system.local",
    firstName: "AISHA",
    lastName: "Bootstrap",
    enabled: true,
    emailVerified: true,
    realmRoles: ["member"]
  }')"
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST -H "$(auth_header)" -H "Content-Type: application/json" \
    -d "$USER_BODY" \
    "${KC_ADMIN}/users" 2>/dev/null)"
  if [ "$HTTP_CODE" != "201" ]; then
    err "Failed to create aisha-bootstrap user (HTTP $HTTP_CODE) — check netbird-backend has realm-management.manage-users role"
    exit 1
  fi
  USER_ID="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/users?username=aisha-bootstrap&exact=true" 2>/dev/null \
    | jq -r '.[0].id // empty')"
  [ -n "$USER_ID" ] || { err "User created (HTTP 201) but cannot resolve ID afterwards"; exit 1; }
  ok "aisha-bootstrap user CREATED id=${USER_ID}"
else
  ok "aisha-bootstrap user id=${USER_ID} (already exists)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Resolve (or create) aisha-bootstrap client → fetch/regenerate secret
# ─────────────────────────────────────────────────────────────────────────────
banner "Step 3 — Resolve/create aisha-bootstrap client + fetch secret"

CLIENT_INTERNAL_ID="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/clients?clientId=aisha-bootstrap" 2>/dev/null \
  | jq -r '.[0].id // empty')"

if [ -z "$CLIENT_INTERNAL_ID" ]; then
  info "Client 'aisha-bootstrap' not found — creating via admin API"
  CLIENT_BODY="$(jq -n '{
    clientId: "aisha-bootstrap",
    name: "AISHA Bootstrap (cold-start ROPC)",
    description: "Confidential client for cold-start system user — see scripts/aisha-bootstrap-user-init.sh",
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: false,
    authorizationServicesEnabled: false,
    fullScopeAllowed: false,
    redirectUris: [],
    webOrigins: [],
    defaultClientScopes: ["openid", "email", "profile", "roles"],
    protocolMappers: [{
      name: "aisha-bootstrap-netbird-audience",
      protocol: "openid-connect",
      protocolMapper: "oidc-audience-mapper",
      config: {
        "included.custom.audience": "netbird",
        "id.token.claim": "false",
        "access.token.claim": "true"
      }
    }]
  }')"
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST -H "$(auth_header)" -H "Content-Type: application/json" \
    -d "$CLIENT_BODY" \
    "${KC_ADMIN}/clients" 2>/dev/null)"
  if [ "$HTTP_CODE" != "201" ]; then
    err "Failed to create aisha-bootstrap client (HTTP $HTTP_CODE)"
    exit 1
  fi
  CLIENT_INTERNAL_ID="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/clients?clientId=aisha-bootstrap" 2>/dev/null \
    | jq -r '.[0].id // empty')"
  [ -n "$CLIENT_INTERNAL_ID" ] || { err "Client created (HTTP 201) but cannot resolve ID afterwards"; exit 1; }
  ok "aisha-bootstrap client CREATED id=${CLIENT_INTERNAL_ID}"
else
  ok "aisha-bootstrap client id=${CLIENT_INTERNAL_ID} (already exists)"
fi

CLIENT_SECRET="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/clients/${CLIENT_INTERNAL_ID}/client-secret" 2>/dev/null \
  | jq -r '.value // empty')"

if [ -z "$CLIENT_SECRET" ]; then
  warn "No client secret yet — regenerating"
  CLIENT_SECRET="$(curl -fsS -X POST -H "$(auth_header)" "${KC_ADMIN}/clients/${CLIENT_INTERNAL_ID}/client-secret" 2>/dev/null \
    | jq -r '.value // empty')"
  [ -n "$CLIENT_SECRET" ] || { err "Failed to regenerate client secret"; exit 1; }
fi

upsert_env "AISHA_BOOTSTRAP_CLIENT_SECRET" "$CLIENT_SECRET"
ok "AISHA_BOOTSTRAP_CLIENT_SECRET stored in $ENV_FILE"

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Set/persist aisha-bootstrap user password (idempotent)
# ─────────────────────────────────────────────────────────────────────────────
banner "Step 4 — aisha-bootstrap user password"

USER_PASSWORD="$(env_value AISHA_BOOTSTRAP_PASSWORD)"

if [ -z "$USER_PASSWORD" ]; then
  USER_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
  info "Generated new aisha-bootstrap password (32 chars)"
fi

# Always re-apply to Keycloak (idempotent — same password is no-op functionally,
# but covers the case where realm was re-imported and lost credentials).
RESET_BODY="$(jq -n --arg pw "$USER_PASSWORD" '{type:"password", value:$pw, temporary:false}')"
HTTP_CODE="$(curl -sS -o /dev/null -w "%{http_code}" -X PUT \
  -H "$(auth_header)" -H "Content-Type: application/json" \
  -d "$RESET_BODY" \
  "${KC_ADMIN}/users/${USER_ID}/reset-password" 2>/dev/null)"

if [ "$HTTP_CODE" != "204" ]; then
  err "Failed to set aisha-bootstrap password (HTTP $HTTP_CODE)"
  exit 1
fi

upsert_env "AISHA_BOOTSTRAP_PASSWORD" "$USER_PASSWORD"
ok "Password set for aisha-bootstrap (Keycloak HTTP 204) and stored in $ENV_FILE"

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Verify ROPC works end-to-end (must succeed before netbird-bootstrap.sh)
# ─────────────────────────────────────────────────────────────────────────────
banner "Step 5 — Verify ROPC token flow"

VERIFY_TOKEN="$(curl -fsS --http1.1 --max-time 30 \
  -X POST "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=aisha-bootstrap" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "username=aisha-bootstrap" \
  -d "password=${USER_PASSWORD}" \
  -d "scope=openid" \
  2>/dev/null | jq -r '.access_token // empty')"

if [ -z "$VERIFY_TOKEN" ]; then
  err "ROPC verification failed — aisha-bootstrap user cannot acquire token"
  exit 1
fi

# Decode and confirm subject + audience
jwt_payload() {
  local payload pad
  payload="$(echo "$VERIFY_TOKEN" | cut -d. -f2 | tr '_-' '/+')"
  pad=$(( (4 - ${#payload} % 4) % 4 ))
  printf '%s' "$payload"
  if [ "$pad" -gt 0 ]; then printf '%*s' "$pad" '' | tr ' ' '='; fi
}

SUB="$(jwt_payload | base64 -d 2>/dev/null | jq -r '.sub // empty' 2>/dev/null || echo "")"
AUD="$(jwt_payload | base64 -d 2>/dev/null | jq -r 'if .aud | type == "array" then .aud | join(",") else .aud end' 2>/dev/null || echo "")"

ok "ROPC token acquired (sub=${SUB:-?}, aud=${AUD:-?})"

# ─────────────────────────────────────────────────────────────────────────────
# Step 6: AISHA_BOOTSTRAP_* sync to Coolify aisha-netbird app
# (NetBird account ownership ROPC creds — needed by netbird-bootstrap.sh)
#
# AISHA_PKI_BOOTSTRAP_* are pushed AT END (Step 11) — those vars are only
# populated after the PKI provisioning steps below complete.
#
# Architectural reason this MUST run here (not in deploy-init):
# coolify-deploy-init.sh runs at step 4 of cold-start, BEFORE this script
# runs in Phase B. So the .env.coolify values for AISHA_BOOTSTRAP_* are
# empty during deploy-init's set_coolify_env_if pass.
# ─────────────────────────────────────────────────────────────────────────────
# ── Deklarované držení: do držené aplikace se env NEZAPISUJE (2026-10-04) ──────
# Kroky 6 a 11 zapisují pověření přímo do env aplikací netbird a pki. Aplikaci,
# kterou overlay instance drží (nasazeni-drzene.json), se zápis vyhne — projevil
# by se při jejím příštím restartu, tedy mimo vědomé rozhodnutí. Deklaraci čte
# jediný domov (lib/nasazeni-drzene.mjs přes lib/drzeni.sh); nečitelná = konec
# dřív, než se do Coolify cokoli zapíše.
if [ "$SYNC_COOLIFY" = "1" ]; then
  # shellcheck source=lib/drzeni.sh
  . "$ROOT/scripts/lib/drzeni.sh"
  if ! drzeni_nacti "aisha-bootstrap-user-init" "$ENV_FILE"; then
    err "Deklaraci držení aplikací nejde přečíst nebo je neplatná (důvod výš) — nevím, komu smím env zapsat. Do Coolify jsem nezapsal nic."
    exit 1
  fi
fi

if [ "$SYNC_COOLIFY" = "1" ] && [ -n "${COOLIFY_API_TOKEN:-$(env_value COOLIFY_API_TOKEN)}" ]; then
  banner "Step 6 — Sync AISHA_BOOTSTRAP_* to Coolify (aisha-netbird)"

  # Disable strict mode for the sync block: a transient Coolify API
  # hiccup (jq parse error on truncated /applications response) MUST
  # NOT abort the script — the rest of the bootstrap (Steps 7-11)
  # still has work to do, and Step 11 below will re-resolve UUIDs and
  # try again with both PASSWORD and CLIENT_SECRET payloads.
  set +e
  step6_sync() {
    if drzena netbird; then
      warn "$(drzeni_hlaska netbird). AISHA_BOOTSTRAP_* se do ní NEZAPISUJÍ."
      return 0
    fi
    COOLIFY_API_TOKEN="${COOLIFY_API_TOKEN:-$(env_value COOLIFY_API_TOKEN)}"
    if [ -z "$COOLIFY_API_TOKEN" ] && [ -f "$TOKEN_FILE" ]; then
      COOLIFY_API_TOKEN="$(grep -E '^COOLIFY_API_TOKEN=' "$TOKEN_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '[:space:]')"
    fi
    if [ -z "$COOLIFY_API_TOKEN" ]; then
      warn "COOLIFY_API_TOKEN not available — skipping Coolify sync"
      return 0
    fi
    # Resolve aisha-netbird UUID dynamically. Each cold-start --wipe creates
    # new UUIDs; hardcoded defaults go stale.
    local apps_json
    apps_json="$(curl -sS --max-time 30 -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
      "${COOLIFY_API}/applications" 2>/dev/null || echo '[]')"
    local NETBIRD_APP_UUID=""
    NETBIRD_APP_UUID="$(printf '%s' "$apps_json" | jq -r --arg prefix "${APP_NAME_PREFIX}" '.[] | select(.name == ($prefix + "-netbird")) | .uuid' 2>/dev/null | head -1 || true)"

    if [ -z "$NETBIRD_APP_UUID" ] || [ "$NETBIRD_APP_UUID" = "null" ]; then
      warn "aisha-netbird UUID not resolved (transient API issue) — Step 11 will retry"
      return 0
    fi
    local body code
    body="$(jq -n \
      --arg pw "$USER_PASSWORD" \
      --arg secret "$CLIENT_SECRET" \
      '{data: [
        {key:"AISHA_BOOTSTRAP_PASSWORD",      value:$pw,     is_build_time:false, is_preview:false},
        {key:"AISHA_BOOTSTRAP_CLIENT_SECRET", value:$secret, is_build_time:false, is_preview:false}
      ]}' 2>/dev/null || echo '{}')"
    code="$(curl -sS -o /dev/null -w "%{http_code}" \
      -X PATCH -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "${COOLIFY_API}/applications/${NETBIRD_APP_UUID}/envs/bulk" 2>/dev/null || true)"
    if [ "$code" = "200" ] || [ "$code" = "201" ]; then
      ok "Coolify env bulk upserted: AISHA_BOOTSTRAP_* on aisha-netbird (HTTP $code)"
    else
      warn "Coolify env bulk upsert failed for AISHA_BOOTSTRAP_* on aisha-netbird (HTTP $code) — Step 11 will retry"
    fi
  }
  step6_sync
  set -e
else
  info "Skipping Coolify sync (SYNC_COOLIFY=$SYNC_COOLIFY or no COOLIFY_API_TOKEN)"
fi

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 2: Provision aisha-pki-bootstrap (mirrors aisha-bootstrap pattern,
# different target: PKI cert issuance via OpenXPKI EST/RPC behind OAuth2 Proxy)
# ═════════════════════════════════════════════════════════════════════════════

banner "Step 7 — Resolve/create aisha-pki-bootstrap user"

PKI_USER_ID="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/users?username=aisha-pki-bootstrap&exact=true" 2>/dev/null \
  | jq -r '.[0].id // empty')"

if [ -z "$PKI_USER_ID" ]; then
  info "User 'aisha-pki-bootstrap' not found — creating via admin API"
  PKI_USER_BODY="$(jq -n '{
    username: "aisha-pki-bootstrap",
    email: "aisha-pki-bootstrap@system.local",
    firstName: "AISHA",
    lastName: "PKI Bootstrap",
    enabled: true,
    emailVerified: true,
    realmRoles: ["member","pki_operator"]
  }')"
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST -H "$(auth_header)" -H "Content-Type: application/json" \
    -d "$PKI_USER_BODY" \
    "${KC_ADMIN}/users" 2>/dev/null)"
  [ "$HTTP_CODE" = "201" ] || { err "Failed to create aisha-pki-bootstrap user (HTTP $HTTP_CODE)"; exit 1; }
  PKI_USER_ID="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/users?username=aisha-pki-bootstrap&exact=true" 2>/dev/null | jq -r '.[0].id // empty')"
  [ -n "$PKI_USER_ID" ] || { err "User created but cannot resolve ID afterwards"; exit 1; }
  ok "aisha-pki-bootstrap user CREATED id=${PKI_USER_ID}"
else
  ok "aisha-pki-bootstrap user id=${PKI_USER_ID} (already exists)"
fi

banner "Step 8 — Resolve/create aisha-pki-bootstrap client + fetch secret"

PKI_CLIENT_INTERNAL_ID="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/clients?clientId=aisha-pki-bootstrap" 2>/dev/null \
  | jq -r '.[0].id // empty')"

if [ -z "$PKI_CLIENT_INTERNAL_ID" ]; then
  info "Client 'aisha-pki-bootstrap' not found — creating via admin API"
  PKI_CLIENT_BODY="$(jq -n '{
    clientId: "aisha-pki-bootstrap",
    name: "AISHA PKI Bootstrap (cert issuance ROPC)",
    description: "Confidential client for cold-start PKI cert issuance — see scripts/aisha-bootstrap-user-init.sh",
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: false,
    authorizationServicesEnabled: false,
    fullScopeAllowed: false,
    redirectUris: [],
    webOrigins: [],
    defaultClientScopes: ["openid", "email", "profile", "roles"],
    protocolMappers: [{
      name: "aisha-pki-bootstrap-pki-proxy-audience",
      protocol: "openid-connect",
      protocolMapper: "oidc-audience-mapper",
      config: {
        "included.custom.audience": "pki-proxy",
        "id.token.claim": "false",
        "access.token.claim": "true"
      }
    }]
  }')"
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST -H "$(auth_header)" -H "Content-Type: application/json" \
    -d "$PKI_CLIENT_BODY" \
    "${KC_ADMIN}/clients" 2>/dev/null)"
  [ "$HTTP_CODE" = "201" ] || { err "Failed to create aisha-pki-bootstrap client (HTTP $HTTP_CODE)"; exit 1; }
  PKI_CLIENT_INTERNAL_ID="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/clients?clientId=aisha-pki-bootstrap" 2>/dev/null | jq -r '.[0].id // empty')"
  [ -n "$PKI_CLIENT_INTERNAL_ID" ] || { err "Client created but cannot resolve ID"; exit 1; }
  ok "aisha-pki-bootstrap client CREATED id=${PKI_CLIENT_INTERNAL_ID}"
else
  ok "aisha-pki-bootstrap client id=${PKI_CLIENT_INTERNAL_ID} (already exists)"
fi

PKI_CLIENT_SECRET="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/clients/${PKI_CLIENT_INTERNAL_ID}/client-secret" 2>/dev/null \
  | jq -r '.value // empty')"
if [ -z "$PKI_CLIENT_SECRET" ]; then
  warn "No pki-bootstrap client secret yet — regenerating"
  PKI_CLIENT_SECRET="$(curl -fsS -X POST -H "$(auth_header)" "${KC_ADMIN}/clients/${PKI_CLIENT_INTERNAL_ID}/client-secret" 2>/dev/null | jq -r '.value // empty')"
  [ -n "$PKI_CLIENT_SECRET" ] || { err "Failed to regenerate pki-bootstrap client secret"; exit 1; }
fi
upsert_env "AISHA_PKI_BOOTSTRAP_CLIENT_SECRET" "$PKI_CLIENT_SECRET"
upsert_env "PKI_BOOTSTRAP_CLIENT_SECRET" "$PKI_CLIENT_SECRET"
ok "AISHA_PKI_BOOTSTRAP_CLIENT_SECRET stored in $ENV_FILE (fp=$(fp "$PKI_CLIENT_SECRET"))"
# Recipient pki-init (Frontend) + pki-renewer (Backend) should log the SAME fp.
# Mismatch in their logs = env not propagated correctly to Coolify.

banner "Step 9 — aisha-pki-bootstrap user password"
PKI_USER_PASSWORD="$(env_value AISHA_PKI_BOOTSTRAP_PASSWORD)"
if [ -z "$PKI_USER_PASSWORD" ]; then
  PKI_USER_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
  info "Generated new aisha-pki-bootstrap password (32 chars)"
fi

PKI_RESET_BODY="$(jq -n --arg pw "$PKI_USER_PASSWORD" '{type:"password", value:$pw, temporary:false}')"
HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT \
  -H "$(auth_header)" -H "Content-Type: application/json" \
  -d "$PKI_RESET_BODY" \
  "${KC_ADMIN}/users/${PKI_USER_ID}/reset-password" 2>/dev/null)"
[ "$HTTP_CODE" = "204" ] || { err "Failed to set aisha-pki-bootstrap password (HTTP $HTTP_CODE)"; exit 1; }
upsert_env "AISHA_PKI_BOOTSTRAP_PASSWORD" "$PKI_USER_PASSWORD"
upsert_env "PKI_BOOTSTRAP_PASSWORD" "$PKI_USER_PASSWORD"
ok "Password set for aisha-pki-bootstrap (HTTP 204) and stored (fp=$(fp "$PKI_USER_PASSWORD"))"

# Step 9.5 — Ensure pki-proxy audience mapper exists on aisha-pki-bootstrap
# (defensive self-heal: realm import may not have applied the mapper, e.g.
# if the realm pre-existed or the import was partial; without `aud=pki-proxy`
# claim, svc-pki-bridge returns 401 "wrong-audience token" on /v1/issue).
banner "Step 9.5 — Ensure pki-proxy audience mapper on aisha-pki-bootstrap"
MAPPERS_JSON="$(curl -fsS -H "$(auth_header)" \
  "${KC_ADMIN}/clients/${PKI_CLIENT_INTERNAL_ID}/protocol-mappers/models" 2>/dev/null || echo '[]')"
HAS_AUDIENCE_MAPPER="$(printf '%s' "$MAPPERS_JSON" \
  | jq -r '[.[] | select(.protocolMapper == "oidc-audience-mapper" and (.config["included.custom.audience"] // "") == "pki-proxy")] | length // 0')"
if [ "${HAS_AUDIENCE_MAPPER:-0}" = "0" ]; then
  info "Audience mapper missing — adding via admin API"
  MAPPER_BODY="$(jq -n '{
    name: "aisha-pki-bootstrap-pki-proxy-audience",
    protocol: "openid-connect",
    protocolMapper: "oidc-audience-mapper",
    config: {
      "included.custom.audience": "pki-proxy",
      "id.token.claim": "false",
      "access.token.claim": "true"
    }
  }')"
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST -H "$(auth_header)" -H "Content-Type: application/json" \
    -d "$MAPPER_BODY" \
    "${KC_ADMIN}/clients/${PKI_CLIENT_INTERNAL_ID}/protocol-mappers/models" 2>/dev/null)"
  case "$HTTP_CODE" in
    201) ok "Audience mapper added (HTTP 201)" ;;
    409) ok "Audience mapper already present (HTTP 409 — concurrent add)" ;;
    *)   err "Failed to add audience mapper (HTTP $HTTP_CODE)"; exit 1 ;;
  esac
else
  ok "Audience mapper present (count=$HAS_AUDIENCE_MAPPER)"
fi

banner "Step 10 — Verify pki-bootstrap ROPC token flow"
PKI_VERIFY_TOKEN="$(curl -fsS --http1.1 --max-time 30 \
  -X POST "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=aisha-pki-bootstrap" \
  -d "client_secret=${PKI_CLIENT_SECRET}" \
  -d "username=aisha-pki-bootstrap" \
  -d "password=${PKI_USER_PASSWORD}" \
  -d "scope=openid" \
  2>/dev/null | jq -r '.access_token // empty')"
[ -n "$PKI_VERIFY_TOKEN" ] || { err "ROPC verification failed for aisha-pki-bootstrap"; exit 1; }
ok "aisha-pki-bootstrap ROPC token acquired (sig_fp=$(fp_jwt "$PKI_VERIFY_TOKEN"))"

# Decode the verification token and assert `aud` contains `pki-proxy`.
# This catches misconfiguration BEFORE netbird-pki-init runs (where it would
# manifest as a confusing HTTP 401 from pki-bridge several waves later).
PKI_TOKEN_PAYLOAD_B64="$(echo "$PKI_VERIFY_TOKEN" | cut -d. -f2)"
PKI_TOKEN_PAYLOAD_PADDED="$(printf '%s' "$PKI_TOKEN_PAYLOAD_B64" | tr '_-' '/+')"
case $(( ${#PKI_TOKEN_PAYLOAD_PADDED} % 4 )) in
  2) PKI_TOKEN_PAYLOAD_PADDED="${PKI_TOKEN_PAYLOAD_PADDED}==" ;;
  3) PKI_TOKEN_PAYLOAD_PADDED="${PKI_TOKEN_PAYLOAD_PADDED}=" ;;
esac
PKI_TOKEN_CLAIMS="$(printf '%s' "$PKI_TOKEN_PAYLOAD_PADDED" | base64 -d 2>/dev/null || echo '{}')"
PKI_TOKEN_AUD_HAS_PROXY="$(echo "$PKI_TOKEN_CLAIMS" | jq -r '
  (.aud // []) as $a
  | if ($a | type) == "string" then ($a == "pki-proxy")
    elif ($a | type) == "array" then ($a | any(. == "pki-proxy"))
    else false end' 2>/dev/null || echo false)"
PKI_TOKEN_ISS="$(echo "$PKI_TOKEN_CLAIMS" | jq -r '.iss // "MISSING"' 2>/dev/null)"
PKI_TOKEN_AUD="$(echo "$PKI_TOKEN_CLAIMS" | jq -c '.aud // "MISSING"' 2>/dev/null)"
if [ "$PKI_TOKEN_AUD_HAS_PROXY" != "true" ]; then
  err "  ROPC token DOES NOT contain 'pki-proxy' in aud claim — pki-bridge will reject"
  err "  iss = $PKI_TOKEN_ISS"
  err "  aud = $PKI_TOKEN_AUD"
  err "  Diagnose: check protocol-mappers on client aisha-pki-bootstrap in KC admin"
  exit 1
fi
ok "  Token aud claim contains 'pki-proxy' (iss=$PKI_TOKEN_ISS)"

# ═════════════════════════════════════════════════════════════════════════════
# PHASE 4: Provision aisha-pki-issuer — SERVICE-ACCOUNT client for the unified
# mesh-cert issuer (aisha-pki-renewer). client_credentials grant (M2M — no user,
# no password), aud=pki-proxy. Best-practice replacement for the ROPC bootstrap
# user in automated cert issuance (infra/pki/pki-renewer.sh).
# ═════════════════════════════════════════════════════════════════════════════
fi  # end "if ISSUER_ONLY != 1" — Steps 2-10 above are the full-flow user bootstrap

banner "Step 10b — Resolve/create aisha-pki-issuer service-account client"

ISSUER_CLIENT_INTERNAL_ID="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/clients?clientId=aisha-pki-issuer" 2>/dev/null | jq -r '.[0].id // empty')"
if [ -z "$ISSUER_CLIENT_INTERNAL_ID" ]; then
  info "Client 'aisha-pki-issuer' not found — creating via admin API"
  ISSUER_CLIENT_BODY="$(jq -n '{
    clientId: "aisha-pki-issuer",
    name: "AISHA PKI Issuer (mesh-cert issuance, client_credentials)",
    description: "Confidential SERVICE-ACCOUNT client used by aisha-pki-renewer to issue *.mesh certs via pki-bridge — see infra/pki/pki-renewer.sh",
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    authorizationServicesEnabled: false,
    fullScopeAllowed: false,
    redirectUris: [],
    webOrigins: [],
    defaultClientScopes: ["openid", "roles"],
    protocolMappers: [{
      name: "aisha-pki-issuer-pki-proxy-audience",
      protocol: "openid-connect",
      protocolMapper: "oidc-audience-mapper",
      config: { "included.custom.audience": "pki-proxy", "id.token.claim": "false", "access.token.claim": "true" }
    }]
  }')"
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST -H "$(auth_header)" -H "Content-Type: application/json" \
    -d "$ISSUER_CLIENT_BODY" "${KC_ADMIN}/clients" 2>/dev/null)"
  [ "$HTTP_CODE" = "201" ] || { err "Failed to create aisha-pki-issuer client (HTTP $HTTP_CODE)"; exit 1; }
  ISSUER_CLIENT_INTERNAL_ID="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/clients?clientId=aisha-pki-issuer" 2>/dev/null | jq -r '.[0].id // empty')"
  [ -n "$ISSUER_CLIENT_INTERNAL_ID" ] || { err "Client created but cannot resolve ID"; exit 1; }
  ok "aisha-pki-issuer client CREATED id=${ISSUER_CLIENT_INTERNAL_ID}"
else
  ok "aisha-pki-issuer client id=${ISSUER_CLIENT_INTERNAL_ID} (already exists)"
fi

# Idempotently ensure the pki-proxy audience mapper (covers a pre-existing client
# created without it). POST returns 409 if already present — harmless.
curl -sS -o /dev/null -H "$(auth_header)" -H "Content-Type: application/json" -X POST \
  -d "$(jq -n '{name:"aisha-pki-issuer-pki-proxy-audience", protocol:"openid-connect", protocolMapper:"oidc-audience-mapper", config:{"included.custom.audience":"pki-proxy","id.token.claim":"false","access.token.claim":"true"}}')" \
  "${KC_ADMIN}/clients/${ISSUER_CLIENT_INTERNAL_ID}/protocol-mappers/models" 2>/dev/null || true

# Resolve the aisha-pki-issuer client secret. PREFER the PRE-GENERATED value
# (generate-secrets.mjs → .env.coolify), which is ALREADY baked into aisha-pki's
# env, so the running pki-renewer holds it. Enforce that exact value on the KC
# client (fetch representation → inject `secret` → PUT) so the two match and the
# renewer authenticates with no post-boot redeploy (container env is immutable
# after start). Confidential-client PUT with a `secret` field sets it in Keycloak.
ISSUER_PREGEN_SECRET="$(env_value AISHA_PKI_ISSUER_CLIENT_SECRET)"
if [ -n "$ISSUER_PREGEN_SECRET" ]; then
  # Enforce the pre-generated secret onto the KC client, WITH RETRY. A transient
  # KC API blip must not leave the client secret mismatched against the renewer's
  # immutable env value (which would make the renewer inert until the next
  # aisha-pki redeploy). Verified end-to-end by the Step 10c token test below.
  ISSUER_PUT_CODE="000"
  ISSUER_PUT_ATTEMPT=0
  while [ "$ISSUER_PUT_ATTEMPT" -lt 3 ]; do
    ISSUER_PUT_ATTEMPT=$((ISSUER_PUT_ATTEMPT + 1))
    ISSUER_REP="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/clients/${ISSUER_CLIENT_INTERNAL_ID}" 2>/dev/null || true)"
    if [ -n "$ISSUER_REP" ]; then
      ISSUER_PUT_CODE="$(printf '%s' "$ISSUER_REP" | jq --arg s "$ISSUER_PREGEN_SECRET" '. + {secret:$s}' \
        | curl -sS -o /dev/null -w '%{http_code}' -X PUT -H "$(auth_header)" -H "Content-Type: application/json" \
            --data @- "${KC_ADMIN}/clients/${ISSUER_CLIENT_INTERNAL_ID}" 2>/dev/null || true)"
      [ "$ISSUER_PUT_CODE" = "204" ] && break
    fi
    warn "  Enforcing aisha-pki-issuer secret → HTTP $ISSUER_PUT_CODE (attempt ${ISSUER_PUT_ATTEMPT}/3)"
    [ "$ISSUER_PUT_ATTEMPT" -lt 3 ] && sleep 3
  done
  [ "$ISSUER_PUT_CODE" = "204" ] || warn "  aisha-pki-issuer secret NOT enforced after 3 attempts (HTTP $ISSUER_PUT_CODE) — renewer may stay inert until aisha-pki is redeployed; verified below via token"
  ISSUER_CLIENT_SECRET="$ISSUER_PREGEN_SECRET"
  ok "aisha-pki-issuer secret set from pre-generated AISHA_PKI_ISSUER_CLIENT_SECRET (fp=$(fp "$ISSUER_CLIENT_SECRET"))"
else
  # Fallback (older vault with no pre-generated value): read KC's secret, or mint one.
  ISSUER_CLIENT_SECRET="$(curl -fsS -H "$(auth_header)" "${KC_ADMIN}/clients/${ISSUER_CLIENT_INTERNAL_ID}/client-secret" 2>/dev/null | jq -r '.value // empty')"
  if [ -z "$ISSUER_CLIENT_SECRET" ]; then
    warn "No aisha-pki-issuer client secret yet — regenerating"
    ISSUER_CLIENT_SECRET="$(curl -fsS -X POST -H "$(auth_header)" "${KC_ADMIN}/clients/${ISSUER_CLIENT_INTERNAL_ID}/client-secret" 2>/dev/null | jq -r '.value // empty')"
    [ -n "$ISSUER_CLIENT_SECRET" ] || { err "Failed to regenerate aisha-pki-issuer client secret"; exit 1; }
  fi
fi
upsert_env "AISHA_PKI_ISSUER_CLIENT_SECRET" "$ISSUER_CLIENT_SECRET"
ok "AISHA_PKI_ISSUER_CLIENT_SECRET stored in $ENV_FILE (fp=$(fp "$ISSUER_CLIENT_SECRET"))"

banner "Step 10c — Verify aisha-pki-issuer client_credentials token (+ aud=pki-proxy)"
ISSUER_VERIFY_TOKEN="$(curl -fsS --http1.1 --max-time 30 \
  -d "grant_type=client_credentials" \
  -d "client_id=aisha-pki-issuer" \
  -d "client_secret=${ISSUER_CLIENT_SECRET}" \
  "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" 2>/dev/null | jq -r '.access_token // empty')"
# NON-FATAL from here: aisha-pki-renewer is a self-healing background sidecar
# (short-poll retry) and netbird uses a self-signed cert until the real mesh cert
# is delivered — so a transient issuer-auth problem must NOT abort the whole
# platform bootstrap. Surface it loudly; the renewer converges on its own.
if [ -z "$ISSUER_VERIFY_TOKEN" ]; then
  warn "aisha-pki-issuer client_credentials verification failed — pki-renewer will keep retrying; netbird stays on self-signed until it succeeds"
else
  ISSUER_CLAIMS_B64="$(echo "$ISSUER_VERIFY_TOKEN" | cut -d. -f2 | tr '_-' '/+')"
  case $(( ${#ISSUER_CLAIMS_B64} % 4 )) in 2) ISSUER_CLAIMS_B64="${ISSUER_CLAIMS_B64}==" ;; 3) ISSUER_CLAIMS_B64="${ISSUER_CLAIMS_B64}=" ;; esac
  ISSUER_CLAIMS="$(printf '%s' "$ISSUER_CLAIMS_B64" | base64 -d 2>/dev/null || echo '{}')"
  ISSUER_AUD_OK="$(echo "$ISSUER_CLAIMS" | jq -r '(.aud // []) as $a | if ($a|type)=="string" then ($a=="pki-proxy") elif ($a|type)=="array" then ($a|any(.=="pki-proxy")) else false end' 2>/dev/null || echo false)"
  if [ "$ISSUER_AUD_OK" != "true" ]; then
    warn "aisha-pki-issuer token missing 'pki-proxy' in aud — pki-bridge will reject issuance (aud=$(echo "$ISSUER_CLAIMS" | jq -c '.aud // "MISSING"'))"
  else
    ok "aisha-pki-issuer client_credentials OK (aud contains pki-proxy, sig_fp=$(fp_jwt "$ISSUER_VERIFY_TOKEN"))"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 11: Sync AISHA_PKI_BOOTSTRAP_* to Coolify (aisha-netbird + aisha-pki)
#
# Has to run AFTER Step 7-10 (which provision aisha-pki-bootstrap user/client
# and populate PKI_USER_PASSWORD/PKI_CLIENT_SECRET). Step 6 above does the
# AISHA_BOOTSTRAP_* (account-ownership) creds; this does the PKI ones.
#
# These creds are consumed by:
#   - aisha-netbird frontend--netbird--pki-init: ROPC token → POST
#     pki-bridge:3040/v1/issue → write cert to /certs/pki/netbird-mesh/
#     → caddy-internal-tls reads it → management binds 443 → healthy
#   - aisha-pki pki-bridge: same ROPC creds for cert lifecycle ops
# ─────────────────────────────────────────────────────────────────────────────
if [ "$SYNC_COOLIFY" = "1" ] && [ -n "${COOLIFY_API_TOKEN:-$(env_value COOLIFY_API_TOKEN)}" ]; then
  banner "Step 11 — Sync AISHA_PKI_BOOTSTRAP_* to Coolify (aisha-netbird + aisha-pki)"

  # Disable strict mode for the sync block: same rationale as Step 6.
  # Transient API errors here MUST NOT abort the script.
  set +e
  step11_sync() {
    local apps_json NETBIRD_APP_UUID PKI_APP_UUID pki_body
    apps_json="$(curl -sS --max-time 30 -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
      "${COOLIFY_API}/applications" 2>/dev/null || echo '[]')"
    NETBIRD_APP_UUID="$(printf '%s' "$apps_json" | jq -r --arg prefix "${APP_NAME_PREFIX}" '.[] | select(.name == ($prefix + "-netbird")) | .uuid' 2>/dev/null | head -1 || true)"
    PKI_APP_UUID="$(printf '%s' "$apps_json" | jq -r --arg prefix "${APP_NAME_PREFIX}" '.[] | select(.name == ($prefix + "-pki")) | .uuid' 2>/dev/null | head -1 || true)"

    # ⛔ NAMĚŘENO 2026-08-19 na riqi: tady stálo JEN `is_preview:false`.
    # Coolify drží od každého klíče DVĚ řádky (produkční a preview) a při
    # renderu compose vyhrává PREVIEW. Zápis šel do produkční, čtení vzalo
    # preview — obojí pravda, a `pki-init` proto dostal 43znakové tajemství
    # z 09:46, přestože se v 13:41 sesouhlasilo správné:
    #   ❌ unauthorized_client: Invalid client or Invalid client credentials
    # Klíč se proto píše do OBOU oblastí. Jedna oblast = tichý rozchod.
    pki_body="$(jq -n \
      --arg pki_pw "$PKI_USER_PASSWORD" \
      --arg pki_secret "$PKI_CLIENT_SECRET" \
      --arg issuer_secret "$ISSUER_CLIENT_SECRET" \
      '[{key:"AISHA_PKI_BOOTSTRAP_PASSWORD",      value:$pki_pw},
        {key:"AISHA_PKI_BOOTSTRAP_CLIENT_SECRET", value:$pki_secret},
        {key:"AISHA_PKI_ISSUER_CLIENT_SECRET",    value:$issuer_secret}]
       | {data: ([.[] | . + {is_build_time:false, is_preview:false}]
               + [.[] | . + {is_build_time:false, is_preview:true}])}' 2>/dev/null || echo '{}')"

    push_pki_to_app() {
      local target_uuid="$1"
      local target_name="$2"
      local target_role="$3"
      local code
      if drzena "$target_role"; then
        warn "  $(drzeni_hlaska "$target_role"). AISHA_PKI_BOOTSTRAP_* se do ní NEZAPISUJÍ."
        return 0
      fi
      if [ -z "$target_uuid" ] || [ "$target_uuid" = "null" ]; then
        warn "  ${target_name}: UUID not resolved (transient API issue) — skip"
        return 0
      fi
      code="$(curl -sS -o /dev/null -w "%{http_code}" \
        -X PATCH -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$pki_body" \
        "${COOLIFY_API}/applications/${target_uuid}/envs/bulk" 2>/dev/null || true)"
      if [ "$code" != "200" ] && [ "$code" != "201" ]; then
        warn "  ${target_name} (${target_uuid}): AISHA_PKI_BOOTSTRAP_* upsert failed (HTTP $code)"
        return 0
      fi
      # ⭐ HTTP 200 mluví o ÚLOZE, ne o CÍLI. Rozhoduje, co si appka PŘEČTE —
      # a to se pozná jen zpětným čtením VŠECH řádků daného klíče. Bez toho
      # hlásil krok „upsert OK" nad prostředím, které se rozcházelo samo se sebou.
      local envs rozchod
      envs="$(curl -sS --max-time 30 -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
        "${COOLIFY_API}/applications/${target_uuid}/envs" 2>/dev/null || echo '[]')"
      rozchod="$(printf '%s' "$envs" | jq -r '
        [ .[] | select(.key | startswith("AISHA_PKI_")) ]
        | group_by(.key)
        | map(select((map(.value) | unique | length) > 1) | .[0].key)
        | .[]' 2>/dev/null || true)"
      if [ -n "$rozchod" ]; then
        err "  ${target_name}: produkční a preview hodnota se ROZCHÁZÍ (při renderu vyhraje preview):"
        printf '      %s\n' $rozchod >&2
        return 1
      fi
      ok "  ${target_name} (${target_uuid}): AISHA_PKI_BOOTSTRAP_* zapsáno a ZPĚTNĚ OVĚŘENO v obou oblastech"
    }

    push_pki_to_app "$NETBIRD_APP_UUID" "aisha-netbird" netbird
    push_pki_to_app "$PKI_APP_UUID" "aisha-pki" pki
  }
  step11_sync
  set -e
fi

banner "Done"
ok "aisha-bootstrap user provisioning complete (NetBird mesh ownership)"
ok "aisha-pki-bootstrap user provisioning complete (PKI cert issuance)"
ok "Next steps:"
ok "  scripts/netbird-bootstrap.sh — claim NetBird account ownership via aisha-bootstrap"
ok "  scripts/pki-issue-internal-cert.sh netbird-mesh — issue cert via aisha-pki-bootstrap (Phase 2)"

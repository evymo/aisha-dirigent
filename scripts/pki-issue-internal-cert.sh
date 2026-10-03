#!/usr/bin/env bash
# ==============================================================================
# pki-issue-internal-cert.sh — Issue/rotate AISHA PKI cert for internal services
# ==============================================================================
#
# WHY THIS EXISTS
# ----------------
# Internal services that need TLS certs from our own AISHA PKI (Evymo Root CA)
# instead of Let's Encrypt. Specifically: NetBird mesh control plane on port
# 33073 — agents trust the cert via /certs/pki/aisha-ca-bundle.pem.
#
# CURRENT STATE: PHASE 1 (manual issuance via OpenXPKI WebUI)
# -----------------------------------------------------------
# OpenXPKI WebUI is behind OAuth2 Proxy (Keycloak SSO). Programmatic EST/RPC
# enrollment requires either:
#   a) Bypass OAuth2 for service-to-service (firewall to PKI internal subnet)
#   b) Service account JWT with realm role pki_operator
#   c) PKI client certificate (mTLS)
#
# Until that flow is wired, USE THIS SCRIPT WITH THE MANUAL WORKFLOW BELOW:
#
#   1. Login to OpenXPKI WebUI: https://pki.example.com/openxpki/webui/
#      Use Keycloak SSO with your platform-admin account (PLATFORM_ADMIN_EMAIL).
#
#   2. Choose the appropriate realm:
#      - identity-plane    (for Keycloak/auth services)
#      - data-plane        (for PostgreSQL/storage/messaging)
#      - orchestration-plane (for n8n/edge-fns/Ragnarok/PostgREST/Dirigent)
#      For NetBird mesh control plane: orchestration-plane
#
#   3. Issue a server-tls cert with these parameters:
#        Subject CN: netbird.mesh.aisha.internal
#        SAN DNS:    netbird.mesh.aisha.internal
#        Profile:    server-tls (web-server / TLS server auth)
#        Validity:   90 days (CNSA 2.0 best practice — auto-renew at 60d)
#        Key:        EC P-384 (matches realm CA algorithm)
#
#   4. Download the issued cert (cert.pem) AND private key (key.pem). For
#      RSA fallback profiles, save key.pem in PKCS#8 format.
#
#   5. Run this script with the downloaded files:
#        bash scripts/pki-issue-internal-cert.sh netbird-mesh \
#          --cert /path/to/cert.pem --key /path/to/key.pem
#
#      The script will:
#        - Validate cert subject + SAN matches expected hostname
#        - Validate cert chain against config/pki/aisha-ca-bundle.pem
#        - Base64-encode cert+key (no newline issues in env vars)
#        - Push to Coolify env on aisha-netbird app:
#            NETBIRD_INTERNAL_CERT_B64
#            NETBIRD_INTERNAL_KEY_B64
#        - Trigger redeploy of aisha-netbird (caddy sidecar picks up)
#
#   6. Verify caddy sidecar loaded the cert (no self-signed warning in logs):
#        docker logs frontend--netbird--internal-tls 2>&1 | grep "AISHA PKI cert"
#
# PHASE 2 (IMPLEMENTED): automated issuance via svc-pki-bridge
# --------------------------------------------------------------
# svc-pki-bridge is the machine consumer of JWT tokens with aud=pki-proxy.
# The flow:
#   1. Acquire ROPC token from Keycloak (aisha-pki-bootstrap client)
#   2. POST to pki-bridge /v1/issue with Bearer token + hostname/SAN
#   3. Bridge generates EC P-384 key + CSR, submits to OpenXPKI RPC with HMAC
#   4. Bridge returns cert + key + chain PEM bundle
#   5. Script validates, encodes, pushes to Coolify env, triggers redeploy
#
# Usage:
#   bash scripts/pki-issue-internal-cert.sh netbird-mesh --auto-issue
#   bash scripts/pki-issue-internal-cert.sh netbird-mesh --auto-issue --no-redeploy
#
# Required env vars (in .env.coolify or env):
#   PKI_BOOTSTRAP_CLIENT_ID       — Keycloak client_id (default: aisha-pki-bootstrap)
#   PKI_BOOTSTRAP_CLIENT_SECRET   — Keycloak client secret
#   PKI_BOOTSTRAP_USERNAME        — system user (default: aisha-pki-bootstrap)
#   PKI_BOOTSTRAP_PASSWORD        — system user password
#   PKI_BRIDGE_URL                — pki-bridge endpoint (default: http://aisha-pki-bridge:3040)
#   KEYCLOAK_URL                  — Keycloak base URL
#
# AUTO-RENEWAL
# ------------
# Run this script via cron with --check-expiry option:
#   bash scripts/pki-issue-internal-cert.sh netbird-mesh --check-expiry
#
# If cert expires within RENEW_WINDOW_DAYS (default: 30), script:
#   - PHASE 1: prints a LOUD warning to stderr (operator must re-issue manually)
#   - PHASE 2 (when implemented): triggers full re-issue flow automatically
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.coolify}"
TOKEN_FILE="${TOKEN_FILE:-$ROOT/.env-prod-backup}"
CA_BUNDLE="${CA_BUNDLE:-$ROOT/config/pki/aisha-ca-bundle.pem}"
# shellcheck source=scripts/lib/coolify-api-base.sh
source "$ROOT/scripts/lib/coolify-api-base.sh"
# shellcheck source=scripts/lib/env-zapis.sh
source "$ROOT/scripts/lib/env-zapis.sh"
COOLIFY_API="$(resolve_coolify_api)" || exit 1  # normalizes to <host>/api/v1 (COOLIFY_API|COOLIFY_URL)
RENEW_WINDOW_DAYS="${RENEW_WINDOW_DAYS:-30}"

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'; N='\033[0m'
info()   { echo -e "${B}ℹ${N}  $*" >&2; }
ok()     { echo -e "${G}✅${N} $*" >&2; }
warn()   { echo -e "${Y}⚠${N}  $*" >&2; }
err()    { echo -e "${R}❌${N} $*" >&2; }
banner() { echo -e "\n${C}═══ $* ═══${N}" >&2; }

usage() {
  cat <<EOF
Usage: $0 <service-name> --cert <path> --key <path>    # Phase 1: manual
       $0 <service-name> --auto-issue                   # Phase 2: autonomous
       $0 <service-name> --check-expiry                 # Renewal check
       $0 <service-name> --check-expiry --auto-renew    # Auto-renew if expiring

Service name (currently only one):
  netbird-mesh  — NetBird internal mesh control plane (CN=netbird.mesh.aisha.internal)

Options:
  --cert <path>      Path to PEM-encoded cert file (issued by OpenXPKI WebUI)
  --key <path>       Path to PEM-encoded private key file
  --auto-issue       Phase 2: acquire cert autonomously via pki-bridge + ROPC
  --check-expiry     Check current cert expiration; warn if within $RENEW_WINDOW_DAYS days
  --auto-renew       With --check-expiry: auto-issue if cert is expiring (implies --auto-issue)
  --no-coolify       Skip Coolify env push + redeploy (write to .env.coolify only)
  --no-redeploy      Skip Coolify deploy trigger (env updated, manual redeploy required)
  -h, --help         Show this help
EOF
}

# ── Service registry: hostname + Coolify app UUID ──────────────────────────
service_config() {
  case "$1" in
    netbird-mesh)
      printf 'hostname=netbird.mesh.aisha.internal\n'
      printf 'coolify_uuid=lgsok8k8k4w4s44sgk00wosc\n'
      printf 'env_cert_key=NETBIRD_INTERNAL_CERT_B64\n'
      printf 'env_key_key=NETBIRD_INTERNAL_KEY_B64\n'
      ;;
    *)
      err "Unknown service: $1"
      exit 1
      ;;
  esac
}

# ── Parse args ─────────────────────────────────────────────────────────────
[[ $# -lt 1 || "$1" = "-h" || "$1" = "--help" ]] && { usage; exit 0; }
SERVICE="$1"; shift

CERT_FILE=""
KEY_FILE=""
CHECK_EXPIRY=0
AUTO_ISSUE=0
AUTO_RENEW=0
SYNC_COOLIFY=1
TRIGGER_DEPLOY=1

while [ $# -gt 0 ]; do
  case "$1" in
    --cert) CERT_FILE="$2"; shift 2 ;;
    --key) KEY_FILE="$2"; shift 2 ;;
    --check-expiry) CHECK_EXPIRY=1; shift ;;
    --auto-issue) AUTO_ISSUE=1; shift ;;
    --auto-renew) AUTO_RENEW=1; shift ;;
    --no-coolify) SYNC_COOLIFY=0; shift ;;
    --no-redeploy) TRIGGER_DEPLOY=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "Unknown arg: $1"; usage; exit 1 ;;
  esac
done

eval "$(service_config "$SERVICE")"
info "Service: $SERVICE  (hostname=$hostname)"

# ── Mode: --check-expiry ───────────────────────────────────────────────────
if [ "$CHECK_EXPIRY" = "1" ]; then
  banner "Check expiry"
  CERT_B64=$(grep -E "^${env_cert_key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)
  if [ -z "$CERT_B64" ]; then
    warn "$env_cert_key not set in $ENV_FILE — no current cert to check"
    info "Issue cert via OpenXPKI WebUI and re-run with --cert/--key"
    exit 2
  fi
  TMP_CERT=$(mktemp)
  trap "rm -f $TMP_CERT" EXIT
  echo "$CERT_B64" | base64 -d > "$TMP_CERT"

  EXPIRY=$(openssl x509 -in "$TMP_CERT" -noout -enddate | cut -d= -f2)
  EXPIRY_EPOCH=$(date -j -f "%b %e %H:%M:%S %Y %Z" "$EXPIRY" +%s 2>/dev/null || date -d "$EXPIRY" +%s 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

  if [ "$DAYS_LEFT" -lt "$RENEW_WINDOW_DAYS" ]; then
    warn "Cert expires in $DAYS_LEFT days (window=$RENEW_WINDOW_DAYS)"
    if [ "$AUTO_RENEW" = "1" ]; then
      info "Auto-renew enabled — proceeding to autonomous issuance via pki-bridge"
      AUTO_ISSUE=1
      # Fall through to auto-issue flow below
    else
      err "  ACTION REQUIRED: re-issue cert via --auto-issue or OpenXPKI WebUI"
      err "  Or use --auto-renew for automatic renewal"
      exit 1
    fi
  else
    ok "Cert valid for $DAYS_LEFT days — within window=$RENEW_WINDOW_DAYS"
    exit 0
  fi
fi

# ── Mode: auto-issue via pki-bridge (Phase 2) ────────────────────────────
if [ "$AUTO_ISSUE" = "1" ]; then
  banner "Phase 2 — Autonomous issuance via svc-pki-bridge"

  # ── Load credentials ──
  KEYCLOAK_URL="${KEYCLOAK_URL:?KEYCLOAK_URL required (e.g. https://auth.<your-domain>)}"
  PKI_BOOTSTRAP_CLIENT_ID="${PKI_BOOTSTRAP_CLIENT_ID:-aisha-pki-bootstrap}"
  PKI_BOOTSTRAP_CLIENT_SECRET="${PKI_BOOTSTRAP_CLIENT_SECRET:-}"
  PKI_BOOTSTRAP_USERNAME="${PKI_BOOTSTRAP_USERNAME:-aisha-pki-bootstrap}"
  PKI_BOOTSTRAP_PASSWORD="${PKI_BOOTSTRAP_PASSWORD:-}"
  # ⛔ ZDE BÝVAL DEFAULT `http://aisha-pki-bridge:3040` — jméno KONKRÉTNÍ
  # (upstreamové) instance. Na forku by mířil na cizí PKI, nebo na nic.
  # Adresu si tenhle skript odvodit NEUMÍ (identitu instance nezná), takže se
  # nedosazuje: chybějící hodnota selže na správném místě, hádaná trefí cizího.
  PKI_BRIDGE_URL="${PKI_BRIDGE_URL:-}"

  # Try loading from env file if not set (bootstrap-user-init.sh writes AISHA_PKI_BOOTSTRAP_* prefix)
  if [ -z "$PKI_BOOTSTRAP_CLIENT_SECRET" ] && [ -f "$ENV_FILE" ]; then
    PKI_BOOTSTRAP_CLIENT_SECRET=$(grep -E "^(AISHA_)?PKI_BOOTSTRAP_CLIENT_SECRET=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true)
  fi
  if [ -z "$PKI_BOOTSTRAP_PASSWORD" ] && [ -f "$ENV_FILE" ]; then
    PKI_BOOTSTRAP_PASSWORD=$(grep -E "^(AISHA_)?PKI_BOOTSTRAP_PASSWORD=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true)
  fi

  # Validate required credentials
  if [ -z "$PKI_BOOTSTRAP_CLIENT_SECRET" ]; then
    err "PKI_BOOTSTRAP_CLIENT_SECRET not set — run aisha-bootstrap-user-init.sh first"
    exit 1
  fi
  if [ -z "$PKI_BOOTSTRAP_PASSWORD" ]; then
    err "PKI_BOOTSTRAP_PASSWORD not set — run aisha-bootstrap-user-init.sh first"
    exit 1
  fi

  # ── Step A: Acquire ROPC token from Keycloak ──
  info "Acquiring ROPC token from Keycloak..."
  TOKEN_RESPONSE=$(curl -fsS \
    -d "grant_type=password" \
    -d "client_id=${PKI_BOOTSTRAP_CLIENT_ID}" \
    -d "client_secret=${PKI_BOOTSTRAP_CLIENT_SECRET}" \
    -d "username=${PKI_BOOTSTRAP_USERNAME}" \
    -d "password=${PKI_BOOTSTRAP_PASSWORD}" \
    "${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" 2>/dev/null)

  ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
  if [ -z "$ACCESS_TOKEN" ]; then
    err "Failed to acquire ROPC token from Keycloak"
    err "  Response: $(echo "$TOKEN_RESPONSE" | head -c 200)"
    exit 1
  fi
  ok "ROPC token acquired (aud=pki-proxy, $(echo "$TOKEN_RESPONSE" | jq -r '.expires_in')s TTL)"

  # ── Step B: Call pki-bridge /v1/issue ──
  # Retry on TRANSIENT failures (pki-bridge not reachable yet / 5xx), fail fast
  # on 4xx (auth/forbidden won't fix with time) — mirrors
  # infra/pki/issue-netbird-mesh-cert.sh. No `curl -f`: it discards the response
  # body on 4xx/5xx, hiding the real error from operators. ROPC token lifetime
  # (>5m) safely covers the retry budget (default 12 × 10s = 2m).
  PKI_ISSUE_RETRIES="${PKI_ISSUE_RETRIES:-12}"
  PKI_ISSUE_BACKOFF="${PKI_ISSUE_BACKOFF:-10}"
  ISSUE_PAYLOAD="$(jq -n --arg h "$hostname" --arg c "Auto-issued by pki-issue-internal-cert.sh ($SERVICE)" \
    '{hostname: $h, sans: [$h], comment: $c}')"
  ISSUE_BODY_FILE=$(mktemp)
  info "Requesting cert from pki-bridge (hostname=$hostname)..."
  _issue_attempt=1
  while :; do
    HTTP_CODE="$(curl -sS --max-time 60 \
      -o "$ISSUE_BODY_FILE" \
      -w '%{http_code}' \
      -X POST \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$ISSUE_PAYLOAD" \
      "${PKI_BRIDGE_URL}/v1/issue" 2>/dev/null)" || HTTP_CODE="curl-error"
    ISSUE_RESPONSE="$(cat "$ISSUE_BODY_FILE" 2>/dev/null || true)"
    if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
      break
    fi
    case "$HTTP_CODE" in
      curl-error|000|""|5??)
        if [ "$_issue_attempt" -lt "$PKI_ISSUE_RETRIES" ]; then
          warn "pki-bridge /v1/issue transient (HTTP $HTTP_CODE) — retry ${_issue_attempt}/${PKI_ISSUE_RETRIES} in ${PKI_ISSUE_BACKOFF}s (pki-bridge may not be ready yet)"
          sleep "$PKI_ISSUE_BACKOFF"
          _issue_attempt=$((_issue_attempt + 1))
          continue
        fi
        ;;
    esac
    break  # 2xx handled above; 4xx or retries exhausted → error handling below
  done
  rm -f "$ISSUE_BODY_FILE"
  if [ "$HTTP_CODE" != "201" ] && [ "$HTTP_CODE" != "200" ]; then
    err "pki-bridge /v1/issue failed (HTTP $HTTP_CODE)"
    err "  Response: $(echo "$ISSUE_RESPONSE" | head -c 300)"
    exit 1
  fi

  BRIDGE_CERT=$(echo "$ISSUE_RESPONSE" | jq -r '.certificate // empty')
  BRIDGE_KEY=$(echo "$ISSUE_RESPONSE" | jq -r '.privateKey // empty')
  BRIDGE_CHAIN=$(echo "$ISSUE_RESPONSE" | jq -r '.chain // empty')
  BRIDGE_ID=$(echo "$ISSUE_RESPONSE" | jq -r '.certIdentifier // empty')
  BRIDGE_TXN=$(echo "$ISSUE_RESPONSE" | jq -r '.transactionId // empty')

  if [ -z "$BRIDGE_CERT" ] || [ -z "$BRIDGE_KEY" ]; then
    err "pki-bridge returned empty cert or key"
    err "  Response: $(echo "$ISSUE_RESPONSE" | head -c 300)"
    exit 1
  fi
  ok "Certificate issued by pki-bridge (id=$BRIDGE_ID txn=$BRIDGE_TXN)"

  # ── Step C: Write cert + key to temp files for validation ──
  CERT_FILE=$(mktemp)
  KEY_FILE=$(mktemp)
  AUTO_CLEANUP="$CERT_FILE $KEY_FILE"
  trap "rm -f $AUTO_CLEANUP" EXIT

  echo "$BRIDGE_CERT" > "$CERT_FILE"
  # If chain is present, append it to cert for full chain bundle
  if [ -n "$BRIDGE_CHAIN" ]; then
    echo "$BRIDGE_CHAIN" >> "$CERT_FILE"
  fi
  echo "$BRIDGE_KEY" > "$KEY_FILE"
  chmod 600 "$KEY_FILE"

  info "Cert + key written to temp files — proceeding to validation..."
  # Fall through to validation + Coolify push (shared with Phase 1)
fi

# ── Mode: issue with --cert/--key (Phase 1 manual) ────────────────────────
if [ -z "$CERT_FILE" ] || [ -z "$KEY_FILE" ]; then
  err "Both --cert and --key required (or use --auto-issue or --check-expiry)"
  usage
  exit 1
fi
[ -r "$CERT_FILE" ] || { err "Cannot read cert file: $CERT_FILE"; exit 1; }
[ -r "$KEY_FILE" ] || { err "Cannot read key file: $KEY_FILE"; exit 1; }

banner "Step 1 — Validate cert"

CERT_SUBJECT=$(openssl x509 -in "$CERT_FILE" -noout -subject -nameopt RFC2253 2>/dev/null | sed 's|^subject=||')
CERT_SANS=$(openssl x509 -in "$CERT_FILE" -noout -ext subjectAltName 2>/dev/null | tail -n +2 | tr ',' '\n' | sed 's|^[[:space:]]*||;s|[[:space:]]*$||' | tr '\n' ',' | sed 's|,$||')
CERT_ISSUER=$(openssl x509 -in "$CERT_FILE" -noout -issuer -nameopt RFC2253 2>/dev/null | sed 's|^issuer=||')

info "Subject:  $CERT_SUBJECT"
info "Issuer:   $CERT_ISSUER"
info "SAN:      $CERT_SANS"

if ! echo "$CERT_SUBJECT" | grep -qE "CN=$hostname(,|$)"; then
  err "Cert CN does not match expected hostname '$hostname'"
  err "  Got: $CERT_SUBJECT"
  exit 1
fi
if ! echo "$CERT_SANS" | grep -q "DNS:$hostname"; then
  err "Cert SAN missing DNS:$hostname"
  err "  Got: $CERT_SANS"
  exit 1
fi
ok "Cert subject + SAN match expected hostname"

banner "Step 2 — Validate chain against AISHA CA bundle"

if openssl verify -CAfile "$CA_BUNDLE" "$CERT_FILE" >/dev/null 2>&1; then
  ok "Cert chains to AISHA CA bundle ($(realpath "$CA_BUNDLE"))"
else
  warn "Cert does NOT chain to $CA_BUNDLE — chain may be incomplete"
  warn "Continuing anyway (intermediate CA may need to be appended to cert.pem)"
fi

banner "Step 3 — Validate key matches cert"
CERT_PUB=$(openssl x509 -in "$CERT_FILE" -noout -pubkey | openssl md5 | cut -d' ' -f2)
KEY_PUB=$(openssl pkey -in "$KEY_FILE" -pubout 2>/dev/null | openssl md5 | cut -d' ' -f2)
if [ "$CERT_PUB" != "$KEY_PUB" ]; then
  err "Cert public key does not match private key (cert=$CERT_PUB key=$KEY_PUB)"
  exit 1
fi
ok "Cert + key pair match (pubkey hash: $CERT_PUB)"

banner "Step 4 — Encode + write to .env.coolify"
CERT_B64=$(base64 < "$CERT_FILE" | tr -d '\n')
KEY_B64=$(base64 < "$KEY_FILE" | tr -d '\n')

upsert_env() {
  local key="$1" value="$2" tmp
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

upsert_env "$env_cert_key" "$CERT_B64"
upsert_env "$env_key_key" "$KEY_B64"
ok "$env_cert_key + $env_key_key written to $ENV_FILE"

# ── Step 5: Coolify sync ───────────────────────────────────────────────────
if [ "$SYNC_COOLIFY" = "1" ]; then
  banner "Step 5 — Push to Coolify env"

  COOLIFY_API_TOKEN=$(grep -E '^COOLIFY_API_TOKEN=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true)
  if [ -z "$COOLIFY_API_TOKEN" ] && [ -f "$TOKEN_FILE" ]; then
    COOLIFY_API_TOKEN=$(grep -E '^COOLIFY_API_TOKEN=' "$TOKEN_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '[:space:]')
  fi

  if [ -z "$COOLIFY_API_TOKEN" ]; then
    warn "COOLIFY_API_TOKEN not set — skipping Coolify push"
  else
    for kv in "$env_cert_key=$CERT_B64" "$env_key_key=$KEY_B64"; do
      key="${kv%%=*}"
      val="${kv#*=}"
      body=$(jq -n --arg k "$key" --arg v "$val" '{key:$k, value:$v}')
      code=$(curl -sS -o /dev/null -w "%{http_code}" \
        -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$body" \
        "${COOLIFY_API}/applications/${coolify_uuid}/envs" 2>/dev/null)
      if [ "$code" != "201" ] && [ "$code" != "200" ]; then
        # Already exists — PATCH
        code=$(curl -sS -o /dev/null -w "%{http_code}" \
          -X PATCH -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
          -H "Content-Type: application/json" \
          -d "$body" \
          "${COOLIFY_API}/applications/${coolify_uuid}/envs" 2>/dev/null)
      fi
      ok "Coolify env $key: HTTP $code"
    done

    if [ "$TRIGGER_DEPLOY" = "1" ]; then
      banner "Step 6 — Trigger Coolify redeploy"
      DEPLOY_RESP=$(curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
        "${COOLIFY_API}/deploy?uuid=${coolify_uuid}&force=true" 2>/dev/null)
      info "Deploy response: $DEPLOY_RESP"
      ok "Redeploy triggered — caddy sidecar will pick up new cert"
    fi
  fi
fi

banner "Done"
ok "Cert for '$hostname' provisioned successfully"
ok "Validity: until $(openssl x509 -in "$CERT_FILE" -noout -enddate | cut -d= -f2)"
info "Self-healing cron (auto-renew if expiring within ${RENEW_WINDOW_DAYS}d):"
info "  0 */6 * * * bash $ROOT/scripts/pki-issue-internal-cert.sh $SERVICE --check-expiry --auto-renew"

#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# scripts/pki/test-enrollment.sh
# Test certificate enrollment against OpenXPKI via EST protocol
#
# Usage:
#   ./scripts/pki/test-enrollment.sh [realm]
#   ./scripts/pki/test-enrollment.sh identity-plane
#   ./scripts/pki/test-enrollment.sh data-plane
#   ./scripts/pki/test-enrollment.sh orchestration-plane
# ──────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

REALM="${1:-identity-plane}"
PKI_HOST="${PKI_HOST:?PKI_HOST required (e.g. https://pki.<your-domain>)}"
CA_BUNDLE="${PROJECT_ROOT}/config/pki/aisha-ca-bundle.pem"

# ── Colors ─────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }
log_ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_err()  { echo -e "${RED}[ERR]${NC} $1"; }

echo ""
echo "================================================================="
echo "  Evymo PKI — EST Enrollment Test"
echo "  Realm:  $REALM"
echo "  Host:   $PKI_HOST"
echo "================================================================="
echo ""

# ── Step 1: Check EST endpoint availability ────────────
log_step "Testing EST endpoint availability..."

EST_URL="${PKI_HOST}/.well-known/est/${REALM}"
CACERTS_URL="${EST_URL}/cacerts"

CURL_OPTS=()
if [[ -f "$CA_BUNDLE" ]]; then
  CURL_OPTS+=(--cacert "$CA_BUNDLE")
  log_ok "Using CA bundle: $CA_BUNDLE"
else
  CURL_OPTS+=(--insecure)
  log_warn "CA bundle not found, using --insecure (NOT for production!)"
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${CURL_OPTS[@]}" "$CACERTS_URL" 2>/dev/null || true)
if [[ "$HTTP_CODE" == "200" ]]; then
  log_ok "EST /cacerts endpoint responded: $HTTP_CODE"
elif [[ "$HTTP_CODE" == "000" ]]; then
  log_err "Cannot reach $CACERTS_URL — is the PKI stack running?"
  echo "  Try: docker compose -f docker-compose.coolify-pki.yml up -d"
  exit 1
else
  log_warn "EST /cacerts returned HTTP $HTTP_CODE (expected 200)"
fi

# ── Step 2: Retrieve CA certificates ──────────────────
log_step "Retrieving CA certificates from EST..."

TMPDIR_TEST=$(mktemp -d "${TMPDIR:-/tmp}/aisha-pki-test.XXXXXX")
trap 'rm -rf "$TMPDIR_TEST"' EXIT

curl -s "${CURL_OPTS[@]}" "$CACERTS_URL" \
  -H "Content-Type: application/pkcs7-mime" \
  -o "$TMPDIR_TEST/cacerts.p7" 2>/dev/null

if [[ -s "$TMPDIR_TEST/cacerts.p7" ]]; then
  # Try to decode PKCS#7 (base64-encoded DER)
  if openssl base64 -d -in "$TMPDIR_TEST/cacerts.p7" -out "$TMPDIR_TEST/cacerts.der" 2>/dev/null; then
    if openssl pkcs7 -inform DER -in "$TMPDIR_TEST/cacerts.der" -print_certs -out "$TMPDIR_TEST/cacerts.pem" 2>/dev/null; then
      CERT_COUNT=$(grep -c "BEGIN CERTIFICATE" "$TMPDIR_TEST/cacerts.pem" 2>/dev/null || echo "0")
      log_ok "Received $CERT_COUNT CA certificate(s) from EST"
    fi
  fi
else
  log_warn "Empty response from /cacerts — CA may not be initialized yet"
fi

# ── Step 3: Generate test CSR ──────────────────────────
log_step "Generating test CSR (EC P-384)..."

TEST_CN="test-enrollment-${REALM}.aisha.internal"

openssl ecparam -name secp384r1 -genkey -noout \
  -out "$TMPDIR_TEST/test.key" 2>/dev/null

openssl req -new \
  -key "$TMPDIR_TEST/test.key" \
  -sha384 \
  -subj "/CN=${TEST_CN}/O=Evymo/OU=$(echo "$REALM" | sed 's/-/ /g')" \
  -out "$TMPDIR_TEST/test.csr" 2>/dev/null

log_ok "CSR generated: CN=$TEST_CN"
openssl req -in "$TMPDIR_TEST/test.csr" -noout -subject

# ── Step 4: Submit enrollment request ─────────────────
log_step "Submitting enrollment via EST /simpleenroll..."

ENROLL_URL="${EST_URL}/simpleenroll"

# Base64-encode the CSR (DER format for EST)
openssl req -in "$TMPDIR_TEST/test.csr" -outform DER -out "$TMPDIR_TEST/test.csr.der" 2>/dev/null
openssl base64 -in "$TMPDIR_TEST/test.csr.der" -out "$TMPDIR_TEST/test.csr.b64" 2>/dev/null

HTTP_CODE=$(curl -s -o "$TMPDIR_TEST/enroll-response" -w "%{http_code}" \
  "${CURL_OPTS[@]}" \
  "$ENROLL_URL" \
  -X POST \
  -H "Content-Type: application/pkcs10" \
  -H "Content-Transfer-Encoding: base64" \
  --data-binary "@$TMPDIR_TEST/test.csr.b64" 2>/dev/null || true)

case "$HTTP_CODE" in
  200)
    log_ok "Certificate issued immediately (HTTP 200)"
    # Decode response
    if openssl base64 -d -in "$TMPDIR_TEST/enroll-response" -out "$TMPDIR_TEST/cert.der" 2>/dev/null; then
      openssl x509 -inform DER -in "$TMPDIR_TEST/cert.der" -out "$TMPDIR_TEST/cert.pem" 2>/dev/null
      echo ""
      echo "  Issued certificate:"
      openssl x509 -in "$TMPDIR_TEST/cert.pem" -noout -subject -issuer -dates -serial
    fi
    ;;
  202)
    log_ok "Enrollment pending approval (HTTP 202)"
    echo "  The CA is configured for manual approval."
    echo "  Approve via OpenXPKI WebUI: $PKI_HOST"
    RETRY_AFTER=$(grep -i "Retry-After" "$TMPDIR_TEST/enroll-response" || echo "")
    if [[ -n "$RETRY_AFTER" ]]; then
      echo "  Retry-After: $RETRY_AFTER"
    fi
    ;;
  401)
    log_warn "Authentication required (HTTP 401)"
    echo "  EST endpoint requires client authentication."
    echo "  For mTLS: provide --cert and --key"
    echo "  For HTTP Basic: configure EST auth in OpenXPKI"
    ;;
  000)
    log_err "Connection failed — EST endpoint unreachable"
    ;;
  *)
    log_warn "Unexpected response: HTTP $HTTP_CODE"
    cat "$TMPDIR_TEST/enroll-response" 2>/dev/null || true
    ;;
esac

# ── Summary ─────────────────────────────────────────────
echo ""
echo "================================================================="
echo "  EST Enrollment Test Results"
echo "================================================================="
echo "  Realm:     $REALM"
echo "  Endpoint:  $ENROLL_URL"
echo "  Test CN:   $TEST_CN"
echo "  Response:  HTTP $HTTP_CODE"
echo "================================================================="

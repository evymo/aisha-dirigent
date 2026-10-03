#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# scripts/pki/gen-trust-bundle.sh
# Generate / refresh the CA trust bundle from OpenXPKI server
# or from local config/pki/ certificates.
#
# Usage:
#   ./scripts/pki/gen-trust-bundle.sh          # from local certs
#   ./scripts/pki/gen-trust-bundle.sh --remote  # fetch from running OpenXPKI
# ──────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PKI_DIR="${PROJECT_ROOT}/config/pki"
BUNDLE="${PKI_DIR}/aisha-ca-bundle.pem"
PKI_COMPOSE="${PROJECT_ROOT}/docker-compose.coolify-pki.yml"
MODE="${1:-local}"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }
log_ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
log_err()  { echo -e "${RED}[ERR]${NC} $1"; }

echo ""
echo "Evymo PKI — Trust Bundle Generator"
echo "==================================="
echo ""

mkdir -p "$PKI_DIR"

if [[ "$MODE" == "--remote" ]]; then
  # ── Fetch from running OpenXPKI via EST /cacerts ────
  log_step "Fetching CA certs from OpenXPKI EST endpoints..."

  for realm in identity-plane data-plane orchestration-plane; do
    log_step "  Fetching $realm CA chain..."
    docker compose -f "$PKI_COMPOSE" exec -T pki-server \
      openxpkiadm certificate list --realm "$realm" --format pem \
      > "$PKI_DIR/${realm}-chain.pem" 2>/dev/null || {
        log_err "Failed to fetch $realm certs from OpenXPKI"
        continue
      }
    log_ok "  $realm: $(grep -c 'BEGIN CERTIFICATE' "$PKI_DIR/${realm}-chain.pem" 2>/dev/null || echo 0) cert(s)"
  done

  # Combine all chains + root
  cat "$PKI_DIR"/identity-plane-chain.pem \
      "$PKI_DIR"/data-plane-chain.pem \
      "$PKI_DIR"/orchestration-plane-chain.pem \
    | awk '!seen[$0]++' \
    > "$BUNDLE"

else
  # ── Build from local certificate files ──────────────
  log_step "Building trust bundle from local certificates..."

  CERTS=()
  for cert_file in "$PKI_DIR"/root-ca.pem "$PKI_DIR"/*-ca.pem; do
    if [[ -f "$cert_file" && "$(basename "$cert_file")" != "aisha-ca-bundle.pem" ]]; then
      CERTS+=("$cert_file")
      echo "  + $(basename "$cert_file")"
    fi
  done

  if [[ ${#CERTS[@]} -eq 0 ]]; then
    log_err "No CA certificates found in $PKI_DIR/"
    echo "  Run bootstrap-ca.sh first to generate CA hierarchy"
    exit 1
  fi

  cat "${CERTS[@]}" > "$BUNDLE"
fi

# ── Verify bundle ───────────────────────────────────────
if [[ -f "$BUNDLE" ]]; then
  CERT_COUNT=$(grep -c "BEGIN CERTIFICATE" "$BUNDLE" 2>/dev/null || echo "0")
  log_ok "Trust bundle: $BUNDLE ($CERT_COUNT certificates)"
  echo ""
  echo "Certificates in bundle:"
  echo "------------------------"

  # Parse and show each cert in the bundle
  csplit -f "$PKI_DIR/.tmp-cert-" -z "$BUNDLE" '/-----BEGIN CERTIFICATE-----/' '{*}' 2>/dev/null || true
  for tmp_cert in "$PKI_DIR"/.tmp-cert-*; do
    if [[ -s "$tmp_cert" ]] && grep -q "BEGIN CERTIFICATE" "$tmp_cert" 2>/dev/null; then
      SUBJ=$(openssl x509 -in "$tmp_cert" -noout -subject 2>/dev/null | sed 's/subject=/  /')
      DATES=$(openssl x509 -in "$tmp_cert" -noout -enddate 2>/dev/null | sed 's/notAfter=/  Expires: /')
      echo "$SUBJ"
      echo "$DATES"
      echo ""
    fi
    rm -f "$tmp_cert"
  done

  echo ""
  echo "Usage in Docker services:"
  echo "  Node.js:   NODE_EXTRA_CA_CERTS=/certs/aisha-ca-bundle.pem"
  echo "  Go:        SSL_CERT_FILE=/certs/aisha-ca-bundle.pem"
  echo "  Python:    REQUESTS_CA_BUNDLE=/certs/aisha-ca-bundle.pem"
  echo "  Java:      keytool -import -trustcacerts -file /certs/aisha-ca-bundle.pem"
  echo "  Nginx:     ssl_trusted_certificate /certs/aisha-ca-bundle.pem;"
else
  log_err "Failed to generate trust bundle"
  exit 1
fi

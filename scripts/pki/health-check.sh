#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# scripts/pki/health-check.sh
# Verify PKI stack health: DB connectivity, OpenXPKI server,
# realm status, EST endpoints, CRL freshness, OCSP responder
#
# Usage:
#   ./scripts/pki/health-check.sh
# ──────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PKI_COMPOSE="${PROJECT_ROOT}/docker-compose.coolify-pki.yml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
WARN=0
FAIL=0

check_pass() { echo -e "  ${GREEN}PASS${NC} $1"; ((PASS++)); }
check_warn() { echo -e "  ${YELLOW}WARN${NC} $1"; ((WARN++)); }
check_fail() { echo -e "  ${RED}FAIL${NC} $1"; ((FAIL++)); }

echo ""
echo "================================================================="
echo "  Evymo PKI Health Check"
echo "  $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "================================================================="
echo ""

# ── 1. Docker services ─────────────────────────────────
echo -e "${BLUE}Docker Services:${NC}"

for svc in pki-db pki-server pki-client pki-webui pki-auth; do
  STATUS=$(docker compose -f "$PKI_COMPOSE" ps --format "{{.Health}}" "$svc" 2>/dev/null || echo "not-running")
  case "$STATUS" in
    healthy)  check_pass "$svc: $STATUS" ;;
    starting) check_warn "$svc: $STATUS (still initializing)" ;;
    *)        check_fail "$svc: $STATUS" ;;
  esac
done
echo ""

# ── 2. Database connectivity ──────────────────────────
echo -e "${BLUE}Database:${NC}"

DB_CHECK=$(docker compose -f "$PKI_COMPOSE" exec -T pki-db \
  mariadb -u openxpki -p"${PKI_DB_PASSWORD:-openxpki}" openxpki \
  -e "SELECT COUNT(*) FROM certificate;" 2>/dev/null || echo "ERROR")

if [[ "$DB_CHECK" == "ERROR" ]]; then
  check_fail "MariaDB connection failed"
else
  CERT_COUNT=$(echo "$DB_CHECK" | tail -1 | tr -d '[:space:]')
  check_pass "MariaDB: $CERT_COUNT certificates in database"
fi
echo ""

# ── 3. OpenXPKI server ────────────────────────────────
echo -e "${BLUE}OpenXPKI Server:${NC}"

OXI_VERSION=$(docker compose -f "$PKI_COMPOSE" exec -T pki-server \
  openxpkiadm version 2>/dev/null | head -1 || echo "ERROR")

if [[ "$OXI_VERSION" == "ERROR" ]]; then
  check_fail "Cannot reach OpenXPKI server"
else
  check_pass "Version: $OXI_VERSION"
fi

# Check each realm
for realm in identity-plane data-plane orchestration-plane; do
  REALM_STATUS=$(docker compose -f "$PKI_COMPOSE" exec -T pki-server \
    openxpkicli --realm "$realm" get_token_info 2>/dev/null | grep -c "ok" || echo "0")
  if [[ "$REALM_STATUS" -gt 0 ]]; then
    check_pass "Realm $realm: token active"
  else
    check_warn "Realm $realm: token status unknown (may need initialization)"
  fi
done
echo ""

# ── 4. EST endpoints ─────────────────────────────────
echo -e "${BLUE}EST Endpoints:${NC}"

PKI_HOST="${PKI_HOST:?PKI_HOST required (e.g. https://pki.<your-domain>)}"
CA_BUNDLE="${PROJECT_ROOT}/config/pki/aisha-ca-bundle.pem"

CURL_OPTS=(-s -o /dev/null -w "%{http_code}" --connect-timeout 5)
if [[ -f "$CA_BUNDLE" ]]; then
  CURL_OPTS+=(--cacert "$CA_BUNDLE")
fi

for realm in identity-plane data-plane orchestration-plane; do
  HTTP_CODE=$(curl "${CURL_OPTS[@]}" "${PKI_HOST}/.well-known/est/${realm}/cacerts" 2>/dev/null || echo "000")
  case "$HTTP_CODE" in
    200) check_pass "EST $realm /cacerts: HTTP $HTTP_CODE" ;;
    000) check_fail "EST $realm: unreachable" ;;
    *)   check_warn "EST $realm /cacerts: HTTP $HTTP_CODE" ;;
  esac
done
echo ""

# ── 5. CRL freshness ─────────────────────────────────
echo -e "${BLUE}CRL Status:${NC}"

# The published CRL filename is DERIVED, not chosen: PublishCRL.pm hands the
# issuer CN to the connector, and publishing.yaml turns it into
# `[% ARGS.0.replace('[^\w-]','_') %].crl`. This check used to construct
# "${realm}.crl" instead, which is a name nothing ever writes — so it reported
# "not yet published" for a CRL that was sitting right there under another name,
# and would have kept reporting it forever. Derive from the same source the
# publisher uses (the CA certificate's own subject) so the two cannot drift.
CA_BUNDLE="${CA_BUNDLE:-${REPO_ROOT:-.}/config/pki/aisha-ca-bundle.pem}"

# CN -> published basename. `\w` is [A-Za-z0-9_]; everything outside that and
# `-` becomes `_`, exactly as the Template Toolkit expression does.
crl_basename_for_cn() { printf '%s' "$1" | sed 's/[^[:alnum:]_-]/_/g'; }

if [[ ! -r "$CA_BUNDLE" ]]; then
  # No bundle, no derivation. Failing loud beats checking a guessed filename:
  # a guess that happens to 404 is indistinguishable from a CA that never
  # issued a CRL, which is the exact confusion this section is fixing.
  check_fail "CRL: CA bundle not readable at $CA_BUNDLE — cannot derive CRL names"
else
  # Split the bundle and read each subject. `openssl storeutl` looks tidier but
  # produces nothing here (verified), and an empty list would make the loop below
  # run zero times and report nothing — a silent pass, which is the same class of
  # failure as the WARN this section replaces. So extract first, then assert.
  CA_CN_LIST=$(
    _tmpd=$(mktemp -d)
    awk -v d="$_tmpd" 'BEGIN{c=0} /BEGIN CERT/{c++} c>0{print > (d "/ca-" c ".pem")}' "$CA_BUNDLE"
    for _f in "$_tmpd"/ca-*.pem; do
      [[ -s "$_f" ]] || continue
      openssl x509 -in "$_f" -noout -subject 2>/dev/null \
        | sed -n 's/.*CN *= *\([^,]*\).*/\1/p'
    done
    rm -rf "$_tmpd"
  )
  if [[ -z "$CA_CN_LIST" ]]; then
    check_fail "CRL: no CA certificates found in $CA_BUNDLE — cannot check any CRL"
  fi
  # One CA certificate per realm; the CN carries the realm.
  while IFS= read -r CA_CN; do
    [[ -n "$CA_CN" ]] || continue
    CRL_NAME="$(crl_basename_for_cn "$CA_CN").crl"
    CRL_FILE=$(mktemp)
    HTTP_CODE=$(curl -s -o "$CRL_FILE" -w "%{http_code}" "${PKI_HOST}/download/${CRL_NAME}" 2>/dev/null || true)

    if [[ "$HTTP_CODE" == "200" && -s "$CRL_FILE" ]]; then
      # Published CRLs are DER (publishing.yaml content: [% der %]); try DER
      # first and fall back to PEM rather than assuming either.
      NEXT_UPDATE=$(openssl crl -inform DER -in "$CRL_FILE" -noout -nextupdate 2>/dev/null \
                    || openssl crl -in "$CRL_FILE" -noout -nextupdate 2>/dev/null)
      NEXT_UPDATE="${NEXT_UPDATE#nextUpdate=}"
      if [[ -n "$NEXT_UPDATE" ]]; then
        NEXT_TS=$(date -j -f "%b %d %H:%M:%S %Y %Z" "$NEXT_UPDATE" "+%s" 2>/dev/null || date -d "$NEXT_UPDATE" "+%s" 2>/dev/null || echo "0")
        NOW_TS=$(date "+%s")
        if [[ "$NEXT_TS" -gt "$NOW_TS" ]]; then
          check_pass "CRL ${CA_CN}: valid until $NEXT_UPDATE"
        else
          check_fail "CRL ${CA_CN}: EXPIRED ($NEXT_UPDATE)"
        fi
      else
        check_fail "CRL ${CA_CN}: served but unparsable"
      fi
    else
      # FAIL, not WARN. The summary exits 0 when only warnings are present, so
      # a warning here made "this CA has never published a CRL" a green result —
      # and that is precisely the state that let 856 revoked certificates stay
      # trusted without anyone noticing.
      check_fail "CRL ${CA_CN}: HTTP $HTTP_CODE for /download/${CRL_NAME} — no published CRL"
    fi
    rm -f "$CRL_FILE"
  done <<< "$CA_CN_LIST"
fi
echo ""

# ── Summary ─────────────────────────────────────────────
echo "================================================================="
echo -e "  Results: ${GREEN}${PASS} passed${NC}, ${YELLOW}${WARN} warnings${NC}, ${RED}${FAIL} failed${NC}"
echo "================================================================="

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
elif [[ "$WARN" -gt 0 ]]; then
  exit 0
else
  exit 0
fi

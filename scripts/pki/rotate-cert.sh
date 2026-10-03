#!/usr/bin/env bash
# scripts/pki/rotate-cert.sh
#
# Zero-downtime certificate rotation for Evymo PKI service certs.
# Usage:
#   ./scripts/pki/rotate-cert.sh --realm identity-plane --profile tls_server \
#                                 --hostname keycloak.evymo.internal \
#                                 --services aisha-keycloak,aisha-studio-auth
#
# What it does:
#   1. Requests new cert from OpenXPKI via workflow
#   2. Downloads PEM + key to config/pki/<realm>/
#   3. Rolling docker restart: one service at a time, waits for health check
#
set -euo pipefail

REALM=""
PROFILE="tls_server"
HOSTNAME_CN=""
SERVICES=""
PKI_CLIENT="${PKI_CLIENT_CONTAINER:-evymo-pki-client}"
PKI_AUTH="--authstack Testing --authuser raop --authpass openxpki"
PKI_REQUESTOR_EMAIL="${PKI_REQUESTOR_EMAIL:-pki@example.com}"
OUTPUT_DIR="./config/pki"
WAIT_HEALTHY=30  # seconds to wait after each restart

usage() {
  echo "Usage: $0 --realm REALM --hostname HOSTNAME --services SVC1,SVC2 [--profile PROFILE]"
  echo "Realms: identity-plane | data-plane | orchestration-plane"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --realm)     REALM="$2";     shift 2 ;;
    --hostname)  HOSTNAME_CN="$2"; shift 2 ;;
    --services)  SERVICES="$2";  shift 2 ;;
    --profile)   PROFILE="$2";   shift 2 ;;
    *) usage ;;
  esac
done

[[ -z "$REALM" || -z "$HOSTNAME_CN" || -z "$SERVICES" ]] && usage

CERT_DIR="$OUTPUT_DIR/$REALM"
mkdir -p "$CERT_DIR"

echo "==> [1/4] Generating CSR for $HOSTNAME_CN in $REALM"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

openssl ecparam -name secp384r1 -genkey -noout -out "$TMPDIR/service.key"
openssl req -new -key "$TMPDIR/service.key" -sha384 \
  -subj "/CN=${HOSTNAME_CN}/O=Evymo" \
  -out "$TMPDIR/service.csr"

PKCS10=$(cat "$TMPDIR/service.csr")

echo "==> [2/4] Submitting to OpenXPKI ($REALM / $PROFILE)"
docker exec "$PKI_CLIENT" bash -c "
  set -e
  WFID=\$(openxpkicmd --realm $REALM $PKI_AUTH --json \
    certificate_signing_request_v2 \
    --param cert_profile=$PROFILE \
    --param cert_subject_style=00_service_style 2>&1 | \
    python3 -c \"import sys,json; print(json.load(sys.stdin)['workflow']['id'])\")

  # Upload CSR
  openxpkicmd --realm $REALM $PKI_AUTH --json \
    --wfid \$WFID --wfaction csr_upload_pkcs10 \
    --param pkcs10=\"$PKCS10\" > /dev/null

  # Subject
  openxpkicmd --realm $REALM $PKI_AUTH --json \
    --wfid \$WFID --wfaction csr_edit_subject \
    --param 'cert_subject_parts=OXJSF1:{\"hostname\":\"$HOSTNAME_CN\"}' > /dev/null

  # Cert info
  openxpkicmd --realm $REALM $PKI_AUTH --json \
    --wfid \$WFID --wfaction csr_edit_cert_info \
    --param 'cert_info=OXJSF1:{\"requestor_realname\":\"AISHA Rotation\",\"requestor_email\":\"${PKI_REQUESTOR_EMAIL}\"}' > /dev/null

  # Policy violation acknowledgement (DNS may not resolve)
  openxpkicmd --realm $REALM $PKI_AUTH --json \
    --wfid \$WFID --wfaction csr_enter_policy_violation_comment \
    --param 'policy_comment=Automated rotation - internal hostname' > /dev/null 2>&1 || true

  # Approve
  openxpkicmd --realm $REALM $PKI_AUTH --json \
    --wfid \$WFID --wfaction csr_approve_csr > /dev/null

  # Get cert identifier
  openxpkicli --realm $REALM $PKI_AUTH --json \
    get_workflow_info --arg id=\$WFID --arg with_context=1 | \
    python3 -c \"import sys,json; d=json.load(sys.stdin); print(d['result']['workflow']['context']['cert_identifier'])\"
" > "$TMPDIR/cert_id.txt"

CERT_ID=$(cat "$TMPDIR/cert_id.txt" | tr -d '[:space:]')
echo "    cert_identifier: $CERT_ID"

echo "==> [3/4] Downloading new PEM to $CERT_DIR/"
docker exec "$PKI_CLIENT" openxpkicli --realm "$REALM" \
  get_cert --arg "identifier=$CERT_ID" --arg format=PEM \
  > "$CERT_DIR/${HOSTNAME_CN}.pem"

cp "$TMPDIR/service.key" "$CERT_DIR/${HOSTNAME_CN}.key"
chmod 600 "$CERT_DIR/${HOSTNAME_CN}.key"

# Rebuild CA trust bundle
./scripts/pki/gen-trust-bundle.sh 2>/dev/null || true

echo "==> [4/4] Rolling restart (one service at a time)"
IFS=',' read -r -a SVC_LIST <<< "$SERVICES"
for SVC in "${SVC_LIST[@]}"; do
  echo "    restarting $SVC..."
  docker restart "$SVC"
  echo -n "    waiting for healthy"
  for i in $(seq 1 "$WAIT_HEALTHY"); do
    STATE=$(docker inspect --format='{{.State.Health.Status}}' "$SVC" 2>/dev/null || echo "unknown")
    if [[ "$STATE" == "healthy" ]]; then
      echo " OK (${i}s)"
      break
    fi
    echo -n "."
    sleep 1
  done
  echo ""
done

echo ""
echo "==> Rotation complete"
echo "    Cert:    $CERT_DIR/${HOSTNAME_CN}.pem"
echo "    Key:     $CERT_DIR/${HOSTNAME_CN}.key"
echo "    Expires: $(openssl x509 -noout -enddate -in "$CERT_DIR/${HOSTNAME_CN}.pem" 2>/dev/null | cut -d= -f2)"
echo "    Services restarted: ${SVC_LIST[*]}"

#!/bin/sh
# =============================================================================
# pki-realm-bootstrap.sh — OpenXPKI 3.32 first-boot bootstrap (verified)
# =============================================================================
# Runs INSIDE the openxpki3 container (sourced from pki-server startup
# wrapper inline). Detects whether the local OpenXPKI daemon already has
# its datasafe + per-realm certsign tokens registered; if not, generates
# the keys + certificates and registers them.
#
# Verified against whiterabbitsecurity/openxpki3:3.32.8 (introspected
# 2026-05-10 by user shell session):
#   - /usr/bin/oxi present (modern v3.32+ wrapper)
#   - /etc/openxpki/contrib/vault.openssl.cnf present
#   - openxpkiadm alias --realm X --token Y supports filtering by type;
#     `oxi alias list --type` does NOT (Unknown option). So idempotency
#     check uses openxpkiadm; token add uses oxi.
#   - Token config (per realm.tpl/crypto.yaml):
#       certsign  → ca-signer (alias name)
#       datasafe  → svault     (alias name)
#       cmcra     → ratoken
#       scep      → ratoken
#     key_store=DATAPOOL means private keys live in the DB (encrypted
#     with the realm's `default` secret password = PKI_SVAULT_KEY,
#     same value as the `svault` secret — collapsed by design, see
#     aisha/templates/openxpki-system-crypto.yaml.template).
#
# Idempotency: every cold-start --wipe re-runs this. Re-keying would
# invalidate every cert ever issued, so we MUST detect already-bootstrapped
# state via `openxpkiadm alias --token <type>` returning a non-"not set"
# entry and exit 0 without touching keys.
#
# See docs/deploy/PKI_BOOTSTRAP_DESIGN.md for the full design rationale.
# =============================================================================

mkdir -p /etc/openxpki/local/log /etc/openxpki/local/keys 2>/dev/null || true
LOG=/etc/openxpki/local/log/bootstrap-last.log
: > "$LOG" 2>/dev/null || true

# Strict mode in normal runs; relaxed in DIAG (collect all errors).
if [ "${PKI_BOOTSTRAP_DIAG:-0}" = "1" ]; then
  set -u
else
  set -eu
fi

# All output to stdout (visible in pki-server's docker logs via the inline
# wrapper) AND to LOG file (volume-persisted for post-mortem).

REALMS="${REALMS:-identity-plane data-plane orchestration-plane}"
KEYS=/etc/openxpki/local/keys
CONTRIB=/etc/openxpki/contrib

if [ -z "${PKI_SVAULT_KEY:-}" ]; then
  echo "FATAL: PKI_SVAULT_KEY env not set — cannot encrypt issuer keys" | tee -a "$LOG"
  exit 1
fi
# Keep PKI_DEFAULT_SECRET as an alias for backward compat. The variable
# name is referenced in older docs, generate-secrets.mjs still emits it
# (no-op orphan), and Coolify env stores still have it from prior wipes.
# All actual encryption + decryption uses PKI_SVAULT_KEY so we stay
# aligned with system/crypto.yaml `default` / `svault` secrets.
KEY_PASS="${PKI_SVAULT_KEY}"

echo "==== pki-realm-bootstrap.sh starting at $(date -u) ====" | tee -a "$LOG"
echo "PKI_BOOTSTRAP_DIAG=${PKI_BOOTSTRAP_DIAG:-0}" | tee -a "$LOG"
echo "REALMS=$REALMS" | tee -a "$LOG"

# Helper: check if a token type is already configured for a realm.
# Returns 0 if at least one alias is registered (i.e. NOT "not set").
has_alias() {
  realm="$1"
  type="$2"
  # openxpkiadm alias output:
  #   <name> (<type>):
  #     not set                ← if absent
  #   OR
  #     alias    : ca-signer-1
  #     identifier: ...        ← if present
  out=$(openxpkiadm alias --realm "$realm" --token "$type" 2>/dev/null || true)
  echo "$out" | grep -qE "alias\s*:\s*[a-z]" 2>/dev/null
}

# Helper: register a token (datasafe or certsign) for a realm.
#
# Why this exists as a function: the previous inline approach had two bugs.
#   1. `if cmd | tee file; then` evaluates `tee`'s exit code, not `cmd`'s, so
#      every `oxi token add` failure was silently masked as "ok via oxi"
#      because `tee` always succeeded (write OK). Captured 2026-05-18 in
#      bootstrap-last.log: "Unknown option: password\n  ok via oxi\n".
#   2. `oxi token add --password X` is not supported in OpenXPKI 3.32.8 —
#      oxi exits with "Unknown option: password" before doing any work.
#      Result: tokens never registered, keys_dir empty, RequestCertificate
#      workflow hangs forever (no signing key for the realm), pki-bridge
#      /v1/issue returns 504.
#
# Fix: drop the broken oxi attempts; go straight to openxpkiadm alias which
# is the canonical CLI for token registration in 3.32.8 (and is already used
# elsewhere in this script for has_alias query). Capture exit code without
# piping through tee so the actual command status is preserved. Append
# output to log AND echo to stdout for live deploy visibility.
register_token() {
  _realm="$1"
  _type="$2"      # datasafe | certsign
  _crt="$3"
  _key="$4"
  echo "Registering $_type in realm: $_realm via openxpkiadm alias..." | tee -a "$LOG"
  # openxpkiadm alias adds an entry to the realm's token table. --file is
  # the cert path; --key is the encrypted private key path; the password
  # for the key is read from the realm's `default` secret (rendered into
  # config.d/system/crypto.yaml from PKI_SVAULT_KEY). No `--password` flag
  # accepted by openxpkiadm; the secret is resolved through the config.
  _out=$(openxpkiadm alias --realm "$_realm" --token "$_type" \
           --file "$_crt" --key "$_key" 2>&1)
  _rc=$?
  printf '%s\n' "$_out" | tee -a "$LOG"
  if [ "$_rc" -eq 0 ]; then
    echo "  ok via openxpkiadm" | tee -a "$LOG"
    return 0
  fi
  echo "  openxpkiadm alias failed (rc=$_rc) — see output above" | tee -a "$LOG"
  # In normal mode (set -eu) this rc≠0 will propagate via the caller; in
  # DIAG mode (set -u) we keep going to surface all errors. Either way we
  # have NOT silently masked the failure as the old code did.
  return "$_rc"
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Datasafe token (one per server, registered into each realm).
# OpenXPKI's datasafe is a self-signed cert protecting datapool (DB-stored
# encrypted blobs). RSA 3072 per QUICKSTART. Encrypted with the realm's
# `default` secret = PKI_SVAULT_KEY (same value as `svault` — collapsed
# by design, see aisha/templates/openxpki-system-crypto.yaml.template).
# ─────────────────────────────────────────────────────────────────────────────
DATASAFE_NEEDED=0
for realm in $REALMS; do
  if ! has_alias "$realm" datasafe; then
    DATASAFE_NEEDED=1
    break
  fi
done

if [ $DATASAFE_NEEDED -eq 0 ]; then
  echo "Datasafe already registered for all realms — skipping" | tee -a "$LOG"
else
  VAULT_KEY="$KEYS/vault-1.pem"
  VAULT_CRT="$KEYS/vault-1.crt"
  VAULT_CNF="$CONTRIB/vault.openssl.cnf"

  if [ ! -f "$VAULT_KEY" ]; then
    echo "Generating $VAULT_KEY (RSA 3072, encrypted with PKI_SVAULT_KEY)..." | tee -a "$LOG"
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 \
      -aes-256-cbc -pass "pass:${KEY_PASS}" \
      -out "$VAULT_KEY" 2>&1 | tee -a "$LOG"
    chmod 400 "$VAULT_KEY"
  fi

  if [ ! -f "$VAULT_CRT" ]; then
    echo "Generating $VAULT_CRT (self-signed, 365d)..." | tee -a "$LOG"
    openssl req -config "$VAULT_CNF" -x509 -days 365 \
      -key "$VAULT_KEY" -passin "pass:${KEY_PASS}" \
      -out "$VAULT_CRT" 2>&1 | tee -a "$LOG"
    chmod 444 "$VAULT_CRT"
  fi

  for realm in $REALMS; do
    if has_alias "$realm" datasafe; then
      echo "Datasafe already in realm: $realm — skipping" | tee -a "$LOG"
      continue
    fi
    register_token "$realm" datasafe "$VAULT_CRT" "$VAULT_KEY"
  done
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Per-realm Root CA (certsign token).
# EC P-384 per AISHA design. Each realm gets independent root CA so realm
# compromise doesn't cascade.
# ─────────────────────────────────────────────────────────────────────────────
for realm in $REALMS; do
  if has_alias "$realm" certsign; then
    echo "Certsign already in realm: $realm — skipping" | tee -a "$LOG"
    continue
  fi

  ROOTCA_KEY="$KEYS/rootca-${realm}.key"
  ROOTCA_CRT="$KEYS/rootca-${realm}.crt"
  ROOTCA_CNF="/tmp/rootca-${realm}.cnf"

  # ── Operator identity for this CA's subject ────────────────────────────────
  # Whoever runs this instance runs it as THEMSELVES — the donor's organization
  # must never end up in someone else's certificate authority. Values come from
  # operator-inputs.mjs (category "identity") via generate-secrets, which always
  # emits them, deriving from the instance namespace when the operator did not
  # answer the prompt. APP_NAME_PREFIX is the in-container last resort so a
  # partially-wired pipeline still produces the operator's own name.
  #
  # This is BOOTSTRAP-ONLY by construction: the guards above skip a realm that
  # already has a certsign alias, and the key/cert are only generated when
  # absent. Editing these values does not rename a live CA — the CN is part of
  # the CA's identity and the published CRL filename is derived from it, so a
  # change means issuing a NEW authority, not relabelling one.
  ca_name="${AISHA_CA_NAME:-}"
  ca_org="${AISHA_OPERATOR_ORG:-}"
  if [ -z "$ca_name" ] || [ -z "$ca_org" ]; then
    fallback="$(printf '%s' "${APP_NAME_PREFIX:-}" | tr '[:lower:]' '[:upper:]')"
    if [ -z "$fallback" ]; then
      # No identity and nothing to derive one from. Refuse rather than mint a CA
      # under a name the operator never chose and would have to re-issue later.
      echo "FATAL: cannot determine CA identity — set AISHA_CA_NAME / AISHA_OPERATOR_ORG (or APP_NAME_PREFIX)" | tee -a "$LOG"
      exit 1
    fi
    ca_name="${ca_name:-$fallback}"
    ca_org="${ca_org:-$fallback}"
    echo "  CA identity not supplied — derived '$ca_name' from instance namespace" | tee -a "$LOG"
  fi
  # C= is OPTIONAL in X.509 and is omitted when unset — a guessed country is a
  # false statement baked into every certificate the instance ever issues, and
  # unlike a name it cannot be derived from anything the deploy knows. An empty
  # line inside the [dn] section is valid openssl config.
  dn_country=""
  [ -n "${AISHA_OPERATOR_COUNTRY:-}" ] && dn_country="C = ${AISHA_OPERATOR_COUNTRY}"

  cat > "$ROOTCA_CNF" <<EOF
[req]
prompt = no
default_md = sha384
distinguished_name = dn
x509_extensions = v3_ca
[dn]
CN = ${ca_name} Root CA - ${realm}
O = ${ca_org}
${dn_country}
[v3_ca]
basicConstraints = critical,CA:true,pathlen:1
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF

  if [ ! -f "$ROOTCA_KEY" ]; then
    echo "Generating $ROOTCA_KEY (EC secp384r1, encrypted with PKI_SVAULT_KEY)..." | tee -a "$LOG"
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:secp384r1 \
      -aes-256-cbc -pass "pass:${KEY_PASS}" \
      -out "$ROOTCA_KEY" 2>&1 | tee -a "$LOG"
    chmod 400 "$ROOTCA_KEY"
  fi

  if [ ! -f "$ROOTCA_CRT" ]; then
    echo "Generating $ROOTCA_CRT (self-signed root, 10y)..." | tee -a "$LOG"
    openssl req -config "$ROOTCA_CNF" -x509 -days 3650 \
      -key "$ROOTCA_KEY" -passin "pass:${KEY_PASS}" \
      -out "$ROOTCA_CRT" 2>&1 | tee -a "$LOG"
    chmod 444 "$ROOTCA_CRT"
  fi

  register_token "$realm" certsign "$ROOTCA_CRT" "$ROOTCA_KEY"
done

echo "==== pki-realm-bootstrap.sh complete at $(date -u) ====" | tee -a "$LOG"

# Final status — show what's now configured
echo "" | tee -a "$LOG"
echo "==== Final alias state ====" | tee -a "$LOG"
for realm in $REALMS; do
  echo "--- realm: $realm ---" | tee -a "$LOG"
  for type in datasafe certsign; do
    echo "  [$type]" | tee -a "$LOG"
    openxpkiadm alias --realm "$realm" --token "$type" 2>&1 | sed 's/^/    /' | tee -a "$LOG" || true
  done
done

# Diagnostic exit guard
if [ "${PKI_BOOTSTRAP_DIAG:-0}" = "1" ]; then
  echo "DIAG mode — exiting 0 regardless of errors" | tee -a "$LOG"
  exit 0
fi
exit 0

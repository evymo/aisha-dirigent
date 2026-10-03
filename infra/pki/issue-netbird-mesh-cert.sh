#!/usr/bin/env sh
# ==============================================================================
# issue-netbird-mesh-cert.sh — auto-issue AISHA PKI cert for netbird-internal-tls
# ==============================================================================
# Runs inside aisha-netbird's pki-init container at every deploy. Idempotent:
#   1. If existing cert in /certs/pki/netbird-mesh/cert.pem is valid for >7
#      days, skip (no churn on cert rotation).
#   2. Otherwise: ROPC token from Keycloak → POST pki-bridge:3040/v1/issue →
#      write cert + key to shared volume → caddy-internal-tls reads them.
#
# This is the SELF-HEALING path that replaces manual OpenXPKI WebUI workflow.
# Required env (from aisha-netbird Coolify env, propagated via cold-start):
#   PKI_BRIDGE_URL                 (default: https://${PKI_BRIDGE_DOMAIN} — public
#                                   Traefik route on Backend; Docker DNS doesn't resolve
#                                   cross-server, so this script — running in pki-init
#                                   on Frontend — must reach pki-bridge through public TLS)
#   KEYCLOAK_URL                   (default: https://${KEYCLOAK_DOMAIN})
#   PKI_BOOTSTRAP_CLIENT_ID        (default: aisha-pki-bootstrap)
#   PKI_BOOTSTRAP_CLIENT_SECRET    (set by scripts/aisha-bootstrap-user-init.sh)
#   PKI_BOOTSTRAP_USERNAME         (default: aisha-pki-bootstrap)
#   PKI_BOOTSTRAP_PASSWORD         (set by scripts/aisha-bootstrap-user-init.sh)
#   NETBIRD_MESH_HOST              (default: netbird.mesh.aisha.internal)
#
# Outputs:
#   /certs/pki/aisha-ca-bundle.pem     (CA trust bundle, copied from /staging)
#   /certs/pki/netbird-mesh/cert.pem   (server cert, signed by AISHA PKI)
#   /certs/pki/netbird-mesh/key.pem    (private key)
# ==============================================================================
set -eu

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; N='\033[0m'
info() { printf "${B}ℹ${N}  %s\n" "$*"; }
ok()   { printf "${G}✅${N} %s\n" "$*"; }
warn() { printf "${Y}⚠${N}  %s\n" "$*"; }
err()  { printf "${R}❌${N} %s\n" "$*" >&2; }

# Load fingerprint helpers if available. Baked into image at known path:
# `/usr/local/lib/fingerprint.sh` (see Dockerfile.pki-init COPY).
# Fallback to inline defs if not present — never silently miss a fingerprint.
if [ -f /usr/local/lib/fingerprint.sh ]; then
  . /usr/local/lib/fingerprint.sh
else
  fp() {
    [ -z "$1" ] && { echo "(empty)"; return; }
    printf '%s/%d' "$(printf '%s' "$1" | sha256sum | cut -c1-12)" "$(printf '%s' "$1" | wc -c | tr -d ' ')"
  }
  fp_jwt() {
    [ -z "$1" ] && { echo "(empty)"; return; }
    SIG="$(printf '%s' "$1" | cut -d. -f3)"
    fp "$SIG"
  }
  fp_file() {
    [ ! -f "$1" ] && { echo "(missing:$1)"; return; }
    printf '%s/%d' "$(sha256sum "$1" | cut -c1-12)" "$(wc -c <"$1" | tr -d ' ')"
  }
fi

CERT_DIR="${CERT_DIR:-/certs/pki/netbird-mesh}"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"
RENEW_THRESHOLD_DAYS="${RENEW_THRESHOLD_DAYS:-7}"

NETBIRD_MESH_HOST="${NETBIRD_MESH_HOST:-netbird.mesh.aisha.internal}"
# Additional SANs so the cert validates for ALL hostnames agents may use:
#   - netbird.mesh.aisha.internal (legacy mesh DNS alias)
#   - netbird-internal-tls (Docker DNS service name on coolify network — used
#     for intra-cluster Signal routing, no host port exposure needed)
#   - netbird-signal / netbird-management (potential future direct-to-service
#     routing if mgmt template advertises plain h2c paths)
NETBIRD_MESH_EXTRA_SANS="${NETBIRD_MESH_EXTRA_SANS:-netbird-internal-tls,netbird-signal,netbird-management}"
PKI_BRIDGE_URL="${PKI_BRIDGE_URL:?PKI_BRIDGE_URL required (cross-server public URL, e.g. https://pki-bridge.<your-domain>)}"
KEYCLOAK_URL="${KEYCLOAK_URL:?KEYCLOAK_URL required (e.g. https://auth.<your-domain>)}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}"
PKI_BOOTSTRAP_CLIENT_ID="${PKI_BOOTSTRAP_CLIENT_ID:-aisha-pki-bootstrap}"
PKI_BOOTSTRAP_CLIENT_SECRET="${PKI_BOOTSTRAP_CLIENT_SECRET:-}"
PKI_BOOTSTRAP_USERNAME="${PKI_BOOTSTRAP_USERNAME:-aisha-pki-bootstrap}"
PKI_BOOTSTRAP_PASSWORD="${PKI_BOOTSTRAP_PASSWORD:-}"

# ── 0. Diagnostic — fingerprints of inputs (compare with donor logs) ──────
info "Diag (fingerprints — match these with donor component logs):"
echo "    PKI_BOOTSTRAP_CLIENT_SECRET fp : $(fp "$PKI_BOOTSTRAP_CLIENT_SECRET")"
echo "    PKI_BOOTSTRAP_PASSWORD fp      : $(fp "$PKI_BOOTSTRAP_PASSWORD")"
echo "    PKI_BRIDGE_URL                 : $PKI_BRIDGE_URL"
echo "    KEYCLOAK_URL                   : $KEYCLOAK_URL realm=$KEYCLOAK_REALM"
echo "    Staging CA bundle fp           : $(fp_file /staging/aisha-ca-bundle.pem)"

# ── 1. CA bundle — fetch DYNAMIC trust bundle from pki-bridge ─────────────
# Replaces the prior `cp /staging/aisha-ca-bundle.pem`. The baked-in file
# (committed in `config/pki/aisha-ca-bundle.pem`, frozen on 2026-04-13)
# was the single biggest source of `error 20 at depth 0: unable to get
# local issuer certificate` after every cold-start `--wipe`: OpenXPKI's
# pki-realm-bootstrap.sh re-generates `rootca-<realm>.{key,crt}` each
# boot, but the static bundle in the image NEVER changed → trust anchors
# in consumers no longer matched the certs OpenXPKI was issuing.
#
# Fetch the LIVE bundle from `pki-bridge /diag/ca-bundle` (newly added).
# That endpoint reads the per-instance rootca-*.crt files OpenXPKI just
# generated and concatenates them — so the bundle always reflects what
# pki-server actually trusts. Empty body means pki-server still booting
# (realms not yet provisioned) — we then fall back to the staged file so
# this script never blocks on PKI cold-start race.
mkdir -p /certs/pki "$CERT_DIR"
BUNDLE_FETCH_OK=0
BUNDLE_TMP="$(mktemp)"
trap 'rm -f "$BUNDLE_TMP"' EXIT
HTTP_CODE="$(curl -sS --max-time 15 \
  -o "$BUNDLE_TMP" \
  -w '%{http_code}' \
  "$PKI_BRIDGE_URL/diag/ca-bundle" 2>&1)" || HTTP_CODE="curl-error"
if [ "$HTTP_CODE" = "200" ] && [ -s "$BUNDLE_TMP" ] \
   && grep -q "BEGIN CERTIFICATE" "$BUNDLE_TMP"; then
  mv "$BUNDLE_TMP" /certs/pki/aisha-ca-bundle.pem
  trap - EXIT
  BUNDLE_FETCH_OK=1
  CERT_COUNT="$(grep -c 'BEGIN CERTIFICATE' /certs/pki/aisha-ca-bundle.pem 2>/dev/null || echo 0)"
  ok "CA bundle fetched DYNAMICALLY from pki-bridge ($CERT_COUNT cert(s), fp=$(fp_file /certs/pki/aisha-ca-bundle.pem))"
else
  warn "pki-bridge /diag/ca-bundle fetch failed (HTTP $HTTP_CODE) — falling back to staged image bundle"
  warn "  (this is acceptable during pki-stack first-boot before pki-server is ready)"
  rm -f "$BUNDLE_TMP"
  trap - EXIT
  cp /staging/aisha-ca-bundle.pem /certs/pki/
  ok "CA bundle staged from /staging/aisha-ca-bundle.pem (fp=$(fp_file /certs/pki/aisha-ca-bundle.pem)) — STATIC FALLBACK"
fi

# ── 2. Skip-if-fresh check ─────────────────────────────────────────────────
# Reissue when EITHER the cert is near expiry OR its SANs no longer cover the
# current NETBIRD_MESH_HOST. The SAN-drift arm is load-bearing for mesh-domain
# migrations (e.g. mesh.aisha.network → mesh.aisha.internal): expiry alone would
# silently keep the stale-domain cert for its full validity, so an agent that
# now connects via the new SNI hits a hostname/SAN mismatch and enrollment fails
# (the exact 2026-07-07 cutover trap — pki-init logged "valid for 29 days —
# skipping issuance" while serving the old .network SAN).
if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
  expiry_epoch="$(openssl x509 -in "$CERT_FILE" -noout -enddate 2>/dev/null | cut -d= -f2 | xargs -I{} date -d "{}" +%s 2>/dev/null || echo 0)"
  now_epoch="$(date +%s)"
  days_left=$(( (expiry_epoch - now_epoch) / 86400 ))
  existing_sans="$(openssl x509 -in "$CERT_FILE" -noout -ext subjectAltName 2>/dev/null || true)"
  if ! printf '%s' "$existing_sans" | grep -q "DNS:$NETBIRD_MESH_HOST"; then
    warn "Existing cert does NOT cover $NETBIRD_MESH_HOST (SAN drift / domain migration) — re-issuing"
  elif [ "$expiry_epoch" -gt 0 ] && [ "$days_left" -gt "$RENEW_THRESHOLD_DAYS" ]; then
    ok "Existing cert valid for $days_left days (threshold=$RENEW_THRESHOLD_DAYS) and covers $NETBIRD_MESH_HOST — skipping issuance"
    exit 0
  else
    warn "Existing cert expires in $days_left days (threshold=$RENEW_THRESHOLD_DAYS) — re-issuing"
  fi
else
  info "No existing cert — issuing fresh"
fi

# ── 3. Validate creds ──────────────────────────────────────────────────────
if [ -z "$PKI_BOOTSTRAP_CLIENT_SECRET" ] || [ -z "$PKI_BOOTSTRAP_PASSWORD" ]; then
  err "PKI_BOOTSTRAP_CLIENT_SECRET / PASSWORD missing — falling back to self-signed at internal-tls"
  warn "  Run scripts/aisha-bootstrap-user-init.sh to provision PKI bootstrap user"
  exit 1  # ⛔ fail-closed: bez certifikátu mesh nevstane. Nulou tady krok LŽE —
          # Coolify, vlny i cold-start:verify pak hlásí úspěch nad prázdnem.
fi

# ── 4. ROPC token from Keycloak ────────────────────────────────────────────
info "Acquiring ROPC token from Keycloak ($KEYCLOAK_URL realm=$KEYCLOAK_REALM)..."
TOKEN_RESPONSE="$(curl -fsS --max-time 30 \
  -d "grant_type=password" \
  -d "client_id=$PKI_BOOTSTRAP_CLIENT_ID" \
  -d "client_secret=$PKI_BOOTSTRAP_CLIENT_SECRET" \
  -d "username=$PKI_BOOTSTRAP_USERNAME" \
  -d "password=$PKI_BOOTSTRAP_PASSWORD" \
  "$KEYCLOAK_URL/realms/$KEYCLOAK_REALM/protocol/openid-connect/token" 2>&1)" || {
  err "Keycloak ROPC request failed:"
  echo "  $TOKEN_RESPONSE" >&2 | head -3
  exit 1  # ⛔ fail-closed: bez certifikátu mesh nevstane. Nulou tady krok LŽE —
          # Coolify, vlny i cold-start:verify pak hlásí úspěch nad prázdnem.
}

ACCESS_TOKEN="$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')"
if [ -z "$ACCESS_TOKEN" ]; then
  err "Keycloak returned no access_token:"
  echo "  $(echo "$TOKEN_RESPONSE" | head -c 200)" >&2
  exit 1  # ⛔ fail-closed: bez certifikátu mesh nevstane. Nulou tady krok LŽE —
          # Coolify, vlny i cold-start:verify pak hlásí úspěch nad prázdnem.
fi
ok "ROPC token acquired (sig_fp=$(fp_jwt "$ACCESS_TOKEN"))"
# This sig_fp should appear in pki-bridge's `auth rejected` log as
# `token_sig_fp`. Mismatch = different token in transit (proxy rewrite?).

# ── 5. Request cert from pki-bridge ────────────────────────────────────────
# Build SANs list: primary hostname + all extra SANs (for Docker DNS service
# names so cert validates when agents reach signal/internal-tls via cross-stack
# Docker DNS instead of host-gateway port mapping).
SANS_JSON="$(echo "$NETBIRD_MESH_HOST,$NETBIRD_MESH_EXTRA_SANS" | tr ',' '\n' | grep -v '^$' | jq -R . | jq -s .)"
info "Requesting cert from pki-bridge: hostname=$NETBIRD_MESH_HOST"
info "  SANs: $(echo "$SANS_JSON" | jq -c .)"
ISSUE_PAYLOAD="$(jq -n \
  --arg h "$NETBIRD_MESH_HOST" \
  --argjson sans "$SANS_JSON" \
  --arg c "Auto-issued by aisha-netbird/pki-init at $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{hostname: $h, sans: $sans, comment: $c}')"

# NOTE: do NOT use `curl -f` — it silently discards the response body on
# HTTP 4xx/5xx, hiding the actual error from operators. Capture status
# and body separately so failures surface their real cause in logs.
# (Mirrors the pattern already used by aisha-pki/pki-renewer compose.)
# Retry the issue call on TRANSIENT failures (pki-bridge not ready yet) — this
# is the wave-timing race: aisha-netbird's pki-init can run before aisha-pki's
# pki-bridge is reachable, and a single curl would then fail → no cert → the
# caddy-internal-tls self-signed fallback → agents fail TLS verify. Retry only
# on connectivity/5xx (curl-error/000/5xx); fail fast on 4xx (auth/forbidden —
# those won't fix with time). ROPC token lifetime (>5m) safely covers the
# retry budget (default 12 × 10s = 2m).
PKI_ISSUE_RETRIES="${PKI_ISSUE_RETRIES:-12}"
PKI_ISSUE_BACKOFF="${PKI_ISSUE_BACKOFF:-10}"
_issue_attempt=1
while :; do
  HTTP_CODE="$(curl -sS --max-time 60 \
    -o /tmp/pki-bridge-resp.json \
    -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$ISSUE_PAYLOAD" \
    "$PKI_BRIDGE_URL/v1/issue" 2>&1)" || HTTP_CODE="curl-error"
  ISSUE_RESPONSE="$(cat /tmp/pki-bridge-resp.json 2>/dev/null || true)"
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
  break  # 2xx handled above; 4xx (auth/forbidden) or retries exhausted → error handling below
done

if [ "$HTTP_CODE" != "201" ] && [ "$HTTP_CODE" != "200" ]; then
  err "pki-bridge /v1/issue failed (HTTP $HTTP_CODE):"
  # Show first 500 chars of body — pki-bridge sends structured error JSON
  # with `error`, `forbidden`, `allowedPatterns`, etc. fields on 4xx.
  # On 5xx (OpenXPKI backend error) the body holds the actual exception.
  echo "  body: $(echo "$ISSUE_RESPONSE" | head -c 500)" >&2

  # Persist a side-channel diagnostic for caddy-internal-tls to re-print.
  # Coolify v4 init-container stdout is NOT captured into app-logs when any
  # container is restarting, so post-mortem of pki-init is normally impossible.
  # Writing to the shared cert volume gives the long-running internal-tls a
  # file to cat on every startup — making the diag visible in *its* logs.
  DIAG_FILE="/certs/pki/last-issue-attempt.log"
  {
    echo "─── pki-init last-issue-attempt @ $(date -u +%Y-%m-%dT%H:%M:%SZ) ───"
    echo "HTTP_CODE: $HTTP_CODE"
    echo "PKI_BRIDGE_URL: $PKI_BRIDGE_URL"
    echo "KEYCLOAK_URL: $KEYCLOAK_URL realm=$KEYCLOAK_REALM"
    echo "HOSTNAME: $NETBIRD_MESH_HOST"
    echo "SANs: $(echo "$SANS_JSON" | jq -c .)"
    echo "Response body (first 800 chars):"
    echo "  $(echo "$ISSUE_RESPONSE" | head -c 800)"
  } > "$DIAG_FILE" 2>/dev/null || true

  # ── Diagnostics for HTTP 401 (auth rejection) ──
  # Decode the JWT payload locally and print iss/aud/azp so operator can
  # compare against pki-bridge's expected_issuer + audience (see pki-bridge
  # /health endpoint). All info is non-secret (these claims are already
  # visible to anyone who can decode the JWT). exp is shown to rule out
  # clock-skew issues. signature integrity is NOT verified here — that's
  # pki-bridge's job; we're just helping the operator see the mismatch.
  if [ "$HTTP_CODE" = "401" ]; then
    PAYLOAD_B64="$(echo "$ACCESS_TOKEN" | cut -d. -f2)"
    # base64url → base64 (pad with '=' and replace url-safe chars)
    PAYLOAD_PADDED="$(printf '%s' "$PAYLOAD_B64" | tr '_-' '/+')"
    case $(( ${#PAYLOAD_PADDED} % 4 )) in
      2) PAYLOAD_PADDED="${PAYLOAD_PADDED}==" ;;
      3) PAYLOAD_PADDED="${PAYLOAD_PADDED}=" ;;
    esac
    TOKEN_PAYLOAD="$(printf '%s' "$PAYLOAD_PADDED" | base64 -d 2>/dev/null || echo '')"
    if [ -n "$TOKEN_PAYLOAD" ]; then
      TOKEN_ISS="$(echo "$TOKEN_PAYLOAD" | jq -r '.iss // "MISSING"' 2>/dev/null)"
      TOKEN_AUD="$(echo "$TOKEN_PAYLOAD" | jq -c '.aud // "MISSING"' 2>/dev/null)"
      TOKEN_AZP="$(echo "$TOKEN_PAYLOAD" | jq -r '.azp // "MISSING"' 2>/dev/null)"
      TOKEN_EXP="$(echo "$TOKEN_PAYLOAD" | jq -r '.exp // "MISSING"' 2>/dev/null)"
      NOW="$(date +%s)"
      BRIDGE_HEALTH="$(curl -fsS --max-time 10 "$PKI_BRIDGE_URL/health" 2>/dev/null || echo '{}')"
      BRIDGE_EXPECTED_ISS="$(echo "$BRIDGE_HEALTH" | jq -r '.expected_issuer // "(pki-bridge /health unreachable)"' 2>/dev/null)"
      BRIDGE_EXPECTED_AUD="$(echo "$BRIDGE_HEALTH" | jq -r '.audience // "(pki-bridge /health unreachable)"' 2>/dev/null)"

      warn "  Token claims (decoded from access_token):"
      echo "    iss : $TOKEN_ISS"   >&2
      echo "    aud : $TOKEN_AUD"   >&2
      echo "    azp : $TOKEN_AZP"   >&2
      echo "    exp : $TOKEN_EXP (now=$NOW, delta=$((TOKEN_EXP - NOW))s)" >&2
      warn "  pki-bridge expects:"
      echo "    iss : $BRIDGE_EXPECTED_ISS" >&2
      echo "    aud : $BRIDGE_EXPECTED_AUD" >&2

      # Append the same diagnostic to the side-channel file.
      {
        echo "── JWT 401 diagnostic ──"
        echo "Token iss : $TOKEN_ISS"
        echo "Token aud : $TOKEN_AUD"
        echo "Token azp : $TOKEN_AZP"
        echo "Token exp : $TOKEN_EXP (now=$NOW, delta=$((TOKEN_EXP - NOW))s)"
        echo "Bridge expects iss : $BRIDGE_EXPECTED_ISS"
        echo "Bridge expects aud : $BRIDGE_EXPECTED_AUD"
        # Heuristic verdict for downstream operator (caddy-internal-tls will print this)
        case "$TOKEN_AUD" in
          *pki-proxy*) echo "VERDICT: token aud contains pki-proxy — likely issuer URL mismatch or JWKS unreachable" ;;
          *MISSING*)   echo "VERDICT: token has NO aud claim — audience mapper missing on aisha-pki-bootstrap client" ;;
          *)           echo "VERDICT: token aud does NOT contain pki-proxy — audience mapper not applied (cold-start should self-heal)" ;;
        esac
      } >> "$DIAG_FILE" 2>/dev/null || true
    fi
  fi
  exit 1  # ⛔ fail-closed: bez certifikátu mesh nevstane. Nulou tady krok LŽE —
          # Coolify, vlny i cold-start:verify pak hlásí úspěch nad prázdnem.
fi

BRIDGE_CERT="$(echo "$ISSUE_RESPONSE" | jq -r '.certificate // empty')"
BRIDGE_KEY="$(echo "$ISSUE_RESPONSE" | jq -r '.privateKey // empty')"
BRIDGE_TXN="$(echo "$ISSUE_RESPONSE" | jq -r '.transactionId // empty')"

if [ -z "$BRIDGE_CERT" ] || [ -z "$BRIDGE_KEY" ]; then
  err "pki-bridge returned 2xx but body has no cert/key:"
  echo "  $(echo "$ISSUE_RESPONSE" | head -c 500)" >&2
  exit 1  # ⛔ fail-closed: bez certifikátu mesh nevstane. Nulou tady krok LŽE —
          # Coolify, vlny i cold-start:verify pak hlásí úspěch nad prázdnem.
fi
ok "Cert issued by AISHA PKI (txn=$BRIDGE_TXN)"

# ── 6. Validate cert chain against AISHA bundle ────────────────────────────
TMP_CERT="$(mktemp)"; TMP_KEY="$(mktemp)"
trap 'rm -f "$TMP_CERT" "$TMP_KEY"' EXIT
echo "$BRIDGE_CERT" > "$TMP_CERT"
echo "$BRIDGE_KEY" > "$TMP_KEY"

# Use the bundle that the earlier dynamic fetch wrote to /certs/pki/. That
# file holds the LIVE root CAs returned by pki-bridge /diag/ca-bundle (or
# the staged-image fallback on fetch failure). Verifying against
# /staging/aisha-ca-bundle.pem would use the *baked-in* file from
# 2026-04-13 image build — stale relative to any OpenXPKI cert rotation
# since, which means freshly-issued certs fail to verify even when the
# live bundle would accept them.
if ! openssl verify -CAfile /certs/pki/aisha-ca-bundle.pem "$TMP_CERT" > /tmp/verify-out 2>&1; then
  err "Cert chain verification failed:"
  cat /tmp/verify-out >&2
  exit 1  # ⛔ fail-closed: bez certifikátu mesh nevstane. Nulou tady krok LŽE —
          # Coolify, vlny i cold-start:verify pak hlásí úspěch nad prázdnem.
fi
ok "Cert chain validated against AISHA CA bundle"

CERT_SUBJECT="$(openssl x509 -in "$TMP_CERT" -noout -subject 2>/dev/null)"
CERT_DATES="$(openssl x509 -in "$TMP_CERT" -noout -dates 2>/dev/null)"
info "Subject: $CERT_SUBJECT"
info "$CERT_DATES" | tr '\n' ' '
echo

# ── 7. Atomic write to shared volume ───────────────────────────────────────
mv "$TMP_CERT" "$CERT_FILE"
mv "$TMP_KEY" "$KEY_FILE"
chmod 644 "$CERT_FILE"
chmod 600 "$KEY_FILE"
trap - EXIT
ok "Cert written to $CERT_FILE"
ok "Key written to $KEY_FILE"

# Cert succeeded — clean up any stale 401-diagnostic from previous runs
# so caddy-internal-tls doesn't surface obsolete error context on its next
# restart. Best-effort: failure to remove is harmless (it'll just be stale).
rm -f /certs/pki/last-issue-attempt.log 2>/dev/null || true

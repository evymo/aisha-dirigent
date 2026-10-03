#!/usr/bin/env bash
# ============================================================================
# scripts/security/cosign-verify.sh
#
# OWASP A08 — verify a container image was signed by our trusted GitHub
# Actions workflow before allowing deploy. Called by deploy pipelines
# (Coolify webhook + manual deploys) before rolling a new image.
#
# Usage:
#   scripts/security/cosign-verify.sh <image-ref>
#
# Returns 0 if the image has a valid Sigstore signature whose certificate
# identity matches our orchestrator's release workflow. Returns 1 otherwise.
#
# Exit codes:
#   0  — signature valid, image is trusted
#   1  — signature missing or invalid (BLOCK deploy)
#   2  — cosign not installed (BLOCK; install cosign in deploy runner)
#   3  — bad arguments
# ============================================================================
set -euo pipefail

IMAGE_REF="${1:-}"
if [ -z "$IMAGE_REF" ]; then
  echo "Usage: $0 <image-ref>" >&2
  exit 3
fi

if ! command -v cosign >/dev/null 2>&1; then
  echo "ERROR: cosign not installed on this runner" >&2
  echo "       Install: brew install cosign  OR  curl -L https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64 -o /usr/local/bin/cosign && chmod +x /usr/local/bin/cosign" >&2
  exit 2
fi

# Identity regexp must match the workflow that produces the SLSA provenance.
# Operator-supplied via env: COSIGN_CERT_IDENTITY_RE points at the org/repo
# pattern of the trusted release workflow; COSIGN_OIDC_ISSUER is the issuer
# of the Sigstore Fulcio cert (typically the CI provider's OIDC URL).
CERT_IDENTITY_RE="${COSIGN_CERT_IDENTITY_RE:?COSIGN_CERT_IDENTITY_RE required (e.g. regexp matching your release workflow URL)}"
OIDC_ISSUER="${COSIGN_OIDC_ISSUER:?COSIGN_OIDC_ISSUER required (e.g. the OIDC issuer URL of your CI provider)}"

echo "[cosign-verify] image=$IMAGE_REF"
echo "[cosign-verify] cert-identity-regexp=$CERT_IDENTITY_RE"
echo "[cosign-verify] oidc-issuer=$OIDC_ISSUER"

if cosign verify \
  --certificate-identity-regexp "$CERT_IDENTITY_RE" \
  --certificate-oidc-issuer "$OIDC_ISSUER" \
  "$IMAGE_REF" >/dev/null 2>&1; then
  echo "[cosign-verify] OK — image is signed by trusted workflow"
  exit 0
fi

echo "[cosign-verify] FAILED — image $IMAGE_REF lacks a valid trusted signature" >&2
echo "[cosign-verify] BLOCK deploy. Re-run the release workflow to produce a signed image." >&2
exit 1

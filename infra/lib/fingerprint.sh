#!/bin/sh
# =============================================================================
# fingerprint.sh — diagnostic helpers for tracing secrets across components
# =============================================================================
# Purpose: let operators compare "did secret X reach component Y intact?"
# without ever logging the raw value. SHA-256 prefix + length is enough for
# visual identification but is computationally infeasible to reverse.
#
# Usage in any shell script that handles a secret:
#   . "$(dirname "$0")/../lib/fingerprint.sh"
#   echo "client_secret fp: $(fp "$PKI_BOOTSTRAP_CLIENT_SECRET")"
#   echo "access_token fp:  $(fp_jwt "$ACCESS_TOKEN")"
#
# Compare values across components by grepping for matching fp prefixes
# in their respective logs. Same prefix = same value.
# =============================================================================

# Fingerprint any string: <12-char SHA-256 hex>/<length>
# Empty input → "(empty)" so callers can grep for "(empty)" to find unset
# secrets without panicking on null arg.
fp() {
  if [ -z "$1" ]; then
    echo "(empty)"
    return
  fi
  printf '%s/%d' \
    "$(printf '%s' "$1" | sha256sum | cut -c1-12)" \
    "$(printf '%s' "$1" | wc -c | tr -d ' ')"
}

# Fingerprint a JWT by its SIGNATURE segment (3rd dot-segment).
# Reveals nothing about the payload — perfect for cross-component compare.
fp_jwt() {
  if [ -z "$1" ]; then
    echo "(empty)"
    return
  fi
  # Count dots: JWT has exactly 2 (header.payload.signature). Using
  # `tr | wc -l` was wrong — wc -l counts trailing newlines, so a
  # 3-segment JWT (no trailing \n) returned wc=2 → falsely flagged as
  # (not-a-jwt). Counting dots directly is unambiguous.
  DOT_COUNT="$(printf '%s' "$1" | tr -cd '.' | wc -c | tr -d ' ')"
  if [ "$DOT_COUNT" != "2" ]; then
    echo "(not-a-jwt)"
    return
  fi
  SIG="$(printf '%s' "$1" | cut -d. -f3)"
  fp "$SIG"
}

# Fingerprint a file by its content hash + size. Useful for shared volume
# files (cert.pem, key.pem, rpc-hmac.key, ca-bundle.pem etc.).
fp_file() {
  if [ ! -f "$1" ]; then
    echo "(missing:$1)"
    return
  fi
  printf '%s/%d' \
    "$(sha256sum "$1" | cut -c1-12)" \
    "$(wc -c <"$1" | tr -d ' ')"
}

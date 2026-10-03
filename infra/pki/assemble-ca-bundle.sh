#!/usr/bin/env sh
# ==============================================================================
# assemble-ca-bundle.sh — build the mesh peer's CA trust bundle
# ==============================================================================
# Runs inside every mesh peer's pki-init container (aisha-core, aisha-edge,
# aisha-integration, ledger/cosmos — all build from Dockerfile.pki-init). Writes
# the trust bundle netbird-agent then trusts via SSL_CERT_FILE +
# NB_SSL_TRUST_BUNDLE.
#
# ── THE INVARIANT ─────────────────────────────────────────────────────────────
# NEVER write a trust anchor we could not verify, and NEVER leave the volume
# worse than we found it. That is the whole job. Whether an unverifiable state
# should ALSO kill the deployment is a separate, per-stack decision — see
# PKI_BUNDLE_REQUIRED.
#
# ── WHY THE BAKED FALLBACK IS GONE ────────────────────────────────────────────
# The realm CAs are minted at first boot by pki-realm-bootstrap.sh from a random
# EC keypair. The committed config/pki/aisha-ca-bundle.pem froze on 2026-04-13,
# so it cannot match the CA that signs mesh TLS on any live instance — not a
# degraded anchor, an impossible one. Writing it anyway gave the worst outcome
# available: every container healthy, every mesh TLS handshake dead with
# `x509: ECDSA verification failure`, api/mcp 502, and nothing in any log
# naming the trust bundle.
#
# ── WHY ONE REQUEST WAS NEVER ENOUGH ──────────────────────────────────────────
#   1. RACE — aisha-redeploy.mjs wave 2 starts aisha-core, aisha-pki and
#      aisha-edge in PARALLEL, and pki-bridge lives inside aisha-pki. The peers
#      calling it start at the same moment it does.
#   2. EMPTY-BUT-OK — pki-bridge answers 200 with an EMPTY body while OpenXPKI
#      bootstraps the realms; its own contract says "consumer should retry"
#      (services/svc-pki-bridge/src/server.ts). Readiness is "the body contains
#      a certificate", never "the request worked".
#
# ── WHY exit 1 IS NOT ALWAYS RIGHT (2026-08-01) ───────────────────────────────
# An earlier revision made every peer exit non-zero on timeout. Adversarial
# review found that this EXTENDS an outage rather than ending one:
#
#     pki-init exit 1
#       -> mesh-router depends_on pki-init: service_completed_successfully
#         -> aisha-edge deployment FAILS
#           -> edge is CRITICAL (absent from SOFT_DEPLOY_APPS in
#              scripts/aisha-redeploy.mjs) -> redeploy exits 1
#             -> cold-start HALTS AT WAVE 2
#               -> aisha-keycloak (WAVE 3) never deploys at all
#
# On a cold `--wipe` the bridge chain (pki-db start_period 60s -> pki-server
# start_period 180s "first-boot openxpki provisioning" -> pki-webui ->
# pki-bridge) routinely outlasts a peer's patience, so that was likely, not
# theoretical.
#
# The resolution: "do not write garbage" and "kill the deploy" are DIFFERENT
# requirements. A peer that cannot reach the bridge writes a TRUTHFUL bundle —
# public roots only, no realm CA, no stale copy — leaves a marker file, and says
# so at error level. Whether that also fails the container is
# PKI_BUNDLE_REQUIRED, decided per stack.
#
# Edge sets it false ON PURPOSE: wave 5 is "Mesh warmup (re-enroll agents after
# management)" and re-deploys aisha-edge, so its pki-init runs a SECOND time
# once pki is definitely up. The recovery path is already in the wave design —
# edge does not need to hold wave 2 hostage to use it.
#
# Env:
#   PKI_BRIDGE_URL                bridge base URL; empty => no mesh trust to
#                                 establish (public roots only, exit 0)
#   PKI_BUNDLE_REQUIRED           true (default) => exit 1 when no live CA.
#                                 false => truthful bundle + marker + exit 0,
#                                 for stacks that get a later re-run.
#   CA_BUNDLE_OUT                 output path  (default /certs/pki/aisha-ca-bundle.pem)
#   SYSTEM_CA_BUNDLE              public roots (default /etc/ssl/certs/ca-certificates.crt)
#   PKI_BUNDLE_WAIT_S             total deadline (default 600). Phase A runs
#                                 waves 1-3 under AISHA_PHASE_A_WAVE_TIMEOUT_S
#                                 (720s, config/cold-start-timeouts.env) — NOT
#                                 the 420s steady-state wave timeout an earlier
#                                 revision cited. 600 leaves the wave room to
#                                 report this as the failure.
#   PKI_BUNDLE_RETRY_DELAY_S      delay between attempts (default 5)
#   PKI_BUNDLE_ATTEMPT_TIMEOUT_S  per-request timeout (default 15)
# ==============================================================================
set -eu

OUT="${CA_BUNDLE_OUT:-/certs/pki/aisha-ca-bundle.pem}"

# ⛔ BUNDLE MUSÍ BÝT ČITELNÝ PRO NEROOTOVÉ SLUŽBY. Kotvy důvěry jsou VEŘEJNÉ —
# utajovat je nedává smysl a tady to rovnou brání jejich použití: mktemp i cp
# vyrobí soubor 0600 root:root, jenže služby běží pod vlastním uživatelem
# (svc-web-render jako node, ws-gateway taky). Node pak ohlásí jen
# 'Ignoring extra certs ... Permission denied' a fetch na https:// selže jako
# nic neříkající 'TypeError: fetch failed'.
#
# Naměřeno 2026-08-31: svazek nesl '-rw------- root root aisha-ca-bundle.pem',
# generátor se kvůli tomu točil v restartu a týž warning byl i v logu
# ws-gateway — vada tedy nebyla v jednom stacku, ale ve VÝROBCI bundlu.
zverejni_bundle() {
  # 0644: číst smí každý, zapisovat jen vlastník. Privátní klíče tudy NEJDOU —
  # tenhle soubor obsahuje výhradně certifikáty CA.
  chmod 0644 "$OUT" 2>/dev/null || true
}
SYSTEM_CA="${SYSTEM_CA_BUNDLE:-/etc/ssl/certs/ca-certificates.crt}"
PKI_BRIDGE_URL="${PKI_BRIDGE_URL:-}"
REQUIRED="${PKI_BUNDLE_REQUIRED:-true}"
WAIT_S="${PKI_BUNDLE_WAIT_S:-600}"
RETRY_DELAY_S="${PKI_BUNDLE_RETRY_DELAY_S:-5}"
ATTEMPT_TIMEOUT_S="${PKI_BUNDLE_ATTEMPT_TIMEOUT_S:-15}"
MARKER="$(dirname "$OUT")/.no-realm-ca"

mkdir -p "$(dirname "$OUT")"

count_certs() {
  [ -f "$1" ] || { echo 0; return; }
  grep -c 'BEGIN CERTIFICATE' "$1" 2>/dev/null || echo 0
}

SYSTEM_COUNT="$(count_certs "$SYSTEM_CA")"

# ── No mesh trust to establish — legitimate for a non-mesh fork ───────────────
if [ -z "$PKI_BRIDGE_URL" ]; then
  cp "$SYSTEM_CA" "$OUT"
  zverejni_bundle
  rm -f "$MARKER"
  echo "[pki-init] PKI_BRIDGE_URL unset — this deployment establishes no mesh trust."
  echo "[pki-init] CA bundle = public roots only ($(count_certs "$OUT") certs)"
  exit 0
fi

# ── Fetch the LIVE realm CA ───────────────────────────────────────────────────
# Everything is assembled in a TEMP file; $OUT is only ever replaced by an
# atomic mv of a bundle we verified. An earlier revision ran
# `cp "$SYSTEM_CA" "$OUT"` unconditionally BEFORE the retry loop, so a failure
# destroyed a working bundle in the persisted volume and left only public roots
# — strictly worse than not running. That hurt exactly where recovery was meant
# to happen: the wave-5 edge re-deploy, whose volume already held a good bundle.
live_tmp="$(mktemp)"
cand_tmp="$(mktemp)"
# shellcheck disable=SC2064 -- expand the paths now, not at trap time
trap "rm -f '$live_tmp' '$cand_tmp'" EXIT

url="${PKI_BRIDGE_URL%/}/diag/ca-bundle"
started="$(date +%s)"
deadline=$(( started + WAIT_S ))
attempt=0

while :; do
  attempt=$(( attempt + 1 ))

  if curl -fsS --max-time "$ATTEMPT_TIMEOUT_S" -o "$live_tmp" "$url" 2>/dev/null \
    && [ -s "$live_tmp" ] \
    && grep -q 'BEGIN CERTIFICATE' "$live_tmp"; then

    # Public roots FIRST: SSL_CERT_FILE REPLACES Go's trust pool rather than
    # extending it, so a bundle without them leaves an EMPTY pool — not a
    # fallback to the system store.
    cat "$SYSTEM_CA" > "$cand_tmp"
    cat "$live_tmp" >> "$cand_tmp"
    mv -f "$cand_tmp" "$OUT"
    zverejni_bundle
    rm -f "$MARKER"
    echo "[pki-init] LIVE realm CA fetched from pki-bridge on attempt ${attempt} ($(( $(date +%s) - started ))s)"
    echo "[pki-init] CA bundle written to $OUT ($(count_certs "$OUT") certs)"
    exit 0
  fi

  now="$(date +%s)"
  if [ "$now" -ge "$deadline" ]; then
    break
  fi

  echo "[pki-init] attempt ${attempt}: pki-bridge has no realm CA yet ($(( deadline - now ))s left) — retrying in ${RETRY_DELAY_S}s"
  sleep "$RETRY_DELAY_S"
done

# ── Deadline expired — do not worsen the volume ───────────────────────────────
# If a previous run already left a bundle carrying realm CAs (more certs than
# the system store alone), KEEP it: a real anchor from this same instance beats
# deleting trust, and the next run replaces it atomically. Otherwise write the
# truthful public-roots bundle so nothing downstream inherits an anchor that
# never existed.
EXISTING_COUNT="$(count_certs "$OUT")"
if [ "$EXISTING_COUNT" -gt "$SYSTEM_COUNT" ]; then
  echo "[pki-init] keeping the existing bundle ($EXISTING_COUNT certs > $SYSTEM_COUNT system roots) — not replacing verified trust with less" >&2
    # ⛔ I TADY, PŘESTOŽE SE NEZAPISUJE. Tahle větev je ta, kterou projde KAŽDÝ
    # opakovaný běh nad už hotovým svazkem — a právě v něm leží soubor se
    # starými právy 0600. Kdyby se chmod vázal jen na zápis, oprava by se
    # existujících instalací nikdy nedotkla a čekala by na smazání svazku.
    # Naměřeno 2026-08-31: po nasazení opravy zůstalo '-rw------- root root'.
    zverejni_bundle
else
  cp "$SYSTEM_CA" "$OUT"
  zverejni_bundle
  echo "[pki-init] wrote public roots only ($(count_certs "$OUT") certs) — NO realm CA" >&2
fi
: > "$MARKER"

cat >&2 <<EOF
[pki-init] NO LIVE REALM CA after ${attempt} attempts over ${WAIT_S}s.
[pki-init]   url:    ${url}
[pki-init]   marker: ${MARKER}
[pki-init]
[pki-init] The baked config/pki/aisha-ca-bundle.pem was NOT used: the realm CA is
[pki-init] minted at first boot from a random keypair, so that copy cannot match a
[pki-init] live instance. Writing it would make this container report healthy while
[pki-init] every mesh TLS handshake fails with "x509: ECDSA verification failure".
[pki-init]
[pki-init] Mesh TLS will NOT work until this runs again with the bridge reachable.
[pki-init] Check, in order:
[pki-init]   1. is aisha-pki deployed and is pki-bridge healthy?
[pki-init]      (pki-bridge depends on pki-webui: service_healthy)
[pki-init]   2. has pki-realm-bootstrap finished writing
[pki-init]      /etc/openxpki/local/keys/rootca-<realm>.crt inside pki-server?
[pki-init]   3. can this container reach ${url} on the internal network?
[pki-init]   4. raise PKI_BUNDLE_WAIT_S (plumbed through the compose env; keep it
[pki-init]      below AISHA_PHASE_A_WAVE_TIMEOUT_S, default 720s, so the wave
[pki-init]      attributes the failure here instead of timing out on its own).
EOF

if [ "$REQUIRED" = "false" ]; then
  echo "[pki-init] PKI_BUNDLE_REQUIRED=false — not failing the container; a later re-deploy of this stack is expected to complete the trust bundle." >&2
  exit 0
fi

echo "[pki-init] PKI_BUNDLE_REQUIRED=true — failing closed so nothing starts on unverified trust." >&2
exit 1

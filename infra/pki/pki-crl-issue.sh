#!/bin/sh
# =============================================================================
# pki-crl-issue.sh — periodically ask OpenXPKI to (re)issue and publish CRLs
# =============================================================================
#
# WHY THIS EXISTS
# ---------------
# OpenXPKI ships a complete `crl_issuance` workflow and a publishing connector,
# but NOTHING that calls them. There is no scheduler in the daemon: the watchdog
# only reaps (`interval_crl_purge`), and upstream's own docs solve this with a
# cron entry outside the container. A stack that never adds that cron issues
# certificates, marks revocations as CRL_ISSUANCE_PENDING… and stops there.
#
# Measured on a live install before this script existed: 0 rows in `crl`, 0
# `crl_issuance` workflows ever created, and 856 certificates parked in
# CRL_ISSUANCE_PENDING — i.e. 856 certificates that operators believed were
# revoked and that every validator still accepted. It never failed; it was
# simply never asked. That is the worst shape a security control can have.
#
# WHY A LOOP HERE AND NOT A SIDECAR
# ---------------------------------
# `openxpkicli` and the daemon socket (/run/openxpkid/openxpkid.sock, group
# openxpkiclient, mode 0660) live in the openxpki image. The pki-init image is
# alpine with openssl/curl/jq and has neither, so a sidecar built from it could
# not talk to the CA at all. Co-locating the loop with the server also makes the
# multi-node question moot: the socket is per-host, so the caller must be on the
# same host as the daemon by construction, not by scheduling luck.
#
# IDEMPOTENCE IS THE WORKFLOW'S JOB, NOT OURS
# -------------------------------------------
# `crl_issuance` compares the current CRL against the realm's `renewal` window
# and CANCELs itself when it is too early. Verified live: two calls seconds
# apart → first SUCCESS (crl_serial 255), second CANCELED, still one row in
# `crl`. So this loop deliberately holds no "last issued" state of its own —
# state we kept here could disagree with the CA's, and the CA is the authority.
# Calling more often than needed is cheap; the cost of a stale CRL is not.
#
# Env:
#   REALMS                  space-separated realm list (already set for pki-server)
#   CRL_INTERVAL_HOURS      how often to ask; default 6
#   CRL_BOOTSTRAP_POLL_S    retry interval while the CA is still coming up; default 60
# =============================================================================

# `set -u` but NOT `set -e`: this runs as a background loop next to the daemon.
# A single bad cycle (CA mid-restart, transient socket error) must log and retry,
# never terminate the loop — a dead loop is indistinguishable from "no CRLs
# needed" from the outside, which is exactly the failure mode being fixed.
set -u

CRL_INTERVAL_HOURS="${CRL_INTERVAL_HOURS:-6}"
CRL_BOOTSTRAP_POLL_S="${CRL_BOOTSTRAP_POLL_S:-60}"
OPENXPKICLI="${OPENXPKICLI:-/usr/bin/openxpkicli}"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [crl-issue] $*"; }

if [ -z "${REALMS:-}" ]; then
  # Not fatal: refuse to guess a realm list, but stay alive so the operator sees
  # this line rather than a container that silently lacks a CRL loop.
  log "FATAL: REALMS not set — no realms to issue CRLs for; loop exiting"
  exit 0
fi

# ── Wait for the CA to be usable ────────────────────────────────────────────
# The realm's signer alias is registered by the realm bootstrap, which runs
# AFTER the daemon opens its socket. Asking for a CRL before that fails in a way
# that looks like a config error. Poll instead of failing: on a cold start this
# is a normal transient state, and hard-exiting here would take the CRL loop out
# for the lifetime of the container.
wait_for_ca() {
  realm="$1"
  while : ; do
    if "$OPENXPKICLI" --realm "$realm" get_ca_list >/dev/null 2>&1; then
      return 0
    fi
    log "  $realm: CA not ready yet — retry in ${CRL_BOOTSTRAP_POLL_S}s"
    sleep "$CRL_BOOTSTRAP_POLL_S"
  done
}

issue_for_realm() {
  realm="$1"
  out="$("$OPENXPKICLI" --realm "$realm" --arg workflow=crl_issuance \
        create_workflow_instance 2>&1)"
  rc=$?
  # Branch on the EXIT CODE, then report the workflow's own verdict. Matching on
  # output text alone would mistake a transport failure for a workflow outcome.
  if [ "$rc" -ne 0 ]; then
    log "  $realm: FAILED (rc=$rc) $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
    return 1
  fi
  state="$(printf '%s' "$out" | sed -n 's/.*"state" *: *"\([A-Z_]*\)".*/\1/p' | head -1)"
  serial="$(printf '%s' "$out" | sed -n 's/.*"crl_serial" *: *\([0-9]*\).*/\1/p' | head -1)"
  case "$state" in
    SUCCESS)  log "  $realm: issued + published (crl_serial=${serial:-?})" ;;
    # CANCELED is the healthy steady state, not an error: the existing CRL is
    # still outside its renewal window. Logging it plainly keeps "nothing to do"
    # visually distinct from "nothing happened".
    CANCELED) log "  $realm: still current — skip" ;;
    *)        log "  $realm: unexpected workflow state '${state:-unknown}'" ; return 1 ;;
  esac
  return 0
}

log "PKI CRL issuer: interval=${CRL_INTERVAL_HOURS}h realms=[${REALMS}]"

while : ; do
  for realm in $REALMS; do
    wait_for_ca "$realm"
    issue_for_realm "$realm" || true
  done
  sleep "$((CRL_INTERVAL_HOURS * 3600))"
done

#!/bin/sh
# =============================================================================
# agent-entrypoint.sh — NetBird agent wrapper s graceful empty-key handling
# =============================================================================
#
# Cold-start chicken-and-egg problém:
#   1. aisha-core / aisha-integration compose má netbird-agent service
#   2. Service vyžaduje NB_SETUP_KEY = NETBIRD_STACK_KEY_<HOST>
#   3. NETBIRD_STACK_KEY_* je placeholder (empty) v .env.coolify do prvního
#      úspěšného běhu netbird-bootstrap.sh (Phase 6 cold-startu)
#   4. Phase 5 (deploy waves) probíhá PŘED Phase 6 — peer agenti by selhali
#      na startup s "no setup key", takže celý stack by Coolify označil
#      jako exited:unhealthy a deploy wave by spadla.
#
# Tento wrapper:
#   • Když NB_SETUP_KEY je prázdné → log + idle (sleep) → kontejner je healthy,
#     stack se deploy-uje bez chyby. Phase 6 netbird-bootstrap.sh pak vyplní
#     stack-key a SYNC_COOLIFY=1 + REDEPLOY_AFTER_NETBIRD=1 trigger second-pass
#     redeploy → wrapper se spustí znovu, key je přítomný, exec netbird up.
#   • Když NB_SETUP_KEY je vyplněné → exec netbird up (normální chování).
#
# State-of-the-art rationale:
#   • Žádné hardcoded fallback klíče (security)
#   • Žádné silent retry loops uvnitř netbird CLI (visibility)
#   • Jasný log "pending bootstrap" pro operátora (debug-friendly)
#   • Healthcheck je doplněk — viz docker-compose pro kontrolu pending-state
#
# Vstupní env:
#   NB_SETUP_KEY        — netbird setup key (prázdné = pending)
#   NB_MANAGEMENT_URL   — URL netbird control plane
#   NB_HOSTNAME         — hostname pro registraci v netbird mesh
#   NB_PENDING_LOG_INTERVAL — sec mezi log heartbeats v pending stavu (default 300)
# =============================================================================

set -eu

PENDING_LOG_INTERVAL="${NB_PENDING_LOG_INTERVAL:-300}"

if [ -z "${NB_SETUP_KEY:-}" ]; then
  echo "[netbird-agent] NB_SETUP_KEY empty for hostname=${NB_HOSTNAME:-<unset>}"
  echo "[netbird-agent] State: PENDING_BOOTSTRAP — awaiting netbird-bootstrap.sh + redeploy."
  echo "[netbird-agent] Cold-start sequence: Phase 6 netbird-bootstrap fills NETBIRD_STACK_KEY_*"
  echo "[netbird-agent]   and triggers second-pass redeploy via SYNC_COOLIFY=1 + REDEPLOY_AFTER_NETBIRD=1."
  echo "[netbird-agent] Container stays running (healthy, idle) until that completes."

  # Termination handlers — Docker stop / Coolify redeploy must drain quickly.
  trap 'echo "[netbird-agent] received TERM — exiting idle"; exit 0' TERM INT

  # Heartbeat loop — periodic log keeps operators aware this state is intentional.
  # Sleep is in small intervals to react to signals quickly.
  while :; do
    elapsed=0
    while [ "$elapsed" -lt "$PENDING_LOG_INTERVAL" ]; do
      sleep 5
      elapsed=$((elapsed + 5))
    done
    echo "[netbird-agent] still pending bootstrap (NB_SETUP_KEY empty) — $(date -u +%FT%TZ)"
  done
fi

# Real start — delegate to netbird CLI. PATH inside netbirdio/netbird image
# resolves `netbird` to the daemon binary.
#
# Fail-fast pokud `netbird` není v PATH (image regression / wrong image): bez
# tohoto checku by `exec netbird` v některých /bin/sh implementacích (alpine
# busybox) padlo na "not found" ALE script by skončil exit 0 → container by
# byl mlčky "healthy" bez fungujícího netbirdu (false-pass).
if ! command -v netbird >/dev/null 2>&1; then
  echo "[netbird-agent] FATAL: 'netbird' binary not in PATH — wrong image? (expected netbirdio/netbird)" >&2
  exit 127
fi

echo "[netbird-agent] NB_SETUP_KEY present — enrolling as ${NB_HOSTNAME:-<unset>} via ${NB_MANAGEMENT_URL:-<unset>}"
exec netbird up \
  --foreground \
  --management-url "${NB_MANAGEMENT_URL}" \
  --setup-key "${NB_SETUP_KEY}" \
  --hostname "${NB_HOSTNAME}"

#!/bin/sh
# n8n-deploy-entrypoint.sh — one-shot in-cluster bootstrap for the n8n stack.
#
# Runs in the `n8n-workflow-init` service (Dockerfile.migrate image: node 22 +
# repo + scripts/deploy-workflows.mjs + n8n/workflows/*.json). Mirrors
# docker-migrate-entrypoint.sh discipline: set -eu, length-only diagnostics, a
# debug-hold escape, and — crucially — it NEVER aborts the n8n stack deploy
# (restart: "no", always exits 0). The workflow deploy is best-effort
# bootstrap; the platform is already up. The authoritative readiness signal is
# n8n itself (depends_on: service_healthy). Cold-start Step 6 verifies +
# self-heals from the host when a key is available.
#
# Why in-cluster: n8n 1.79 blocks programmatic public-API-key creation from
# outside. The supported headless mint (/rest/owner/setup → /rest/api-keys)
# requires reaching n8n directly at http://n8n:5678 — never through the
# oauth2-proxy edge, so no skip-auth route is opened. See
# scripts/n8n-bootstrap-apikey.mjs.

set -eu

APP_DIR="${APP_DIR:-/app}"
N8N_REST_URL="${N8N_REST_URL:-http://n8n:5678}"
KEY_OUT="${N8N_APIKEY_OUT:-/run/n8n/apikey}"
# Mapa pověření `typ::jméno → id`: zapíše ji provision-credentials (jediný
# zakladatel), čte deploy-workflows. Leží vedle klíče na tmpfs a po běhu se maže.
POVERENI_MAPA="$(dirname "$KEY_OUT")/povereni.json"
# Výsledek deploye. Inicializováno TADY, ne fallbackem na použití —
# `${VAR:-0}` by byl nový fallback nad prostředím (brána `zadny-fallback-nad-identitou`).
DEPLOY_RC=0

log() { printf '[n8n-deploy] %s\n' "$1"; }

cd "$APP_DIR" 2>/dev/null || cd / || true

if [ "${AISHA_N8N_DEPLOY_DEBUG_HOLD:-0}" = "1" ]; then
  log "AISHA_N8N_DEPLOY_DEBUG_HOLD=1 — holding (no bootstrap/deploy); exec into the container to debug."
  # Idle so the container stays inspectable, then exit clean.
  sleep 3600 || true
  exit 0
fi

# Výsledky jednotlivých kroků. Inicializováno TADY, ne fallbackem na použití —
# `${VAR:-0}` by byl nový fallback nad prostředím (brána `zadny-fallback-nad-identitou`).
KEY_RC=0
TYPY_RC=0
CRED_RC=0
CRED_LOG=/tmp/n8n-credentials.log
: > "$CRED_LOG"

# 1) Mint (or re-mint) the public API key in-cluster.
if node "${APP_DIR}/scripts/n8n-bootstrap-apikey.mjs" --out "$KEY_OUT"; then
  log "api-key bootstrap ok"
else
  # ⛔ TADY BYLO `exit 0` s odůvodněním „ať stack zůstane zdravý". To odůvodnění
  # je NEPRAVDIVÉ a je to změřené: `plugin-publish-init` v témže clusteru končil
  # kódem 1 dvanáct dní a appka `<fork>-core` u toho svítila `running:healthy`.
  # Init s `restart: "no"` a vypnutým healthcheckem stack neshodí ani při
  # nenulovém konci — tichý `exit 0` tedy nic nechránil, jen schoval, že do n8n
  # nedorazil ANI JEDEN z 93 workflowů.
  log "api-key bootstrap SELHAL — credentials ani workflowy se NEDORUČÍ."
  KEY_RC=1
fi
if [ "$KEY_RC" = "0" ] && [ ! -s "$KEY_OUT" ]; then
  log "žádný klíč v ${KEY_OUT} — credentials ani workflowy se NEDORUČÍ."
  KEY_RC=1
fi

# 1b) Zná běžící n8n typy uzlů a pověření, na které workflowy odkazují?
#     NAMĚŘENO 2026-09-17: n8n neznal žádný typ aisha* a nasazení hlásilo úspěch.
#     Seznamy typů jsou bez přihlášení, krok na klíči nezávisí.
if N8N_REST_URL="$N8N_REST_URL" node "${APP_DIR}/scripts/n8n/overit-typy.mjs"; then
  log "typy: n8n zná vše, na co workflowy odkazují"
else
  TYPY_RC=1
  log "typy: n8n NEZNÁ část typů (výpis výš) — workflowy s nimi padnou za běhu."
fi

if [ "$KEY_RC" = "0" ]; then
  RAW_KEY="$(cat "$KEY_OUT")"

  # 2) Credentials PŘED workflowy: deploy-workflows.mjs přemapovává pověření
  #    podle JMÉNA, takže workflow nahraný dřív než jeho pověření zůstane
  #    odkazovat do prázdna.
  #
  # ⛔ NAMĚŘENO 2026-09-13: na cestě cold-startu se credentials NEZAKLÁDALY
  # vůbec — provision-credentials.mjs volala jen CI úloha „Provision: n8n
  # Content", a ta bez secretů končí nulou. n8n tak nabíhal s workflowy, které
  # při prvním běhu padnou na chybějící pověření.
  log "provisioning credentials against ${N8N_REST_URL}"
  if [ -z "${POSTGREST_SERVICE_TOKEN:-}" ]; then
    # Tajemství platformy, ne vstup obsluhy: bez něj nevznikne pověření k PostgREST
    # a polovina workflowů je mrtvá. Fail-closed tady, u místa použití.
    log "POSTGREST_SERVICE_TOKEN je prázdný — pověření 'AISHA PostgREST' NEVZNIKNE."
    CRED_RC=1
  fi
  if N8N_URL="$N8N_REST_URL" N8N_API_KEY="$RAW_KEY" N8N_POVERENI_MAPA="$POVERENI_MAPA" node "${APP_DIR}/scripts/n8n/provision-credentials.mjs" >"$CRED_LOG" 2>&1; then
    log "credentials: skript doběhl"
  else
    CRED_RC=1
    log "credentials SELHALY (výpis níž)."
  fi
  cat "$CRED_LOG"

  # 3) Deploy WF_* workflows directly against the in-cluster n8n REST endpoint.
  log "deploying workflows against ${N8N_REST_URL} (keyLen=$(printf '%s' "$RAW_KEY" | wc -c | tr -d ' '))"
  if N8N_URL="$N8N_REST_URL" N8N_API_KEY="$RAW_KEY" N8N_POVERENI_MAPA="$POVERENI_MAPA" node "${APP_DIR}/scripts/deploy-workflows.mjs" --force; then
    log "workflow deploy ok"
  else
    DEPLOY_RC=1
    # ⛔ TÝŽ DŮVOD JAKO U BOOTSTRAPU VÝŠ. Tady se selhání zalogovalo a propadlo na
    # závěrečné `exit 0`. Naměřeno 2026-09-07: 66 z 93 workflowů se nenahrálo
    # a nasazení hlásilo úspěch.
    log "workflow deploy SELHAL — část workflowů se nenahrála (viz výpis výš)."
  fi
else
  # Bez klíče neproběhl ani jeden z kroků — verdikt to musí nést jako selhání.
  CRED_RC=1
  DEPLOY_RC=1
fi

# Klíč ani mapa pověření nesmí zůstat na disku ani po neúspěchu.
rm -f "$KEY_OUT" "$POVERENI_MAPA" 2>/dev/null || true

# 4) VERDIKT tam, kde ho někdo přečte (cold-start krok 6). Kód tohohle kontejneru
#    nečte nikdo — Coolify ho do stavu aplikace nepromítne.
VERDIKT_RC=0
node "${APP_DIR}/scripts/n8n/bootstrap-verdikt.mjs" --klic-rc "$KEY_RC" --typy-rc "$TYPY_RC" --credentials-rc "$CRED_RC" \
  --credentials-log "$CRED_LOG" --workflows-rc "$DEPLOY_RC" || VERDIKT_RC=1

CELKEM_RC=0
if [ "$KEY_RC" != "0" ] || [ "$TYPY_RC" != "0" ] || [ "$CRED_RC" != "0" ] || [ "$DEPLOY_RC" != "0" ] || [ "$VERDIKT_RC" != "0" ]; then
  CELKEM_RC=1
fi
exit "$CELKEM_RC"

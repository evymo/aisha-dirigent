#!/usr/bin/env bash
# =============================================================================
# diagnose-pki-coolify.sh — Diagnostika PKI deploy failure v Coolify
# =============================================================================
# Symptom: PKI deploy padá s `Error: network <random-id> declared as external,
# but could not be found`. Random ID není v repu — generuje ho Coolify.
#
# Hypotéza: PKI app v Coolify state má cached starší compose verzi (před
# commitem `3ec2616b` co sjednotil network names), kde Coolify dosadil
# per-project UUID místo `name: coolify`.
#
# Tento skript:
#   - Read-only diagnóza (žádné modifikace, žádné API DELETE/PATCH bez --fix)
#   - Detekuje stale state symptomy
#   - Navrhne recovery kroky (manual UI ops nebo --fix režim, který přes API
#     resetne docker_compose_raw → Coolify ho znovu načte z gitu)
#
# Spouští se z dev mašiny proti Coolify API.
#
# Usage:
#   bash scripts/diagnose-pki-coolify.sh                   # diagnostika only
#   bash scripts/diagnose-pki-coolify.sh --fix             # PATCH compose_raw na null → re-fetch z gitu
#   COOLIFY_HOST_SSH=user@coolify bash diagnose-pki-coolify.sh  # plus host docker checks
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'; N='\033[0m'; BOLD='\033[1m'; DIM='\033[2m'
ok()    { echo -e "  ${G}✓${N} $*"; }
fail()  { echo -e "  ${R}✗${N} $*"; }
warn()  { echo -e "  ${Y}⚠${N} $*"; }
info()  { echo -e "  ${B}ℹ${N} $*"; }
section(){ echo -e "\n${C}${BOLD}━━━ $* ━━━${N}"; }

FIX=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fix) FIX=1; shift ;;
    -h|--help) head -25 "$0" | tail -23; exit 0 ;;
    *) fail "Unknown option: $1"; exit 1 ;;
  esac
done

# Source creds — GUARD against unquoted multi-word secrets (COSMOS_SIGNER_MNEMONIC, a BIP39
# phrase) word-splitting under `set -e` and aborting the script; restore prior flags.
if [[ -f "$REPO_ROOT/.env-prod-backup" ]]; then
  _aisha_save="$-"; set +eu; set -a; . "$REPO_ROOT/.env-prod-backup" 2>/dev/null || true; set +a; case "$_aisha_save" in *e*) set -e;; esac; case "$_aisha_save" in *u*) set -u;; esac; unset _aisha_save
fi
COOLIFY_URL="${COOLIFY_URL:?COOLIFY_URL must be set}"
COOLIFY_API_KEY="${COOLIFY_API_KEY:-${COOLIFY_API_TOKEN:-}}"

if [[ -z "$COOLIFY_API_KEY" ]]; then
  fail "COOLIFY_API_KEY not set — diagnostika vyžaduje API access"
  exit 1
fi

coolify_api() {
  local method="$1" endpoint="$2"; shift 2
  curl -sS --max-time 30 \
    -X "$method" \
    -H "Authorization: Bearer $COOLIFY_API_KEY" \
    -H "Content-Type: application/json" \
    "${COOLIFY_URL}/api/v1${endpoint}" \
    "$@"
}

# ── Banner ──────────────────────────────────────────────────────────────────
echo -e "${C}${BOLD}╔══════════════════════════════════════════════════════════════╗${N}"
echo -e "${C}${BOLD}║  PKI Coolify State Diagnostic                                 ║${N}"
echo -e "${C}${BOLD}╚══════════════════════════════════════════════════════════════╝${N}"

# ── Find PKI app ────────────────────────────────────────────────────────────
section "1. Find PKI app v Coolify"

# ⛔ NAMĚŘENO 2026-08-25. Tady stálo `GET /applications` + výběr podle jména
# `test("^aisha-pki$|^pki$")`. Na sdíleném Coolify to je adresa BEZ VLASTNÍKA:
# skript si vybral `aisha-pki` UPSTREAM nájemníka (git_repository ukazoval na
# evymo-ai-orchestrator.git), přečetl jeho stav a v režimu `--fix` by mu poslal
# PATCH na `docker_compose_raw`. Diagnostika, která umí zapisovat, se nesmí ptát
# jménem — jméno s prefixem si může zvolit kdokoli.
#
# Identita je PROJEKT (+ prostředí), a repo na to má jeden domov:
# `coolify_our_applications` (scripts/lib/coolify-our-apps.sh), který používá
# doktor, deploy-init, story-init i sync. Prázdná odpověď z něj znamená
# NEZMĚŘENO, ne „projekt nemá aplikace" — proto se tu končí, ne pokračuje.
# shellcheck source=lib/coolify-our-apps.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/coolify-our-apps.sh"

apps=$(coolify_our_applications "${COOLIFY_URL}/api/v1" "$COOLIFY_API_KEY") || apps=""
if [[ -z "$apps" ]] || ! echo "$apps" | jq -e . >/dev/null 2>&1; then
  fail "Nepodařilo se zjistit, které aplikace jsou NAŠE (projekt/prostředí)."
  info "  Bez toho se nedá diagnostikovat: výběr podle jména by na sdíleném"
  info "  Coolify sáhl na cizího nájemníka — a v --fix režimu mu i zapsal."
  info "  Doplň COOLIFY_PROJECT_UUID (a COOLIFY_ENVIRONMENT, default production)."
  exit 1
fi

# Jméno aplikace SE SKLÁDÁ z identity instance, neopisuje se. Uvnitř vlastního
# projektu je pak sufix `-pki` jednoznačný.
pki_name="${APP_NAME_PREFIX:?identita instance — bez ní nelze určit, která PKI je naše}-pki"
pki_uuid=$(echo "$apps" | jq -r --arg n "$pki_name" '.[] | select(.name == $n) | .uuid' | head -1)
if [[ -z "$pki_uuid" ]] || [[ "$pki_uuid" == "null" ]]; then
  fail "PKI app '${pki_name}' není v našem projektu (neexistuje?)"
  info "Recovery: bash scripts/coolify-story-init.sh --manifest coolify/manifests/${APP_NAME_PREFIX}.manifest"
  exit 1
fi
ok "PKI app: ${pki_name} (UUID ${pki_uuid})"

# ── Inspect current state ──────────────────────────────────────────────────
section "2. Inspect docker_compose_location + raw state"

pki_full=$(coolify_api GET "/applications/$pki_uuid" 2>/dev/null)
compose_loc=$(echo "$pki_full" | jq -r '.docker_compose_location // "(missing)"')
raw_len=$(echo "$pki_full" | jq -r '(.docker_compose_raw // "") | length')
git_branch=$(echo "$pki_full" | jq -r '.git_branch // "(missing)"')
git_repo=$(echo "$pki_full" | jq -r '.git_repository // "(missing)"')
safe_git_repo=$(printf '%s' "$git_repo" | sed -E 's#(https?://)[^/@[:space:]]+@#\1<redacted>@#g')

info "docker_compose_location: $compose_loc"
info "docker_compose_raw size: ${raw_len} chars"
info "git_branch:              $git_branch"
info "git_repository:          $safe_git_repo"

if [[ "$compose_loc" == *"coolify-pki"* ]]; then
  ok "Compose location odpovídá PKI"
else
  fail "Compose location nesměřuje na PKI compose ($compose_loc)"
fi

# ── Check raw compose for stale network ID ────────────────────────────────
section "3. Detekce stale 'external network' v cached compose"

if [[ "$raw_len" -eq 0 ]]; then
  warn "docker_compose_raw je prázdný (NULL) — Coolify ho re-fetchne z gitu při příštím deploy"
  info "Pokud deploy padá s 'network not found', root cause je jinde"
elif [[ "$raw_len" -gt 0 ]]; then
  raw_compose=$(echo "$pki_full" | jq -r '.docker_compose_raw')
  # Hledat external network names pouze v top-level `networks:` bloku.
  # Nepoužívat globální grep na `name:` — volume names by false-positive
  # vypadaly jako stale network names.
  network_names=$(echo "$raw_compose" | awk '
    /^networks:/ { in_networks=1; next }
    /^[^[:space:]][^:]*:/ { if (in_networks) exit }
    in_networks && /^[[:space:]]+name:[[:space:]]+/ { print $2 }
  ' | sort -u)
  echo "  Networks defined in cached raw compose:"
  echo "$network_names" | sed 's/^/    /'
  if echo "$network_names" | grep -qvE "^(coolify|aisha|aisha-shared-net|aisha-livekit-net)$"; then
    fail "STALE STATE: cached raw compose obsahuje neznámé network names!"
    fail "  Toto pravděpodobně způsobuje 'declared as external, but could not be found'."
    info "  Recovery: --fix mode zavolá PATCH na docker_compose_raw=null → Coolify ho znovu načte z gitu"
    STALE=1
  else
    ok "Network names v cached compose vypadají sjednoceně"
    STALE=0
  fi
else
  STALE=0
fi

# ── Check coolify network on host (via SSH if available) ───────────────────
section "4. Coolify Docker network na hostiteli"

if [[ -n "${COOLIFY_HOST_SSH:-}" ]]; then
  if ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$COOLIFY_HOST_SSH" \
       "docker network inspect coolify --format '{{.Driver}} ({{len .Containers}} containers)'" 2>/dev/null > /tmp/pki-net-info; then
    ok "Network 'coolify' exists on host: $(cat /tmp/pki-net-info)"
  else
    fail "Network 'coolify' NEEXISTUJE na hostiteli ($COOLIFY_HOST_SSH)"
    info "  Fix: ssh $COOLIFY_HOST_SSH 'docker network create coolify --driver bridge'"
  fi
else
  warn "COOLIFY_HOST_SSH not set — cannot check 'coolify' network on host"
  info "  Manuálně: ssh <coolify-host> 'docker network inspect coolify'"
  info "  Pokud chybí: docker network create coolify --driver bridge"
fi

# ── Public pki-bridge route ────────────────────────────────────────────────
section "5. Public pki-bridge route"

# pki-bridge health endpoint — env-driven (no hardcoded hostname).
# Priority: explicit PKI_BRIDGE_HEALTH_URL → PKI_BRIDGE_URL + /health →
# derived from INTERNAL_TLD. Fail fast if none is configured.
if [[ -n "${PKI_BRIDGE_HEALTH_URL:-}" ]]; then
  pki_bridge_health_url="${PKI_BRIDGE_HEALTH_URL%/}"
elif [[ -n "${PKI_BRIDGE_URL:-}" ]]; then
  pki_bridge_health_url="${PKI_BRIDGE_URL%/}/health"
elif [[ -n "${INTERNAL_TLD:-}" ]]; then
  pki_bridge_health_url="https://pki-bridge.backend.${INTERNAL_TLD}/health"
else
  fail "pki-bridge health URL not configured — set PKI_BRIDGE_HEALTH_URL, PKI_BRIDGE_URL, or INTERNAL_TLD (env or .env-prod-backup)"
  exit 1
fi

bridge_code=$(curl -sS --max-time 15 -o /tmp/pki-bridge-health-body -w '%{http_code}' \
  "$pki_bridge_health_url" 2>/tmp/pki-bridge-health-err || true)
case "$bridge_code" in
  200)
    ok "pki-bridge /health route returns 200"
    ;;
  000|"")
    fail "pki-bridge /health unreachable: $(head -c 200 /tmp/pki-bridge-health-err 2>/dev/null)"
    ;;
  *)
    fail "pki-bridge /health returned HTTP $bridge_code: $(head -c 200 /tmp/pki-bridge-health-body 2>/dev/null)"
    info "  NetBird pki-init will fall back to self-signed cert until this route returns 200."
    ;;
esac

# ── --fix mode: reset docker_compose_raw → re-fetch from git ───────────────
if [[ "$FIX" -eq 1 ]] && [[ "${STALE:-0}" -eq 1 ]]; then
  section "5. FIX MODE — reset docker_compose_raw"

  warn "Toto provede PATCH na docker_compose_raw=null. Coolify pak při příštím deploy"
  warn "znovu načte compose z gitu (revision: $git_branch)."
  read -rp "  Pokračovat? [y/N]: " confirm
  if [[ "$confirm" != "y" ]] && [[ "$confirm" != "Y" ]]; then
    info "Fix přerušen."
    exit 0
  fi

  rc=$(coolify_api PATCH "/applications/$pki_uuid" -d '{"docker_compose_raw": null}' \
       -o /tmp/pki-fix-resp -w "%{http_code}")
  case "$rc" in
    200|201|204)
      ok "docker_compose_raw reset → Coolify znovu načte compose z gitu při dalším deploy"
      info "  Trigger: node scripts/aisha-redeploy.mjs --only=pki"
      ;;
    *)
      fail "API returned HTTP $rc: $(cat /tmp/pki-fix-resp 2>/dev/null | head -c 200)"
      exit 1
      ;;
  esac
fi

# ── Summary ─────────────────────────────────────────────────────────────────
section "Summary"
if [[ "${STALE:-0}" -eq 1 ]]; then
  warn "Stale state detected. Recovery options:"
  echo ""
  echo "  Option A — Auto fix (re-fetch z gitu):"
  echo "    bash scripts/diagnose-pki-coolify.sh --fix"
  echo ""
  echo "  Option B — Manual delete + recreate v Coolify UI:"
  echo "    1. Coolify UI → aisha-pki app → Settings → Delete"
  echo "    2. bash scripts/coolify-story-init.sh --manifest coolify/manifests/aisha.manifest"
  echo "    3. bash scripts/coolify-deploy-init.sh"
  echo "    4. node scripts/aisha-redeploy.mjs --only=pki"
  echo ""
  echo "  Option C — Skip & deploy z fresh state (destruktivní):"
  echo "    bash scripts/aisha-cold-start.sh --wipe"
else
  ok "Žádné zjevné stale state symptomy. Pokud deploy stále padá:"
  echo "    1. Ověř coolify network: docker network inspect coolify (na hostiteli)"
  echo "    2. Coolify logs: docker logs coolify (na hostiteli)"
  echo "    3. PKI deploy logs: Coolify UI → aisha-pki → Deployments"
fi

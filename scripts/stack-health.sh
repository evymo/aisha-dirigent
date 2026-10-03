#!/usr/bin/env bash
# =============================================================================
# stack-health.sh — Unified AISHA stack health check (production + local)
# =============================================================================
#
# Checks all AISHA platform services and reports status.
# Automatically detects environment: production vs local.
#
# Usage:
#   ./scripts/stack-health.sh              # Auto-detect environment
#   ./scripts/stack-health.sh --prod       # Force production check
#   ./scripts/stack-health.sh --local      # Force local check
#   ./scripts/stack-health.sh --json       # JSON output (for CI/scripts)
#   ./scripts/stack-health.sh --wait       # Wait until core services are healthy (60s timeout)
#
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Jediný domov verdiktu „žije to" — viz komentář v `check_service`.
PROBE_CLI="$SCRIPT_DIR/lib/routing-probe-cli.mjs"
[[ -f "$PROBE_CLI" ]] || { echo "FATAL: chybí $PROBE_CLI — verdikt nemá domov" >&2; exit 2; }

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Parse args ───────────────────────────────────────────────────────────────
MODE=""
JSON_OUTPUT=false
WAIT_MODE=false
WAIT_TIMEOUT=60

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod)   MODE="prod"; shift ;;
    --local)  MODE="local"; shift ;;
    --json)   JSON_OUTPUT=true; shift ;;
    --wait)   WAIT_MODE=true; shift ;;
    --timeout) WAIT_TIMEOUT="$2"; shift 2 ;;
    -h|--help) head -15 "$0" | tail -13; exit 0 ;;
    *)        echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Auto-detect environment ─────────────────────────────────────────────────
if [[ -z "$MODE" ]]; then
  # If the local gateway or Keycloak is reachable, prefer local mode.
  if curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:3001/health" >/dev/null 2>&1 ||
     curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:8080/realms/${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}/.well-known/openid-configuration" >/dev/null 2>&1; then
    MODE="local"
  else
    MODE="prod"
  fi
fi

# ── Endpoint configuration ──────────────────────────────────────────────────
if [[ "$MODE" == "prod" ]]; then
  # Compose the SAME env foundation cold-start uses: operator env
  # (.env-prod-backup) → topology resolver (*_DOMAIN SoT) → domains.env
  # composites. Makes `npm run stack:health:prod` standalone-runnable from a
  # fresh shell (config/domains.env alone is a template with empty values).
  # Fail-loud: the helper exits 2 when the resolver cannot run.
  # shellcheck source=lib/resolve-domains-env.sh
  . "$SCRIPT_DIR/lib/resolve-domains-env.sh"

  # Canonical post-zoning endpoints come from the topology resolver. Each
  # *_DOMAIN must be populated by the SoT — no literal fallbacks here.
  : "${API_DOMAIN:?API_DOMAIN required from topology resolver}"
  : "${APP_DOMAIN:?APP_DOMAIN required from topology resolver}"
  : "${KEYCLOAK_DOMAIN:?KEYCLOAK_DOMAIN required from topology resolver}"
  : "${N8N_DOMAIN:?N8N_DOMAIN required from topology resolver}"
  : "${LANGFUSE_DOMAIN:?LANGFUSE_DOMAIN required from topology resolver}"
  : "${NOCODB_DOMAIN:?NOCODB_DOMAIN required from topology resolver}"
  : "${APPSMITH_DOMAIN:?APPSMITH_DOMAIN required from topology resolver}"
  : "${PKI_DOMAIN:?PKI_DOMAIN required from topology resolver}"
  # ADRESA SE ŘÍDÍ STANOVISKEM.
  #
  # ⛔ NAMĚŘENO 2026-08-15: `--prod` z operátorova stroje hlásil 8/9 služeb
  # nemocných, protože se ptal na `*.mesh.aisha.internal`. Ta jména se zvenčí
  # nepřeloží NIKDY — ať stack žije, nebo ne. Verdikt byl červený bez ohledu
  # na skutečnost a operátor by musel vstoupit do mesh, aby se vůbec dozvěděl,
  # jak na tom je.
  #
  # Vnitřní jméno je DEKLARACE „tohle není pro vnějšek", takže volba tváře
  # nepotřebuje hádání: odsud se měří tvář, kterou topologie jako vnější
  # vydala. Kde žádná není, řekne sonda NEZMĚŘENO — a to je pravda, ne nemoc.
  #
  # Řetěz je čistě odvozený z výstupu resolveru (`<X>_DOMAIN_PUBLIC` →
  # `_DIRECT` → `_DOMAIN`), takže fork s jinou topologií dostane svou vlastní
  # odpověď bez jediné literální adresy tady.
  _vnejsi_tvar() {
    local zaklad="$1" verejna primy mesh
    eval "verejna=\${${zaklad}_DOMAIN_PUBLIC:-}"
    eval "primy=\${${zaklad}_DOMAIN_DIRECT:-}"
    eval "mesh=\${${zaklad}_DOMAIN:-}"
    printf '%s' "${verejna:-${primy:-$mesh}}"
  }
  # ⚠ `AISHA_API_URL` a `KEYCLOAK_URL` NEJSOU operátorské přepínače — jsou to
  # KOMPOZITY složené v `config/domains.env:197` z MESH tváře:
  #     AISHA_API_URL=https://${API_DOMAIN}
  # Kdyby se braly jako override, odvození podle stanoviště by se nikdy
  # nedostalo ke slovu (táž třída jako „vault je ozvěna výstupu"). Odvozená
  # tvář má proto přednost; kompozit slouží jen tam, kde topologie nevydala nic.
  API_BASE="https://$(_vnejsi_tvar API)"; API_BASE="${API_BASE:-${AISHA_API_URL}}"
  APP_URL="https://$(_vnejsi_tvar APP)"; APP_URL="${APP_URL:-${PUBLIC_SITE_URL}}"
  KC_URL="https://$(_vnejsi_tvar KEYCLOAK)"; KC_URL="${KC_URL:-${KEYCLOAK_URL}}"
  N8N_URL="https://$(_vnejsi_tvar N8N)"
  LANGFUSE_URL="https://$(_vnejsi_tvar LANGFUSE)"
  NOCODB_URL="https://$(_vnejsi_tvar NOCODB)"
  APPSMITH_URL="https://$(_vnejsi_tvar APPSMITH)"
  PKI_URL="https://$(_vnejsi_tvar PKI)"
else
  # Local: aisha/db + gateway + Keycloak/PKI. Override per service as needed.
  API_BASE="${AISHA_LOCAL_API_URL:-${AISHA_API_URL:-http://127.0.0.1:3001}}"
  APP_URL="${AISHA_LOCAL_APP_URL:-${PUBLIC_SITE_URL:-http://127.0.0.1:5173}}"
  KC_URL="${AISHA_LOCAL_KEYCLOAK_URL:-${KEYCLOAK_URL:-http://127.0.0.1:8080}}"
  N8N_URL="${AISHA_LOCAL_N8N_URL:-http://127.0.0.1:5678}"
  LANGFUSE_URL="${AISHA_LOCAL_LANGFUSE_URL:-http://127.0.0.1:3100}"
  NOCODB_URL="${AISHA_LOCAL_NOCODB_URL:-http://127.0.0.1:8085}"
  APPSMITH_URL="${AISHA_LOCAL_APPSMITH_URL:-http://127.0.0.1:8090}"
  PKI_URL="${AISHA_LOCAL_PKI_URL:-http://127.0.0.1:8081}"
fi

# ── Check function ───────────────────────────────────────────────────────────
TOTAL=0
HEALTHY=0
UNHEALTHY=0
SKIPPED=0
RESULTS=()

# Snapshot of running container names — populated once per run (local only).
# Used to skip preset-optional services whose container isn't deployed, so a
# subset preset (e.g. `minimum`) reports healthy when its DEPLOYED services are.
RUNNING=""

# Resolve the full namespaced container name for a basename pattern from the
# RUNNING snapshot (e.g. "aisha-n8n" → "aisha-local__aisha-n8n"). First match
# wins; empty if none. Stays line-based so a substring pattern resolves cleanly.
resolve_container_name() {
  local pattern="$1"
  local line
  while IFS= read -r line; do
    [[ "$line" == *"$pattern"* ]] && { printf '%s' "$line"; return; }
  done <<< "$RUNNING"
}

# Inspect a container's docker healthcheck status. Emits one of:
#   healthy | unhealthy | starting   — when a healthcheck is defined
#   none                             — container running but has no healthcheck
#   missing                          — container not found / docker unavailable
# The {{if .State.Health}} guard is REQUIRED: a bare .State.Health.Status on a
# container without a healthcheck raises a Go-template error, not an empty value.
container_health() {
  local cname="$1"
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$cname" 2>/dev/null || echo "missing"
}

check_service() {
  local name="$1"
  local url="$2"
  local expected_codes="${3:-200}"  # comma-separated acceptable codes
  local stack="${4:-core}"
  local container_pattern="${5:-}"   # optional: container basename to gate on (local only)

  TOTAL=$((TOTAL + 1))

  # Preset-awareness: for optional/per-preset services (non-empty pattern), if
  # the container is not running in local mode, mark absent and skip probing —
  # do NOT count it unhealthy. Core + Web pass no pattern → always checked.
  if [[ "$MODE" == "local" && -n "$container_pattern" ]] && [[ "$RUNNING" != *"$container_pattern"* ]]; then
    SKIPPED=$((SKIPPED + 1))
    if ! $JSON_OUTPUT; then
      echo -e "  ${DIM}○ ${name} (absent — container not running, skipped)${NC}"
    fi
    RESULTS+=("{\"name\":\"${name}\",\"url\":\"${url}\",\"status\":\"absent\",\"http_code\":\"\",\"stack\":\"${stack}\"}")
    return
  fi

  # Internal-but-running (local only): these optional services have NO host port
  # under the port-hygiene profile (only gateway/web/keycloak are exposed), so a
  # host HTTP probe would spuriously fail even though the service is up. When the
  # container IS running, judge it by its docker healthcheck instead. A passing
  # healthcheck ("healthy") is authoritative → healthy. If there's no healthcheck
  # ("none") or it's not yet passing ("unhealthy"/"starting"/"missing"), fall
  # through to the HTTP probe below as the fallback signal.
  if [[ "$MODE" == "local" && -n "$container_pattern" ]]; then
    local cname chealth
    cname="$(resolve_container_name "$container_pattern")"
    if [[ -n "$cname" ]]; then
      chealth="$(container_health "$cname")"
      if [[ "$chealth" == "healthy" ]]; then
        HEALTHY=$((HEALTHY + 1))
        if ! $JSON_OUTPUT; then
          echo -e "  ${GREEN}✓${NC} ${name} ${DIM}(container: ${chealth})${NC}"
        fi
        RESULTS+=("{\"name\":\"${name}\",\"url\":\"${url}\",\"status\":\"healthy\",\"http_code\":\"container:${chealth}\",\"stack\":\"${stack}\"}")
        return
      fi
    fi
  fi

  # Verdikt „žije to" má JEDEN domov — `scripts/lib/routing-probe.mjs` přes CLI.
  #
  # ⛔ Dřív tady stálo porovnání HOLÉHO stavového kódu proti `$expected_codes`.
  # Na hostu se search doménou s wildcardem to nestačí: neznámé jméno se
  # přeloží na síťovou appliance a ta odpoví přesměrováním, takže i mrtvá
  # služba vrátí „živý" kód. Kurátorovaný seznam kódů se NERUŠÍ — předává se
  # dál jako nárok; přibývá jen to, co kód sám říct neumí: že odpověď přišla
  # od služby.
  local probe_out probe_rc http_code duvod
  probe_out=$(node "$PROBE_CLI" --url="$url" --expect="$expected_codes" --timeout-ms=10000 2>&1) \
    && probe_rc=0 || probe_rc=$?
  http_code=$(printf '%s' "$probe_out" | cut -d'|' -f2)
  duvod=$(printf '%s' "$probe_out" | cut -d'|' -f3-)
  [[ "$http_code" =~ ^[0-9]{3}$ ]] || http_code="000"

  local status="unhealthy"
  case "$probe_rc" in
    0) status="healthy" ;;
    1) : ;;  # verdikt „není to důkaz o službě" — `duvod` říká proč
    3)
      # ⛔ NAMĚŘENO 2026-08-15: `--prod` se z operátorova stroje ptal na
      # `*.mesh.aisha.internal`. Ta jména se odsud nepřeloží NIKDY, ať stack
      # žije, nebo ne — a skript hlásil 8/9 nemocných. NEZMĚŘENO není nemoc.
      SKIPPED=$((SKIPPED + 1))
      if ! $JSON_OUTPUT; then
        echo -e "  ${DIM}○ ${name} (nezměřeno — ${duvod})${NC}"
      fi
      RESULTS+=("{\"name\":\"${name}\",\"url\":\"${url}\",\"status\":\"unmeasured\",\"http_code\":\"\",\"stack\":\"${stack}\"}")
      return
      ;;
    *)
      # Mlčení nástroje NENÍ měření (feedback_tool_failure_read_as_data).
      duvod="sonda sama selhala (exit ${probe_rc}): ${probe_out}"
      http_code="000"
      ;;
  esac

  if [[ "$status" == "healthy" ]]; then
    HEALTHY=$((HEALTHY + 1))
    if ! $JSON_OUTPUT; then
      echo -e "  ${GREEN}✓${NC} ${name} ${DIM}(${http_code})${NC}"
    fi
  else
    UNHEALTHY=$((UNHEALTHY + 1))
    if ! $JSON_OUTPUT; then
      echo -e "  ${RED}✗${NC} ${name} ${DIM}(${http_code}${duvod:+ — $duvod})${NC}"
    fi
  fi

  RESULTS+=("{\"name\":\"${name}\",\"url\":\"${url}\",\"status\":\"${status}\",\"http_code\":\"${http_code}\",\"stack\":\"${stack}\"}")
}

# ── Run checks ───────────────────────────────────────────────────────────────
run_checks() {
  TOTAL=0; HEALTHY=0; UNHEALTHY=0; SKIPPED=0; RESULTS=()

  # Capture running containers once (local only): subset presets (e.g. `minimum`)
  # deploy only a fraction of the catalogue, so optional services whose container
  # is absent must be skipped, not counted unhealthy. Names are namespaced
  # (aisha-local__aisha-keycloak), so a substring match on the basename works.
  if [[ "$MODE" == "local" ]]; then
    RUNNING="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
  fi

  if ! $JSON_OUTPUT; then
    echo -e "\n${CYAN}${BOLD}AISHA Stack Health — ${MODE} (enterprise stack)${NC}"
    echo -e "${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}\n"
    echo -e "${BOLD}Core (gateway + PostgREST + Keycloak):${NC}"
  fi

  # Core services: aisha-gateway (Node.js, services/gateway/) + PostgREST + Keycloak + RPC-only.
  # Core + Web are ALWAYS checked (no container pattern) — their absence is a real failure.
  check_service "aisha-gateway (API)"  "${API_BASE}/health"               "200"         "core"
  # PostgREST: 404 na kořeni je ZDRAVÝ stav, ne vada. Stack běží s
  # `PGRST_OPENAPI_MODE: ${PGRST_OPENAPI_MODE:-disabled}`, takže služba na `/`
  # odpovídá `PGRST126 Root endpoint metadata is disabled` — tedy sama, a tím
  # dokazuje, že žije a že přes bránu vede cesta. Nárok „200" byl proto trvale
  # červený (naměřeno 2026-09-05) a učil čtenáře přehlížet červenou.
  #
  # Přidat 404 je bezpečné: nerozroutovanou „výchozí 404 edge" zamítá
  # routing-probe ve své ZÁPORNÉ půlce, která běží PŘED porovnáním kódů a
  # očekáváním se přebít nedá. Kdyby tedy hostitele nechytil žádný router,
  # sonda spadne dál — 404 od PostgRESTu a 404 od edge nejsou totéž.
  check_service "PostgREST (REST)"     "${API_BASE}/rest/v1/"             "200,404"     "core"

  if ! $JSON_OUTPUT; then
    echo -e "\n${BOLD}Frontend:${NC}"
  fi
  check_service "Web App"              "${APP_URL}/"                      "200"         "web"
  # Studio check removed (replaced by new aisha-admin + web UI)

  if ! $JSON_OUTPUT; then
    echo -e "\n${BOLD}Identity:${NC}"
  fi
  # Optional/per-preset services: 5th arg = local container basename. When that
  # container isn't running (subset preset), the service is skipped, not failed.
  check_service "Keycloak (OIDC)"      "${KC_URL}/realms/${KEYCLOAK_REALM:?jméno realmu je identita instance — nedosazuje se}/.well-known/openid-configuration" "200" "keycloak"  "aisha-keycloak"
  check_service "PKI (OpenXPKI + aisha_auth)" "${PKI_URL}/" "200,302" "pki"    "aisha-pki"

  if ! $JSON_OUTPUT; then
    echo -e "\n${BOLD}Ecosystem:${NC}"
  fi
  check_service "n8n (Workflows)"      "${N8N_URL}/healthz"              "200"         "n8n"       "aisha-n8n"
  check_service "Langfuse (LLM Obs)"   "${LANGFUSE_URL}/"                "200,302"     "langfuse"  "aisha-langfuse"
  check_service "NocoDB"               "${NOCODB_URL}/"                  "200,302"     "admin"     "aisha-nocodb"
  check_service "Appsmith"             "${APPSMITH_URL}/"                "200,302"     "admin"     "aisha-appsmith"
}

# ── Wait mode ────────────────────────────────────────────────────────────────
if $WAIT_MODE; then
  elapsed=0
  while [[ $elapsed -lt $WAIT_TIMEOUT ]]; do
    run_checks
    if [[ $UNHEALTHY -eq 0 ]]; then
      echo -e "\n${GREEN}${BOLD}All services healthy after ${elapsed}s${NC}"
      exit 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    if ! $JSON_OUTPUT; then
      echo -e "\n${YELLOW}Waiting... (${elapsed}s/${WAIT_TIMEOUT}s)${NC}\n"
    fi
  done

  echo -e "\n${RED}${BOLD}Timeout: ${UNHEALTHY} services still unhealthy after ${WAIT_TIMEOUT}s${NC}"
  exit 1
fi

# ── Single check ─────────────────────────────────────────────────────────────
run_checks

# ── Summary ──────────────────────────────────────────────────────────────────
if $JSON_OUTPUT; then
  echo "{\"mode\":\"${MODE}\",\"total\":${TOTAL},\"healthy\":${HEALTHY},\"unhealthy\":${UNHEALTHY},\"skipped\":${SKIPPED},\"services\":[$(IFS=,; echo "${RESULTS[*]}")]}"
else
  echo ""
  if [[ $UNHEALTHY -eq 0 ]]; then
    if [[ $SKIPPED -gt 0 ]]; then
      # ⚠ POKRYTÍ SE ŘÍKÁ NAHLAS. „All healthy" u jedné změřené z devíti je
      # zelená proto, že nevidím — táž vada jako falešná červená, jen z druhé
      # strany (feedback_gates_green_because_invisible). Verdikt proto nikdy
      # nemluví o celku, když se celku nezeptal.
      echo -e "${GREEN}${BOLD}${HEALTHY}/${HEALTHY} změřených služeb zdravých${NC}" \
        "${DIM}— ale ${SKIPPED} z ${TOTAL} se odsud změřit nedalo, o těch tenhle běh NEŘÍKÁ NIC${NC}"
    else
      echo -e "${GREEN}${BOLD}All ${TOTAL} services healthy${NC}"
    fi
  else
    echo -e "${RED}${BOLD}${UNHEALTHY}/${TOTAL} services unhealthy${NC}"

    # Show per-stack summary for unhealthy services
    echo ""
    for r in "${RESULTS[@]}"; do
      status=$(echo "$r" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
      if [[ "$status" == "unhealthy" ]]; then
        name=$(echo "$r" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)
        stack=$(echo "$r" | grep -o '"stack":"[^"]*"' | cut -d'"' -f4)
        echo -e "  ${RED}↳${NC} ${name} ${DIM}(stack: ${stack})${NC}"
      fi
    done
  fi
fi

exit $UNHEALTHY

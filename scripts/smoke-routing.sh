#!/usr/bin/env bash
# =============================================================================
# smoke-routing.sh — Verify Coolify-deployed routes are live
# =============================================================================
# Probes every public endpoint and asserts a healthy HTTP response.
# Run after `patch-domains-and-redeploy.sh` or any cold-start.
#
# Usage:
#   ./scripts/smoke-routing.sh                         # full endpoint matrix
#   ./scripts/smoke-routing.sh --skip-public-aliases   # canonical routes only
#
# Exit codes:
#   0  all checks passed
#   1  one or more endpoints failed
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOMAINS_FILE="$PROJECT_ROOT/config/domains.env"
SKIP_PUBLIC_ALIASES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-public-aliases) SKIP_PUBLIC_ALIASES=true; shift ;;
    -h|--help) head -14 "$0" | tail -12; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# Compose the SAME env foundation cold-start uses: operator env
# (.env-prod-backup) → topology resolver (*_DOMAIN SoT) → domains.env
# composites. config/domains.env alone is a template (empty values), so this
# script must self-resolve to be standalone-runnable. Fail-loud inside.
if [[ ! -f "$DOMAINS_FILE" ]]; then
  echo "FATAL: $DOMAINS_FILE missing — cannot probe routes without domain SoT" >&2
  exit 2
fi
# shellcheck source=lib/resolve-domains-env.sh
. "$SCRIPT_DIR/lib/resolve-domains-env.sh"

# Every domain MUST come from the topology resolver (SoT). No literal
# fallbacks here — the script fails fast if a required var is missing.
# NOTE: STUDIO_DOMAIN (db.${PUBLIC_TLD}) is NOT required — that public route
# was intentionally dropped 2026-05-07 and was never probed here anyway.
: "${APP_DOMAIN:?APP_DOMAIN required from topology resolver}"
: "${API_DOMAIN:?API_DOMAIN required from topology resolver}"
: "${KEYCLOAK_DOMAIN:?KEYCLOAK_DOMAIN required from topology resolver}"
: "${LANGFUSE_DOMAIN:?LANGFUSE_DOMAIN required from topology resolver}"
: "${NOCODB_DOMAIN:?NOCODB_DOMAIN required from topology resolver}"
: "${APPSMITH_DOMAIN:?APPSMITH_DOMAIN required from topology resolver}"
: "${PKI_DOMAIN:?PKI_DOMAIN required from topology resolver}"
: "${PKI_BRIDGE_DOMAIN:?PKI_BRIDGE_DOMAIN required from topology resolver}"
: "${MATRIX_DOMAIN:?MATRIX_DOMAIN required from topology resolver}"
: "${ELEMENT_DOMAIN:?ELEMENT_DOMAIN required from topology resolver}"
: "${ELEMENT_CALL_DOMAIN:?ELEMENT_CALL_DOMAIN required from topology resolver}"
: "${N8N_DOMAIN:?N8N_DOMAIN required from topology resolver}"
: "${NETBIRD_DOMAIN:?NETBIRD_DOMAIN required from topology resolver}"
: "${REGISTRY_DOMAIN:?REGISTRY_DOMAIN required from topology resolver}"
: "${MCP_DOMAIN:?MCP_DOMAIN required from topology resolver}"
N8N_PUBLIC_DOMAIN="${N8N_PUBLIC_DOMAIN:-$MCP_DOMAIN}"
: "${DIRIGENT_DOMAIN:?DIRIGENT_DOMAIN required from topology resolver}"
: "${AUTH_DOMAIN_PUBLIC:?AUTH_DOMAIN_PUBLIC required from topology resolver}"
AUTH_PUBLIC_DOMAIN="${AUTH_PUBLIC_DOMAIN:-$AUTH_DOMAIN_PUBLIC}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0; FAIL=0; NEZMERENO=0
pass() { printf "  ${GREEN}✓${NC} %s\n" "$*"; ((PASS++)) || true; }
fail() { printf "  ${RED}✗${NC} %s\n" "$*"; ((FAIL++)) || true; }
warn() { printf "  ${YELLOW}⚠${NC} %s\n" "$*"; }

# Verdikt „žije to" má JEDEN domov — `scripts/lib/routing-probe.mjs` přes CLI.
#
# ⛔ Dřív tady stálo `[[ ",$want," == *",$code,"* ]]`, tedy porovnání HOLÉHO
# stavového kódu. Na hostu se search doménou s wildcardem je to slabé: neznámé
# jméno se přeloží na síťovou appliance a ta odpoví přesměrováním. Kontroly
# nocodb/appsmith/pki/mcp tu čekají `200,302` — 302 od appliance by tedy prošlo
# jako zdraví, i kdyby služba neběžela.
#
# Kurátorovaný nárok (`$want`) se NERUŠÍ — je bohatší než druh služby a předává
# se dál. Přibývá k němu jen to, co samotný kód říct neumí: že odpověď vůbec
# přišla od služby.
PROBE_CLI="$SCRIPT_DIR/lib/routing-probe-cli.mjs"
[[ -f "$PROBE_CLI" ]] || { echo "FATAL: chybí $PROBE_CLI — verdikt nemá domov" >&2; exit 2; }

check() {
  local name="$1" url="$2" want="$3" kind="${4:-http}"
  local out rc
  # `|| true` by spolklo i selhání nástroje; exit kód se proto čte zvlášť.
  out=$(node "$PROBE_CLI" --url="$url" --expect="$want" --kind="$kind" --timeout-ms=20000 2>&1) && rc=0 || rc=$?
  local code duvod
  code=$(printf '%s' "$out" | cut -d'|' -f2)
  duvod=$(printf '%s' "$out" | cut -d'|' -f3-)
  case "$rc" in
    0) pass "$name → ${code} (${url})" ;;
    1)
      # Verdikt, ne selhání nástroje — `reason` říká, PROČ to není důkaz.
      fail "$name → ${code}${duvod:+ — $duvod} (${url})"
      ;;
    3)
      # NEZMĚŘENO ≠ nemoc: hostitel, který se z principu zvenčí nepřekládá
      # (vnitřní jméno), se odsud změřit nedá. Tvrdit o něm cokoli by byla
      # červená bez nálezu — a operátora by to nutilo vstoupit do mesh, aby
      # se vůbec něco dozvěděl.
      warn "$name → NEZMĚŘENO (${duvod}) — ${url}"
      ((NEZMERENO++)) || true
      ;;
    *)
      # Mlčení nástroje NENÍ měření (feedback_tool_failure_read_as_data).
      fail "$name → sonda sama selhala (exit $rc): ${out} (${url})"
      ;;
  esac
}

echo "═══ Direct *.${INTERNAL_TLD} routes (Traefik) ═══"
check "gateway"   "https://${API_DOMAIN}/health"                              "200"
check "keycloak"  "https://${KEYCLOAK_DOMAIN}/health"                         "200"
check "langfuse"  "https://${LANGFUSE_DOMAIN}/api/public/health"              "200"
check "nocodb"    "https://${NOCODB_DOMAIN}/"                                 "200,302"
check "appsmith"  "https://${APPSMITH_DOMAIN}/"                               "200,302"
check "pki"       "https://${PKI_DOMAIN}/"                                    "200,302"
check "pki-bridge" "https://${PKI_BRIDGE_DOMAIN}/health"                       "200"
check "matrix"    "https://${MATRIX_DOMAIN}/_matrix/client/versions"          "200"
check "element"   "https://${ELEMENT_DOMAIN}/"                                "200"
check "call"      "https://${ELEMENT_CALL_DOMAIN}/"                           "200"
check "n8n"       "https://${N8N_DOMAIN}/healthz"                             "200"
# Optional faces (tier:optional services) — probed only when the resolver
# emitted a real hostname (absent/sentinel = service not in the profile).
if [[ -n "${LIVE_DOMAIN:-}" && "${LIVE_DOMAIN}" != *.invalid ]]; then
  check "ws-gateway" "https://${LIVE_DOMAIN}/health"                          "200"
fi
if [[ -n "${GATEWAY_DOMAIN:-}" && "${GATEWAY_DOMAIN}" != *.invalid ]]; then
  check "llm-gateway" "https://${GATEWAY_DOMAIN}/"                            "200"
fi
if [[ -n "${COMPANION_DOMAIN:-}" && "${COMPANION_DOMAIN}" != *.invalid ]]; then
  check "openclaw"  "https://${COMPANION_DOMAIN}/health"                      "200"
fi

if ! $SKIP_PUBLIC_ALIASES; then
  echo
  echo "═══ Production *.${PUBLIC_TLD} routes (Frontend edge-proxy) ═══"
  # Provided services exposed publicly via Frontend edge-proxy (mcp, api, dirigent
  # are aliases to the same backend services on backend). web is the SPA.
  # netbird and cache are independent stacks on frontend.
  # db.${PUBLIC_TLD} is INTENTIONALLY NOT here — pgAdmin is admin-only,
  # accessible via db.${INTERNAL_TLD} direct (see scripts/coolify-domain-doctor.mjs
  # comment for aisha-core/pgadmin-auth).
  check "web"       "https://${APP_DOMAIN}/"                                  "200"
  check "netbird"   "https://${NETBIRD_DOMAIN}/"                              "200"
  check "cache"     "https://${REGISTRY_DOMAIN}/v2/"                          "200,401"
  check "mcp"       "https://${N8N_PUBLIC_DOMAIN}/"                           "200,302"
  check "mcp-jsonrpc" "https://${N8N_PUBLIC_DOMAIN}/functions/v1/mcp-knowledge-server" "200"
  # api maps directly to gateway:3001 (no OAuth2 proxy), so /health is
  # public. dirigent + mcp share the same n8n OAuth2-proxied backend, so
  # /health goes through OAuth2 proxy → 302 to login. /healthz is in the
  # OAuth2 proxy bypass list and is the standard liveness probe path
  # (matches Coolify healthcheck convention).
  check "api-health"      "https://${API_DOMAIN_PUBLIC:?API_DOMAIN_PUBLIC required from config/domains.env}/health"     "200"
  check "dirigent-health" "https://${DIRIGENT_DOMAIN}/healthz"                      "200"
  # auth.${PUBLIC_TLD} → Caddy demux → KC at auth.${INTERNAL_TLD}. Realm
  # discovery endpoint is anonymous + cheap (no DB roundtrip beyond
  # realm cache lookup), perfect for an edge-proxy smoke check.
  check "auth-realm"      "https://${AUTH_PUBLIC_DOMAIN}/realms/${KEYCLOAK_REALM:?KEYCLOAK_REALM required}/.well-known/openid-configuration" "200"
  # Optional edge-fronted public faces — probed only when the resolver emitted
  # a real hostname (sentinel *.invalid = service not in the profile).
  if [[ -n "${LIVE_DOMAIN_PUBLIC:-}" && "${LIVE_DOMAIN_PUBLIC}" != *.invalid ]]; then
    check "live-public"      "https://${LIVE_DOMAIN_PUBLIC}/health"           "200"
  fi
  if [[ -n "${GATEWAY_DOMAIN_PUBLIC:-}" && "${GATEWAY_DOMAIN_PUBLIC}" != *.invalid ]]; then
    check "gateway-public"   "https://${GATEWAY_DOMAIN_PUBLIC}/"              "200"
  fi
  # Extranet — a tady je 200 VADA, ne úspěch.
  #
  # Se zapnutou bránou musí nepřihlášený dostat přesměrování na IdP. Když
  # dostane 200, znamená to, že server vydal JS bundle komukoli: brána buď
  # nestojí, nebo ji edge obešel. Z bundlu se dá přečíst struktura sekcí
  # i jména RPC, takže je to bezpečnostní vada, ne kosmetika — a bez téhle
  # sondy je NEVIDITELNÁ, protože povrch přitom vypadá zdravě.
  if [[ -n "${EXTRANET_DOMAIN_PUBLIC:-}" && "${EXTRANET_DOMAIN_PUBLIC}" != *.invalid ]]; then
    if [[ "${EXTRANET_AUTH_GATE:-0}" == "1" ]]; then
      check "extranet-brána"  "https://${EXTRANET_DOMAIN_PUBLIC}/"            "302,303,307"
    else
      check "extranet-public" "https://${EXTRANET_DOMAIN_PUBLIC}/"            "200"
    fi
  fi
  if [[ -n "${COMPANION_DOMAIN_PUBLIC:-}" && "${COMPANION_DOMAIN_PUBLIC}" != *.invalid ]]; then
    check "companion-public" "https://${COMPANION_DOMAIN_PUBLIC}/health"      "200"
  fi
fi

echo
# Pokrytí se říká NAHLAS. „All checks passed" u hrstky změřených je zelená
# proto, že nevidím — táž vada jako falešná červená, jen z druhé strany
# (feedback_gates_green_because_invisible).
_nezmereno_dovetek=""
(( NEZMERENO > 0 )) && _nezmereno_dovetek=" ${YELLOW}(+%d NEZMĚŘENO — o těch tenhle běh NEŘÍKÁ NIC)${NC}"
if (( FAIL > 0 )); then
  # shellcheck disable=SC2059
  printf "${RED}── %d failed, %d passed ──${NC}${_nezmereno_dovetek}\n" "$FAIL" "$PASS" ${NEZMERENO:+$NEZMERENO}
  exit 1
else
  # shellcheck disable=SC2059
  printf "${GREEN}── %d změřených prošlo ──${NC}${_nezmereno_dovetek}\n" "$PASS" ${NEZMERENO:+$NEZMERENO}
fi

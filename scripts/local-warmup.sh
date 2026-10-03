#!/usr/bin/env bash
# =============================================================================
# local-warmup.sh — Local "deploy" orchestrator (interactive / preset)
# =============================================================================
# Runs a chosen subset of the AISHA stack locally via plain Docker Compose.
# This is the local equivalent of a production deploy (using the same manifest
# and coolify compose files, with local deployment config from
# config/local-presets.mjs).
#
# No Coolify, no Traefik by default, no /etc/hosts edits.
#
# Workflow (analogous to cold-start / coolify-deploy-init + redeploy):
#   1. Select preset (or --apps) — this is the "target stack selection"
#   2. local-compose-gen.mjs (using local-presets as config source)
#      → generates the effective compose + dev envs
#   3. Create local network
#   4. docker compose up -d   (the "redeploy / bring up" step)
#   5. Optional extras (LLM etc.)
#
# After this, the stack is "deployed locally" with envs from the preset
# (the local equivalent of .env.coolify + per-app envs).
#
# Usage:
#   ./scripts/local-warmup.sh                      # interactive
#   ./scripts/local-warmup.sh --preset minimum
#   ./scripts/local-warmup.sh --preset optimum-llm
#   ./scripts/local-warmup.sh --apps core,keycloak # custom set (no preset)
#   ./scripts/local-warmup.sh --seed-profile dev   # dev=active dev content (default),
#                                                  # demo=test data, template=sablona (clean + auto web sablona)
#   ./scripts/local-warmup.sh --seed-domain cafe-shop  # explicit sablona from domains/templates/
#   ./scripts/local-warmup.sh --seed-profile template --seed-domain company-wiki
#   ./scripts/local-warmup.sh --status             # show running services
#   ./scripts/local-warmup.sh --down               # tear down
#   ./scripts/local-warmup.sh --dry-run            # generate but don't up
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GENERATED_COMPOSE="$REPO_ROOT/docker-compose.local.generated.json"
# Per-IMPLEMENTATION local stack namespace (project/network/prefix) — default
# must match scripts/lib/local-stack-name.mjs (parity enforced by the
# local-container-namespacing gate). One local instance per implementation;
# never touch other implementations' stacks (e.g. evymo's `aisha-local`).
NETWORK_NAME="${AISHA_LOCAL_STACK:-aisha-local}"

# ── Colors ──────────────────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'; N='\033[0m'; BOLD='\033[1m'
ok()    { echo -e "  ${G}✓${N} $*"; }
fail()  { echo -e "  ${R}✗${N} $*"; }
warn()  { echo -e "  ${Y}⚠${N} $*"; }
info()  { echo -e "  ${B}ℹ${N} $*"; }
banner(){ echo -e "\n${C}${BOLD}━━━ $* ━━━${N}"; }

# ── Args ────────────────────────────────────────────────────────────────────
PRESET=""
APPS=""
DRY_RUN=0
STATUS_ONLY=0
TEAR_DOWN=0
REGEN=0
SEED_PROFILE=""
SEED_DOMAIN=""
NON_INTERACTIVE=0
WAIT_HEALTHY=0
JSON_OUTPUT=0
HEALTH_TIMEOUT=120

while [[ $# -gt 0 ]]; do
  case "$1" in
    --preset)       PRESET="$2"; shift 2 ;;
    --apps)         APPS="$2"; shift 2 ;;
    --seed-profile) SEED_PROFILE="$2"; shift 2 ;;
    --seed-domain)  SEED_DOMAIN="$2"; shift 2 ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --regenerate|--regen) REGEN=1; shift ;;
    --status)       STATUS_ONLY=1; shift ;;
    --down)         TEAR_DOWN=1; shift ;;
    --non-interactive|--yes) NON_INTERACTIVE=1; shift ;;
    --wait)         WAIT_HEALTHY=1; shift ;;
    --health-timeout) HEALTH_TIMEOUT="$2"; shift 2 ;;
    --json)         JSON_OUTPUT=1; shift ;;
    -h|--help)      head -25 "$0" | tail -23; exit 0 ;;
    *)              fail "Unknown option: $1"; exit 1 ;;
  esac
done

# Treat a closed/non-TTY stdin as non-interactive too: a CI runner, an IDE
# child_process, or `</dev/null` must never block on the `read -rp` preset menu.
if [[ $NON_INTERACTIVE -eq 0 ]] && [[ ! -t 0 ]]; then
  NON_INTERACTIVE=1
fi

# Under --json we must keep stdout machine-parseable: route the human-readable
# banners/log lines to stderr so the only stdout line is the final JSON object.
if [[ $JSON_OUTPUT -eq 1 ]]; then
  ok()    { echo -e "  ${G}✓${N} $*" >&2; }
  fail()  { echo -e "  ${R}✗${N} $*" >&2; }
  warn()  { echo -e "  ${Y}⚠${N} $*" >&2; }
  info()  { echo -e "  ${B}ℹ${N} $*" >&2; }
  banner(){ echo -e "\n${C}${BOLD}━━━ $* ━━━${N}" >&2; }
fi

# Emit the single machine-readable JSON status line on stdout (only under --json).
# Args: <preset> <apps> <healthy:true|false> <gatewayUrl> <services-json-array>
emit_json() {
  [[ $JSON_OUTPUT -eq 1 ]] || return 0
  local preset="$1" apps="$2" healthy="$3" gateway="$4" services="$5"
  printf '{"preset":%s,"apps":%s,"composeFile":%s,"envFile":%s,"healthy":%s,"services":%s,"gatewayUrl":%s}\n' \
    "$(json_str "$preset")" \
    "$(json_str "$apps")" \
    "$(json_str "$GENERATED_COMPOSE")" \
    "$(json_str ".env.local.dev")" \
    "$healthy" \
    "${services:-[]}" \
    "$(json_str "$gateway")"
}

# JSON-encode a bare string (null when empty) without spawning node.
json_str() {
  local s="$1"
  if [[ -z "$s" ]]; then printf 'null'; return; fi
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

# Resolve the host-facing AISHA Gateway URL from the generated artifacts.
# Source-of-truth precedence:
#   1. The port-hygiene manifest agent A writes (if/when present) — authoritative.
#   2. VITE_AISHA_GATEWAY_URL in the generated .env.local.dev (compose-gen writes it).
#   3. The gateway service host-port mapping in the generated compose JSON.
#   4. Last-resort default that matches stack-health.sh's local gateway default.
resolve_gateway_url() {
  local manifest="$REPO_ROOT/.aisha/local-ports.json"
  local url=""

  if [[ -f "$manifest" ]] && command -v node >/dev/null 2>&1; then
    url="$(node -e '
      try {
        const m = require(process.argv[1]);
        const g = m.gatewayUrl || (m.services && m.services.gateway && m.services.gateway.url)
          || (m.ports && m.ports.gateway && ("http://localhost:" + m.ports.gateway));
        if (g) process.stdout.write(String(g));
      } catch { /* fall through */ }
    ' "$manifest" 2>/dev/null || true)"
  fi

  if [[ -z "$url" && -f "$REPO_ROOT/.env.local.dev" ]]; then
    url="$(grep -E '^VITE_AISHA_GATEWAY_URL=' "$REPO_ROOT/.env.local.dev" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  fi

  if [[ -z "$url" && -f "$GENERATED_COMPOSE" ]] && command -v node >/dev/null 2>&1; then
    url="$(node -e '
      try {
        const fs = require("fs");
        const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const g = (c.services || {}).gateway;
        const ports = (g && g.ports) || [];
        for (const p of ports) {
          const m = String(p).match(/^(?:[\d.]+:)?(\d+):/);
          if (m) { process.stdout.write("http://localhost:" + m[1]); break; }
        }
      } catch { /* fall through */ }
    ' "$GENERATED_COMPOSE" 2>/dev/null || true)"
  fi

  [[ -z "$url" ]] && url="http://localhost:3001"
  printf '%s' "$url"
}

# Pass seed profile + optional web sablona (AISHA_SEED_DOMAIN) to the generator.
# The generator writes them into .env.local.dev (loaded by docker compose --env-file).
# "dev" (default): active development content — lively/editable for dev work.
# "demo": classic demo/test data.
# "template" (sablona): clean/minimal content; when used, generator auto-defaults
#   AISHA_SEED_DOMAIN to one of our committed sablony (cafe-shop etc.) so the
#   public web gets a real template design via svc-web-artifact /seed-default.
# Explicit --seed-domain or AISHA_SEED_DOMAIN=... always wins.
# You can also just export the AISHA_* vars before running.
if [ -n "$SEED_PROFILE" ]; then
  export AISHA_SEED_PROFILE="$SEED_PROFILE"
  info "Using local seed profile: $SEED_PROFILE (dev=active dev content, demo=test data, template=sablona)"
fi
if [ -n "$SEED_DOMAIN" ]; then
  export AISHA_SEED_DOMAIN="$SEED_DOMAIN"
  info "Using web sablona: $SEED_DOMAIN (from domains/templates/)"
fi

# ── Preflight ───────────────────────────────────────────────────────────────
command -v docker >/dev/null || { fail "docker not installed"; exit 1; }
docker info >/dev/null 2>&1 || { fail "Docker daemon nedostupný (Docker Desktop běží?)"; exit 1; }
command -v node >/dev/null || { fail "node not installed (potřeba pro generator)"; exit 1; }
# Generator + lib use modern ESM/syntax — an old `node` on PATH (e.g. a stale
# nvm default) fails with cryptic SyntaxErrors. Enforce the repo Node (.nvmrc=22).
NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node $(node -v 2>/dev/null || echo '?') — generator vyžaduje Node ≥22 (viz .nvmrc). Spusť: nvm use 22 (nebo nvm install 22)"
  exit 1
fi

# ── Status mode ─────────────────────────────────────────────────────────────
if [[ $STATUS_ONLY -eq 1 ]]; then
  banner "AISHA local stack — status"
  if [[ ! -f "$GENERATED_COMPOSE" ]]; then
    warn "Žádný generated compose (běhal jsi local-warmup?)"
    exit 0
  fi
  docker compose --env-file .env.local.dev -f "$GENERATED_COMPOSE" ps
  echo ""
  info "Network:"
  docker network inspect "$NETWORK_NAME" --format '  {{.Name}} ({{.Driver}}, {{len .Containers}} containers)' 2>/dev/null \
    || warn "Network '$NETWORK_NAME' neexistuje"
  exit 0
fi

# ── Tear-down mode ──────────────────────────────────────────────────────────
if [[ $TEAR_DOWN -eq 1 ]]; then
  banner "AISHA local stack — tear-down"
  if [[ -f "$GENERATED_COMPOSE" ]]; then
    docker compose --env-file .env.local.dev -f "$GENERATED_COMPOSE" down -v --remove-orphans
    ok "Containers + volumes removed"
  else
    warn "Žádný generated compose — pravděpodobně už nic neběží"
  fi
  if docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
    docker network rm "$NETWORK_NAME" 2>/dev/null && ok "Network '$NETWORK_NAME' removed" \
      || warn "Network '$NETWORK_NAME' nelze smazat (možná ji ještě někdo používá)"
  fi
  exit 0
fi

# ── Non-interactive guard ───────────────────────────────────────────────────
# Under --non-interactive/--yes (or a non-TTY stdin) we must NEVER drop into the
# `read -rp` preset menu — that would hang a CI runner or an IDE child process
# forever. Fail fast with an actionable message instead.
if [[ -z "$PRESET" && -z "$APPS" && $NON_INTERACTIVE -eq 1 && $STATUS_ONLY -eq 0 && $TEAR_DOWN -eq 0 ]]; then
  fail "Non-interactive mode requires an explicit stack selection."
  info "Pass --preset <minimum|optimum|optimum-llm|full-light|full> or --apps <a,b,c>."
  info "Example: scripts/local-warmup.sh --preset optimum --seed-profile dev --non-interactive --wait --json"
  exit 2
fi

# ── Interactive prompt (pokud není preset/apps) ─────────────────────────────
if [[ -z "$PRESET" && -z "$APPS" ]]; then
  banner "AISHA Local Warmup"
  cat <<'EOF'

  Vyber preset:

   [1] minimum     — DB + Edge + Web app (~14 containers, lehké pro laptop)
   [2] optimum     — + Keycloak + n8n + Ragnarok RAG (~25 containers)
   [3] optimum+LLM — Optimum + lokální Ollama
   [4] full-light  — vše krom infra-only (pki/exec/ledger/registry) (~43 containers)
   [5] full        — Vše kromě netbird (~51 containers, 16+ GB RAM, vyžaduje Kata pro exec)
   [c] custom      — Vyber stacky ručně (oddělené čárkou)
   [q] quit

EOF
  read -rp "  Volba [1-5/c/q]: " choice
  case "$choice" in
    1) PRESET="minimum" ;;
    2) PRESET="optimum" ;;
    3) PRESET="optimum-llm" ;;
    4) PRESET="full-light" ;;
    5) PRESET="full" ;;
    c|C)
      cat <<'EOF'

  Dostupné apps (z coolify/manifests/aisha.manifest):
    registry, core, keycloak, pki, orchestration, messaging, observability,
    admin, integration, ledger, exec, edge, netbird

EOF
      read -rp "  Apps (např. core,keycloak,orchestration): " APPS
      [[ -z "$APPS" ]] && { fail "Žádné apps zadané"; exit 1; }
      ;;
    q|Q) info "Quit"; exit 0 ;;
    *) fail "Neplatná volba: $choice"; exit 1 ;;
  esac
fi

# ── Generate compose ─────────────────────────────────────────────────────────
# Reuse the already-generated artifacts ONLY for a bare `local-warmup` refresh
# (no app selection). When the developer explicitly names a --preset/--apps (or
# passes --regenerate), regenerate from current presets — otherwise a stale
# generated compose silently brings up the OLD app set, ignoring the request.
if [[ -f "$GENERATED_COMPOSE" && -f .env.local.dev && $DRY_RUN -eq 0 \
      && -z "$PRESET" && -z "$APPS" && $REGEN -eq 0 ]]; then
  info "Generated compose and .env.local.dev exist — reusing (idempotent refresh)."
  info "Pass --preset/--apps or --regenerate to rebuild for a different app set."

  # ── Sedí znovupoužitý stack na DNEŠNÍ compose? ────────────────────────────
  # Vygenerovaný soubor je už interpolovaný — `up` nad ním nic nedosazuje, takže
  # novou povinnou proměnnou (`${X:?}` přidané po pullu) nikdo nezachytí a stack
  # naběhne ve STARÉ podobě. Generátor si proto zapisuje, z čeho vznikl
  # (`x-aisha-zdroje`), a tady se ptá táž knihovna jako sync a CI před nasazením
  # (scripts/lib/povinne-promenne.mjs): dostal by dnešní compose z .env.local.dev
  # všechno, bez čeho spadne? Když ne, vygenerovaný stack je prokazatelně starší
  # než jeho zdroje.
  POVINNE_ARGS=()
  while IFS= read -r zdroj; do
    [[ -n "$zdroj" ]] && POVINNE_ARGS+=(--compose "$zdroj")
  done < <(node -e '
    try {
      const z = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))["x-aisha-zdroje"];
      if (Array.isArray(z)) process.stdout.write(z.join("\n"));
    } catch {}
  ' "$GENERATED_COMPOSE")
  if [[ ${#POVINNE_ARGS[@]} -eq 0 ]]; then
    warn "Vygenerovaný compose nenese x-aisha-zdroje (starší generátor) — shodu se zdroji NEMĚŘÍM."
    warn "  Spusť --regenerate, ať se to dá příště ověřit."
  elif ! POVINNE_VYSTUP=$(node "$SCRIPT_DIR/lib/povinne-promenne.mjs" "${POVINNE_ARGS[@]}" --env-file .env.local.dev 2>&1); then
    fail "Znovupoužitý stack je starší než jeho compose — dnešní compose chce proměnné, které .env.local.dev nemá:"
    printf '%s\n' "$POVINNE_VYSTUP" | grep -v '^✓' | sed 's/^/      /'
    fail "  Spusť: scripts/local-warmup.sh --regenerate"
    emit_json "$PRESET" "$APPS" "false" "$(resolve_gateway_url)" "[]"
    exit 1
  else
    ok "Znovupoužitý stack sedí na dnešní compose (povinné proměnné: .env.local.dev je má)"
  fi
else
  banner "Generating local compose"

  GEN_ARGS=()
  if [[ -n "$PRESET" ]]; then GEN_ARGS+=("--preset" "$PRESET"); fi
  if [[ -n "$APPS" ]]; then GEN_ARGS+=("--apps" "$APPS"); fi

  node "$SCRIPT_DIR/local-compose-gen.mjs" "${GEN_ARGS[@]}" || { fail "Generator failed"; exit 1; }
fi

# ── Dry-run exit ────────────────────────────────────────────────────────────
if [[ $DRY_RUN -eq 1 ]]; then
  banner "DRY-RUN done"
  info "Generated compose: $GENERATED_COMPOSE"
  info "Run: docker compose -f docker-compose.local.generated.json up -d"
  # In dry-run the stack is not up, so it cannot be healthy yet.
  emit_json "$PRESET" "$APPS" "false" "$(resolve_gateway_url)" "[]"
  exit 0
fi

# ── Ensure docker network ───────────────────────────────────────────────────
banner "Network setup"
if docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  ok "Network '$NETWORK_NAME' už existuje"
else
  docker network create "$NETWORK_NAME" --driver bridge >/dev/null
  ok "Network '$NETWORK_NAME' vytvořena"
fi

# ── Bring up stack ──────────────────────────────────────────────────────────
banner "Spouštím lokální stack"
info "docker compose -f $GENERATED_COMPOSE up -d"

if docker compose --env-file .env.local.dev -f "$GENERATED_COMPOSE" up -d; then
  ok "Stack běží"
else
  fail "docker compose up vrátilo non-zero exit"
  warn "Diagnostika: docker compose -f $GENERATED_COMPOSE logs --tail=50"
  # `up -d` failed → containers never came up; report unhealthy and bail.
  emit_json "$PRESET" "$APPS" "false" "$(resolve_gateway_url)" "[]"
  exit 1
fi

# ── LLM extras (optimum-llm preset) ─────────────────────────────────────────
if [[ "$PRESET" == "optimum-llm" ]]; then
  banner "LLM setup (Ollama auto-detect)"
  AUTO_SELECT="$SCRIPT_DIR/ai/auto-select.sh"
  if [[ -f "$AUTO_SELECT" ]]; then
    bash "$AUTO_SELECT" --install || warn "auto-select.sh vrátilo non-zero"
  else
    warn "$AUTO_SELECT not found — přeskakuji LLM setup"
  fi
fi

# ── Health gate ──────────────────────────────────────────────────────────────
# `docker compose up -d` only returns once containers are *created* — not once
# the stack is actually serving. Chain stack-health.sh so this script returns 0
# ONLY when the gateway/PostgREST/Keycloak/etc. are genuinely healthy. The health
# script's EXIT CODE is the authoritative signal (0 = healthy); its --wait/--json
# combo does not print a JSON summary, so we harvest the services array with a
# final single-shot --local --json pass and build our own status line.
GATEWAY_URL="$(resolve_gateway_url)"
HEALTHY="false"
SERVICES_JSON="[]"
HEALTH_SCRIPT="$SCRIPT_DIR/stack-health.sh"

# Give the chained stack-health.sh the REAL local endpoints. .env.local.dev is a docker-compose
# env-file, NOT shell-source-safe (e.g. COSMOS_SIGNER_MNEMONIC is a space-separated BIP39 mnemonic
# → `source` runs "abandon" as a command), so extract only the few values the health check needs
# line-by-line. Map the gen's VITE_* URLs — which carry the REAL port-hygiene-allocated ports
# (gateway/KC land on free ports ≠ the bare 3001/8080 defaults) — onto stack-health's AISHA_LOCAL_*.
if [[ -f "$REPO_ROOT/.env.local.dev" ]]; then
  _envval() { grep -E "^$1=" "$REPO_ROOT/.env.local.dev" 2>/dev/null | tail -1 | cut -d= -f2-; }
  __api="$(_envval VITE_AISHA_GATEWAY_URL)"
  __kc="$(_envval VITE_KC_URL)"
  __realm="$(_envval KEYCLOAK_REALM)"
  if [[ -n "$__api"   ]]; then export AISHA_LOCAL_API_URL="$__api"; fi
  if [[ -n "$__kc"    ]]; then export AISHA_LOCAL_KEYCLOAK_URL="$__kc"; fi
  if [[ -n "$__realm" ]]; then export KEYCLOAK_REALM="$__realm"; fi
fi

if [[ -f "$HEALTH_SCRIPT" ]]; then
  banner "Health check (stack-health.sh --local)"

  HEALTH_ARGS=(--local)
  if [[ $WAIT_HEALTHY -eq 1 ]]; then
    HEALTH_ARGS+=(--wait --timeout "$HEALTH_TIMEOUT")
    info "Waiting up to ${HEALTH_TIMEOUT}s for the stack to become healthy…"
  fi

  HEALTH_RC=0
  # Route the health script's human output to stderr so --json stdout stays clean.
  if bash "$HEALTH_SCRIPT" "${HEALTH_ARGS[@]}" >&2; then
    HEALTH_RC=0
  else
    HEALTH_RC=$?
  fi

  # Harvest the structured per-service results (single-shot JSON pass; the
  # --wait run above does not emit the JSON summary). Capture only stdout.
  HEALTH_JSON="$(bash "$HEALTH_SCRIPT" --local --json 2>/dev/null || true)"
  if [[ -n "$HEALTH_JSON" ]] && command -v node >/dev/null 2>&1; then
    SERVICES_JSON="$(node -e '
      let s = "";
      process.stdin.on("data", d => s += d);
      process.stdin.on("end", () => {
        try { process.stdout.write(JSON.stringify((JSON.parse(s).services) || [])); }
        catch { process.stdout.write("[]"); }
      });
    ' <<<"$HEALTH_JSON" 2>/dev/null || echo "[]")"
  fi

  if [[ $HEALTH_RC -eq 0 ]]; then
    HEALTHY="true"
    ok "Stack is healthy"
  else
    HEALTHY="false"
    fail "Stack is NOT healthy (stack-health.sh rc=$HEALTH_RC)"
  fi
else
  warn "stack-health.sh not found — skipping health gate (cannot confirm readiness)"
fi

# ── Done ────────────────────────────────────────────────────────────────────
banner "Done"
ok "Gateway: $GATEWAY_URL"
info "Status:    ./scripts/local-warmup.sh --status"
info "Tear down: ./scripts/local-warmup.sh --down"
info "Logs:      docker compose -f $GENERATED_COMPOSE logs -f <service>"
warn "VITE_* jsou BUILD-TIME (zapečené do web image při buildu). Po změně VITE_* v config/local-presets.mjs rebuilduj: docker compose -f $GENERATED_COMPOSE up -d --build web"

emit_json "$PRESET" "$APPS" "$HEALTHY" "$GATEWAY_URL" "$SERVICES_JSON"

# Propagate health: return 0 ONLY when the stack is actually healthy. When the
# health script was unavailable we leave the legacy success behavior (exit 0).
if [[ -f "$HEALTH_SCRIPT" && "$HEALTHY" != "true" ]]; then
  exit 1
fi
exit 0

#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# test-coolify-config.sh — Coolify App Deployment Config Validator
# ═══════════════════════════════════════════════════════════════════════════════
#
# Adapted for app-level Coolify deployment (NOT self-hosted Supabase).
# Architecture: migrate → deploy-functions → web (connects to external Supabase)
#
# Output is a structured REMEDIATION PLAN designed to instruct an AI coding
# agent (or human) to fix all issues according to embedded best practices.
#
# Usage:
#   ./scripts/test-coolify-config.sh                    # from project root
#   ./scripts/test-coolify-config.sh /path/to/project   # explicit project root
#   ./scripts/test-coolify-config.sh --agent             # agent-only output (markdown)
#   ./scripts/test-coolify-config.sh --agent /path       # both flags
#
# Modes:
#   Default:  Colored progress + Remediation Plan (markdown)
#   --agent:  Remediation Plan only (clean markdown, no ANSI colors)
#
# Exit code:
#   0 = all tests passed
#   1 = one or more critical tests failed
#
# ═══════════════════════════════════════════════════════════════════════════════
# NOTE: Do NOT use 'set -e' or 'set -o pipefail' here.
# grep returns exit code 1 when no match is found, which would kill the script.
set -u

# ─── Arguments ────────────────────────────────────────────────────────────────
AGENT_MODE=false
PROJECT_ROOT="$(pwd)"
for arg in "$@"; do
  case "$arg" in
    --agent) AGENT_MODE=true ;;
    *)       PROJECT_ROOT="$arg" ;;
  esac
done

# ─── Config: Auto-detect files ───────────────────────────────────────────────
COMPOSE_FILE=""
for candidate in \
  "$PROJECT_ROOT/docker-compose.coolify.yml" \
  "$PROJECT_ROOT/docker-compose.coolify.yaml" \
  "$PROJECT_ROOT/docker-compose.yml" \
  "$PROJECT_ROOT/docker-compose.yaml" \
  "$PROJECT_ROOT/compose.yml" \
  "$PROJECT_ROOT/compose.yaml"; do
  if [[ -f "$candidate" ]]; then
    COMPOSE_FILE="$candidate"
    break
  fi
done

DOCKERFILE="$PROJECT_ROOT/Dockerfile"
NGINX_CONF="$PROJECT_ROOT/docker/nginx.conf"
DEPLOY_SCRIPT="$PROJECT_ROOT/scripts/deploy-edge-functions.sh"
MIGRATE_SCRIPT="$PROJECT_ROOT/scripts/db/migrate.mjs"

# Relative paths for output
rel() {
  echo "${1#"$PROJECT_ROOT"/}"
}

COMPOSE_REL="$(rel "${COMPOSE_FILE:-docker-compose.coolify.yml}")"
DOCKERFILE_REL="$(rel "$DOCKERFILE")"
NGINX_REL="$(rel "$NGINX_CONF")"
DEPLOY_SCRIPT_REL="$(rel "$DEPLOY_SCRIPT")"

# ─── Colors (disabled in agent mode) ─────────────────────────────────────────
if [[ "$AGENT_MODE" == "true" ]]; then
  RED='' GREEN='' YELLOW='' CYAN='' BOLD='' NC=''
else
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  NC='\033[0m'
fi

# ─── Counters ─────────────────────────────────────────────────────────────────
PASS=0
FAIL=0
WARN=0
SKIP=0

# ─── Remediation accumulation ────────────────────────────────────────────────
CURRENT_FILE=""
FAIL_ITEMS=""
WARN_ITEMS=""
SKIP_ITEMS=""
FAIL_NUMBER=0
WARN_NUMBER=0

# ─── Helpers ──────────────────────────────────────────────────────────────────

pass() {
  ((PASS++))
  if [[ "$AGENT_MODE" != "true" ]]; then
    echo -e "  ${GREEN}✓${NC} $1"
  fi
}

fail() {
  ((FAIL++))
  ((FAIL_NUMBER++))
  local title="$1"
  local instruction="$2"

  if [[ "$AGENT_MODE" != "true" ]]; then
    echo -e "  ${RED}✗${NC} $title"
    echo -e "    ${YELLOW}FIX:${NC} $instruction"
  fi

  FAIL_ITEMS="${FAIL_ITEMS}
### Fix ${FAIL_NUMBER}. [${CURRENT_FILE}] ${title}

**Problem:** ${title}

**Action:** ${instruction}

**Verify:** After fixing, re-run this script and confirm this check passes.

---
"
}

warn() {
  ((WARN++))
  ((WARN_NUMBER++))
  local title="$1"
  local tip="$2"

  if [[ "$AGENT_MODE" != "true" ]]; then
    echo -e "  ${YELLOW}⚠${NC} $1"
    echo -e "    ${CYAN}TIP:${NC} $2"
  fi

  WARN_ITEMS="${WARN_ITEMS}
### Warning ${WARN_NUMBER}. [${CURRENT_FILE}] ${title}

**Observation:** ${title}

**Recommendation:** ${tip}

---
"
}

skip() {
  ((SKIP++))
  if [[ "$AGENT_MODE" != "true" ]]; then
    echo -e "  ${CYAN}○${NC} $1 (skipped — file not found)"
  fi

  SKIP_ITEMS="${SKIP_ITEMS}
- **${1}** — file not found, may need to be created
"
}

section() {
  if [[ "$AGENT_MODE" != "true" ]]; then
    echo ""
    echo -e "${BOLD}━━━ $1 ━━━${NC}"
  fi
}

file_exists() {
  [[ -f "$1" ]]
}

has_pattern() {
  grep -qE "$2" "$1" 2>/dev/null
}

count_pattern() {
  local count
  count=$(grep -cE "$2" "$1" 2>/dev/null) && echo "$count" || echo 0
}

extract_service() {
  local svc_name="$1"
  local file="$2"
  awk -v svc="  ${svc_name}:" '
    found && /^  [a-zA-Z]/ { exit }
    $0 ~ "^"svc { found=1 }
    found { print }
  ' "$file" 2>/dev/null || true
}

# ═══════════════════════════════════════════════════════════════════════════════
# TESTS START
# ═══════════════════════════════════════════════════════════════════════════════

if [[ "$AGENT_MODE" != "true" ]]; then
  echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║  Coolify App Deployment Config Validator                    ║${NC}"
  echo -e "${BOLD}║  Architecture: migrate → deploy-functions → web            ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo -e "  Project: ${CYAN}$PROJECT_ROOT${NC}"
  echo -e "  Date:    $(date +%Y-%m-%d\ %H:%M:%S)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 0. FILE EXISTENCE
# ═══════════════════════════════════════════════════════════════════════════════

section "0. Required files"
CURRENT_FILE="project root"

if [[ -z "$COMPOSE_FILE" ]]; then
  fail "Docker Compose file not found" \
    "Create docker-compose.coolify.yml in the project root."
  COMPOSE_FILE="$PROJECT_ROOT/docker-compose.coolify.yml"
  COMPOSE_REL="docker-compose.coolify.yml"
else
  pass "$COMPOSE_REL exists"
fi

REQUIRED_FILES=(
  "$DOCKERFILE:$DOCKERFILE_REL"
  "$NGINX_CONF:$(rel "$NGINX_CONF")"
)

for entry in "${REQUIRED_FILES[@]}"; do
  file="${entry%%:*}"
  name="${entry##*:}"
  if file_exists "$file"; then
    pass "$name exists"
  else
    fail "$name missing" \
      "Create $name — required for Coolify deployment"
  fi
done

OPTIONAL_FILES=(
  "$DEPLOY_SCRIPT:$DEPLOY_SCRIPT_REL"
)

for entry in "${OPTIONAL_FILES[@]}"; do
  file="${entry%%:*}"
  name="${entry##*:}"
  if file_exists "$file"; then
    pass "$name exists"
  else
    skip "$name"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# 1. DOCKER-COMPOSE: SERVICE STRUCTURE
# ═══════════════════════════════════════════════════════════════════════════════

section "1. Service structure"
CURRENT_FILE="$COMPOSE_REL"

if file_exists "$COMPOSE_FILE"; then

  # 1.1 Required services exist
  REQUIRED_SERVICES=("migrate" "web")
  for svc in "${REQUIRED_SERVICES[@]}"; do
    if has_pattern "$COMPOSE_FILE" "^  ${svc}:"; then
      pass "Service '$svc' defined"
    else
      fail "Missing service: $svc" \
        "Add '$svc' service to $COMPOSE_REL — required for Coolify deployment pipeline"
    fi
  done

  # 1.2 Optional but expected services
  OPTIONAL_SERVICES=("deploy-functions")
  for svc in "${OPTIONAL_SERVICES[@]}"; do
    if has_pattern "$COMPOSE_FILE" "^  ${svc}:"; then
      pass "Service '$svc' defined"
    else
      warn "Missing optional service: $svc" \
        "Consider adding '$svc' service for edge function deployment"
    fi
  done

else
  skip "Docker Compose file ($COMPOSE_REL)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 2. SERVICE DEPENDENCIES
# ═══════════════════════════════════════════════════════════════════════════════

section "2. Service dependencies"
CURRENT_FILE="$COMPOSE_REL"

if file_exists "$COMPOSE_FILE"; then

  # 2.1 web depends on migrate
  WEB_BLOCK=$(extract_service "web" "$COMPOSE_FILE")
  if echo "$WEB_BLOCK" | grep -q 'migrate'; then
    pass "web depends on migrate"
  else
    fail "web missing dependency on migrate" \
      "Add to web service: depends_on: migrate: condition: service_completed_successfully"
  fi

  # 2.2 web depends on deploy-functions (if service exists)
  if has_pattern "$COMPOSE_FILE" "^  deploy-functions:"; then
    if echo "$WEB_BLOCK" | grep -q 'deploy-functions'; then
      pass "web depends on deploy-functions"
    else
      warn "web missing dependency on deploy-functions" \
        "Add: depends_on: deploy-functions: condition: service_completed_successfully"
    fi
  fi

  # 2.3 Dependencies use service_completed_successfully
  if echo "$WEB_BLOCK" | grep -q 'service_completed_successfully'; then
    pass "Dependencies use service_completed_successfully"
  else
    fail "Dependencies should use service_completed_successfully" \
      "Use 'condition: service_completed_successfully' for migrate and deploy-functions dependencies — ensures they complete before web starts"
  fi

else
  skip "Docker Compose file ($COMPOSE_REL)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 3. HEALTHCHECKS
# ═══════════════════════════════════════════════════════════════════════════════

section "3. Service healthchecks"
CURRENT_FILE="$COMPOSE_REL"

if file_exists "$COMPOSE_FILE"; then

  # 3.1 web healthcheck
  WEB_BLOCK=$(extract_service "web" "$COMPOSE_FILE")
  if echo "$WEB_BLOCK" | grep -q 'healthcheck'; then
    pass "web has healthcheck"
    
    if echo "$WEB_BLOCK" | grep -qE 'wget.*127\.0\.0\.1.*80|curl.*127\.0\.0\.1.*80'; then
      pass "web healthcheck uses HTTP probe"
    else
      warn "web healthcheck may not use HTTP probe" \
        "Recommended: test: [\"CMD-SHELL\", \"wget -q -O /dev/null http://127.0.0.1:80/ || exit 1\"]"
    fi
  else
    fail "web missing healthcheck" \
      "Add healthcheck to web: test: [\"CMD-SHELL\", \"wget -q -O /dev/null http://127.0.0.1:80/ || exit 1\"] interval: 10s timeout: 3s retries: 6"
  fi

  # 3.2 migrate and deploy-functions should NOT have healthchecks (one-shot)
  for svc in "migrate" "deploy-functions"; do
    SVC_BLOCK=$(extract_service "$svc" "$COMPOSE_FILE")
    if echo "$SVC_BLOCK" | grep -q 'healthcheck'; then
      warn "$svc has healthcheck (one-shot services don't need it)" \
        "Remove healthcheck from $svc — it runs once and exits"
    else
      pass "$svc: no healthcheck (correct for one-shot service)"
    fi
  done

else
  skip "Docker Compose file ($COMPOSE_REL)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 4. DOCKERFILE STAGES
# ═══════════════════════════════════════════════════════════════════════════════

section "4. Dockerfile stages"
CURRENT_FILE="$DOCKERFILE_REL"

if file_exists "$DOCKERFILE"; then

  # 4.1 Required stages matching compose targets
  REQUIRED_STAGES=("deps" "builder" "migrator" "web")
  for stage in "${REQUIRED_STAGES[@]}"; do
    if has_pattern "$DOCKERFILE" "AS ${stage}\$|AS ${stage} "; then
      pass "Stage '$stage' exists"
    else
      fail "Missing Dockerfile stage: $stage" \
        "Add: FROM <base-image> AS $stage — required by docker-compose build targets"
    fi
  done

  # 4.2 Optional but expected stages
  OPTIONAL_STAGES=("functions-init" "functions")
  for stage in "${OPTIONAL_STAGES[@]}"; do
    if has_pattern "$DOCKERFILE" "AS ${stage}\$|AS ${stage} "; then
      pass "Stage '$stage' exists"
    else
      warn "Missing optional Dockerfile stage: $stage" \
        "Consider adding: FROM <base-image> AS $stage — used for edge function deployment"
    fi
  done

  # 4.3 web stage uses nginx
  WEB_FROM=$(grep -E 'FROM.*AS web' "$DOCKERFILE" | head -1)
  if echo "$WEB_FROM" | grep -qEi 'nginx'; then
    pass "web stage uses nginx image"
  else
    fail "web stage not based on nginx" \
      "Use: FROM nginx:<version>-alpine AS web — required for SPA serving"
  fi

  # 4.4 Vite build args declared
  VITE_ARGS=("VITE_AISHA_GATEWAY_URL" "VITE_AISHA_GATEWAY_KEY")
  for arg in "${VITE_ARGS[@]}"; do
    if has_pattern "$DOCKERFILE" "ARG $arg"; then
      pass "Build arg: $arg declared"
    else
      fail "Missing build arg: $arg" \
        "Add: ARG $arg — required for Vite to embed Supabase config into the bundle"
    fi
  done

  # 4.5 Node base image pinned
  NODE_IMAGE=$(grep -E '^FROM node:' "$DOCKERFILE" | head -1 || true)
  if echo "$NODE_IMAGE" | grep -qE 'node:[0-9]+'; then
    pass "Node image version pinned"
  else
    warn "Node image may not be version-pinned" \
      "Pin to specific major: FROM node:22-alpine (not node:latest or node:alpine)"
  fi

  # 4.6 nginx base image pinned
  NGINX_IMAGE=$(grep -E '^FROM nginx:' "$DOCKERFILE" | head -1 || true)
  if echo "$NGINX_IMAGE" | grep -qE 'nginx:[0-9]+'; then
    pass "Nginx image version pinned"
  else
    warn "Nginx image may not be version-pinned" \
      "Pin to specific version: FROM nginx:1.27-alpine"
  fi

  # 4.7 nginx.conf COPY exists
  if has_pattern "$DOCKERFILE" 'COPY.*nginx\.conf'; then
    pass "nginx.conf copied into web stage"
  else
    fail "nginx.conf not copied into web stage" \
      "Add: COPY docker/nginx.conf /etc/nginx/conf.d/default.conf — SPA routing requires custom nginx config"
  fi

  # 4.8 dist COPY from builder
  if has_pattern "$DOCKERFILE" 'COPY --from=builder.*/app/dist'; then
    pass "Built dist copied from builder stage"
  else
    fail "dist not copied from builder" \
      "Add: COPY --from=builder /app/dist ./ — the Vite build output must be in the web stage"
  fi

else
  skip "Dockerfile ($DOCKERFILE_REL)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 5. NETWORKING & SECURITY
# ═══════════════════════════════════════════════════════════════════════════════

section "5. Networking & security"
CURRENT_FILE="$COMPOSE_REL"

if file_exists "$COMPOSE_FILE"; then

  # 5.1 Internal network
  if has_pattern "$COMPOSE_FILE" 'internal:'; then
    pass "Internal network defined"
  else
    warn "No internal network" \
      "Add an 'internal:' network definition to docker-compose for service isolation"
  fi

  # 5.2 Only web should have Coolify labels
  TRAEFIK_SERVICES=$(grep -B 30 'coolify.managed\|traefik.enable' "$COMPOSE_FILE" | grep -oE '^  [a-z-]+:' | tr -d ' :' | sort -u || true)
  for svc in $TRAEFIK_SERVICES; do
    if [[ "$svc" == "web" ]]; then
      pass "Coolify labels on web (correct)"
    else
      warn "Coolify/Traefik labels on $svc" \
        "Only 'web' should have Coolify labels — migrate and deploy-functions are one-shot services"
    fi
  done

  # 5.3 web uses expose (not ports)
  if has_pattern "$COMPOSE_FILE" '^\s+ports:'; then
    warn "Uses 'ports:' (may expose services directly)" \
      "Use 'expose:' instead of 'ports:' — Coolify/Traefik handles external routing"
  fi

  WEB_BLOCK=$(extract_service "web" "$COMPOSE_FILE")
  if echo "$WEB_BLOCK" | grep -q 'expose:'; then
    pass "web uses expose (not ports)"
  else
    warn "web may not have expose declaration" \
      "Add: expose: - \"80\" — Coolify needs to know which port to route to"
  fi

  # 5.4 No hardcoded secrets
  SUSPICIOUS_SECRETS=$(grep -nE '(SECRET|PASSWORD|TOKEN|KEY): *[a-zA-Z0-9/+]{20,}' "$COMPOSE_FILE" | grep -v '\${' | head -5 || true)
  if [[ -n "$SUSPICIOUS_SECRETS" ]]; then
    fail "Potential hardcoded secrets found" \
      "Use \${VARIABLE} pattern for ALL secrets. Hardcoded secrets in docker-compose are visible in the repo"
  else
    pass "No obvious hardcoded secrets"
  fi

  # 5.5 Migration gate (RUN_DB_MIGRATIONS default off)
  MIGRATE_BLOCK=$(extract_service "migrate" "$COMPOSE_FILE")
  if echo "$MIGRATE_BLOCK" | grep -qE 'RUN_DB_MIGRATIONS.*false|RUN_DB_MIGRATIONS.*:-false'; then
    pass "Migration gate defaults to off (safe first deploy)"
  else
    warn "Migration gate may not default to off" \
      "Set RUN_DB_MIGRATIONS: \${RUN_DB_MIGRATIONS:-false} — prevents accidental migration on first deploy"
  fi

  # 5.6 Deploy-functions gate
  FUNCTIONS_BLOCK=$(extract_service "deploy-functions" "$COMPOSE_FILE")
  if echo "$FUNCTIONS_BLOCK" | grep -qE 'DEPLOY_EDGE_FUNCTIONS.*false|DEPLOY_EDGE_FUNCTIONS.*:-false'; then
    pass "Edge functions deploy gate defaults to off"
  else
    warn "Edge functions deploy gate may not default to off" \
      "Set DEPLOY_EDGE_FUNCTIONS: \${DEPLOY_EDGE_FUNCTIONS:-false}"
  fi

else
  skip "Docker Compose file ($COMPOSE_REL)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 6. NGINX CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

section "6. Nginx configuration"
CURRENT_FILE="$(rel "$NGINX_CONF")"

if file_exists "$NGINX_CONF"; then

  # 6.1 SPA routing (try_files with index.html fallback)
  if has_pattern "$NGINX_CONF" 'try_files.*\$uri.*index\.html'; then
    pass "SPA routing configured (try_files → index.html)"
  else
    fail "Missing SPA routing" \
      "Add: try_files \$uri \$uri/ /index.html; — required for client-side routing (React Router)"
  fi

  # 6.2 Gzip enabled
  if has_pattern "$NGINX_CONF" 'gzip on'; then
    pass "Gzip compression enabled"
  else
    warn "Gzip not enabled" \
      "Add: gzip on; gzip_types text/plain text/css application/json application/javascript; — reduces transfer size significantly"
  fi

  # 6.3 Asset caching
  if has_pattern "$NGINX_CONF" 'Cache-Control.*(immutable|max-age=31536000)'; then
    pass "Aggressive caching for hashed assets"
  else
    warn "Missing cache headers for assets" \
      "Add Cache-Control headers for /assets/ with max-age=31536000 and immutable flag"
  fi

  # 6.4 Security headers
  if has_pattern "$NGINX_CONF" '(X-Frame-Options|X-Content-Type-Options|Content-Security-Policy)'; then
    pass "Security headers present"
  else
    warn "Missing security headers" \
      "Consider adding: X-Frame-Options, X-Content-Type-Options, Content-Security-Policy headers"
  fi

else
  skip "Nginx configuration ($(rel "$NGINX_CONF"))"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 7. IMAGE VERSION PINNING
# ═══════════════════════════════════════════════════════════════════════════════

section "7. Image version pinning"
CURRENT_FILE="$COMPOSE_REL"

if file_exists "$COMPOSE_FILE"; then
  LATEST_IMAGES=$(grep -E 'image:.*:latest' "$COMPOSE_FILE" | head -5 || true)
  if [[ -n "$LATEST_IMAGES" ]]; then
    fail "Images using :latest tag" \
      "Pin ALL images to specific versions. :latest breaks reproducibility"
  else
    pass "No :latest image tags in compose"
  fi
fi

CURRENT_FILE="$DOCKERFILE_REL"
if file_exists "$DOCKERFILE"; then
  LATEST_IN_DF=$(grep -E '^FROM.*:latest' "$DOCKERFILE" | head -5 || true)
  if [[ -n "$LATEST_IN_DF" ]]; then
    fail "Dockerfile uses :latest tag" \
      "Pin ALL FROM images to specific versions"
  else
    pass "No :latest tags in Dockerfile"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 8. BUILD OPTIMIZATION
# ═══════════════════════════════════════════════════════════════════════════════

section "8. Build optimization"
CURRENT_FILE=".dockerignore"

DOCKERIGNORE="$PROJECT_ROOT/.dockerignore"
if file_exists "$DOCKERIGNORE"; then
  pass ".dockerignore exists"

  for pattern in "node_modules" ".git" "dist" "e2e"; do
    if has_pattern "$DOCKERIGNORE" "$pattern"; then
      pass ".dockerignore excludes $pattern"
    else
      warn ".dockerignore missing $pattern" \
        "Add '$pattern' to .dockerignore to speed up builds and prevent cache busting"
    fi
  done
else
  fail ".dockerignore missing" \
    "Create .dockerignore with: node_modules, .git, dist, e2e, *.log, docs/"
fi

# 8.2 Dockerfile layer caching
CURRENT_FILE="$DOCKERFILE_REL"
if file_exists "$DOCKERFILE"; then
  # package.json should be copied before full COPY . . for cache optimization
  PKG_COPY_LINE=$(grep -n 'COPY package' "$DOCKERFILE" | head -1 | cut -d: -f1 || echo 999)
  FULL_COPY_LINE=$(grep -n 'COPY \. \.' "$DOCKERFILE" | head -1 | cut -d: -f1 || echo 0)
  if [[ "$PKG_COPY_LINE" -lt "$FULL_COPY_LINE" ]]; then
    pass "Package files copied before source (layer caching)"
  else
    warn "Package files may not be cached efficiently" \
      "COPY package.json package-lock.json should come BEFORE COPY . . to leverage Docker layer caching"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 9. RESTART POLICIES
# ═══════════════════════════════════════════════════════════════════════════════

section "9. Restart policies"
CURRENT_FILE="$COMPOSE_REL"

if file_exists "$COMPOSE_FILE"; then

  # 9.1 web should restart
  WEB_BLOCK=$(extract_service "web" "$COMPOSE_FILE")
  if echo "$WEB_BLOCK" | grep -qE 'restart:.*unless-stopped|restart:.*always'; then
    pass "web has restart policy (unless-stopped or always)"
  else
    fail "web missing restart policy" \
      "Add: restart: unless-stopped — web should auto-restart on failure"
  fi

  # 9.2 One-shot services should not restart
  for svc in "migrate" "deploy-functions"; do
    SVC_BLOCK=$(extract_service "$svc" "$COMPOSE_FILE")
    if [[ -z "$SVC_BLOCK" ]]; then
      continue
    fi
    if echo "$SVC_BLOCK" | grep -qE 'restart:.*"no"|restart: "no"|restart: no$'; then
      pass "$svc has restart: \"no\" (correct for one-shot)"
    elif echo "$SVC_BLOCK" | grep -qE 'restart:'; then
      warn "$svc should not restart" \
        "Set restart: \"no\" for one-shot services like $svc"
    else
      warn "$svc has no explicit restart policy" \
        "Add: restart: \"no\" — one-shot services should not restart"
    fi
  done

else
  skip "Docker Compose file ($COMPOSE_REL)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 10. CROSS-FILE CONSISTENCY
# ═══════════════════════════════════════════════════════════════════════════════

section "10. Cross-file consistency"
CURRENT_FILE="$COMPOSE_REL + $DOCKERFILE_REL"

if file_exists "$COMPOSE_FILE" && file_exists "$DOCKERFILE"; then

  # 10.1 Compose build targets match Dockerfile stages
  COMPOSE_TARGETS=$(grep -oE 'target: [a-z_-]+' "$COMPOSE_FILE" | sed 's/target: //' | sort -u || true)
  for target in $COMPOSE_TARGETS; do
    if has_pattern "$DOCKERFILE" "AS ${target}\$|AS ${target} "; then
      pass "Compose target '$target' matches Dockerfile stage"
    else
      fail "Compose target '$target' has no matching Dockerfile stage" \
        "Add: FROM <base-image> AS $target — or fix the target name in $COMPOSE_REL"
    fi
  done

  # 10.2 Compose expose port matches Dockerfile EXPOSE
  COMPOSE_PORT=$(grep -A2 'expose:' "$COMPOSE_FILE" | grep -oE '[0-9]+' | head -1 || true)
  DF_PORT=$(grep -E '^EXPOSE' "$DOCKERFILE" | grep -oE '[0-9]+' | head -1 || true)
  if [[ -n "$COMPOSE_PORT" && -n "$DF_PORT" && "$COMPOSE_PORT" == "$DF_PORT" ]]; then
    pass "Exposed port consistent: compose=$COMPOSE_PORT, Dockerfile=$DF_PORT"
  elif [[ -n "$COMPOSE_PORT" && -n "$DF_PORT" ]]; then
    warn "Port mismatch: compose=$COMPOSE_PORT, Dockerfile=$DF_PORT" \
      "Ensure compose expose and Dockerfile EXPOSE use the same port"
  fi

  # 10.3 Vite build args in compose match Dockerfile ARGs
  COMPOSE_VITE_ARGS=$(grep -oE 'VITE_[A-Z_]+' "$COMPOSE_FILE" | sort -u || true)
  for arg in $COMPOSE_VITE_ARGS; do
    if has_pattern "$DOCKERFILE" "ARG $arg"; then
      pass "Compose build arg $arg declared in Dockerfile"
    else
      warn "Compose uses $arg but Dockerfile missing ARG $arg" \
        "Add: ARG $arg to Dockerfile builder stage"
    fi
  done

fi

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY (human-readable)
# ═══════════════════════════════════════════════════════════════════════════════

if [[ "$AGENT_MODE" != "true" ]]; then
  echo ""
  echo -e "${BOLD}━━━ SUMMARY ━━━${NC}"
  echo -e "  ${GREEN}Passed:${NC}  $PASS"
  echo -e "  ${RED}Failed:${NC}  $FAIL"
  echo -e "  ${YELLOW}Warnings:${NC} $WARN"
  echo -e "  ${CYAN}Skipped:${NC} $SKIP"
  echo ""

  if [[ $FAIL -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}All critical tests passed!${NC}"
    if [[ $WARN -gt 0 ]]; then
      echo -e "${YELLOW}Review warnings above for potential improvements.${NC}"
    fi
  else
    echo -e "${RED}${BOLD}$FAIL critical test(s) failed.${NC}"
  fi
  echo ""
  echo -e "${BOLD}━━━ REMEDIATION PLAN (below) ━━━${NC}"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# REMEDIATION PLAN (structured markdown — agent-consumable)
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "# COOLIFY APP DEPLOYMENT CONFIG — REMEDIATION PLAN"
echo ""
echo "> **Project:** \`$PROJECT_ROOT\`"
echo "> **Compose:** \`$COMPOSE_REL\`"
echo "> **Date:** $(date +%Y-%m-%d\ %H:%M:%S)"
echo "> **Result:** $FAIL critical, $WARN warnings, $PASS passed, $SKIP skipped"
echo ""

if [[ $FAIL -eq 0 && $WARN -eq 0 ]]; then
  echo "## ✅ ALL CHECKS PASSED"
  echo ""
  echo "No issues found. The Coolify deployment configuration is correct."
  echo ""
fi

if [[ $FAIL -gt 0 ]]; then
  echo "## CRITICAL FIXES (must be applied before deployment)"
  echo ""
  echo "Apply these fixes in order. Each fix includes the target file,"
  echo "a description of the problem, and exact instructions for resolution."
  echo ""
  echo "$FAIL_ITEMS"
fi

if [[ $WARN -gt 0 ]]; then
  echo "## WARNINGS (recommended improvements)"
  echo ""
  echo "These are not blocking but improve reliability and security."
  echo ""
  echo "$WARN_ITEMS"
fi

if [[ -n "$SKIP_ITEMS" ]]; then
  echo "## SKIPPED CHECKS (files not found)"
  echo ""
  echo "These files were not found:"
  echo ""
  echo "$SKIP_ITEMS"
  echo ""
fi

# ═══════════════════════════════════════════════════════════════════════════════
# BEST PRACTICES REFERENCE
# ═══════════════════════════════════════════════════════════════════════════════

if [[ $FAIL -gt 0 || $WARN -gt 0 ]]; then
  cat << 'BESTPRACTICES'

## BEST PRACTICES REFERENCE

### Architecture: App-Level Coolify Deployment

This project uses Coolify to deploy the **application** (not self-hosted Supabase).
Supabase runs separately (cloud or dedicated self-hosted instance).

```
┌─ docker-compose.coolify.yml ─────────────────────────────┐
│                                                           │
│  migrate (one-shot)  ─── runs DB migrations ──→ exits    │
│       │                                                   │
│  deploy-functions (one-shot) ─── deploys EFs ──→ exits   │
│       │                                                   │
│  web (long-running) ── nginx SPA ── Traefik → Internet   │
│                                                           │
└───────────────────────────────────────────────────────────┘
         │                    │
         └── connects to ─────┘
                │
          External Supabase
          (cloud / self-hosted)
```

### Dockerfile Multi-Stage Build

Required stages:
- `deps` — installs node_modules (cache layer)
- `builder` — builds Vite app + generates assets
- `migrator` — runs DB migrations via Node
- `functions` — deploys edge functions via Supabase CLI
- `functions-init` — copies edge function source to shared volume
- `web` — nginx serving built static files

### Service Dependencies

```
migrate (completed) ──┐
                      ├──► web (starts)
deploy-functions ─────┘
(completed)
```

### Docker Build Optimization

- `.dockerignore` must exclude: node_modules, .git, dist, e2e, docs/, *.log
- Copy package.json BEFORE source code for layer caching
- Pin ALL base image versions (no :latest)
- Use `expose:` (not `ports:`) — Coolify/Traefik handles routing

### Security

- ALL secrets via `${VARIABLE}` — never hardcoded in compose
- Migration and deploy gates default to off (safe first deploy)
- Only `web` gets Coolify/Traefik labels (public-facing)
- One-shot services use `restart: "no"`

### Nginx SPA Config

- `try_files $uri $uri/ /index.html;` for client-side routing
- Gzip compression for text/css/js/json
- Aggressive caching for `/assets/` (hashed filenames)
- Security headers (X-Frame-Options, X-Content-Type-Options)

### Verification Commands

```bash
# Re-run this validator
./scripts/test-coolify-config.sh

# Build all stages locally
docker compose -f docker-compose.coolify.yml build

# Verify compose config
docker compose -f docker-compose.coolify.yml config
```

BESTPRACTICES
fi

echo ""
echo "---"
echo ""
echo "> Re-run after fixes: \`./scripts/test-coolify-config.sh\` (human) or \`./scripts/test-coolify-config.sh --agent\` (agent-consumable)"

# ═══════════════════════════════════════════════════════════════════════════════
# EXIT
# ═══════════════════════════════════════════════════════════════════════════════

if [[ $FAIL -eq 0 ]]; then
  exit 0
else
  exit 1
fi

#!/usr/bin/env bash
# ==============================================================================
# coolify-server-onboard.sh — Automated Coolify server onboarding
# ==============================================================================
#
# Onboards a new server into the Evymo Coolify infrastructure:
#   1. Registers SSH key in Coolify
#   2. Creates server in Coolify
#   3. Validates Docker agent connectivity
#   4. Provisions stacks (if specified)
#   5. Installs Forgejo Actions runner (if role=backend)
#   6. Updates Forgejo secrets with new UUIDs
#
# Prerequisites:
#   - jq, curl, ssh-keygen installed
#   - COOLIFY_API_TOKEN set
#   - SSH access to target server (root)
#   - Target server has Docker installed
#
# Usage:
#   bash scripts/coolify-server-onboard.sh \
#     --name backend \
#     --ip <server-ip> \
#     --role backend \
#     --ssh-user root
#
#   # Dry run:
#   DRY_RUN=1 bash scripts/coolify-server-onboard.sh --name backend --ip <server-ip>
#
# Roles:
#   build    — Build server only (is_build_server=true, no stacks)
#   backend  — Internal runtime + optional Forgejo runner
#   staging  — Staging + project hosting
# ==============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()   { echo -e "${BLUE}ℹ${NC}  $*"; }
ok()     { echo -e "${GREEN}✅${NC} $*"; }
warn()   { echo -e "${YELLOW}⚠️${NC}  $*"; }
err()    { echo -e "${RED}❌${NC} $*" >&2; }
step()   { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

# ── Configuration ─────────────────────────────────────────────────────────────
COOLIFY_URL="${COOLIFY_URL:?COOLIFY_URL must be set}"
FORGEJO_URL="${FORGEJO_URL:?FORGEJO_URL required (e.g. https://git.<your-domain>)}"
# ⛔ ŽÁDNÝ FALLBACK (2026-08-24): dosazený donor ukazuje na CIZÍ repozitář.
FORGEJO_OWNER="${FORGEJO_OWNER:?FORGEJO_OWNER required — organizace je vlastnost projektu, nedosazuje se}"
FORGEJO_REPO="${FORGEJO_REPO:?FORGEJO_REPO required — repozitář je vlastnost projektu, nedosazuje se}"
DRY_RUN="${DRY_RUN:-0}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SERVERS_JSON="${PROJECT_ROOT}/coolify/servers.json"

# ── Argument parsing ──────────────────────────────────────────────────────────
SERVER_NAME=""
SERVER_IP=""
SERVER_ROLE="backend"
SSH_USER="root"
SSH_PORT="22"
INSTALL_RUNNER=false

while [ $# -gt 0 ]; do
  case "$1" in
    --name|-n)     SERVER_NAME="$2"; shift 2 ;;
    --ip|-i)       SERVER_IP="$2"; shift 2 ;;
    --role|-r)     SERVER_ROLE="$2"; shift 2 ;;
    --ssh-user)    SSH_USER="$2"; shift 2 ;;
    --ssh-port)    SSH_PORT="$2"; shift 2 ;;
    --runner)      INSTALL_RUNNER=true; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    --help|-h)
      echo "Usage: $0 --name <server> --ip <ip> [--role build|backend|staging] [--ssh-user root] [--runner] [--dry-run]"
      exit 0
      ;;
    *) err "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$SERVER_NAME" ] || [ -z "$SERVER_IP" ]; then
  err "Required: --name and --ip"
  echo "Usage: $0 --name <server> --ip <ip> [--role build|backend|staging]"
  exit 1
fi

# Auto-enable runner for backend role
[ "$SERVER_ROLE" = "backend" ] && INSTALL_RUNNER=true

# ── API helpers ───────────────────────────────────────────────────────────────
coolify_api() {
  local method="$1" endpoint="$2" data="${3:-}"
  local args=(-s -S --max-time 30 -X "$method"
    -H "Authorization: Bearer $COOLIFY_API_TOKEN"
    -H "Accept: application/json"
    -H "Content-Type: application/json")
  [ -n "$data" ] && args+=(-d "$data")
  curl "${args[@]}" "${COOLIFY_URL}/api/v1${endpoint}"
}

forgejo_api() {
  local method="$1" endpoint="$2" data="${3:-}"
  local args=(-s -S --max-time 30 -X "$method"
    -H "Authorization: token $FORGEJO_API_TOKEN"
    -H "Accept: application/json"
    -H "Content-Type: application/json")
  [ -n "$data" ] && args+=(-d "$data")
  curl "${args[@]}" "${FORGEJO_URL}/api/v1${endpoint}"
}

# ── Prerequisite checks ──────────────────────────────────────────────────────
step "Prerequisites"

for cmd in jq curl ssh-keygen; do
  command -v "$cmd" &>/dev/null || { err "${cmd} not installed"; exit 1; }
  ok "$cmd"
done

if [ -z "${COOLIFY_API_TOKEN:-}" ]; then
  err "COOLIFY_API_TOKEN not set"
  exit 1
fi
ok "COOLIFY_API_TOKEN"

if [ -z "${FORGEJO_API_TOKEN:-}" ]; then
  warn "FORGEJO_API_TOKEN not set — Forgejo secrets won't be updated"
fi

echo ""
info "Server:  ${SERVER_NAME} (${SERVER_IP})"
info "Role:    ${SERVER_ROLE}"
info "SSH:     ${SSH_USER}@${SERVER_IP}:${SSH_PORT}"
info "Runner:  ${INSTALL_RUNNER}"

if [ "$DRY_RUN" = "1" ]; then
  warn "DRY RUN — no changes will be made"
fi

# ── Step 1: SSH Key ──────────────────────────────────────────────────────────
step "1. SSH Key"

SSH_KEY_PATH="${HOME}/.ssh/coolify_${SERVER_NAME}"

if [ ! -f "$SSH_KEY_PATH" ]; then
  info "Generating SSH key: ${SSH_KEY_PATH}"
  if [ "$DRY_RUN" != "1" ]; then
    ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -C "coolify@${SERVER_NAME}"
    ok "SSH key generated"
  else
    info "[DRY RUN] Would generate SSH key"
  fi
else
  ok "SSH key already exists: ${SSH_KEY_PATH}"
fi

# Copy public key to server
if [ "$DRY_RUN" != "1" ] && [ -f "${SSH_KEY_PATH}.pub" ]; then
  info "Copying public key to ${SERVER_NAME}..."
  ssh-copy-id -i "${SSH_KEY_PATH}.pub" -p "$SSH_PORT" "${SSH_USER}@${SERVER_IP}" 2>/dev/null || \
    warn "ssh-copy-id failed — key may already be authorized"
fi

# Register key in Coolify
if [ "$DRY_RUN" != "1" ] && [ -f "$SSH_KEY_PATH" ]; then
  PRIVATE_KEY=$(cat "$SSH_KEY_PATH")
  KEY_PAYLOAD=$(jq -n \
    --arg name "coolify-${SERVER_NAME}" \
    --arg private_key "$PRIVATE_KEY" \
    --arg description "Auto-generated for ${SERVER_NAME} onboarding" \
    '{ name: $name, private_key: $private_key, description: $description }')

  KEY_RESULT=$(coolify_api POST "/security/keys" "$KEY_PAYLOAD" 2>/dev/null || echo '{}')
  KEY_UUID=$(echo "$KEY_RESULT" | jq -r '.uuid // empty' 2>/dev/null || true)

  if [ -n "$KEY_UUID" ]; then
    ok "SSH key registered in Coolify: ${KEY_UUID}"
  else
    warn "SSH key registration returned: $(echo "$KEY_RESULT" | jq -r '.message // "might already exist"' 2>/dev/null)"
    # Try to find existing key
    KEY_UUID=$(coolify_api GET "/security/keys" 2>/dev/null | \
      jq -r ".[] | select(.name == \"coolify-${SERVER_NAME}\") | .uuid // empty" 2>/dev/null || true)
    [ -n "$KEY_UUID" ] && ok "Found existing key: ${KEY_UUID}"
  fi
else
  info "[DRY RUN] Would register SSH key in Coolify"
  KEY_UUID="dry-run-key-uuid"
fi

# ── Step 2: Register Server ──────────────────────────────────────────────────
step "2. Register Server in Coolify"

IS_BUILD_SERVER=false
[ "$SERVER_ROLE" = "build" ] && IS_BUILD_SERVER=true

if [ "$DRY_RUN" != "1" ]; then
  SERVER_PAYLOAD=$(jq -n \
    --arg name "$SERVER_NAME" \
    --arg ip "$SERVER_IP" \
    --arg user "$SSH_USER" \
    --argjson port "$SSH_PORT" \
    --arg private_key_uuid "${KEY_UUID:-}" \
    --argjson is_build_server "$IS_BUILD_SERVER" \
    --arg description "Evymo ${SERVER_ROLE} server (auto-onboarded)" \
    '{
      name: $name,
      ip: $ip,
      user: $user,
      port: $port,
      private_key_uuid: $private_key_uuid,
      is_build_server: $is_build_server,
      description: $description
    }')

  SERVER_RESULT=$(coolify_api POST "/servers" "$SERVER_PAYLOAD" 2>/dev/null || echo '{}')
  SERVER_UUID=$(echo "$SERVER_RESULT" | jq -r '.uuid // empty' 2>/dev/null || true)

  if [ -n "$SERVER_UUID" ]; then
    ok "Server registered: ${SERVER_UUID}"
  else
    warn "Server registration returned: $(echo "$SERVER_RESULT" | jq -r '.message // "unknown"' 2>/dev/null)"
    # Try to find existing
    SERVER_UUID=$(coolify_api GET "/servers" 2>/dev/null | \
      jq -r ".[] | select(.name == \"${SERVER_NAME}\" or .ip == \"${SERVER_IP}\") | .uuid // empty" 2>/dev/null || true)
    [ -n "$SERVER_UUID" ] && ok "Found existing server: ${SERVER_UUID}"
  fi
else
  info "[DRY RUN] Would register server '${SERVER_NAME}' (${SERVER_IP}) as ${SERVER_ROLE}"
  SERVER_UUID="dry-run-server-uuid"
fi

# ── Step 3: Validate Server ──────────────────────────────────────────────────
step "3. Validate Docker Agent"

if [ "$DRY_RUN" != "1" ] && [ -n "$SERVER_UUID" ]; then
  VALIDATE_RESULT=$(coolify_api GET "/servers/${SERVER_UUID}/validate" 2>/dev/null || echo '{}')
  IS_VALID=$(echo "$VALIDATE_RESULT" | jq -r '.docker_installed // .message // "unknown"' 2>/dev/null || true)
  info "Validation result: ${IS_VALID}"

  # Also test direct SSH connectivity
  info "Testing SSH..."
  if ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
    -p "$SSH_PORT" -i "$SSH_KEY_PATH" "${SSH_USER}@${SERVER_IP}" \
    'docker --version' 2>/dev/null; then
    ok "Docker reachable on ${SERVER_NAME}"
  else
    warn "SSH/Docker test failed — Coolify may handle agent differently"
  fi
else
  info "[DRY RUN] Would validate server connectivity"
fi

# ── Step 4: Set Build Server Config ──────────────────────────────────────────
if [ "$SERVER_ROLE" = "build" ] && [ "$DRY_RUN" != "1" ] && [ -n "$SERVER_UUID" ]; then
  step "4. Configure Build Server"
  PATCH_RESULT=$(coolify_api PATCH "/servers/${SERVER_UUID}" \
    '{"settings": {"is_build_server": true, "concurrent_builds": 2}}' 2>/dev/null || echo '{}')
  ok "Build server settings applied"

  # ── Forgejo container-registry login (enables NATIVE private image pulls) ───
  # Coolify v4 has no registry-credential store and never runs `docker login`
  # during a deploy; it mounts the SSH user's ~/.docker/config.json into its
  # build/helper container (ApplicationDeploymentJob::prepare_builder_image).
  # So the build server itself must hold a login for our private Forgejo OCI
  # registry — reusing the SAME credential Coolify already uses to clone
  # (the FORGEJO_API_TOKEN as the 'aisha' user, valid for git AND the registry
  # on the same host). This is what lets Coolify pull repo.${INTERNAL_TLD}/aisha/*
  # images natively, with no pre-pull or pull_policy workarounds.
  # NOTE: must log in as the SAME user Coolify connects with (SSH_USER, default
  # root) so creds land in the home dir Coolify mounts (Coolify issue #6398).
  if [ -n "${FORGEJO_API_TOKEN:-}" ]; then
    REGISTRY_HOST="${FORGEJO_URL#*://}"; REGISTRY_HOST="${REGISTRY_HOST%%/*}"
    info "Configuring Forgejo registry login on ${SERVER_NAME} (${REGISTRY_HOST}, user ${FORGEJO_OWNER})..."
    if printf '%s' "$FORGEJO_API_TOKEN" | ssh -o ConnectTimeout=30 -o StrictHostKeyChecking=accept-new \
         -p "$SSH_PORT" -i "$SSH_KEY_PATH" "${SSH_USER}@${SERVER_IP}" \
         "docker login '${REGISTRY_HOST}' -u '${FORGEJO_OWNER}' --password-stdin" >/dev/null 2>&1; then
      ok "Registry login stored in ${SSH_USER}'s ~/.docker/config.json → Coolify pulls private images natively"
    else
      warn "Registry login failed (non-fatal). Private image pulls will 401 until you run, as ${SSH_USER} on ${SERVER_NAME}:"
      warn "  printf '%s' \"\$FORGEJO_API_TOKEN\" | docker login ${REGISTRY_HOST} -u ${FORGEJO_OWNER} --password-stdin"
    fi
  else
    warn "FORGEJO_API_TOKEN not set — skipping registry login; private image pulls will need a manual 'docker login'"
  fi
fi

# ── Step 5: Install Forgejo Runner ───────────────────────────────────────────
if [ "$INSTALL_RUNNER" = true ]; then
  step "5. Forgejo Actions Runner"

  if [ "$DRY_RUN" != "1" ]; then
    info "Installing act_runner on ${SERVER_NAME} via SSH..."

    # Get runner registration token from Forgejo
    if [ -n "${FORGEJO_API_TOKEN:-}" ]; then
      RUNNER_TOKEN_RESULT=$(forgejo_api GET "/repos/${FORGEJO_OWNER}/${FORGEJO_REPO}/actions/runners/registration-token" 2>/dev/null || echo '{}')
      RUNNER_TOKEN=$(echo "$RUNNER_TOKEN_RESULT" | jq -r '.token // empty' 2>/dev/null || true)

      if [ -n "$RUNNER_TOKEN" ]; then
        ok "Runner registration token obtained"

        ssh -o ConnectTimeout=30 -p "$SSH_PORT" -i "$SSH_KEY_PATH" "${SSH_USER}@${SERVER_IP}" bash <<RUNNER_INSTALL
#!/bin/bash
set -e

# Install act_runner if not present
if ! command -v act_runner &>/dev/null && [ ! -f /usr/local/bin/act_runner ]; then
  echo "Installing act_runner..."
  RUNNER_VERSION="0.2.11"
  ARCH=\$(uname -m)
  [ "\$ARCH" = "x86_64" ] && ARCH="amd64"
  [ "\$ARCH" = "aarch64" ] && ARCH="arm64"
  curl -fsSL "https://dl.gitea.com/act_runner/\${RUNNER_VERSION}/act_runner-\${RUNNER_VERSION}-linux-\${ARCH}" -o /usr/local/bin/act_runner
  chmod +x /usr/local/bin/act_runner
  echo "act_runner installed"
fi

# Register runner
mkdir -p /opt/forgejo-runner
cd /opt/forgejo-runner

act_runner register --no-interactive \
  --instance "${FORGEJO_URL}" \
  --token "${RUNNER_TOKEN}" \
  --name "${SERVER_NAME}-runner" \
  --labels "ubuntu-latest:docker://node:22" 2>/dev/null || echo "Runner may already be registered"

# Create systemd service
cat > /etc/systemd/system/forgejo-runner.service <<'EOF'
[Unit]
Description=Forgejo Actions Runner
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/forgejo-runner
ExecStart=/usr/local/bin/act_runner daemon
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable forgejo-runner
systemctl start forgejo-runner
echo "Forgejo runner installed and started"
RUNNER_INSTALL

        ok "Forgejo runner installed on ${SERVER_NAME}"
      else
        warn "Could not get runner registration token — install manually"
      fi
    else
      warn "FORGEJO_API_TOKEN not set — skipping runner installation"
    fi
  else
    info "[DRY RUN] Would install Forgejo Actions runner on ${SERVER_NAME}"
  fi
fi

# ── Step 6: Update Forgejo Secrets ───────────────────────────────────────────
step "6. Update Forgejo Secrets"

if [ -n "${FORGEJO_API_TOKEN:-}" ] && [ -n "$SERVER_UUID" ]; then
  SECRET_NAME="COOLIFY_SERVER_UUID_$(echo "$SERVER_NAME" | tr '[:lower:]' '[:upper:]')"

  if [ "$DRY_RUN" != "1" ]; then
    SECRET_PAYLOAD=$(jq -n --arg data "$SERVER_UUID" '{ data: $data }')
    forgejo_api PUT "/repos/${FORGEJO_OWNER}/${FORGEJO_REPO}/actions/secrets/${SECRET_NAME}" \
      "$SECRET_PAYLOAD" &>/dev/null

    ok "Forgejo secret ${SECRET_NAME} = ${SERVER_UUID}"
  else
    info "[DRY RUN] Would set Forgejo secret ${SECRET_NAME} = ${SERVER_UUID}"
  fi
else
  warn "Skipping Forgejo secrets (missing token or UUID)"
fi

# ── Step 7: Update servers.json ──────────────────────────────────────────────
step "7. Update servers.json"

if [ -f "$SERVERS_JSON" ] && [ -n "$SERVER_UUID" ] && [ "$DRY_RUN" != "1" ]; then
  # Update the coolify_uuid placeholder
  PLACEHOLDER="\${COOLIFY_SERVER_UUID_$(echo "$SERVER_NAME" | tr '[:lower:]' '[:upper:]')}"
  if grep -q "$PLACEHOLDER" "$SERVERS_JSON" 2>/dev/null; then
    sed -i.bak "s|${PLACEHOLDER}|${SERVER_UUID}|g" "$SERVERS_JSON"
    rm -f "${SERVERS_JSON}.bak"
    ok "servers.json updated: ${SERVER_NAME} UUID → ${SERVER_UUID}"
  fi

  # Update IP placeholder
  IP_PLACEHOLDER="\${$(echo "${SERVER_NAME}_IP" | tr '[:lower:]' '[:upper:]')}"
  if grep -q "$IP_PLACEHOLDER" "$SERVERS_JSON" 2>/dev/null; then
    sed -i.bak "s|${IP_PLACEHOLDER}|${SERVER_IP}|g" "$SERVERS_JSON"
    rm -f "${SERVERS_JSON}.bak"
    ok "servers.json updated: ${SERVER_NAME} IP → ${SERVER_IP}"
  fi
else
  info "[DRY RUN] Would update servers.json"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
step "Summary"
echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│          Server Onboarding — ${SERVER_NAME}                        │"
echo "├─────────────────────────────────────────────────────────────┤"
printf "│  Name:     %-47s │\n" "$SERVER_NAME"
printf "│  IP:       %-47s │\n" "$SERVER_IP"
printf "│  Role:     %-47s │\n" "$SERVER_ROLE"
printf "│  UUID:     %-47s │\n" "${SERVER_UUID:-unknown}"
printf "│  Runner:   %-47s │\n" "$INSTALL_RUNNER"
echo "└─────────────────────────────────────────────────────────────┘"

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  warn "DRY RUN — no changes were made"
fi

echo ""
ok "Onboarding complete!"

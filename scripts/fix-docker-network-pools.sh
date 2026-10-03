#!/usr/bin/env bash
# =============================================================================
# fix-docker-network-pools.sh — Rozšíří Docker bridge address pools
# =============================================================================
# Symptom: deploy padá s "all predefined address pools have been fully subnetted"
# nebo "network <random-id> declared as external, but could not be found".
#
# Root cause: Docker default pool 172.17.0.0/16 vyčerpán per-app bridge networks
# (Coolify vytváří jednu /24 per app UUID; po ~250 deployech je pool plný).
#
# Tento skript má dva módy:
#
#   SSH mode (default): SSH na hostitele (vyžaduje COOLIFY_HOST_SSH=user@host
#     + passwordless sudo na hostiteli)
#   On-host mode (--on-host): spustí se přímo na hostiteli jako root
#     (žádné SSH, žádné sudo — předpokládá že už jsi root přes su -)
#
# Co dělá v obou módech:
#   1. Diagnose current state (network count, pools, dangling)
#   2. docker network prune -f (mrtvé networks z deleted apps)
#   3. Backup /etc/docker/daemon.json + add 172.17/16 + 10.30/16 + 10.40/16 pools
#   4. systemctl restart docker (~5s downtime)
#   5. Verify Docker daemon + count networks/containers
#
# Usage:
#   # SSH mode (z dev mašiny):
#   COOLIFY_HOST_SSH=ubuntu@coolify.example.com bash scripts/fix-docker-network-pools.sh
#   COOLIFY_HOST_SSH=... bash scripts/fix-docker-network-pools.sh --prune-only
#   COOLIFY_HOST_SSH=... bash scripts/fix-docker-network-pools.sh --dry-run
#
#   # On-host mode (přímo na Coolify hostiteli, jako root, bez SSH):
#   #   1) scp scripts/fix-docker-network-pools.sh user@host:/tmp/
#   #   2) ssh user@host
#   #   3) su -    (nebo sudo -i pokud je sudo)
#   #   4) bash /tmp/fix-docker-network-pools.sh --on-host
#   #      bash /tmp/fix-docker-network-pools.sh --on-host --prune-only
#   #      bash /tmp/fix-docker-network-pools.sh --on-host --yes  (no interactive)
#
# WARNING: `systemctl restart docker` způsobí ~5s downtime všech kontejnerů na
# hostiteli. Plánuj v maintenance window. Po restartu se obnoví automaticky,
# ale healthchecks (pet startup periods) potřebují čas.
# =============================================================================
set -uo pipefail

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'; N='\033[0m'; BOLD='\033[1m'
ok()    { echo -e "  ${G}✓${N} $*"; }
fail()  { echo -e "  ${R}✗${N} $*"; }
warn()  { echo -e "  ${Y}⚠${N} $*"; }
info()  { echo -e "  ${B}ℹ${N} $*"; }
section(){ echo -e "\n${C}${BOLD}━━━ $* ━━━${N}"; }

PRUNE_ONLY=0
DRY_RUN=0
ON_HOST=0
YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prune-only) PRUNE_ONLY=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --on-host)    ON_HOST=1; shift ;;
    --yes|-y)     YES=1; shift ;;
    -h|--help)    head -36 "$0" | tail -34; exit 0 ;;
    *) fail "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Mode: SSH vs on-host ────────────────────────────────────────────────────
# `run` helper unifikuje SSH-vs-on-host volání. V on-host módu jen exec lokálně.
if [[ "$ON_HOST" -eq 1 ]]; then
  if [[ "$EUID" -ne 0 ]]; then
    fail "--on-host vyžaduje root. Použij: su - && bash $0 --on-host"
    exit 1
  fi
  HOST="$(hostname)"
  run() { bash -c "$1"; }
else
  if [[ -z "${COOLIFY_HOST_SSH:-}" ]]; then
    fail "COOLIFY_HOST_SSH not set (nebo použij --on-host na hostiteli)"
    echo "  Example: COOLIFY_HOST_SSH=ubuntu@coolify.example.com bash scripts/fix-docker-network-pools.sh"
    echo "  On-host:  bash scripts/fix-docker-network-pools.sh --on-host  (jako root, na hostiteli)"
    exit 1
  fi
  HOST="$COOLIFY_HOST_SSH"
  SSH_OPTS=(-o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10)
  run() { ssh "${SSH_OPTS[@]}" "$HOST" "$1"; }
fi

# ── Banner ──────────────────────────────────────────────────────────────────
echo -e "${C}${BOLD}╔══════════════════════════════════════════════════════════════╗${N}"
echo -e "${C}${BOLD}║  Docker Network Pool Fix                                      ║${N}"
echo -e "${C}${BOLD}╚══════════════════════════════════════════════════════════════╝${N}"
info "Target host: $HOST"
[[ "$DRY_RUN" -eq 1 ]] && warn "DRY RUN — no changes will be made"

# ── Connectivity check ─────────────────────────────────────────────────────
if [[ "$ON_HOST" -eq 1 ]]; then
  section "1. On-host pre-flight"
  if ! command -v docker >/dev/null 2>&1; then
    fail "docker not in PATH"
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon nedostupný"
    exit 1
  fi
  ok "Running as root on $(hostname)"
  ok "Docker: $(docker --version)"
else
  section "1. SSH connectivity"
  if run "echo ok" >/dev/null 2>&1; then
    ok "SSH OK"
  else
    fail "Cannot SSH to $HOST (check key, BatchMode requires no password prompt)"
    exit 1
  fi
fi

# ── Diagnose current pool usage ────────────────────────────────────────────
section "2. Current pool state"
network_count=$(run "docker network ls -q | wc -l" 2>/dev/null | tr -d '[:space:]')
info "Current Docker networks on host: $network_count"

dangling=$(run "docker network ls --filter 'dangling=true' -q | wc -l" 2>/dev/null | tr -d '[:space:]')
info "Dangling networks (unused): $dangling"

current_pools=$(run "cat /etc/docker/daemon.json 2>/dev/null | jq -r '.\"default-address-pools\" // []' 2>/dev/null" || echo "[]")
info "Current default-address-pools: $current_pools"

# ── Step A: prune dangling networks ────────────────────────────────────────
section "3. Network prune (cleanup dangling)"
if [[ "$DRY_RUN" -eq 1 ]]; then
  info "[DRY RUN] Would run: docker network prune -f"
else
  pruned=$(run "docker network prune -f 2>&1 | grep -E '^(Deleted|Total)' | head -2" || true)
  ok "Pruned: $pruned"
  post_prune_count=$(run "docker network ls -q | wc -l" 2>/dev/null | tr -d '[:space:]')
  info "Networks po prune: $post_prune_count (uvolněno $((network_count - post_prune_count)))"
fi

if [[ "$PRUNE_ONLY" -eq 1 ]]; then
  section "Done (--prune-only)"
  ok "Pool expansion skipped. Re-run without --prune-only to expand pools."
  exit 0
fi

# ── Step B: backup & expand daemon.json ────────────────────────────────────
section "4. Expand /etc/docker/daemon.json (default-address-pools)"

# Privilegovaný prefix — v on-host módu už jsme root, v SSH módu je sudo
# (vyžaduje passwordless sudo na hostiteli).
if [[ "$ON_HOST" -eq 1 ]]; then
  SUDO=""
else
  SUDO="sudo "
fi

POOL_SCRIPT=$(cat <<REMOTE_EOF
#!/bin/bash
set -e

DAEMON_JSON="/etc/docker/daemon.json"
BACKUP="\$DAEMON_JSON.bak.\$(date +%s)"

# Create file if missing
if [[ ! -f "\$DAEMON_JSON" ]]; then
  echo '{}' | ${SUDO}tee "\$DAEMON_JSON" > /dev/null
  echo "Created empty \$DAEMON_JSON"
fi

# Backup
${SUDO}cp "\$DAEMON_JSON" "\$BACKUP"
echo "Backup: \$BACKUP"

# Check if pools already expanded
if jq -e '."default-address-pools" | length > 0' "\$DAEMON_JSON" >/dev/null 2>&1; then
  current=\$(jq -c '."default-address-pools"' "\$DAEMON_JSON")
  echo "default-address-pools already set: \$current"
  echo "(re-running this script appends, ne overwritte; check if 10.30/16 + 10.40/16 are present)"
fi

# Merge new pools (preserve existing 172.17/16 + add 10.30/16 + 10.40/16)
${SUDO}jq '.["default-address-pools"] = (
  (."default-address-pools" // []) + [
    {"base": "172.17.0.0/16", "size": 24},
    {"base": "10.30.0.0/16", "size": 24},
    {"base": "10.40.0.0/16", "size": 24}
  ]
  | unique_by(.base)
)' "\$DAEMON_JSON" > /tmp/daemon-new.json

${SUDO}mv /tmp/daemon-new.json "\$DAEMON_JSON"
${SUDO}chmod 644 "\$DAEMON_JSON"

echo "New \$DAEMON_JSON:"
${SUDO}cat "\$DAEMON_JSON"

# Validate JSON
if ! jq empty "\$DAEMON_JSON" 2>/dev/null; then
  echo "ERROR: daemon.json je nevalidní JSON, restoring backup"
  ${SUDO}cp "\$BACKUP" "\$DAEMON_JSON"
  exit 1
fi
REMOTE_EOF
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  info "[DRY RUN] Would expand pools: 172.17.0.0/16 + 10.30.0.0/16 + 10.40.0.0/16"
else
  if [[ "$ON_HOST" -eq 1 ]]; then
    if echo "$POOL_SCRIPT" | bash -s; then
      ok "daemon.json updated"
    else
      fail "daemon.json update failed"
      exit 1
    fi
  else
    if echo "$POOL_SCRIPT" | ssh "${SSH_OPTS[@]}" "$HOST" 'bash -s'; then
      ok "daemon.json updated"
    else
      fail "daemon.json update failed"
      exit 1
    fi
  fi
fi

# ── Step C: restart docker ─────────────────────────────────────────────────
section "5. Restart Docker daemon"
warn "Toto způsobí ~5s downtime všech kontejnerů na hostiteli."

if [[ "$DRY_RUN" -eq 0 ]]; then
  if [[ "$YES" -eq 0 ]]; then
    read -rp "  Confirm [y/N]: " confirm
    if [[ "$confirm" != "y" ]] && [[ "$confirm" != "Y" ]]; then
      info "Restart skipped. Změny se aplikují až po manual 'systemctl restart docker' na hostiteli."
      exit 0
    fi
  fi
  if run "${SUDO}systemctl restart docker"; then
    ok "Docker daemon restarted"
  else
    fail "Restart failed — checkni '${SUDO}systemctl status docker'"
    exit 1
  fi

  # Wait for daemon to be responsive
  info "Waiting for Docker daemon to be ready..."
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if run "docker info" >/dev/null 2>&1; then
      ok "Docker ready after ${i}s"
      break
    fi
    sleep 1
  done
else
  info "[DRY RUN] Would: ${SUDO}systemctl restart docker + 15s wait"
fi

# ── Step D: verify ──────────────────────────────────────────────────────────
section "6. Verify"
new_networks=$(run "docker network ls -q | wc -l" 2>/dev/null | tr -d '[:space:]')
info "Networks now: $new_networks (was $network_count)"

run "cat /etc/docker/daemon.json" 2>/dev/null | jq '."default-address-pools"' 2>/dev/null | sed 's/^/  /' || true

running=$(run "docker ps -q | wc -l" 2>/dev/null | tr -d '[:space:]')
info "Běžící kontejnery: $running"

# ── Summary ─────────────────────────────────────────────────────────────────
section "Summary"
ok "Docker network pools expanded. Cca 256 → 768 /24 networks."
echo ""
echo "Next steps:"
echo "  1. Trigger PKI redeploy (pokud byl blocked):"
echo "     node scripts/aisha-redeploy.mjs --only=pki"
echo ""
echo "  2. aisha-messaging deploy (KNOWN_BROKEN po pool exhaustion):"
echo "     node scripts/aisha-redeploy.mjs --only=messaging"
echo ""
echo "Note: Existing kontejnery se po restart-u Docker daemonu připojily ke svým"
echo "  původním networkům. Pokud nějaký pet ne, manuálně:"
echo "    docker compose -f docker-compose.coolify-X.yml up -d (z Coolify UI)"

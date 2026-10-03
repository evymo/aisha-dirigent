#!/usr/bin/env bash
# Credentials come from the shared canonical chain, not one hardcoded file.
# shellcheck source=scripts/lib/coolify-credentials.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/coolify-credentials.sh" 2>/dev/null || \
  . "$(cd "$(dirname "$0")" && pwd)/lib/coolify-credentials.sh"

# ═══════════════════════════════════════════════════════════════════════════════
# AISHA Deploy All — sequential trigger of all 11 Coolify apps
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   bash scripts/aisha-deploy-all.sh              # deploy all in order
#   bash scripts/aisha-deploy-all.sh status       # only show status table
#   bash scripts/aisha-deploy-all.sh STACK_NAME   # deploy single stack
#
# Order: keycloak → core → langfuse → admin → n8n → matrix → livekit
#        → pki → ledger → integration → web
# (auth first, data layer next, services last, web at end for prod cutover)
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Colors
if [ -t 1 ]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'
  BLUE=$'\033[0;34m'; CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; CYAN=""; BOLD=""; RESET=""
fi

# Token from .env-prod-backup
if [ ! -f .env-prod-backup ]; then
  echo "${RED}❌ .env-prod-backup not found${RESET}" >&2
  exit 1
fi
COOLIFY_TOKEN="$(config_env_key COOLIFY_API_TOKEN COOLIFY_API_KEY)"
# shellcheck source=scripts/lib/coolify-api-base.sh
source "$REPO_ROOT/scripts/lib/coolify-api-base.sh"
COOLIFY_API="$(resolve_coolify_api)" || exit 1  # normalizes to <host>/api/v1 (COOLIFY_API|COOLIFY_URL)

if [ -z "$COOLIFY_TOKEN" ]; then
  echo "${RED}❌ COOLIFY_API_TOKEN missing in .env-prod-backup${RESET}" >&2
  exit 1
fi

# Deploy order — auth/data first, web last
DEPLOY_ORDER=(keycloak core langfuse admin n8n matrix livekit pki ledger integration web)

# Cache app list once
ALL_APPS=$(curl -sS --http1.1 -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_API/applications" | tr -d '\000-\037')

get_uuid() {
  echo "$ALL_APPS" | jq -r --arg n "aisha-$1" '.[] | select(.name==$n) | .uuid'
}

get_status() {
  local uuid="$1"
  echo "$ALL_APPS" | jq -r --arg u "$uuid" '.[] | select(.uuid==$u) | .status'
}

trigger_deploy() {
  local uuid="$1"
  local resp
  resp=$(curl -sS --http1.1 -X POST \
    -H "Authorization: Bearer $COOLIFY_TOKEN" \
    "$COOLIFY_API/deploy?uuid=$uuid" 2>&1 | tr -d '\000-\037')
  echo "$resp" | jq -r '.deployments[0].deployment_uuid // .message // "unknown"' 2>/dev/null \
    || echo "raw: $resp"
}

# ═══════════════════════════════════════════════════════════════════════════════
# STATUS TABLE
# ═══════════════════════════════════════════════════════════════════════════════
print_status_table() {
  echo
  echo "${BOLD}${CYAN}━━━ AISHA Stack Status ━━━${RESET}"
  printf "${BOLD}  %-15s %-26s %-22s %s${RESET}\n" "STACK" "UUID" "STATUS" "LAST_DEPLOY"
  echo "  ─────────────────────────────────────────────────────────────────────────────"
  for stack in "${DEPLOY_ORDER[@]}"; do
    local uuid status last deploy_color
    uuid=$(get_uuid "$stack")
    if [ -z "$uuid" ] || [ "$uuid" = "null" ]; then
      printf "  %-15s ${RED}MISSING${RESET}\n" "aisha-$stack"
      continue
    fi
    status=$(get_status "$uuid")
    last=$(curl -sS --http1.1 -H "Authorization: Bearer $COOLIFY_TOKEN" \
      "$COOLIFY_API/applications/$uuid/deployments?per_page=1" 2>/dev/null \
      | tr -d '\000-\037' \
      | jq -r '.deployments[0].status // "none"' 2>/dev/null || echo "?")
    case "$last" in
      finished|in_progress) deploy_color="$GREEN" ;;
      failed|cancelled) deploy_color="$RED" ;;
      queued|running) deploy_color="$YELLOW" ;;
      *) deploy_color="" ;;
    esac
    case "$status" in
      running:healthy) sc="$GREEN" ;;
      exited:unhealthy|*:unhealthy) sc="$RED" ;;
      *) sc="$YELLOW" ;;
    esac
    printf "  %-15s %-26s ${sc}%-22s${RESET} ${deploy_color}%s${RESET}\n" \
      "aisha-$stack" "$uuid" "$status" "$last"
  done
  echo
}

# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOY ONE
# ═══════════════════════════════════════════════════════════════════════════════
deploy_one() {
  local stack="$1"
  local uuid
  uuid=$(get_uuid "$stack")
  if [ -z "$uuid" ] || [ "$uuid" = "null" ]; then
    echo "${RED}❌ aisha-$stack: app not found in Coolify${RESET}"
    return 1
  fi
  echo "${BLUE}▶ Triggering aisha-$stack ($uuid)...${RESET}"
  local result
  result=$(trigger_deploy "$uuid")
  echo "  → $result"
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════
case "${1:-}" in
  status)
    print_status_table
    exit 0
    ;;
  ""|all)
    echo "${BOLD}${CYAN}🚀 AISHA — Deploying all 11 stacks in order${RESET}"
    echo "${YELLOW}⚠  Pozn: 6 stacků (keycloak/n8n/matrix/livekit/pki/ledger) má 0 envs po dedup —${RESET}"
    echo "${YELLOW}   tyto pravděpodobně skončí ve 'failed' kvůli chybějícím required vars.${RESET}"
    echo "${YELLOW}   Spusť 'bash scripts/aisha-deploy-all.sh status' pro průběžný stav.${RESET}"
    echo
    read -p "Pokračovat? [y/N] " -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && { echo "Aborted."; exit 0; }
    for stack in "${DEPLOY_ORDER[@]}"; do
      deploy_one "$stack" || true
      sleep 2
    done
    echo
    echo "${GREEN}✅ All deploys triggered.${RESET}"
    echo "${YELLOW}Sleduj průběh: bash scripts/aisha-deploy-all.sh status${RESET}"
    ;;
  *)
    # Single stack
    deploy_one "$1"
    ;;
esac

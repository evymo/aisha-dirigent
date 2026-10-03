#!/bin/bash
#
# select-env.sh — Auto-select .env file based on APP_ENV
#
# Usage:
#   APP_ENV=production ./scripts/select-env.sh
#   ./scripts/select-env.sh              # defaults to 'development'
#
# Called automatically by prebuild:ios:prod and build:ios scripts.
# Sources the right .env file so that expo prebuild bakes in correct values.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_ENV="${APP_ENV:-development}"

case "$APP_ENV" in
  production|prod)
    ENV_FILE="$PROJECT_DIR/.env.production"
    ;;
  staging)
    ENV_FILE="$PROJECT_DIR/.env.staging"
    ;;
  *)
    ENV_FILE="$PROJECT_DIR/.env"
    ;;
esac

if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}[error] Missing env file: $ENV_FILE${NC}"
  echo "Create it from .env.example or .env.production"
  exit 1
fi

# Validate: production builds must NOT point to localhost
if [ "$APP_ENV" = "production" ] || [ "$APP_ENV" = "prod" ]; then
  if grep -q "127.0.0.1\|localhost" "$ENV_FILE" 2>/dev/null; then
    echo -e "${RED}[error] $ENV_FILE contains localhost URLs — cannot build for production!${NC}"
    exit 1
  fi
fi

# Export vars so expo prebuild picks them up
set -a
source "$ENV_FILE"
set +a

echo -e "${GREEN}[ok] Loaded $ENV_FILE (APP_ENV=$APP_ENV)${NC}"

# Backend URL: app.config.ts reads EXPO_PUBLIC_AISHA_GATEWAY_URL.
# Bridge the legacy POSTGREST alias so older .env files keep working.
: "${EXPO_PUBLIC_AISHA_GATEWAY_URL:=${EXPO_PUBLIC_AISHA_POSTGREST_URL:-}}"
: "${EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY:=${EXPO_PUBLIC_AISHA_POSTGREST_ANON_KEY:-}}"
export EXPO_PUBLIC_AISHA_GATEWAY_URL EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY

# Show key values (masked)
if [ -n "$EXPO_PUBLIC_AISHA_GATEWAY_URL" ]; then
  echo -e "  AISHA_GATEWAY_URL = $EXPO_PUBLIC_AISHA_GATEWAY_URL"
fi
if [ -n "$EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY" ]; then
  echo -e "  ANON_KEY     = ${EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY:0:20}..."
fi

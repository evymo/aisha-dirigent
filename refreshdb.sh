#!/usr/bin/env bash
set -euo pipefail

PROFILE="${AISHA_SEED_PROFILE:-platform}"
IMPLEMENTATION="${AISHA_IMPLEMENTATION:-${AISHA_STORY:-${STORY:-}}}"

usage() {
  cat <<'USAGE'
Usage: ./refreshdb.sh [--profile PROFILE] [--implementation NAME] [--story NAME]

Refreshes the local database from source of truth:
  1. compile seed for the selected public/implementation profile
  2. regenerate baseline from aisha/db/sql/
  3. reset local DB
  4. regenerate local DB types

Defaults:
  --profile platform

Profiles:
  platform|empty      platform core + platform translations
  demo                platform + public demo data
  implementation      platform + selected implementation
  instance            platform + implementation + private overlay
  full                platform + implementation + private overlay + demo

Production/private restores must pass --profile instance explicitly.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --profile)
      PROFILE="${2:?--profile requires a value}"
      shift 2
      ;;
    --profile=*)
      PROFILE="${1#--profile=}"
      shift
      ;;
    --implementation)
      IMPLEMENTATION="${2:?--implementation requires a value}"
      shift 2
      ;;
    --implementation=*)
      IMPLEMENTATION="${1#--implementation=}"
      shift
      ;;
    --story)
      IMPLEMENTATION="${2:?--story requires a value}"
      shift 2
      ;;
    --story=*)
      IMPLEMENTATION="${1#--story=}"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

export AISHA_SEED_PROFILE="$PROFILE"
if [ -n "$IMPLEMENTATION" ]; then
  export AISHA_IMPLEMENTATION="$IMPLEMENTATION"
fi

compile_args=(--profile "$PROFILE")
if [ -n "$IMPLEMENTATION" ]; then
  compile_args+=(--implementation "$IMPLEMENTATION")
fi

npm run db:seed:compile -- "${compile_args[@]}"
npm run db:init:generate
npm run db:reset:local
npm run db:types:gen:local

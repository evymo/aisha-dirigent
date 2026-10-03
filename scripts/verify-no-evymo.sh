#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PATTERN='_evymo_'
# Check compose files across the repo, but ignore trash snapshots and generated junk.
TARGET_FILES=$(find "$ROOT_DIR" \
  \( -path "$ROOT_DIR/trash" -o -path "$ROOT_DIR/trash/*" \
  -o -path "$ROOT_DIR/.claude" -o -path "$ROOT_DIR/.claude/*" \
  -o -path "$ROOT_DIR/archive" -o -path "$ROOT_DIR/archive/*" \) -prune -o \
  -type f -name 'docker-compose*.yml' -print | sort)

if [ -z "$TARGET_FILES" ]; then
  echo "WARN: Nenalezeny zadne top-level docker-compose*.yml soubory."
  exit 0
fi

# Block accidental legacy cookie prefixes and similar leftovers in active compose files.
if echo "$TARGET_FILES" | xargs grep --line-number --with-filename "$PATTERN" >/tmp/verify-no-evymo.out; then
  echo "FAIL: Nalezeny legacy hodnoty '$PATTERN' v compose souborech:"
  cat /tmp/verify-no-evymo.out
  exit 1
fi

echo "OK: V compose souborech nejsou zadne '$PATTERN' hodnoty."

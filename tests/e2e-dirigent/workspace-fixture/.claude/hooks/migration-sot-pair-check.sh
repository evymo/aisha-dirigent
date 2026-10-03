#!/usr/bin/env bash
# After a migration is created, suggest creating SoT pair file.
#
# Triggers on: PostToolUse Write|Edit on aisha/db/migrations/[timestamp]_*.sql
# (excluding baseline.sql — handled by separate block hook)
#
# Behavior: emit reminder text to stdout (advisory only, never blocks)
set -euo pipefail

TARGET=$(echo "${CLAUDE_HOOK_TOOL_INPUT:-}" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')

if [[ -z "$TARGET" ]]; then
  exit 0
fi

# Only trigger on aisha/db/migrations/[timestamp]_*.sql
if ! [[ "$TARGET" =~ /aisha/db/migrations/[0-9]{14}_[^/]+\.sql$ ]]; then
  exit 0
fi

# Skip baseline.sql (already blocked elsewhere)
if [[ "$TARGET" == */aisha/db/migrations/00000000000000_baseline.sql ]]; then
  exit 0
fi

# Look for likely SoT pair candidates
MIGRATION_BASENAME=$(basename "$TARGET" .sql)
DESCRIPTION="${MIGRATION_BASENAME#*_}"

# Read migration content to detect CREATE TABLE / CREATE FUNCTION
CONTENT=$(cat "$TARGET" 2>/dev/null || echo "")
NEW_TABLES=$(echo "$CONTENT" | grep -iE "^[[:space:]]*CREATE TABLE[[:space:]]+(IF NOT EXISTS[[:space:]]+)?(public\.)?[a-z_]+" | sed -E 's/.*CREATE TABLE[[:space:]]+(IF NOT EXISTS[[:space:]]+)?(public\.)?([a-z_]+).*/\3/i' | sort -u)
NEW_FUNCS=$(echo "$CONTENT" | grep -iE "^[[:space:]]*CREATE (OR REPLACE )?FUNCTION[[:space:]]+(public\.)?[a-z_]+" | sed -E 's/.*CREATE (OR REPLACE )?FUNCTION[[:space:]]+(public\.)?([a-z_]+).*/\3/i' | sort -u)

cat <<EOF
📝 Migration created: $TARGET

Reminder — AISHA migration → SoT pairing:

EOF

if [[ -n "$NEW_TABLES" ]]; then
  echo "  Tables in migration (consider SoT files):"
  for t in $NEW_TABLES; do
    SOT_PATH="aisha/db/sql/tables/$t.sql"
    if [[ ! -f "$SOT_PATH" ]]; then
      echo "    ⚠ MISSING SoT pair: $SOT_PATH"
    else
      echo "    ✓ SoT pair exists: $SOT_PATH"
    fi
  done
  echo
fi

if [[ -n "$NEW_FUNCS" ]]; then
  echo "  Functions in migration (consider SoT files):"
  for f in $NEW_FUNCS; do
    SOT_PATH="aisha/db/sql/functions/$f.sql"
    if [[ ! -f "$SOT_PATH" ]]; then
      echo "    ⚠ MISSING SoT pair: $SOT_PATH"
    else
      echo "    ✓ SoT pair exists: $SOT_PATH"
    fi
  done
  echo
fi

cat <<EOF
Next steps:
  1. Create missing SoT files (tables/functions) so baseline regen captures them
  2. npm run db:migration:register
  3. npm run db:migrate:local
  4. npm run db:types:gen:local
  5. npx tsc --noEmit  (verify TS still compiles)

Skill reference: .claude/skills/aisha-migration/SKILL.md
EOF

# ── Dirigent router-coach: cost-advisory (advisory-only, exit 0 always) ──
# Sourced as last step so the hook's existing behavior is unchanged when the
# router-coach lib is missing. Migration tool uses are mid-cost (Edit/Write).
if [[ -f "$(dirname "$0")/../lib/session-cost.sh" ]]; then
  # shellcheck disable=SC1091
  source "$(dirname "$0")/../lib/session-cost.sh"
  sc_log_tool "Edit" 2>/dev/null || true
  sc_advise "${CLAUDE_SESSION_ID:-unknown}" 2>/dev/null || true
fi

exit 0

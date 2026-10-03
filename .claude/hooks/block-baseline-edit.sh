#!/usr/bin/env bash
# Block direct edits to auto-generated baseline + seed files.
#
# These files are regenerated from SoT via:
#   npm run db:init:generate     (baseline.sql)
#   npm run db:seed:compile      (seed.sql)
#
# Editing them directly = changes lost on next regeneration.
#
# Hook type: PreToolUse (Edit, Write, MultiEdit)
# Behavior: exit 1 with error if target path matches generated files
set -euo pipefail

# CLAUDE_HOOK_TOOL_INPUT is JSON of tool args
TARGET=$(echo "${CLAUDE_HOOK_TOOL_INPUT:-}" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')

if [[ -z "$TARGET" ]]; then
  exit 0  # Cannot determine target → permit
fi

case "$TARGET" in
  */aisha/db/migrations/00000000000000_baseline.sql|*/aisha/db/migrations/00000000000000_baseline.sql/*)
    cat <<EOF >&2
❌ BLOCKED: aisha/db/migrations/00000000000000_baseline.sql is AUTO-GENERATED.

Don't edit baseline directly. Instead:
  1. Edit/create SoT files in aisha/db/sql/{tables,functions,...}
  2. Create incremental migration in aisha/db/migrations/{timestamp}_{description}.sql
  3. Run: npm run db:migration:register
  4. Apply: npm run db:migrate:local
  5. (Maintainer later) Regenerate baseline: npm run db:init:generate

See: .claude/skills/aisha-migration/SKILL.md
EOF
    exit 1
    ;;
  */aisha/db/seed.sql|*/aisha/db/seed.compiled.sql)
    cat <<EOF >&2
❌ BLOCKED: $TARGET is AUTO-COMPILED from aisha/db/seed/.

Don't edit compiled seed directly. Instead:
  1. Edit source files in aisha/db/seed/{core,...}/
  2. Run: npm run db:seed:compile
EOF
    exit 1
    ;;
esac

exit 0

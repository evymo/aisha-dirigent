#!/usr/bin/env bash
# Pre-commit gate: ensure migrations are registered + types are up to date.
#
# Triggers on: PreToolUse Bash for `git commit`
# Behavior: emit warning if migrations changed but registry not updated
set -euo pipefail

CMD="${CLAUDE_HOOK_TOOL_INPUT:-}"

# Only trigger on git commit
if ! echo "$CMD" | grep -qE '"command"[[:space:]]*:[[:space:]]*"git[[:space:]]+commit'; then
  exit 0
fi

# Check git status for migration changes
MIGRATION_CHANGES=$(git status --porcelain 2>/dev/null | grep -E "^\s*[AM?].*aisha/db/migrations/[0-9]{14}_" | wc -l | tr -d ' ')

if [[ "$MIGRATION_CHANGES" -eq 0 ]]; then
  exit 0
fi

cat <<EOF >&2

📝 Pre-commit check: $MIGRATION_CHANGES migration file(s) changed.

Verify before committing:
  ✓ Migration registered:  npm run db:migration:register
  ✓ SQL functions valid:   npm run func:validate
  ✓ Types regenerated:     npm run db:types:gen:local
  ✓ TypeScript compiles:   npx tsc --noEmit
  ✓ SoT pair files in aisha/db/sql/{tables,functions,...}

Skill: .claude/skills/aisha-migration/SKILL.md

EOF

exit 0

#!/usr/bin/env bash
# {{HOOK_FILENAME}} — Advisory: {{RULE_SLUG}} ({{SEVERITY}}).
# Generated from claude_hook_bindings — DO NOT EDIT MANUALLY.
# Regenerate via: npm run gen:ide -- --format=claude-overlay
# Hook type: {{HOOK_EVENT}} ({{MATCHER}}). Always exits 0 (advisory only).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

INPUT="${CLAUDE_HOOK_TOOL_INPUT:-}"
[[ -z "$INPUT" ]] && exit 0

NEW_TEXT=$(printf '%s' "$INPUT" | aisha_extract_new_text)

# Pattern from claude_hook_bindings.pattern_regex.
# `read -r -d ''` with single-quoted heredoc terminator preserves all special
# chars (apostrophes, backticks, $, double quotes) without subshell parser
# trying to match quotes across the body.
IFS= read -r -d '' PATTERN <<'AISHA_PATTERN_END' || true
{{PATTERN_REGEX}}
AISHA_PATTERN_END
PATTERN="${PATTERN%$'\n'}"

if ! printf '%s' "$NEW_TEXT" | grep -qE "$PATTERN"; then
  exit 0
fi

aisha_advise_cooldown "{{RULE_SLUG}}" {{COOLDOWN_SEC}} || exit 0

cat <<'AISHA_ADVISORY_END'
⚠️  AISHA Advisor — {{RULE_SLUG}} ({{SEVERITY}}, advisory)

{{MESSAGE_CS}}

{{HINT_LINE}}

Advisory only — agent rozhodne. Cooldown: {{COOLDOWN_SEC}}s.
AISHA_ADVISORY_END
exit 0

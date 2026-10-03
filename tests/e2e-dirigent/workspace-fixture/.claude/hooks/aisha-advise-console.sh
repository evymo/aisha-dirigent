#!/usr/bin/env bash
# aisha-advise-console.sh — Advisory: no-console (moderate).
# Generated from claude_hook_bindings — DO NOT EDIT MANUALLY.
# Regenerate via: npm run gen:ide -- --format=claude-overlay
# Hook type: PreToolUse (Edit|Write|MultiEdit). Always exits 0 (advisory only).
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
console\.log\s*\(
AISHA_PATTERN_END
PATTERN="${PATTERN%$'\n'}"

if ! printf '%s' "$NEW_TEXT" | grep -qE "$PATTERN"; then
  exit 0
fi

aisha_advise_cooldown "no-console" 45 || exit 0

cat <<'AISHA_ADVISORY_END'
⚠️  AISHA Advisor — no-console (moderate, advisory)

Hygiena: console.log() není povoleno. Použij safeError() pro error logování.

Tip: @aisha Jak správně logovat chyby?

Advisory only — agent rozhodne. Cooldown: 45s.
AISHA_ADVISORY_END
exit 0

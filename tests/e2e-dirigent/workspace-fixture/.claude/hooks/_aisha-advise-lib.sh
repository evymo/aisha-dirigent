#!/usr/bin/env bash
# shellcheck disable=SC2317  # functions sourced; reachability flagged false-positive
set -euo pipefail
# _aisha-advise-lib.sh — Shared helpers for AISHA Dirigent advisory hooks.
#
# Source this from any aisha-advise-*.sh script:
#   source "$(dirname "$0")/_aisha-advise-lib.sh"
#
# Provides:
#   extract_new_text   — pulls new_string / content / edits[].new_string from CLAUDE_HOOK_TOOL_INPUT
#   advise_cooldown    — gate per (rule, session) with 45s cooldown to prevent flooding
#
# All functions are POSIX-shell-safe; require bash + python3.

# Extract the NEW content from a Claude Code tool input JSON on stdin.
# Returns: concatenated new_string / content / edits[].new_string (one per line).
# On any parse error: empty output.
aisha_extract_new_text() {
  if ! command -v python3 >/dev/null 2>&1; then
    cat
    return
  fi
  python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())
    parts = []
    if d.get("new_string"): parts.append(d["new_string"])
    if d.get("content"):    parts.append(d["content"])
    for e in d.get("edits", []) or []:
        if isinstance(e, dict) and e.get("new_string"):
            parts.append(e["new_string"])
    print("\n".join(parts))
except Exception:
    pass
' 2>/dev/null
}

# Extract the bash command from a Claude Code Bash tool input.
aisha_extract_bash_command() {
  if ! command -v python3 >/dev/null 2>&1; then
    cat
    return
  fi
  python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(d.get("command", ""))
except Exception:
    pass
' 2>/dev/null
}

# Cooldown gate. Usage:
#   aisha_advise_cooldown <rule_key> [seconds] || exit 0
# Returns 0 (proceed) if last advisory for this (rule, session) was > N seconds ago.
# Returns 1 (suppress) otherwise.
aisha_advise_cooldown() {
  local rule_key="$1"
  local seconds="${2:-45}"
  local session="${CLAUDE_SESSION_ID:-default}"
  local cooldown_file="/tmp/aisha-advise-${rule_key}-${session}"
  local now last
  now=$(date +%s)
  if [[ -f "$cooldown_file" ]]; then
    last=$(cat "$cooldown_file" 2>/dev/null || echo 0)
    if (( now - last < seconds )); then
      return 1
    fi
  fi
  printf '%s' "$now" > "$cooldown_file" 2>/dev/null || true
  return 0
}

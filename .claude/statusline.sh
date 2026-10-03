#!/usr/bin/env bash
# AISHA Dirigent — Claude Code status line.
#
# Single-line status: branch • story • supervisor mode • cooldowns.
# Read once per Claude Code render tick; must be FAST (<200ms).
#
# Output format (single line, no newline):
#   ⊕ <branch> | story:<id8|none> | dir:<L1|L1+L2|off> | cd:<n>
#
# Color codes intentionally avoided — different terminals interpret ANSI
# differently and the status line is shown verbatim.
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# 1. Branch (short)
BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "?")
[[ -z "$BRANCH" ]] && BRANCH="?"
# Truncate long branch names like claude/loving-kirch-461e38 → claude/loving-…
if [[ ${#BRANCH} -gt 22 ]]; then
  BRANCH="${BRANCH:0:21}…"
fi

# 2. Story (first 8 of UUID, or "none")
STORY="none"
if [[ -f "$PROJECT_DIR/.aisha/story.json" ]]; then
  RAW=$(grep -oE '"story_id"[[:space:]]*:[[:space:]]*"[^"]+"' "$PROJECT_DIR/.aisha/story.json" 2>/dev/null \
    | head -1 | sed -E 's/.*"([^"]+)"$/\1/' || true)
  if [[ -n "$RAW" ]]; then
    STORY="${RAW:0:8}"
  fi
fi

# 3. Supervisor mode
#    L1: local hooks always active (any aisha-advise-*.sh exists)
#    L1+L2: AISHA_MCP_TOKEN is set (HTTP relay will fire)
#    off: no aisha-advise scripts found
MODE="off"
if compgen -G "$PROJECT_DIR/.claude/hooks/aisha-advise-*.sh" > /dev/null 2>&1; then
  if [[ -n "${AISHA_MCP_TOKEN:-}" ]]; then
    MODE="L1+L2"
  else
    MODE="L1"
  fi
fi

# 4. Active cooldowns count for this session
SESSION="${CLAUDE_SESSION_ID:-default}"
CD_COUNT=0
if compgen -G "/tmp/aisha-advise-*-${SESSION}" > /dev/null 2>&1; then
  CD_COUNT=$(ls /tmp/aisha-advise-*-${SESSION} 2>/dev/null | wc -l | tr -d ' ')
fi

printf '⊕ %s | story:%s | dir:%s | cd:%s' "$BRANCH" "$STORY" "$MODE" "$CD_COUNT"

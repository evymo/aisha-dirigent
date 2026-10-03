#!/usr/bin/env bash
# aisha-advise-context-reuse.sh — Advisory: re-reading a large, unchanged file.
# Hook type: PreToolUse (Read). Always exits 0 (advisory only).
#
# Enforcement point for expert rule: agent-ops-context-reuse.
# A blind reread of an unchanged large file burns context and credit for zero
# information gain. First find out what actually changed (git diff / git log), or
# ask the file a targeted question (grep, offset+limit), instead of re-ingesting it.
#
# Fires only when: same path, same mtime+size as an earlier read in this session,
# file is large, and the read is NOT already targeted (no offset/limit).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

INPUT="${CLAUDE_HOOK_TOOL_INPUT:-}"
[[ -z "$INPUT" ]] && exit 0

# Extract file_path + whether the read is already targeted.
PARSED=$(printf '%s' "$INPUT" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    targeted = "1" if (d.get("offset") or d.get("limit")) else "0"
    print(d.get("file_path",""))
    print(targeted)
except Exception:
    pass' 2>/dev/null || true)
FILE_PATH=$(printf '%s' "$PARSED" | sed -n '1p')
TARGETED=$(printf '%s' "$PARSED" | sed -n '2p')

[[ -z "$FILE_PATH" ]] && exit 0
[[ -f "$FILE_PATH" ]] || exit 0
# A targeted read (offset/limit) is exactly the recommended behaviour — never nag it.
[[ "$TARGETED" == "1" ]] && exit 0

# Only large files are worth this advisory.
LINES=$(wc -l < "$FILE_PATH" 2>/dev/null | tr -d ' ' || echo 0)
case "$LINES" in ''|*[!0-9]*) LINES=0 ;; esac
[[ "$LINES" -lt 300 ]] && exit 0

# Portable mtime+size signature (BSD stat first, GNU stat fallback).
SIG=$(stat -f '%m:%z' "$FILE_PATH" 2>/dev/null || stat -c '%Y:%s' "$FILE_PATH" 2>/dev/null || echo "")
[[ -z "$SIG" ]] && exit 0

SESSION="${CLAUDE_SESSION_ID:-default}"
if command -v shasum >/dev/null 2>&1; then
  KEY=$(printf '%s' "$FILE_PATH" | shasum | cut -d' ' -f1)
elif command -v sha1sum >/dev/null 2>&1; then
  KEY=$(printf '%s' "$FILE_PATH" | sha1sum | cut -d' ' -f1)
else
  exit 0
fi

STATE_FILE="/tmp/aisha-advise-read-${SESSION}-${KEY}"
PREV=$(cat "$STATE_FILE" 2>/dev/null || echo "")
printf '%s' "$SIG" > "$STATE_FILE" 2>/dev/null || true

# First read in this session, or the file genuinely changed → no advisory.
[[ -z "$PREV" ]] && exit 0
[[ "$PREV" != "$SIG" ]] && exit 0

aisha_advise_cooldown "context-reuse-${KEY}" 300 || exit 0

cat <<EOF
⚠️  AISHA Advisor — Context Reuse (advisory)

Znovu čteš celý soubor, který jsi v této session už četl a od té doby se NEZMĚNIL:

  ${FILE_PATH}  (${LINES} řádků, stejné mtime i velikost)

EOF
cat <<'EOF'
Pravidlo agent-ops-context-reuse: nerutinní reread velkých dokumentů. Nejdřív
zjisti, co se reálně změnilo, nebo se zeptej cíleně:

  git diff --name-only        # co se vůbec změnilo
  git log -- <soubor>         # změnil se ten soubor?
  grep -n "<symbol>" <soubor> # cílený dotaz místo celého souboru
  Read s offset/limit         # jen ta část, kterou potřebuješ

Plný reread je namístě při: novém vlákně / přepnutí kontextu, chybějícím
kontextu, zjištěné změně souboru, pochybnosti o aktuálnosti pravidla.

Advisory only — nepovinné, agent rozhodne.
EOF
exit 0

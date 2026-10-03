#!/usr/bin/env bash
# aisha-advise-zadani-scope.sh — Advisory: zadani-scope (delegace, DELEGATION_PLAN §6.2).
# Ručně autorováno (non-managed) — NENÍ generováno přes gen:ide; přežije regeneraci
# díky mergeHookEvent (non-managed položky se zachovávají).
# Hook type: PreToolUse (Edit|Write|MultiEdit). Always exits 0 (advisory only).
#
# Fire-uje, když edit míří mimo in_scope globy aktivního zadání (.aisha/zadani.json).
# Bez aktivního zadání je ticho — hook se týká jen delegovaných sessions.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

ZADANI_FILE="${CLAUDE_PROJECT_DIR:-.}/.aisha/zadani.json"
[[ -f "$ZADANI_FILE" ]] || exit 0

INPUT="${CLAUDE_HOOK_TOOL_INPUT:-${TOOL_INPUT:-}}"
if [[ -z "$INPUT" && ! -t 0 ]]; then INPUT="$(cat || true)"; fi
[[ -z "$INPUT" ]] && exit 0

# Vrátí "OK" pokud file_path (stdin JSON tool input) padne do in_scope globů,
# "OUT <wp_id> <path>" pokud ne. Prázdno při chybě/neúplných datech.
RESULT=$(printf '%s' "$INPUT" | python3 -c '
import json, sys
from fnmatch import fnmatch
try:
    tool_input = json.loads(sys.stdin.read())
    zadani = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
path = tool_input.get("file_path", "")
globs = zadani.get("in_scope", [])
wp = zadani.get("wp_id", "?")
if not path or not globs:
    sys.exit(0)
# Implicitně vždy in-scope: zadani docs, .aisha meta, scratch poznámky.
always = ["docs/planning/zadani/*", ".aisha/*", "*.scratch.md"]
def hit(p, g):
    # fnmatch nechápe "**" jako path-crossing — normalizuj na "*" match po segmentech
    return fnmatch(p, g) or fnmatch(p, g.replace("**", "*")) or (
        g.endswith("/**") and p.startswith(g[:-3].rstrip("/") + "/"))
for g in list(globs) + always:
    if hit(path, g):
        print("OK"); sys.exit(0)
print(f"OUT {wp} {path}")
' "$ZADANI_FILE" 2>/dev/null)

case "$RESULT" in
  OUT\ *) ;;
  *) exit 0 ;;
esac

WP_ID=$(printf '%s' "$RESULT" | awk '{print $2}')
FILE_PATH=$(printf '%s' "$RESULT" | cut -d' ' -f3-)

aisha_advise_cooldown "zadani-scope" 45 || exit 0

cat <<AISHA_ADVISORY_END
⚠️  AISHA Advisor — zadani-scope (delegace, advisory)

Edit souboru "${FILE_PATH}" míří MIMO in-scope globy aktivního zadání ${WP_ID}.
Dle DELEGATION_PLAN §4 je scope kontrakt — OUT-of-scope práce patří do jiného WP nebo eskalace.

Doporučení: ověř §3 (Scope) v souboru zadání; pokud je změna nutná, zapiš ji do handback poznámky a eskaluj.
Advisory only — agent rozhodne. Cooldown: 45s.
AISHA_ADVISORY_END
exit 0

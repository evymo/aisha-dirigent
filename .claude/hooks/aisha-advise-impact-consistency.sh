#!/usr/bin/env bash
# aisha-advise-impact-consistency.sh — Advisory: new doc next to an existing one on the same topic.
# Hook type: PreToolUse (Write). Always exits 0 (advisory only).
#
# Enforcement point for expert rule: agent-ops-impact-consistency.
# Two failure modes this catches:
#  1. Fragmentation — a new file for information that belongs in an existing living
#     document. One topic ends up scattered across many small files and rots.
#  2. Unresolved contradiction — the new text supersedes / narrows / conflicts with
#     an existing document and nobody says which one now holds.
#
# The hard half of this rule (never retroactively rewrite an immutable baseline)
# is enforced separately by block-baseline-edit.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

INPUT="${CLAUDE_HOOK_TOOL_INPUT:-}"
[[ -z "$INPUT" ]] && exit 0

FILE_PATH=$(printf '%s' "$INPUT" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("file_path",""))
except Exception: pass' 2>/dev/null || true)
[[ -z "$FILE_PATH" ]] && exit 0

# Only prose/doctrine artifacts.
case "$FILE_PATH" in
  *.md) ;;
  *) exit 0 ;;
esac

# Only a NEW file — overwriting an existing doc is the behaviour we want.
[[ -e "$FILE_PATH" ]] && exit 0

DIR=$(dirname "$FILE_PATH")
[[ -d "$DIR" ]] || exit 0
BASE=$(basename "$FILE_PATH" .md)

# Tokenise the basename; keep tokens long enough to be topical, drop date-ish noise.
TOKENS=$(printf '%s' "$BASE" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '\n' \
  | grep -vE '^[0-9]+$' | awk 'length($0) >= 4' | sort -u)
[[ -z "$TOKENS" ]] && exit 0

# Find sibling docs sharing a topical token.
declare -a NEAR=()
while IFS= read -r sibling; do
  [[ -z "$sibling" ]] && continue
  sib_base=$(basename "$sibling" .md | tr '[:upper:]' '[:lower:]')
  while IFS= read -r tok; do
    [[ -z "$tok" ]] && continue
    if printf '%s' "$sib_base" | grep -q "$tok"; then
      NEAR+=("$(basename "$sibling")")
      break
    fi
  done <<< "$TOKENS"
done <<< "$(find "$DIR" -maxdepth 1 -name '*.md' -type f 2>/dev/null | head -60)"

[[ ${#NEAR[@]} -eq 0 ]] && exit 0

aisha_advise_cooldown "impact-consistency" 90 || exit 0

cat <<EOF
⚠️  AISHA Advisor — Impact Consistency (advisory)

Zakládáš nový dokument:

  ${FILE_PATH}

Ve stejném adresáři už jsou dokumenty ke stejnému tématu:

EOF
for n in "${NEAR[@]}"; do
  printf '  • %s\n' "$n"
done
cat <<'EOF'

Pravidlo agent-ops-impact-consistency — nová informace ≠ nový soubor:

  1. Existuje-li živý dokument ke stejnému tématu → doplň tam (s časovým razítkem).
  2. Nový soubor jen tehdy, když vhodný tematický dokument NEEXISTUJE, a zdůvodni proč.
  3. Stejný poznatek se neopisuje do více souborů — detail žije na jednom místě,
     ostatní odkazují.

A urči dopad vůči existujícímu — právě jeden ze tří verdiktů:

  Supersedes          → starší přepiš / označ jako historický / odkaž na novější.
  Scoped coexistence  → platí obojí, ale jinde; napiš výslovně kdy platí která verze.
  Conflict            → rozpor bez jasné přednosti → NEZAVÍREJ jako hotové,
                        vrať do rozhodovacího režimu.

Rozpor zapsaný jako "hotovo" je horší než rozpor přiznaný.

Advisory only — nepovinné, agent rozhodne.
EOF
exit 0

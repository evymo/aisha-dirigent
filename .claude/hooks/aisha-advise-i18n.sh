#!/usr/bin/env bash
# aisha-advise-i18n.sh — Advisory: hardcoded text in JSX → suggest t("key").
# Hook type: PreToolUse (Edit | Write | MultiEdit). Always exits 0 (advisory only).
#
# Heuristic: detect JSX text content (>… <) or attribute values containing 4+ word chars
# that look like prose (have a lowercase letter and a space, OR start with a capital).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

INPUT="${CLAUDE_HOOK_TOOL_INPUT:-}"
[[ -z "$INPUT" ]] && exit 0

FILE_PATH=$(printf '%s' "$INPUT" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("file_path",""))
except: pass' 2>/dev/null || true)
# Only check React component files
case "$FILE_PATH" in
  *.tsx|*.jsx) ;;
  *) exit 0 ;;
esac

NEW_TEXT=$(printf '%s' "$INPUT" | aisha_extract_new_text)

# Detect JSX text node with prose: >Some text here< (3+ words OR 12+ chars with space + lowercase)
# Loose pattern — meant as a flagger, not a perfect lint.
HAS_PROSE_JSX=$(printf '%s' "$NEW_TEXT" | grep -cE '>[^<>{}]*[a-z]+[[:space:]]+[a-zA-Z]+[^<>{}]*<' || true)

# Detect attribute strings with prose: placeholder="Search products..."  label="User name"
HAS_PROSE_ATTR=$(printf '%s' "$NEW_TEXT" | grep -cE '(placeholder|label|title|alt|aria-label)\s*=\s*"[^"{}]*[a-z][a-z][a-z][[:space:]]+[a-zA-Z]+[^"{}]*"' || true)

if [[ "${HAS_PROSE_JSX:-0}" -eq 0 ]] && [[ "${HAS_PROSE_ATTR:-0}" -eq 0 ]]; then
  exit 0
fi

# Skip if t( is also present in the new text — likely the developer is using i18n elsewhere in same edit
if printf '%s' "$NEW_TEXT" | grep -qE '\bt\(\s*['"'"'"`][a-zA-Z0-9_.]+['"'"'"`]'; then
  # Has t() calls, advisory still useful but lower confidence. Keep cooldown longer.
  aisha_advise_cooldown "i18n-mixed" 120 || exit 0
else
  aisha_advise_cooldown "i18n-hardcoded" 45 || exit 0
fi

cat <<'EOF'
⚠️  AISHA Advisor — i18n law (advisory)

Detekuji hardcoded text v JSX/attributes — vypadá to jako prose, ne identifikátor.

AISHA Development Law #4: všechen UI text přes useTranslation() / t("key"),
žádné hardcoded stringy v JSX.

Doporučený postup:
  - const { t } = useTranslation();
  - <Button>{t("submit")}</Button>  místo  <Button>Submit</Button>
  - placeholder={t("search.placeholder")}
  - Přidej EN klíč do src/i18n/segments/en/*.json + CS do cs/*.json
  - npm run i18n:check before commit

Heuristika je loose — pokud jde o ne-překládatelný text (kód, ID, debug), ignoruj.

Advisory only — nepovinné, agent rozhodne.
EOF
exit 0

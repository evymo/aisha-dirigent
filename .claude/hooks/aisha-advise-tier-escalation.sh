#!/usr/bin/env bash
# aisha-advise-tier-escalation.sh — Advisory: tier-escalation (delegace, DELEGATION_PLAN §3).
# Ručně autorováno (non-managed) — NENÍ generováno přes gen:ide; přežije regeneraci
# díky mergeHookEvent (non-managed položky se zachovávají).
# Hook type: PreToolUse (Edit|Write|MultiEdit). Always exits 0 (advisory only).
#
# Fire-uje, když aktivní zadání (.aisha/zadani.json) má tier B/C a edit míří na
# Tier-A-only třídu práce: SECURITY DEFINER / RLS / GRANT-REVOKE / migrace / auth.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

ZADANI_FILE="${CLAUDE_PROJECT_DIR:-.}/.aisha/zadani.json"
[[ -f "$ZADANI_FILE" ]] || exit 0

INPUT="${CLAUDE_HOOK_TOOL_INPUT:-${TOOL_INPUT:-}}"
if [[ -z "$INPUT" && ! -t 0 ]]; then INPUT="$(cat || true)"; fi
[[ -z "$INPUT" ]] && exit 0

read_zadani_field() {
  python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print(d.get(sys.argv[2], ""))
except Exception:
    pass
' "$ZADANI_FILE" "$1" 2>/dev/null
}

TIER="$(read_zadani_field tier)"
WP_ID="$(read_zadani_field wp_id)"
# Tier A (nebo neznámý) smí Tier-A práci — ticho.
[[ "$TIER" == "B" || "$TIER" == "C" ]] || exit 0

extract_file_path() {
  python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(d.get("file_path", ""))
except Exception:
    pass
' 2>/dev/null
}

FILE_PATH=$(printf '%s' "$INPUT" | extract_file_path)
NEW_TEXT=$(printf '%s' "$INPUT" | aisha_extract_new_text)

# Dokumentace a meta soubory netriggerují (psaní zadání/poznámek je OK).
case "$FILE_PATH" in
  docs/*|.claude/*|.aisha/*|*.md) exit 0 ;;
esac

TIER_A_HIT=""
# Obsahové patterny Tier-A práce (bezpečnostní substrát DB).
if printf '%s' "$NEW_TEXT" | grep -qiE 'SECURITY[[:space:]]+DEFINER|(CREATE|ALTER)[[:space:]]+POLICY|ENABLE[[:space:]]+ROW[[:space:]]+LEVEL[[:space:]]+SECURITY|^[[:space:]]*(GRANT|REVOKE)[[:space:]]'; then
  TIER_A_HIT="obsah: RPC/RLS/GRANT substrát"
fi
# Cestové patterny Tier-A práce.
case "$FILE_PATH" in
  aisha/db/migrations/*|*baseline*) TIER_A_HIT="${TIER_A_HIT:+$TIER_A_HIT; }cesta: migrace/baseline" ;;
  packages/security/*|*/auth.ts|*/auth/*) TIER_A_HIT="${TIER_A_HIT:+$TIER_A_HIT; }cesta: auth/security vrstva" ;;
esac

[[ -z "$TIER_A_HIT" ]] && exit 0

aisha_advise_cooldown "tier-escalation" 45 || exit 0

cat <<AISHA_ADVISORY_END
⚠️  AISHA Advisor — tier-escalation (delegace, advisory)

Aktivní zadání ${WP_ID:-?} běží jako Tier ${TIER}, ale tento edit vypadá jako Tier-A práce (${TIER_A_HIT}).
Dle DELEGATION_PLAN §3 patří RPC SECURITY DEFINER / RLS / GRANT / migrace / auth vrstva na Tier A (Fable 5 / Opus 4.8).

Doporučení: zastav se, zapiš rozpracovaný stav do handback poznámky zadání a eskaluj na Tier-A session.
Advisory only — agent rozhodne. Cooldown: 45s.
AISHA_ADVISORY_END
exit 0

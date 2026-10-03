#!/usr/bin/env bash
# aisha-advise-retry-loop.sh — Advisory: identical command repeated → bounded-loop rule.
# Hook type: PreToolUse (Bash). Always exits 0 (advisory only).
#
# Enforcement point for expert rule: agent-ops-bounded-self-correction.
# An agent that keeps re-running the same command is usually inside an unbounded
# fix→re-verify loop. The rule caps it: max 3 passes, and an IDENTICAL repeated
# failure stops immediately — a repeated identical error means the causal model is
# wrong, and another attempt will not fix it, only cost more.
#
# Detection uses the tool INPUT only (command identity), not the result: a command
# re-run verbatim 3+ times in one session is the observable signature of the loop.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

INPUT="${CLAUDE_HOOK_TOOL_INPUT:-}"
[[ -z "$INPUT" ]] && exit 0

CMD=$(printf '%s' "$INPUT" | aisha_extract_bash_command)
[[ -z "$CMD" ]] && exit 0

# Read-only / navigational commands legitimately repeat — not a fix loop.
if printf '%s' "$CMD" | grep -qE '^[[:space:]]*(ls|pwd|echo|cat|head|tail|wc|find|grep|which|date|git[[:space:]]+(status|diff|log|branch|show))\b'; then
  exit 0
fi

SESSION="${CLAUDE_SESSION_ID:-default}"
# Normalise whitespace so cosmetic reformatting still counts as the same command.
NORM=$(printf '%s' "$CMD" | tr -s '[:space:]' ' ' | sed -e 's/^ //' -e 's/ $//')
if command -v shasum >/dev/null 2>&1; then
  HASH=$(printf '%s' "$NORM" | shasum | cut -d' ' -f1)
elif command -v sha1sum >/dev/null 2>&1; then
  HASH=$(printf '%s' "$NORM" | sha1sum | cut -d' ' -f1)
else
  exit 0
fi

COUNT_FILE="/tmp/aisha-advise-retry-${SESSION}-${HASH}"
COUNT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
case "$COUNT" in ''|*[!0-9]*) COUNT=0 ;; esac
COUNT=$((COUNT + 1))
printf '%s' "$COUNT" > "$COUNT_FILE" 2>/dev/null || true

# 1st and 2nd run are the allowed passes (attempt + one correction). Advise from the 3rd.
[[ "$COUNT" -lt 3 ]] && exit 0

aisha_advise_cooldown "retry-loop-${HASH}" 120 || exit 0

SHORT=$(printf '%s' "$NORM" | cut -c1-90)
cat <<EOF
⚠️  AISHA Advisor — Ohraničená sebeopravná smyčka (advisory)

Tento příkaz jsi v této session spustil už ${COUNT}×:

  ${SHORT}

EOF
cat <<'EOF'
Pravidlo agent-ops-bounded-self-correction — smyčka má tvrdý strop:

  • Strop pokusů: max 3 průchody auditem (= 2 pokusy o opravu).
  • Repeated-error stop: zopakuje-li se po opravě IDENTICKÁ chyba, zastav ihned.
    Nečekej na vyčerpání zbylých pokusů — identická chyba znamená, že model
    příčiny je špatný; další pokus ji neopraví, jen zdraží.
  • Scope stop: leží-li příčina mimo schválený scope, zastav a nahlas blocker.
    Nikdy neopravuj tiše přes hranici scope.

Při zastavení brzdou: NEKOMITUJ, NEDEPLOYUJ. Nahlas poslední selhání, analýzu
příčiny a co jsi zkusil. Rozhodnutí se vrací člověku.

Pokud jde o legitimní opakování (watch, poll, jiný vstup), ignoruj.

Advisory only — nepovinné, agent rozhodne.
EOF
exit 0

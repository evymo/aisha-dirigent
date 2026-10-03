#!/usr/bin/env bash
# aisha-advise-placeholder-cmd.sh — Advisory: placeholder tokens in a runnable command.
# Hook type: PreToolUse (Bash). Always exits 0 (advisory only).
#
# Enforcement point for expert rule: agent-ops-no-placeholder-commands.
# A command handed over with <DB_HOST> / {{TOKEN}} / YOUR_API_KEY is either run
# verbatim (and fails, or worse, hits the wrong target) or silently ignored.
# Není-li hodnota známá, nejdřív ji zjisti nebo si ji vyžádej — příkaz je buď
# přímo spustitelný, nebo to není příkaz.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

INPUT="${CLAUDE_HOOK_TOOL_INPUT:-}"
[[ -z "$INPUT" ]] && exit 0

CMD=$(printf '%s' "$INPUT" | aisha_extract_bash_command)
[[ -z "$CMD" ]] && exit 0

declare -a HITS=()

# <DB_HOST>, <TOKEN>, <ID> — angle-bracketed SCREAMING placeholders.
# Shell redirects (2>&1, < file) and heredocs (<<'EOF') do not match: the pattern
# requires uppercase word chars enclosed by < and >.
MATCH=$(printf '%s' "$CMD" | grep -oE '<[A-Z][A-Z0-9_]+>' | sort -u | tr '\n' ' ' || true)
if [[ -n "${MATCH// /}" ]]; then
  HITS+=("Angle placeholder: ${MATCH}")
fi

# {{VAR}} — template placeholders.
MATCH=$(printf '%s' "$CMD" | grep -oE '\{\{[A-Za-z_][A-Za-z0-9_]*\}\}' | sort -u | tr '\n' ' ' || true)
if [[ -n "${MATCH// /}" ]]; then
  HITS+=("Template placeholder: ${MATCH}")
fi

# YOUR_API_KEY / YOUR_TOKEN style.
MATCH=$(printf '%s' "$CMD" | grep -oE '\bYOUR_[A-Z0-9_]+\b' | sort -u | tr '\n' ' ' || true)
if [[ -n "${MATCH// /}" ]]; then
  HITS+=("Sample-value placeholder: ${MATCH}")
fi

# <your-token>, <path-to-file> — lowercase hyphenated angle placeholders.
MATCH=$(printf '%s' "$CMD" | grep -oE '<(your|path|my)-[a-z0-9-]+>' | sort -u | tr '\n' ' ' || true)
if [[ -n "${MATCH// /}" ]]; then
  HITS+=("Doc-style placeholder: ${MATCH}")
fi

[[ ${#HITS[@]} -eq 0 ]] && exit 0

aisha_advise_cooldown "placeholder-cmd" 45 || exit 0

cat <<'EOF'
⚠️  AISHA Advisor — Placeholder v příkazu (advisory)

Tento příkaz obsahuje zástupný token, ne skutečnou hodnotu:

EOF
for h in "${HITS[@]}"; do
  printf '  • %s\n' "$h"
done
cat <<'EOF'

Pravidlo agent-ops-no-placeholder-commands: příkaz je buď přímo spustitelný,
nebo nemá být formulován jako příkaz.

  - Není-li hodnota známá → nejdřív ji ověř (grep konfigu, `git config`, API),
    nebo si ji vyžádej.
  - Potřebuješ-li ukázat tvar příkazu, označ ho jako ukázku, ne jako krok
    k provedení.

Placeholder spuštěný doslova buď selže, nebo — hůř — trefí špatný cíl.

Advisory only — nepovinné, agent rozhodne.
EOF
exit 0

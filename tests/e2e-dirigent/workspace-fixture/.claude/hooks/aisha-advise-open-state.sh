#!/usr/bin/env bash
# aisha-advise-open-state.sh — Advisory: disclose open state at closure; escalate UNCLEAR.
# Hook type: Stop. Always exits 0 (advisory only).
#
# Enforcement point for expert rules:
#   agent-ops-unclear-escalation      (three-state answer: NO / YES / UNCLEAR → escalate)
#   agent-ops-stop-is-not-closure     ("nedělej nic" ends actions, not the duty to disclose)
#
# The most dangerous state is an open problem everyone believes is closed. Work was
# done in this session (the tree is dirty), so closure is a real moment: say what is
# verified, what is open, and what you could not decide. Silence after "stop" reads
# as "done".
#
# Long cooldown — this is a periodic closure reminder, not a per-turn nag.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Only when work actually happened — a clean tree has nothing to disclose.
PORCELAIN=$(git status --porcelain 2>/dev/null || echo "")
DIRTY=$(printf '%s' "$PORCELAIN" | grep -c . || true)
case "$DIRTY" in ''|*[!0-9]*) DIRTY=0 ;; esac
[[ "$DIRTY" -eq 0 ]] && exit 0

# The backlog brake owns the large-backlog case — don't double-fire on top of it.
UNPUSHED=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
case "$UNPUSHED" in ''|*[!0-9]*) UNPUSHED=0 ;; esac
[[ $((DIRTY + UNPUSHED)) -gt 20 ]] && exit 0

aisha_advise_cooldown "open-state" 1800 || exit 0

cat <<'EOF'
ℹ️  AISHA Advisor — Uzávěrka: přiznej otevřený stav (advisory)

V této session vznikly změny. Než to uzavřeš:

Pravidlo agent-ops-stop-is-not-closure:
  Pokyn "nedělej nic" / "stop" ruší AKCE, neruší povinnost přiznat otevřený stav.
  Neznamená to tvářit se, že je závěr uzavřený, když se nerozhodlo, ani nahradit
  povinnou kontrolu obecným shrnutím.

Pravidlo agent-ops-unclear-escalation:
  Rozhodovací brána vrací TŘI stavy, ne dva:
    NO      – neuplatní se; pokračuj.
    YES     – uplatní se; proveď proceduru.
    UNCLEAR – neumím rozhodnout → ESKALUJ na člověka.
  YES ani UNCLEAR nesmí zůstat jako poznámka bez akce. Musí následovat konkrétní
  krok, prompt, plán, nebo EXPLICITNÍ blocker s důvodem. Odkládáš-li akci, řekni proč.

Také platí: odevzdává se finální výstup, ne draft s příslibem pozdějšího vylepšení.
Jsou-li varianty rovnocenné nebo závisí-li volba na rozhodnutí mimo tebe, uveď
rozdíl a vyžádej rozhodnutí. Nejistota se nesmí maskovat stylistickou jistotou.

Zkontroluj, že jsi řekl:
  • co je ověřené (a čím — ne "mělo by to fungovat"),
  • co zůstává otevřené,
  • co jsi nemohl rozhodnout a kdo to má rozhodnout.

Advisory only — nepovinné, agent rozhodne.
EOF
exit 0

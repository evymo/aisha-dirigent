#!/usr/bin/env bash
# aisha-advise-closure-backlog.sh — Advisory: anti-backlog brake at task closure.
# Hook type: Stop. Always exits 0 (advisory only).
#
# Enforcement point for expert rule: agent-ops-closure-backlog-brake.
# Born from a real failure mode: execution tools walk away from a task leaving
# hundreds of files in an uncommitted / untracked / unpushed limbo, and the cleanup
# is manual and expensive. The brake: once the backlog outgrows the expected scope
# of the task, STOP and report — never a blind bulk commit, never a push.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

PORCELAIN=$(git status --porcelain 2>/dev/null || echo "")
DIRTY=$(printf '%s' "$PORCELAIN" | grep -c . || true)
UNTRACKED=$(printf '%s' "$PORCELAIN" | grep -c '^??' || true)
UNPUSHED=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
case "$DIRTY" in ''|*[!0-9]*) DIRTY=0 ;; esac
case "$UNTRACKED" in ''|*[!0-9]*) UNTRACKED=0 ;; esac
case "$UNPUSHED" in ''|*[!0-9]*) UNPUSHED=0 ;; esac

# ~20 is a catch threshold, not dogma: the point is that a large backlog never
# slips past without a human decision.
THRESHOLD=20
TOTAL=$((DIRTY + UNPUSHED))
[[ "$TOTAL" -le "$THRESHOLD" ]] && exit 0

aisha_advise_cooldown "closure-backlog" 300 || exit 0

BRANCH=$(git branch --show-current 2>/dev/null || echo "(detached)")

cat <<EOF
🛑 AISHA Advisor — Post-Task Closure Gate: STOP (advisory)

Backlog přerostl očekávaný rozsah úkolu:

  Větev:              ${BRANCH}
  Změněné soubory:    ${DIRTY}  (z toho untracked: ${UNTRACKED})
  Necommitnuté ahead: ${UNPUSHED}
  Celkem:             ${TOTAL}  (práh ~${THRESHOLD})

EOF
cat <<'EOF'
Pravidlo agent-ops-closure-backlog-brake:

  Žádná úloha není hotová, dokud není repozitář srovnaný. Přeroste-li počet
  nevyřízených změn očekávaný rozsah úkolu — nebo obsahuje-li soubory
  NESOUVISEJÍCÍ se zadáním — ZASTAV a nahlas dřív, než uděláš cokoliv dalšího.

  ŽÁDNÝ hromadný commit "naslepo". ŽÁDNÝ push.

Povinný výstup uzávěrky:

  Closure Gate: CLEAN / RESOLVED / STOP
  Working tree:
  Ahead/behind remote:
  Zbylé soubory a jejich zařazení (commit / ignore / move / ponechat + důvod):
  Doporučená akce (push / pull / žádná):
  Pokud STOP: důvod a co čeká na rozhodnutí.

Každý zbylý soubor musí být výslovně zařazen. Nezůstává anonymní nevyřízený balík.

  git status --short          # co tam vlastně je
  git diff --stat             # rozsah změn

Je-li ten objem legitimní (velký refactor, generované artefakty), řekni to nahlas
a zdůvodni — brzda má vynutit rozhodnutí, ne ho nahradit.

Advisory only — nepovinné, agent rozhodne.
EOF
exit 0

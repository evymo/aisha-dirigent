#!/usr/bin/env bash
# aisha-advise-repo-state.sh — Advisory: repo state before a write-side git command.
# Hook type: PreToolUse (Bash). Always exits 0 (advisory only).
#
# Enforcement point for expert rule: agent-ops-repo-state-gate.
# Work that writes to the repo must start from a known-clean state, not discover the
# mess at commit time. Detects: rozdělaný merge/rebase/cherry-pick, unmerged paths,
# detached HEAD, behind-remote (a non-ff pull is coming).
#
# Advisory only — hard repo guards (block-baseline-edit.sh) are separate.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

INPUT="${CLAUDE_HOOK_TOOL_INPUT:-}"
[[ -z "$INPUT" ]] && exit 0

CMD=$(printf '%s' "$INPUT" | aisha_extract_bash_command)
[[ -z "$CMD" ]] && exit 0

# Only write-side git commands — read-only git is not a repo-state risk.
printf '%s' "$CMD" | grep -qE 'git[[:space:]]+(commit|push|merge|rebase|cherry-pick)\b' || exit 0

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

declare -a HITS=()

GIT_DIR=$(git rev-parse --git-dir 2>/dev/null || echo "")
if [[ -n "$GIT_DIR" ]]; then
  if [[ -f "$GIT_DIR/MERGE_HEAD" ]]; then
    HITS+=("Rozdělaný MERGE (MERGE_HEAD existuje) — dokonči, nebo abortuj, než zapíšeš dál.")
  fi
  if [[ -d "$GIT_DIR/rebase-merge" ]] || [[ -d "$GIT_DIR/rebase-apply" ]]; then
    HITS+=("Rozdělaný REBASE — dokonči (--continue), nebo abortuj (--abort).")
  fi
  if [[ -f "$GIT_DIR/CHERRY_PICK_HEAD" ]]; then
    HITS+=("Rozdělaný CHERRY-PICK — dokonči, nebo abortuj.")
  fi
fi

# Unmerged paths — a commit would record conflict markers as "resolved".
if git status --porcelain 2>/dev/null | grep -E '^(UU|AA|DD|AU|UA|DU|UD)' >/dev/null; then
  HITS+=("Nevyřešené konflikty (unmerged paths) — commit by je zapsal jako vyřešené.")
fi

# Detached HEAD — commit nevisí na větvi a snadno se ztratí.
if ! git symbolic-ref -q HEAD >/dev/null 2>&1; then
  HITS+=("Detached HEAD — commit se neváže na žádnou větev a snadno se ztratí.")
fi

# Behind upstream (reflects the last fetch — informativní, ne autoritativní).
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo "")
if [[ -n "$UPSTREAM" ]]; then
  BEHIND=$(git rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)
  if [[ "${BEHIND:-0}" -gt 0 ]]; then
    HITS+=("Jsi ${BEHIND} commitů za ${UPSTREAM} (dle posledního fetch) — 'git pull --ff-only' napřed; selže-li ff, zastav.")
  fi
fi

[[ ${#HITS[@]} -eq 0 ]] && exit 0

aisha_advise_cooldown "repo-state" 90 || exit 0

cat <<'EOF'
⚠️  AISHA Advisor — Repo State Gate (advisory)

Zapisuješ do repa, ale výchozí stav není čistý:

EOF
for h in "${HITS[@]}"; do
  printf '  • %s\n' "$h"
done
cat <<'EOF'

Pravidlo agent-ops-repo-state-gate: práce, která může zapsat do repozitáře, má
začínat ze známého čistého stavu. Vstupní kontrola provedená až při commitu už
není vstupní kontrola.

Při nesouladu: zastav, popiš blokující okolnost, nic neuprav, vyžádej rozhodnutí.
Neobcházej to předpokladem "pravděpodobně nevadí".

Advisory only — nepovinné, agent rozhodne.
EOF
exit 0

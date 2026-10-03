#!/usr/bin/env bash
# aisha-advise-bash-risk.sh — Advisory: warn about destructive bash commands.
# Hook type: PreToolUse (Bash). Always exits 0 (advisory only — repo-safety guards live elsewhere).
#
# Per the Dirigent advisory principle: we WARN, we never BLOCK. If a hard block on
# certain commands is desired, that's a separate repo-safety hook (analog block-baseline-edit.sh),
# not Dirigent expert opinion.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

INPUT="${CLAUDE_HOOK_TOOL_INPUT:-}"
[[ -z "$INPUT" ]] && exit 0

CMD=$(printf '%s' "$INPUT" | aisha_extract_bash_command)
[[ -z "$CMD" ]] && exit 0

declare -a HITS=()

# git push --force / -f to main/master branch
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+push[[:space:]]+(--force|-f)\b'; then
  if printf '%s' "$CMD" | grep -qE '(\b|/)(main|master|prod|production)\b'; then
    HITS+=("git push --force na chráněnou větev — historie se přepíše napříč týmem.")
  else
    HITS+=("git push --force — zvaž --force-with-lease, který je bezpečnější.")
  fi
fi

# git reset --hard
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard\b'; then
  HITS+=("git reset --hard — všechny lokální změny zmizí. Stash/branch nejdřív?")
fi

# rm -rf with broad scope
if printf '%s' "$CMD" | grep -qE 'rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-rf|-fr)\b'; then
  if printf '%s' "$CMD" | grep -qE 'rm[[:space:]]+(-[rfRF]+)[[:space:]]+(/|~|\$HOME|\.{1,2}/?)([[:space:]]|$)'; then
    HITS+=("rm -rf na root/HOME — obvykle se mažou jen subdirs jako node_modules/dist.")
  fi
fi

# --no-verify on git commit/push (skips hooks)
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+(commit|push)[[:space:]].*--no-verify\b'; then
  HITS+=("--no-verify obejde pre-commit/pre-push gate — pokud hook fail, je to obvykle signál, ne překážka.")
fi

# HUSKY=0 — druhá cesta, jak vypnout tytéž hooky
#
# ⛔ DOPLNĚNO 2026-08-10. Větev výš hlídala jen `--no-verify`, takže `HUSKY=0`
# prošla bez povšimnutí — a je to přitom TÁŽ věc jiným vchodem: vypne pre-commit
# i pre-push. Dlouhý hook se řeší ČASEM (běh na pozadí + `AISHA_SMOKE_TIMEOUT_MS`),
# ne vypnutím měření.
if printf '%s' "$CMD" | grep -qE '(^|[[:space:];&|])HUSKY=0\b'; then
  HITS+=("HUSKY=0 vypne pre-commit i pre-push — táž věc jako --no-verify, jen jiným vchodem. Dlouhý hook se řeší časem (pozadí + AISHA_SMOKE_TIMEOUT_MS), ne vypnutím.")
fi

# `git commit -n` je zkratka pro --no-verify.
# ⚠️ ÚZKO ZÁMĚRNĚ: u `git push` znamená `-n` DRY-RUN, tedy pravý opak rizika.
# Plošné hledání `-n` by hlásilo poplach nad neškodnou zkouškou nasucho a hook
# by se tím naučil ignorovat.
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+commit[[:space:]].*[[:space:]]-n\b'; then
  HITS+=("git commit -n je zkratka pro --no-verify — obejde pre-commit gate.")
fi

# Bypass GPG signing
if printf '%s' "$CMD" | grep -qE '(--no-gpg-sign|commit\.gpgsign=false)\b'; then
  HITS+=("Vypnutí GPG podpisu — pokud projekt vyžaduje signed commits, audit trail to zaznamená.")
fi

# DROP TABLE / DROP DATABASE / TRUNCATE
if printf '%s' "$CMD" | grep -qiE '(DROP[[:space:]]+TABLE|DROP[[:space:]]+DATABASE|TRUNCATE[[:space:]]+TABLE)'; then
  HITS+=("DROP/TRUNCATE — destruktivní vůči datům. Ověř, že běží proti lokální DB, ne v cloudu.")
fi

# AISHA local DB reset (npm run db:reset / npm run db:migrate:local --reset)
if printf '%s' "$CMD" | grep -qE 'npm[[:space:]]+run[[:space:]]+db:(reset|refreshdb)\b'; then
  HITS+=("npm run db:reset / refreshdb — kompletně resetuje lokální DB. Ujisti se, že je to záměr.")
fi

[[ ${#HITS[@]} -eq 0 ]] && exit 0

aisha_advise_cooldown "bash-risk" 30 || exit 0

cat <<'EOF'
⚠️  AISHA Advisor — Bash risk (advisory)

Detekuji potenciálně destruktivní příkaz:

EOF
for h in "${HITS[@]}"; do
  printf '  • %s\n' "$h"
done
cat <<'EOF'

Tyto příkazy jsou v některých scénářích legitimní (cleanup, recovery), v jiných
ztratí práci. Zvaž důvod a alternativy:
  - git stash / nová větev místo --hard reset
  - --force-with-lease místo --force push
  - oprava failujícího hooku místo --no-verify

Advisory only — agent (a user) rozhodnou. Pokud má repo hard guards na destruktivní
příkazy, ty jsou separate od této advisory.
EOF
exit 0

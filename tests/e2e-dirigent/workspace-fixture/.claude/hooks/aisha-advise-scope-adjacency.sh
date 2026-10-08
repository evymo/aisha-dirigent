#!/usr/bin/env bash
# aisha-advise-scope-adjacency.sh — Advisory: high-blast-radius target → needs its own approval.
# Hook type: PreToolUse (Edit | Write | MultiEdit). Always exits 0 (advisory only).
#
# Enforcement point for expert rule: agent-ops-scope-adjacency.
# "Sousedství ≠ souhlas": an ambiguous natural-language instruction gets expanded
# into the widest reading, and for a high-blast target that reading reaches users
# before a reviewer does. Consent for this class never follows from an adjacent or
# generally-worded task — it must be asked for separately.
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

NEW_TEXT=$(printf '%s' "$INPUT" | aisha_extract_new_text)

declare -a HITS=()

# 1. Navigation / routing — what the user sees and clicks.
if printf '%s' "$FILE_PATH" | grep -qiE '(^|/)(routes?|router|navigation|nav|menu|sidebar)([./]|$)|[Rr]outes?\.(ts|tsx|js|jsx)$|[Nn]av(igation)?\.(ts|tsx)$'; then
  HITS+=("Navigace / routing — mění, co uživatel vidí a kam se proklikne.")
fi

# 2. Migration carrying DML (not just DDL) — touches live rows.
if printf '%s' "$FILE_PATH" | grep -qE 'aisha/db/migrations/[0-9]{14}_.*\.sql$'; then
  if printf '%s' "$NEW_TEXT" | grep -qiE '\b(INSERT[[:space:]]+INTO|UPDATE[[:space:]]+[a-z_]+[[:space:]]+SET|DELETE[[:space:]]+FROM|TRUNCATE|DROP[[:space:]]+(TABLE|COLUMN))\b'; then
    HITS+=("Migrace obsahuje DML/destruktivní DDL — sahá na živá data, ne jen na schéma.")
  fi
fi

# 3. Secrets / credentials surface.
if printf '%s' "$FILE_PATH" | grep -qiE '(^|/)\.env|secret|credential|\.pem$|\.key$'; then
  HITS+=("Secrets / credentials — rotace nebo změna má dosah mimo tento repozitář.")
fi

# 4. Deploy / infra topology.
if printf '%s' "$FILE_PATH" | grep -qiE 'docker-compose.*\.ya?ml$|(^|/)compose\.ya?ml$|\.github/workflows/|(^|/)coolify|Dockerfile$'; then
  HITS+=("Deploy / infra topologie — dopad na běžící službu, ne jen na kód.")
fi

# 5. Public visibility / feature flags.
if printf '%s' "$NEW_TEXT" | grep -qiE '\b(feature_?flag|is_public|visibility[[:space:]]*[:=]|hidden_languages|published|enabled[[:space:]]*[:=][[:space:]]*true)\b'; then
  HITS+=("Viditelnost / feature flag — může odkrýt obsah veřejnosti dřív než reviewer.")
fi

[[ ${#HITS[@]} -eq 0 ]] && exit 0

aisha_advise_cooldown "scope-adjacency" 90 || exit 0

cat <<EOF
⚠️  AISHA Advisor — Scope Adjacency Gate (advisory)

Cíl: ${FILE_PATH}

Tohle je zásah s velkým dosahem:

EOF
for h in "${HITS[@]}"; do
  printf '  • %s\n' "$h"
done
cat <<'EOF'

Pravidlo agent-ops-scope-adjacency — sousedství ≠ souhlas:

  Souhlas s touto třídou zásahů NIKDY neplyne ze sousedního nebo obecně
  formulovaného úkolu. Vytvoření entity, existence URL ani "logicky to tam
  patří" samo o sobě neimplikuje souhlas.

Považuješ-li ten zásah za správný a navazující:
  → uveď ho jako SAMOSTATNÝ návrh a zastav se na výslovné potvrzení,
  → neprováděj ho jako součást jiného schváleného zásahu.

Bylo-li to schváleno explicitně, pokračuj — tahle advisory jen brání tomu,
aby souhlas vznikl odvozením.

Advisory only — nepovinné, agent rozhodne.
EOF
exit 0

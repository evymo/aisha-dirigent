#!/usr/bin/env bash
# aisha-advise-contract-change.sh — Advisory: contract-change (delegace, DELEGATION_PLAN §6.2).
# Ručně autorováno (non-managed) — NENÍ generováno přes gen:ide; přežije regeneraci
# díky mergeHookEvent (non-managed položky se zachovávají).
# Hook type: PostToolUse (Edit|Write|MultiEdit). Always exits 0 (advisory only).
#
# Fire-uje po editu, který mění veřejný kontrakt: RPC signaturu (SQL funkce),
# Zod schema v route, nebo exportovaný typ ve sdíleném package. SOLID pravidlo:
# "changes to interfaces require versioning or migration."
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./_aisha-advise-lib.sh
source "$SCRIPT_DIR/_aisha-advise-lib.sh"

INPUT="${CLAUDE_HOOK_TOOL_INPUT:-${TOOL_INPUT:-}}"
if [[ -z "$INPUT" && ! -t 0 ]]; then INPUT="$(cat || true)"; fi
[[ -z "$INPUT" ]] && exit 0

FILE_PATH=$(printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(d.get("file_path", ""))
except Exception:
    pass
' 2>/dev/null)
NEW_TEXT=$(printf '%s' "$INPUT" | aisha_extract_new_text)

[[ -z "$FILE_PATH" || -z "$NEW_TEXT" ]] && exit 0

CONTRACT_KIND=""
case "$FILE_PATH" in
  services/*/src/routes/*.ts)
    if printf '%s' "$NEW_TEXT" | grep -qE 'z\.object\(|schema:|Body:|Params:|Querystring:'; then
      CONTRACT_KIND="Fastify route schema (Zod) — HTTP kontrakt služby"
    fi
    ;;
  aisha/db/*)
    if printf '%s' "$NEW_TEXT" | grep -qiE 'CREATE[[:space:]]+OR[[:space:]]+REPLACE[[:space:]]+FUNCTION|DROP[[:space:]]+FUNCTION'; then
      CONTRACT_KIND="Postgres RPC signatura — DB kontrakt (klienti: web, n8n, služby)"
    fi
    ;;
  packages/*/src/*)
    if printf '%s' "$NEW_TEXT" | grep -qE '^[[:space:]]*export[[:space:]]+(type|interface|function|const)[[:space:]]'; then
      CONTRACT_KIND="exportovaný symbol sdíleného package — build-chain kontrakt"
    fi
    ;;
esac

[[ -z "$CONTRACT_KIND" ]] && exit 0

aisha_advise_cooldown "contract-change" 60 || exit 0

cat <<AISHA_ADVISORY_END
⚠️  AISHA Advisor — contract-change (advisory)

Tento edit se dotýká veřejného kontraktu: ${CONTRACT_KIND}.
Soubor: ${FILE_PATH}

Checklist (SOLID: interface change ⇒ versioning/migration):
  1. Je změna zpětně kompatibilní? Pokud ne → nová verze / nová funkce vedle staré + deprecation.
  2. RPC: existuje SoT pár (aisha/db/sql/ + migrace)? GRANT/REVOKE aktualizován?
  3. Route: prošel edge-fn-validation? Klienti (web hooks, n8n) aktualizováni?
  4. Package export: zkontroluj dependents v Docker build-chains (Dockerfile.svc-*).
  5. V delegované session (Tier B/C): změna kontraktu = eskalační trigger dle zadání §9.

Advisory only — agent rozhodne. Cooldown: 60s.
AISHA_ADVISORY_END
exit 0

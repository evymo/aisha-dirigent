#!/usr/bin/env bash
# Credentials come from the shared canonical chain, not one hardcoded file.
# shellcheck source=scripts/lib/coolify-credentials.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/lib/coolify-credentials.sh" 2>/dev/null || \
  . "$(cd "$(dirname "$0")" && pwd)/lib/coolify-credentials.sh"

# coolify-stack-status.sh — reliable status matrix for all aisha-* apps
# Uses python3 for tolerant JSON parsing (Coolify embeds raw control chars)
set -euo pipefail

cd "$(dirname "$0")/.."
TOKEN="$(config_env_key COOLIFY_API_TOKEN COOLIFY_API_KEY)"
# shellcheck source=scripts/lib/coolify-api-base.sh
source scripts/lib/coolify-api-base.sh
BASE="$(resolve_coolify_api)" || exit 1  # normalizes to <host>/api/v1 (COOLIFY_API|COOLIFY_URL)

[[ -z "${TOKEN}" ]] && { echo "COOLIFY_API_TOKEN missing"; exit 1; }

export TOK="$TOKEN" BASE

python3 <<'PY'
import os, json, re, urllib.request, sys
tok, base = os.environ["TOK"], os.environ["BASE"]
# App-name prefix: story-derived, never hardcoded "aisha" (else a fork sees no apps).
prefix = os.environ.get("APP_NAME_PREFIX") or os.environ.get("AISHA_STORY") or "aisha"

def api(path):
    req = urllib.request.Request(base+path, headers={"Authorization":f"Bearer {tok}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode("utf-8","replace")
    # Coolify embeds ANSI/control chars in logs; strip except \n \r \t
    raw = ''.join(c for c in raw if ord(c) >= 32 or c in '\n\r\t')
    try: return json.loads(raw)
    except json.JSONDecodeError as e:
        # try escaping stray backslashes
        return json.loads(raw.replace("\\","\\\\"))

apps = api("/applications")
rows = []
for a in apps:
    n = a.get("name","")
    if not n.startswith(prefix + "-"): continue
    rows.append((n, a["uuid"], a.get("status","?")))
rows.sort()

print(f"{'APP':<22} {'UUID':<26} {'STATUS':<22} LAST_DEPLOY")
print("-"*100)
for n,u,s in rows:
    try:
        d = api(f"/applications/{u}/deployments?per_page=1")
        last = (d.get("deployments") or [{}])[0].get("status","none")
    except Exception as e:
        last = f"ERR:{type(e).__name__}"
    s_short = s.split("\n",1)[0][:21]
    print(f"  {n:<20} {u:<26} {s_short:<22} {last}")
PY

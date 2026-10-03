#!/usr/bin/env bash
# Validate n8n workflow JSON after Edit/Write.
#
# Checks:
# - Valid JSON
# - Has required top-level fields (name, nodes, connections, settings)
# - settings includes callerPolicy + executionOrder
# - aishaRpc nodes have auditTrail option (advisory)
#
# Triggers on: PostToolUse Write|Edit on n8n/workflows/WF_*.json
# Behavior: emit warning to stderr (does not block)
set -euo pipefail

TARGET=$(echo "${CLAUDE_HOOK_TOOL_INPUT:-}" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')

if [[ -z "$TARGET" ]]; then
  exit 0
fi

if ! [[ "$TARGET" =~ /n8n/workflows/WF_[A-Z_]+\.json$ ]]; then
  exit 0
fi

if [[ ! -f "$TARGET" ]]; then
  exit 0
fi

# Validate JSON
if ! python3 -m json.tool "$TARGET" > /dev/null 2>&1; then
  echo "⚠ n8n workflow invalid JSON: $TARGET" >&2
  exit 0  # advisory
fi

# Field checks via python
python3 <<PYEOF
import json, sys

try:
    with open("$TARGET") as f:
        wf = json.load(f)
except Exception as e:
    print(f"⚠ Cannot parse: {e}", file=sys.stderr)
    sys.exit(0)

warnings = []

# Required fields
for field in ("name", "nodes", "connections", "settings"):
    if field not in wf:
        warnings.append(f"missing top-level field: {field}")

# Settings checks
settings = wf.get("settings", {})
if settings.get("executionOrder") != "v1":
    warnings.append("settings.executionOrder should be 'v1'")
if settings.get("callerPolicy") not in ("workflowsFromSameOwner", "workflowsFromAList"):
    warnings.append("settings.callerPolicy should be set (default: workflowsFromSameOwner)")

# aishaRpc nodes audit trail check
nodes = wf.get("nodes", [])
for n in nodes:
    if n.get("type") == "n8n-nodes-aisha.aishaRpc":
        opts = n.get("parameters", {}).get("options", {})
        if not opts.get("auditTrail"):
            warnings.append(f"aishaRpc node '{n.get('name')}' missing options.auditTrail (recommended for production)")

# Naming check
if "name" in wf and not wf["name"].startswith("WF_"):
    warnings.append(f"workflow name should start with 'WF_': {wf['name']}")

if warnings:
    print(f"📝 n8n workflow advisory ({wf.get('name', 'unknown')}):", file=sys.stderr)
    for w in warnings:
        print(f"  ⚠ {w}", file=sys.stderr)
    print("Skill reference: .claude/skills/aisha-n8n-workflow/SKILL.md", file=sys.stderr)
PYEOF

exit 0

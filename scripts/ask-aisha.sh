zy potreb, definici zadani, tvorby testovaci ch scenaru, vyvoje, betatestovani a uyivatelskych testu po deploy vcetne monitoringu a dalsiho vylepsovani#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# scripts/ask-aisha.sh — Consult AISHA Dirigent for advice/review
# ═══════════════════════════════════════════════════════════════════════════════
#
# Phase 1 of AISHA-Copilot cooperation model:
#   AISHA reviews what Copilot is doing and provides feedback.
#
# Usage:
#   ./scripts/ask-aisha.sh "Is this Dockerfile approach aligned?"
#   ./scripts/ask-aisha.sh --context "Creating n8n Dockerfile" "Should I use multi-stage build?"
#   echo "Review my changes" | ./scripts/ask-aisha.sh
#
# Environment:
#   AISHA_URL  — Dirigent webhook URL (e.g. https://n8n.example.com/webhook/dirigent-agent)
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# Load .env.aisha if present (source secrets)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/../.env.aisha" ]] && set -a && source "$SCRIPT_DIR/../.env.aisha" && set +a

AISHA_URL="${AISHA_URL:?AISHA_URL required (e.g. https://mcp.<your-domain>/webhook/dirigent-agent)}"
CONTEXT=""
QUESTION=""

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --context|-c)
      CONTEXT="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: ask-aisha.sh [--context 'task description'] 'question'"
      echo ""
      echo "Consult AISHA Dirigent for advice. Phase 1 of AISHA-Copilot cooperation."
      echo ""
      echo "Options:"
      echo "  --context, -c   Task context (what you're working on)"
      echo "  --help, -h      Show this help"
      echo ""
      echo "Examples:"
      echo "  ask-aisha.sh 'What MCP tools do you have for compliance?'"
      echo "  ask-aisha.sh -c 'Building Dockerfile.n8n' 'Should I use alpine or debian?'"
      exit 0
      ;;
    *)
      QUESTION="$1"
      shift
      ;;
  esac
done

# Read from stdin if no question provided
if [[ -z "$QUESTION" ]]; then
  QUESTION=$(cat)
fi

if [[ -z "$QUESTION" ]]; then
  echo "Error: No question provided. Use --help for usage." >&2
  exit 1
fi

# ── Build request ─────────────────────────────────────────────────────────────
MESSAGE="$QUESTION"
if [[ -n "$CONTEXT" ]]; then
  MESSAGE="[ADVISOR REQUEST]\nContext: ${CONTEXT}\nQuestion: ${QUESTION}\nPlease evaluate using your knowledge base and provide structured feedback."
fi

# ── Configuration ─────────────────────────────────────────────────────────────
N8N_API_URL="${N8N_API_URL:?N8N_API_URL required (e.g. https://mcp.<your-domain>/api/v1)}"
N8N_API_KEY="${N8N_API_KEY:?Set N8N_API_KEY env var or add to .env.aisha}"
WEBHOOK_TIMEOUT="${WEBHOOK_TIMEOUT:-20}"
POLL_TIMEOUT="${POLL_TIMEOUT:-45}"
POLL_INTERVAL=3

# ── Call AISHA ────────────────────────────────────────────────────────────────
PAYLOAD=$(python3 -c "
import json, sys
msg = '''${MESSAGE}'''
print(json.dumps({'message': msg, 'session_id': 'copilot-advisor'}))
")

echo "━━━ Asking AISHA Dirigent ━━━"
echo "Q: $QUESTION"
[[ -n "$CONTEXT" ]] && echo "Context: $CONTEXT"
echo ""

# Try direct webhook first
RESPONSE=$(curl -s --max-time "$WEBHOOK_TIMEOUT" -X POST "$AISHA_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>/dev/null || echo "__TIMEOUT__")

# ── Fallback: Execution API (handles Coolify/Traefik proxy timeout) ───────────
if [[ "$RESPONSE" == "__TIMEOUT__" ]] || [[ -z "$RESPONSE" ]]; then
  echo "(webhook timeout — polling execution API...)"
  
  ELAPSED=0
  while [[ $ELAPSED -lt $POLL_TIMEOUT ]]; do
    sleep $POLL_INTERVAL
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
    
    # Get latest execution
    EXEC_JSON=$(curl -s --max-time 5 "${N8N_API_URL}/executions?limit=1" \
      -H "X-N8N-API-KEY: ${N8N_API_KEY}" 2>/dev/null || echo "")
    
    if [[ -z "$EXEC_JSON" ]]; then continue; fi
    
    EXEC_STATUS=$(echo "$EXEC_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    e = d['data'][0]
    print(e['status'])
except: print('unknown')
" 2>/dev/null)
    
    if [[ "$EXEC_STATUS" == "success" ]]; then
      EXEC_ID=$(echo "$EXEC_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d['data'][0]['id'])
" 2>/dev/null)
      
      # Fetch full execution with response data
      RESPONSE=$(curl -s --max-time 10 "${N8N_API_URL}/executions/${EXEC_ID}?includeData=true" \
        -H "X-N8N-API-KEY: ${N8N_API_KEY}" 2>/dev/null | python3 -c "
import json, sys
try:
    full = json.load(sys.stdin)
    rd = full.get('data', {}).get('resultData', {}).get('runData', {})
    for node_name in ['Format Webhook Response', 'Respond to Webhook']:
        for run in rd.get(node_name, []):
            items = run.get('data', {}).get('main', [[]])[0] or []
            for item in items:
                js = item.get('json', {})
                resp = js.get('response', js.get('body', js.get('output', '')))
                if resp:
                    # Wrap in JSON for consistent downstream parsing
                    print(json.dumps({'response': resp}))
                    sys.exit(0)
    print(json.dumps({'response': 'No response found in execution data'}))
except Exception as e:
    print(json.dumps({'response': f'Parse error: {e}'}))
" 2>/dev/null)
      
      echo "(got response from execution #${EXEC_ID})"
      break
    elif [[ "$EXEC_STATUS" == "error" ]]; then
      RESPONSE='{"response":"AISHA execution failed"}'
      break
    fi
    # still running — continue polling
    echo -n "."
  done
  
  if [[ $ELAPSED -ge $POLL_TIMEOUT ]]; then
    echo ""
    echo "Error: AISHA did not respond within ${POLL_TIMEOUT}s" >&2
    exit 1
  fi
fi

# ── Format response ───────────────────────────────────────────────────────────
echo ""
echo "━━━ AISHA Response ━━━"
echo "$RESPONSE" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if 'response' in data:
        print(data['response'])
    elif 'message' in data:
        print(data['message'])
    else:
        print(json.dumps(data, indent=2, ensure_ascii=False))
except:
    print(sys.stdin.read() if hasattr(sys.stdin, 'read') else str(data))
" 2>/dev/null || echo "$RESPONSE"
echo ""

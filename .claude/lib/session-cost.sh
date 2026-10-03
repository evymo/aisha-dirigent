#!/usr/bin/env bash
# .claude/lib/session-cost.sh — Dirigent router-coach shared helpers.
#
# Maintains a per-session cost-tracking JSONL at .aisha/session-cost.jsonl so
# multiple hooks can append/read without coordinating. Each line is one event:
#   { "ts": "...", "tool": "Read", "cost_usd": 0.001, "tokens_in": 100, ... }
#
# Reads aggregate rolling cost, emits stderr advisories.
# Pure shell + jq (when available); falls back to grep+awk when jq missing.
#
# Source this file from hooks:
#   source "$(dirname "$0")/../lib/session-cost.sh"
#   sc_log_tool "Read"
#   sc_advise "$session_id"

sc_session_file() {
  echo ".aisha/session-cost.jsonl"
}

sc_threshold_usd() {
  echo "${AISHA_ROUTER_COST_THRESHOLD_USD:-0.50}"
}

# sc_append <tool> <cost_usd> <tokens_in> <tokens_out>
sc_append() {
  local file
  file="$(sc_session_file)"
  mkdir -p "$(dirname "$file")"
  local tool="${1:-unknown}"
  local cost="${2:-0}"
  local tin="${3:-0}"
  local tout="${4:-0}"
  printf '{"ts":"%s","tool":"%s","cost_usd":%s,"tokens_in":%s,"tokens_out":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tool" "$cost" "$tin" "$tout" >> "$file"
}

# sc_rolling_cost — sum cost_usd over last 2h (or whole file if jq missing).
sc_rolling_cost() {
  local file
  file="$(sc_session_file)"
  if [[ ! -f "$file" ]]; then
    echo "0"
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    local cutoff
    cutoff=$(date -u -v-2H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")
    if [[ -n "$cutoff" ]]; then
      jq -s --arg cutoff "$cutoff" \
        '[.[] | select(.ts > $cutoff) | .cost_usd] | add // 0' "$file"
    else
      jq -s '[.[].cost_usd] | add // 0' "$file"
    fi
  else
    awk -F'"cost_usd":' '{split($2,a,","); s+=a[1]} END {printf "%.6f", s+0}' "$file"
  fi
}

# sc_advise — single-line stderr advisory. Never exits non-zero.
sc_advise() {
  local session_id="${1:-unknown}"
  local cost
  cost="$(sc_rolling_cost 2>/dev/null || echo 0)"
  local threshold
  threshold="$(sc_threshold_usd)"

  local over
  over=$(awk -v c="$cost" -v t="$threshold" 'BEGIN { print (c+0 > t+0) ? 1 : 0 }')

  if [[ "$over" == "1" ]]; then
    echo "[router-coach] cost \$${cost} > threshold \$${threshold}. Run /aisha-router-config to switch profile (budget profile ~40% savings)." >&2
  else
    echo "[router-coach] cost \$${cost} / threshold \$${threshold} - within budget" >&2
  fi
}

# sc_log_tool — bookkeeping helper for hooks that observe tool usage.
# Cost estimate is heuristic (not authoritative — actual costs flow via
# ai_trace_events / costAggregator on the backend).
sc_log_tool() {
  local tool="${1:-unknown}"
  local cost="0"
  case "$tool" in
    Read|Grep|Glob|WebFetch|WebSearch) cost="0.0005" ;;
    Edit|Write|NotebookEdit) cost="0.002" ;;
    Bash) cost="0.001" ;;
    *) cost="0.0005" ;;
  esac
  sc_append "$tool" "$cost" "0" "0"
}

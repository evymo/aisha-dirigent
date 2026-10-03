#!/usr/bin/env bash
# =============================================================================
# log.sh — Structured logger pro shell skripty (pretty | JSON)
# =============================================================================
# Source via: . "$SCRIPT_DIR/lib/log.sh"
#
# Env vars:
#   AISHA_LOG_JSON=1          → JSON Lines output (stderr)
#   AISHA_LOG_LEVEL=debug|info|warn|error  → minimum verbosity
#   AISHA_LOG_COMPONENT=name  → default component label
#
# Public API (functions):
#   log_debug "msg" [k1 v1 k2 v2 ...]
#   log_info  "msg" [k1 v1 k2 v2 ...]
#   log_warn  "msg" [k1 v1 k2 v2 ...]
#   log_error "msg" [k1 v1 k2 v2 ...]
#   log_phase_start "name"
#   log_phase_end   "name"          (uses LOG_PHASE_T0_<name> from start)
#
# Pretty:  ℹ [cold-start] message  k1=v1 k2=v2
# JSON:    {"ts":"2026-...","level":"info","component":"cold-start","msg":"message","k1":"v1","k2":"v2"}
# =============================================================================

# Don't re-source
if [[ -n "${_AISHA_LOG_LOADED:-}" ]]; then return 0 2>/dev/null || exit 0; fi
_AISHA_LOG_LOADED=1

_AISHA_LOG_JSON="${AISHA_LOG_JSON:-0}"
_AISHA_LOG_LEVEL="${AISHA_LOG_LEVEL:-info}"
_AISHA_LOG_COMPONENT="${AISHA_LOG_COMPONENT:-aisha}"

# Numeric level mapping
case "$_AISHA_LOG_LEVEL" in
  debug) _AISHA_LOG_MIN=10 ;;
  info)  _AISHA_LOG_MIN=20 ;;
  warn)  _AISHA_LOG_MIN=30 ;;
  error) _AISHA_LOG_MIN=40 ;;
  *)     _AISHA_LOG_MIN=20 ;;
esac

_AISHA_R='\033[0;31m'; _AISHA_G='\033[0;32m'; _AISHA_Y='\033[1;33m'
_AISHA_B='\033[0;34m'; _AISHA_DIM='\033[2m'; _AISHA_N='\033[0m'

_emit_pretty() {
  local level="$1"; local msg="$2"; shift 2
  local prefix
  case "$level" in
    debug) prefix="${_AISHA_DIM}∘${_AISHA_N}" ;;
    info)  prefix="${_AISHA_B}ℹ${_AISHA_N}" ;;
    warn)  prefix="${_AISHA_Y}⚠${_AISHA_N}" ;;
    error) prefix="${_AISHA_R}✗${_AISHA_N}" ;;
    *)     prefix="·" ;;
  esac
  local fields=""
  while [[ $# -gt 0 ]]; do
    if [[ $# -ge 2 ]]; then
      fields+=" ${_AISHA_DIM}$1${_AISHA_N}=$2"
      shift 2
    else
      shift
    fi
  done
  echo -e "  ${prefix} ${_AISHA_DIM}[${_AISHA_LOG_COMPONENT}]${_AISHA_N} ${msg}${fields}" >&2
}

_emit_json() {
  local level="$1"; local msg="$2"; shift 2
  # Use jq for safe JSON encoding if available (handles quotes, newlines, etc.)
  if command -v jq >/dev/null 2>&1; then
    local args=(-nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
                    --arg level "$level" \
                    --arg component "$_AISHA_LOG_COMPONENT" \
                    --arg msg "$msg")
    local filter='{ts: $ts, level: $level, component: $component, msg: $msg'
    while [[ $# -ge 2 ]]; do
      local k="$1" v="$2"; shift 2
      args+=(--arg "$k" "$v")
      filter+=", $k: \$$k"
    done
    filter+="}"
    jq "${args[@]}" "$filter" >&2
  else
    # Fallback: simple printf with limited escaping (caller responsible for clean values)
    local fields=""
    while [[ $# -ge 2 ]]; do
      fields+=",\"$1\":\"$2\""
      shift 2
    done
    printf '{"ts":"%s","level":"%s","component":"%s","msg":"%s"%s}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$level" "$_AISHA_LOG_COMPONENT" "$msg" "$fields" >&2
  fi
}

_log() {
  local level="$1"; local level_num="$2"; shift 2
  if [[ "$level_num" -lt "$_AISHA_LOG_MIN" ]]; then return 0; fi
  if [[ "$_AISHA_LOG_JSON" == "1" ]]; then
    _emit_json "$level" "$@"
  else
    _emit_pretty "$level" "$@"
  fi
}

log_debug() { _log debug 10 "$@"; }
log_info()  { _log info  20 "$@"; }
log_warn()  { _log warn  30 "$@"; }
log_error() { _log error 40 "$@"; }

# Phase markers — track timing per named phase.
# Note: macOS bash 3.2 doesn't support `declare -A`, so we use scalar
# variables with name-mangled keys: _AISHA_PHASE_T0__<name>=<unix_ts>.
log_phase_start() {
  local name="$1"
  local var="_AISHA_PHASE_T0__${name//[^a-zA-Z0-9_]/_}"
  eval "$var=$(date +%s)"
  _log info 20 "phase $name start" phase "$name" event start
}
log_phase_end() {
  local name="$1"
  local var="_AISHA_PHASE_T0__${name//[^a-zA-Z0-9_]/_}"
  local t0="${!var:-0}"
  local duration=$(( $(date +%s) - t0 ))
  _log info 20 "phase $name end" phase "$name" event end duration_s "$duration"
  unset "$var"
}

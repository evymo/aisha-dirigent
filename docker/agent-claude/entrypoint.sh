#!/usr/bin/env bash
# agent-claude entrypoint — launch a headless Claude Code run against the mounted
# worktree, stream stream-json events to stdout (the runner captures them), and
# optionally commit+push the story branch on success.
#
# Env contract (injected by svc-agent-runner, Component 4 E4 / auth E5):
#   AISHA_RUN_ID            agent_runs.id — re-exported as AISHA_AGENT_RUN_ID so
#                           the supervisor relay links the live session to the run
#   AISHA_WORKTREE          worktree mount path (default /work)
#   AISHA_PROMPT            task prompt (else read $WORKTREE/.aisha/story.json)
#   AISHA_GATEWAY_URL       relay telemetry target (→ agent_live_sessions)   [E2]
#   AISHA_MCP_TOKEN         relay bearer                                      [E2]
#   ANTHROPIC_BASE_URL      LLM gateway proxy (cost governance)              [E5]
#   ANTHROPIC_API_KEY       fallback key (else ~/.claude subscription mount) [E5]
#   CLAUDE_MODEL            model id (default: CLI/stack default)
#   CLAUDE_PERMISSION_MODE  acceptEdits (default) | bypassPermissions (full sandbox autonomy)
#   AISHA_GIT_PUSH=1        commit + push the branch on success (needs a credentialed remote) [E4/E5]
#   AISHA_BRANCH            push target branch (default: current HEAD)
#
# Exit code is Claude's own; degradation paths emit a single JSON sentinel line
# so the runner can record a structured outcome.
set -euo pipefail

WORKTREE="${AISHA_WORKTREE:-/work}"
cd "$WORKTREE"
# Git přihlášení pro CELÝ běh jen přes env (GIT_CONFIG_*), nikdy do .git/config:
# /work je samostatný klon (runner ho klonuje per běh, --filter=blob:none), takže
# líné dotahování obsahu z historie i závěrečný push jdou na remote a potřebují
# token. AGENT_GIT_TOKEN dítě dostává od runneru už dnes; tady se jen předá gitu.
# The runner and agent use different UIDs; trust only this isolated clone.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$WORKTREE"
if [ -n "${AGENT_GIT_TOKEN:-}" ]; then
  export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_1=http.extraHeader
  export GIT_CONFIG_VALUE_1="Authorization: token ${AGENT_GIT_TOKEN}"
fi
umask 0000
export GIT_TERMINAL_PROMPT=0

# Link the live session back to its execution-plane run (E2 reads this in the relay).
export AISHA_AGENT_RUN_ID="${AISHA_RUN_ID:-${AISHA_AGENT_RUN_ID:-}}"

emit() { printf '%s\n' "$1"; }

# The runner's parseLogs REQUIRES a final {"__result":true,...} stdout sentinel to
# count a run as success. Emit it from an EXIT trap so it fires on EVERY exit path —
# a `git commit` that fails under `set -e`, the early no-prompt exit, the timeout —
# always carrying the REAL captured exit code. Without the trap, set -e could abort
# before the sentinel and a clean run (exit 0, commit-failed) would be recorded FAILED.
CLAUDE_EXIT=1
emit_result() {
  local actual_exit=$?
  if [ "$actual_exit" -ne 0 ]; then CLAUDE_EXIT=$actual_exit; fi
  emit "{\"__result\":true,\"value\":{\"ok\":$([ "$CLAUDE_EXIT" -eq 0 ] && echo true || echo false),\"run_id\":\"${AISHA_AGENT_RUN_ID:-}\",\"exit_code\":${CLAUDE_EXIT}}}"
}
trap emit_result EXIT

# The publishing branch must belong to this run, including when a caller supplies a label.
if [ "${AISHA_GIT_PUSH:-0}" = "1" ]; then
  case "${AISHA_BRANCH:-}" in
    "aisha/run/${AISHA_AGENT_RUN_ID}/"*|"aisha/run/${AISHA_AGENT_RUN_ID}") ;;
    *) emit "[agent-claude] refusing a branch outside this run" >&2; exit 64 ;;
  esac
  [ -n "${AISHA_AGENT_RUN_ID}" ] && git check-ref-format --branch "$AISHA_BRANCH" >/dev/null
fi

# Resolve the prompt: explicit env wins, else the story brief in the worktree.
PROMPT="${AISHA_PROMPT:-}"
if [ -z "$PROMPT" ] && [ -f "$WORKTREE/.aisha/story.json" ]; then
  PROMPT="$(node -e 'try{const s=require(process.argv[1]);process.stdout.write(String(s.prompt||s.initial_prompt||""))}catch(e){}' "$WORKTREE/.aisha/story.json" 2>/dev/null || true)"
fi
if [ -z "$PROMPT" ]; then
  emit "[agent-claude] no prompt (set AISHA_PROMPT or .aisha/story.json)" >&2
  CLAUDE_EXIT=64
  exit 64  # the EXIT trap emits the canonical __result sentinel with exit_code=64
fi

emit "[agent-claude] run=${AISHA_AGENT_RUN_ID:-?} worktree=${WORKTREE} model=${CLAUDE_MODEL:-default} perm=${CLAUDE_PERMISSION_MODE:-acceptEdits}" >&2

# Headless run. --output-format stream-json requires --verbose in print mode.
# Container-side hard stop (defense-in-depth): even if the runner process AND the
# orphan reaper are gone, the agent self-terminates at EXEC_TIMEOUT_MS so an
# orphan can't bill the subscription forever. EXEC_TIMEOUT_MS is injected by the
# runner (claude-cli.ts); default mirrors CLAUDE_CLI_TIMEOUT_MS.
TIMEOUT_S=$(( ${EXEC_TIMEOUT_MS:-3600000} / 1000 ))
# Use GNU `timeout` when present (the Linux container) for the hard stop; degrade to a
# direct run where it isn't (e.g. macOS dev) — the runner's container-wait still bounds
# the run, so we never hard-depend on coreutils being on PATH.
TIMEOUT_PREFIX=""
command -v timeout >/dev/null 2>&1 && TIMEOUT_PREFIX="timeout --signal=TERM --kill-after=30s ${TIMEOUT_S}s"
CONTEXT_ARGS=()
if [ -f "$WORKTREE/.aisha/run-context.md" ]; then
  CONTEXT_ARGS=(--append-system-prompt "$(cat "$WORKTREE/.aisha/run-context.md")")
fi
set +e
$TIMEOUT_PREFIX claude -p "$PROMPT" \
  --output-format stream-json --verbose "${CONTEXT_ARGS[@]}" \
  --permission-mode "${CLAUDE_PERMISSION_MODE:-acceptEdits}" \
  ${CLAUDE_MODEL:+--model "$CLAUDE_MODEL"}
CLAUDE_EXIT=$?
[ "$CLAUDE_EXIT" -eq 124 ] && emit "[agent-claude] self-terminated at EXEC_TIMEOUT_MS=${EXEC_TIMEOUT_MS:-3600000}ms" >&2
set -e

# Finalize: commit + push the branch on success when asked + credentialed.
if [ "$CLAUDE_EXIT" -eq 0 ] && [ "${AISHA_GIT_PUSH:-0}" = "1" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git -c user.name="AISHA Agent" -c user.email="agent@aisha.local" \
        commit -m "${AISHA_COMMIT_MSG:-chore(agent): automated changes by AISHA Claude run ${AISHA_AGENT_RUN_ID:-unknown}}"
  fi
  git push origin "HEAD:refs/heads/${AISHA_BRANCH}"
fi

# The __result sentinel is emitted by the EXIT trap (emit_result) so it survives a
# failed commit/push above — exit with the real code and let the trap fire.
exit "$CLAUDE_EXIT"

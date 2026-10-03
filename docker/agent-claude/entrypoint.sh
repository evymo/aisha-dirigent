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
  emit "{\"__result\":true,\"value\":{\"ok\":$([ "$CLAUDE_EXIT" -eq 0 ] && echo true || echo false),\"run_id\":\"${AISHA_AGENT_RUN_ID:-}\",\"exit_code\":${CLAUDE_EXIT}}}"
}
trap emit_result EXIT

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
set +e
$TIMEOUT_PREFIX claude -p "$PROMPT" \
  --output-format stream-json --verbose \
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
  git push origin "HEAD:${AISHA_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}" \
    || emit "[agent-claude] git push failed (non-fatal)" >&2
fi

# The __result sentinel is emitted by the EXIT trap (emit_result) so it survives a
# failed commit/push above — exit with the real code and let the trap fire.
exit "$CLAUDE_EXIT"

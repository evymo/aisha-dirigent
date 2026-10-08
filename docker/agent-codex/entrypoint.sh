#!/usr/bin/env bash
# agent-codex entrypoint — the EXECUTION recipe for the cli:codex-cli runtime tool,
# parallel to docker/agent-claude/entrypoint.sh. AISHA selects cli:codex-cli (a
# capability-availability decision) and svc-agent-runner spawns this in an isolated
# container against a per-run worktree; here we drive OpenAI Codex headlessly and
# emit the SAME machine-readable __result sentinel the runner's parseLogs captures,
# so the two CLI tools share one result contract — nothing tool-specific leaks into
# the runner. Everything is env-parametrised; no model / key / path is hardcoded.
set -u
WORKTREE="${AISHA_WORKTREE:-/work}"
cd "$WORKTREE" 2>/dev/null || true
# Git přihlášení pro CELÝ běh jen přes env (GIT_CONFIG_*), nikdy do .git/config:
# /work je samostatný klon (runner ho klonuje per běh, --filter=blob:none), takže
# líné dotahování obsahu z historie i závěrečný push jdou na remote a potřebují
# token. AGENT_GIT_TOKEN dítě dostává od runneru už dnes; tady se jen předá gitu.
if [ -n "${AGENT_GIT_TOKEN:-}" ]; then
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader
  export GIT_CONFIG_VALUE_0="Authorization: token ${AGENT_GIT_TOKEN}"
fi
export GIT_TERMINAL_PROMPT=0
export AISHA_AGENT_RUN_ID="${AISHA_RUN_ID:-${AISHA_AGENT_RUN_ID:-}}"

emit() { printf '%s\n' "$1"; }

# Single result contract (identical to agent-claude): emit {"__result":true,...} from
# an EXIT trap so it fires on every path with the real exit code.
CODEX_EXIT=1
emit_result() {
  emit "{\"__result\":true,\"value\":{\"ok\":$([ "$CODEX_EXIT" -eq 0 ] && echo true || echo false),\"run_id\":\"${AISHA_AGENT_RUN_ID:-}\",\"exit_code\":${CODEX_EXIT},\"tool\":\"codex-cli\"}}"
}
trap emit_result EXIT

PROMPT="${AISHA_PROMPT:-}"
if [ -z "$PROMPT" ] && [ -f "$WORKTREE/.aisha/story.json" ]; then
  PROMPT="$(node -e 'try{const s=require(process.argv[1]);process.stdout.write(String(s.prompt||s.goal||""))}catch(e){}' "$WORKTREE/.aisha/story.json" 2>/dev/null || true)"
fi
if [ -z "$PROMPT" ]; then
  emit "[agent-codex] no prompt (set AISHA_PROMPT or .aisha/story.json)" >&2
  CODEX_EXIT=64; exit 64
fi

emit "[agent-codex] run=${AISHA_AGENT_RUN_ID:-?} worktree=${WORKTREE} model=${CODEX_MODEL:-default}" >&2

# Headless, autonomous exec. Sandbox + approval are parametrised: a code-editing run
# needs a writable workspace; a read-only run keeps the worktree intact. The model +
# the OpenAI key come from the env the runner injects (CODEX_MODEL / OPENAI_API_KEY).
TIMEOUT_S=$(( ${EXEC_TIMEOUT_MS:-3600000} / 1000 ))
# GNU `timeout` for the container-side hard stop; degrade to a direct run where it
# isn't on PATH (macOS dev) — the runner's container-wait still bounds the run (same
# defense-in-depth contract as agent-claude; never hard-depends on coreutils).
TIMEOUT_PREFIX=""
command -v timeout >/dev/null 2>&1 && TIMEOUT_PREFIX="timeout --signal=TERM --kill-after=30s ${TIMEOUT_S}s"
$TIMEOUT_PREFIX npx -y @openai/codex@latest exec \
  --skip-git-repo-check \
  --sandbox "${CODEX_SANDBOX:-workspace-write}" \
  ${CODEX_MODEL:+--model "$CODEX_MODEL"} \
  "$PROMPT"
CODEX_EXIT=$?

# git finalize (commit/push the branch) when asked + credentialed — same contract as
# agent-claude; the EXIT trap still emits the sentinel if a commit fails under set -e.
if [ "$CODEX_EXIT" -eq 0 ] && [ "${AISHA_GIT_PUSH:-0}" = "1" ] && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  git add -A
  git -c user.name="AISHA Agent" -c user.email="agent@aisha.local" \
      commit -m "${AISHA_COMMIT_MSG:-chore(agent): automated changes by AISHA Codex run ${AISHA_AGENT_RUN_ID:-unknown}}" || true
  git push origin "HEAD:${AISHA_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}" || emit "[agent-codex] git push failed (non-fatal)" >&2
fi

exit "$CODEX_EXIT"

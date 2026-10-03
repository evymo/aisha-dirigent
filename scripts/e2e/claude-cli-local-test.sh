#!/usr/bin/env bash
# claude-cli-local-test.sh — exercise the Component 4 (AISHA spawns Claude CLI)
# loop against the LOCAL dev stack, as far as a credential-free machine allows:
#
#   1. DATA LOOP (live dev DB): governance gate (fn_authorize) → fn_spawn_claude_cli_run
#      (E1) → fn_upsert_agent_live_session with agent_run_id (E2) → list_active_agent_sessions
#      surfaces it linked (what Mission Control reads).
#   2. CONTAINER MECHANICS (local Docker): build Dockerfile.agent-claude (E3), run it
#      against a worktree mount with the env contract (E4); the entrypoint resolves the
#      prompt, launches `claude -p --output-format stream-json`, and emits the __result
#      sentinel. A REAL model call needs a credential (ANTHROPIC_API_KEY / subscription);
#      without one the run fast-fails at auth (proving every step up to the model call).
#
# Everything is env-driven — no hardcoded values.
#   CLAUDE_CLI_TEST_DB        dev DB container          (default aisha-local__aisha-db)
#   CLAUDE_CLI_TEST_IMAGE     agent image tag           (default aisha-agent-claude:local)
#   CLAUDE_CLI_TEST_GATEWAY   relay target for the run  (default http://host.docker.internal:3001)
#   CLAUDE_CLI_TEST_USER      provisioned caller uuid   (default the e2e admin)
#   ANTHROPIC_API_KEY         if set, used for a REAL model run (else a dummy key fast-fails)
#   CLAUDE_CLI_TEST_SKIP_BUILD=1   reuse an existing image
set -euo pipefail

DB="${CLAUDE_CLI_TEST_DB:-${AISHA_LOCAL_STACK:-aisha-local}__aisha-db}"
IMAGE="${CLAUDE_CLI_TEST_IMAGE:-aisha-agent-claude:local}"
GATEWAY="${CLAUDE_CLI_TEST_GATEWAY:-http://host.docker.internal:3001}"
CALLER="${CLAUDE_CLI_TEST_USER:-e2e00000-0000-0000-0000-000000000001}"
API_KEY="${ANTHROPIC_API_KEY:-sk-ant-dummy-invalid}"
# Real run paths (no API key), in the same precedence the runner uses:
#   1. SUBSCRIPTION — CLAUDE_CLI_TEST_OAUTH_TOKEN (`claude setup-token`); the CLI's point.
#   2. LOCAL LLM    — CLAUDE_CLI_TEST_BASE_URL (+ _MODEL), e.g. LM Studio :1234.
OAUTH_TOKEN="${CLAUDE_CLI_TEST_OAUTH_TOKEN:-${CLAUDE_CODE_OAUTH_TOKEN:-}}"
BASE_URL="${CLAUDE_CLI_TEST_BASE_URL:-}"
MODEL="${CLAUDE_CLI_TEST_MODEL:-}"
DRY_RUN="${DRY_RUN:-0}"   # DRY_RUN=1 skips container/worktree teardown (set -u safe)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SESSION="local-c4-$$"
pass=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }

echo "── 1. DATA LOOP (dev DB: $DB) ─────────────────────────────────────────────"
OUT="$(docker exec -i "$DB" psql -U postgres -d postgres -tA 2>&1 <<SQL
SELECT set_config('request.jwt.claims','{"sub":"$CALLER","role":"authenticated","email":"admin@platform.rtn"}',false);
-- governance: an over-cap estimate must hard-deny the spawn loudly (robust to any policy)
UPDATE public.ai_cost_class_catalog SET usd_p90=1000 WHERE kind='claude_cli_task';
DO \$\$ BEGIN
  PERFORM public.fn_spawn_claude_cli_run('$IMAGE','test:local','{"prompt":"x"}'::jsonb);
  RAISE NOTICE 'SPAWN_ALLOWED_OVER_CAP';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'GOVERNANCE_REFUSED'; END \$\$;
-- operator-tuned band so a normal run admits
UPDATE public.ai_cost_class_catalog SET usd_p90=4 WHERE kind='claude_cli_task';
SELECT public.fn_spawn_claude_cli_run('$IMAGE','test:local',
  '{"prompt":"Write hello.txt","branch":"aisha/$SESSION"}'::jsonb) AS run_id \gset
SELECT 'RUN_KIND=' || kind || ',PROMPT=' || (inputs->>'prompt') FROM public.agent_runs WHERE id=:'run_id';
SELECT public.fn_upsert_agent_live_session(p_session_id:='$SESSION',p_phase:='tool_use',
  p_source:='aisha-claude',p_agent_run_id:=:'run_id'::uuid);
SELECT 'SURFACED=' || session_id || ',RUN=' || agent_run_id || ',SRC=' || source
  FROM public.list_active_agent_sessions() WHERE session_id='$SESSION';
DELETE FROM public.agent_live_sessions WHERE session_id='$SESSION';
DELETE FROM public.agent_runs WHERE id=:'run_id';
UPDATE public.ai_cost_class_catalog SET usd_p90=8 WHERE kind='claude_cli_task';
SQL
)"
grep -q 'GOVERNANCE_REFUSED' <<< "$OUT" && ok "governance gate refuses over-budget spawn (fn_authorize)" || bad "governance gate"
grep -q 'RUN_KIND=claude_cli_task' <<< "$OUT" && ok "E1 fn_spawn_claude_cli_run persists row + inputs" || bad "E1 spawn"
grep -q "SURFACED=$SESSION,RUN=" <<< "$OUT" && ok "E2 live session surfaces LINKED to agent_run_id" || bad "E2 link/surfacing"

echo "── 2. CONTAINER MECHANICS (local Docker) ──────────────────────────────────"
if [ "${CLAUDE_CLI_TEST_SKIP_BUILD:-0}" != "1" ]; then
  echo "  building $IMAGE ..."
  docker build ${REGISTRY_PROXY:+--build-arg REGISTRY_PROXY="$REGISTRY_PROXY"} \
    -f "$ROOT/Dockerfile.agent-claude" -t "$IMAGE" "$ROOT" >/tmp/c4-build.log 2>&1 \
    && ok "E3 Dockerfile.agent-claude builds" || { bad "E3 image build (see /tmp/c4-build.log)"; }
fi
docker run --rm --entrypoint claude "$IMAGE" --version >/dev/null 2>&1 && ok "claude CLI present in image" || bad "claude CLI missing"

WT="$(mktemp -d)"; echo pre > "$WT/README.md"
NAME="c4-mech-$$"
# Destructive cleanup is DRY_RUN-gated (set DRY_RUN=1 to skip container/worktree teardown).
if [ "$DRY_RUN" != "1" ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
fi
RUN_ARGS=(-e AISHA_RUN_ID="local-$SESSION" -e "AISHA_PROMPT=Create hello.txt with hi"
  -e CLAUDE_PERMISSION_MODE=bypassPermissions
  -e AISHA_GATEWAY_URL="$GATEWAY" -e AISHA_MCP_TOKEN=dummy -v "$WT:/work:rw")
# Auth precedence: subscription (OAuth token) → local LLM → dummy key (plumbing only).
if [ -n "$OAUTH_TOKEN" ]; then
  RUN_ARGS+=(-e CLAUDE_CODE_OAUTH_TOKEN="$OAUTH_TOKEN")
  echo "  (subscription: CLAUDE_CODE_OAUTH_TOKEN — no API key)"
elif [ -n "$BASE_URL" ]; then
  RUN_ARGS+=(-e ANTHROPIC_BASE_URL="$BASE_URL" -e ANTHROPIC_API_KEY=local-llm)
  [ -n "$MODEL" ] && RUN_ARGS+=(-e CLAUDE_MODEL="$MODEL")
  echo "  (local model: $BASE_URL ${MODEL:+model=$MODEL})"
else
  RUN_ARGS+=(-e ANTHROPIC_API_KEY="$API_KEY")
fi
docker run -d --name "$NAME" "${RUN_ARGS[@]}" "$IMAGE" >/dev/null
EC="$(docker wait "$NAME" 2>&1 || true)"
LOGS="$(docker logs "$NAME" 2>&1)"
if [ "$DRY_RUN" != "1" ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WT"
fi
grep -q "worktree=/work" <<< "$LOGS" && ok "E3 entrypoint runs, mounts /work, resolves prompt" || bad "entrypoint plumbing"
grep -q '"cwd":"/work"' <<< "$LOGS" && ok "E4 claude launches headless (stream-json) at the worktree" || bad "claude launch"
grep -q '"__result":true' <<< "$LOGS" && ok "E3 entrypoint emits __result sentinel (runner-capturable)" || bad "__result sentinel"
if grep -q 'authentication_failed\|Invalid API key' <<< "$LOGS"; then
  echo "  ℹ real model call skipped — auth (set ANTHROPIC_API_KEY for a full run); exit=$EC"
else
  grep -q '"exit_code":0' <<< "$LOGS" && ok "REAL model run completed (credentialed)" || echo "  ℹ run exit=$EC"
fi

echo "──────────────────────────────────────────────────────────────────────────"
echo "  PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]

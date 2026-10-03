-- Function: public.fn_spawn_claude_cli_run
-- Description: Enqueue an AISHA-spawned Claude Code CLI run on the execution
--   plane (agent_runs, kind='claude_cli_task'). The caller (Dirigent task-picker
--   UI / n8n spawner) hands a story-derived prompt + branch in p_inputs; the
--   svc-agent-runner picks the row up, creates a per-run git worktree, mounts it
--   into an isolated container, and launches `claude -p`. E0 admission
--   (fn_admit_clow) gates the run: deny refuses loudly, ask creates the run HELD
--   pending approval (approve_claude_run), allow proceeds — and every dispatch
--   mints an ai_decisions row (I1) threaded onto the run.
-- Security: SECURITY DEFINER, grants to authenticated.

-- Signature changed (added p_max_inflight) — drop the prior 5-arg overload so a
-- 5-positional call is never ambiguous between it and the new default-arg form.
DROP FUNCTION IF EXISTS public.fn_spawn_claude_cli_run(text, text, jsonb, text, text);
-- p_cli_slug appended (default claude-cli) so the SAME spawn drives ANY cli:<slug>
-- tool — claude-cli or codex-cli. The image picks the agent (docker/agent-claude vs
-- agent-codex), the slug drives admission (fn_admit_clow checks cli:<slug>
-- availability — a disabled/absent tool denies, so nothing tool-specific is
-- hardcoded here) + the I1 journal. DROP the prior 6-arg form so a 6-positional
-- call is never ambiguous against the new default-7th.
DROP FUNCTION IF EXISTS public.fn_spawn_claude_cli_run(text, text, jsonb, text, text, int);

CREATE OR REPLACE FUNCTION public.fn_spawn_claude_cli_run(
  p_image       text,
  p_source      text,
  p_inputs      jsonb,                              -- {story_id, prompt, base_ref, branch, auth_mode, context_profile}
  p_profile     text DEFAULT 'kata-dragonball',     -- workspace-friendly VMM isolation
  p_source_ref  text DEFAULT NULL,                  -- branch carrier (falls back to p_inputs->>'branch')
  p_max_inflight int DEFAULT NULL,                  -- override; else resolved dynamically (see below)
  p_cli_slug    text DEFAULT 'claude-cli'           -- which cli:<slug> tool: 'claude-cli' | 'codex-cli'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id       uuid;
  v_admit        jsonb;
  v_verdict      text;
  v_awaiting     text;
  v_approval_req boolean := false;
  v_decision_id  uuid;
  v_story_id     uuid := NULLIF(p_inputs->>'story_id', '')::uuid;
  -- Queue-depth ceiling resolved DYNAMICALLY: explicit arg → system_config
  -- ('agent_runner'.max_inflight, tunable at runtime) → conservative fail-safe.
  v_max_inflight int := GREATEST(
    COALESCE(
      p_max_inflight,
      NULLIF(public.get_system_config('agent_runner')->>'max_inflight', '')::int,
      50
    ), 1);
BEGIN
  -- JIT-provision the caller row so requested_by FK never trips (KC user with a
  -- valid JWT but no aisha_auth.users row yet). See ensure_current_user.
  PERFORM public.ensure_current_user();

  -- p_image may be empty: a producer (Dirigent UI / n8n) need not know the agent
  -- image — the svc-agent-runner defaults it from AGENT_CLAUDE_IMAGE at execution.
  IF p_inputs IS NULL OR NULLIF(p_inputs->>'prompt', '') IS NULL THEN
    RAISE EXCEPTION 'fn_spawn_claude_cli_run: p_inputs.prompt required' USING ERRCODE = '22023';
  END IF;

  -- E0 admission (replaces the spend-only gate). Composes ALL FOUR derived axes —
  -- spend + runtime-availability (the cli:claude-cli registry row must be enabled +
  -- adapter-live) + capability-match + risk — into one verdict. A CLI run writes
  -- code, reaches the network, and uses tools, so the clow declares those needs;
  -- fn_admit_clow derives the risk band from the runtime's side_effect_class.
  v_admit := public.fn_admit_clow(
    jsonb_build_object(
      'purpose',        'claude_cli_task',
      'runtime',        'cli',
      'cli_slug',       p_cli_slug,
      'task_kind',      'claude_cli_task',
      'needs_write',    true,
      'needs_internet', true,
      'needs_tools',    true
    ),
    jsonb_build_object('story_id', v_story_id)
  );
  v_verdict  := v_admit->>'decision';
  v_awaiting := v_admit->>'awaiting';

  -- deny → refuse loudly (spend over budget, runtime disabled, capability mismatch,
  -- or risk above the deny ceiling). The run is never created.
  IF v_verdict = 'deny' THEN
    RAISE EXCEPTION USING
      MESSAGE = format('admission_deny: claude_cli_task refused — %s (%s)',
        v_admit->>'reason_code', COALESCE(v_awaiting, 'admission_denied')),
      ERRCODE = 'P0001';
  END IF;

  -- ask → the run IS created but HELD pending human approval (approval_required +
  -- approved_at IS NULL); claim_queued_claude_run skips it until approve_claude_run
  -- clears it via Mission Control. allow → proceeds immediately.
  v_approval_req := (v_verdict = 'ask');

  -- Anti-pile-up at the SOURCE (the backlog the runner later drains into
  -- containers). Two guards, both bound how many rows can ever sit queued:
  --   1) idempotency: never two concurrently-active runs for the SAME story, so a
  --      retrying producer (n8n/client) is ABSORBED, not multiplied — the root
  --      reason "dozens of queued rows" can form.
  --   2) global queued+running ceiling: even across distinct stories / NULL-story
  --      runs, the total in-flight backlog cannot exceed p_max_inflight, so a
  --      poller restart can never face an unbounded queue to drain.
  IF v_story_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.agent_runs r
    WHERE r.kind = 'claude_cli_task'
      AND r.status IN ('queued', 'running')
      AND NULLIF(r.inputs->>'story_id', '')::uuid = v_story_id
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = format('claude_cli_task already active for story %s', v_story_id),
      ERRCODE = 'P0001';
  END IF;

  IF (
    SELECT count(*) FROM public.agent_runs
    WHERE kind = 'claude_cli_task' AND status IN ('queued', 'running')
  ) >= v_max_inflight THEN
    RAISE EXCEPTION USING
      MESSAGE = format('claude_cli_task queue depth at limit (%s) — try later', v_max_inflight),
      ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.agent_runs (kind, profile, image, requested_by, source, source_ref, inputs,
                                 approval_required, awaiting)
  VALUES (
    'claude_cli_task',
    p_profile,
    p_image,
    auth.uid(),
    p_source,
    COALESCE(p_source_ref, NULLIF(p_inputs->>'branch', '')),
    p_inputs,
    v_approval_req,
    CASE WHEN v_approval_req THEN v_awaiting ELSE NULL END
  )
  RETURNING id INTO v_run_id;

  -- I1 — journal the dispatch: mint the single ai_decisions row (the only writer is
  -- fn_record_execution_decision) carrying the admission verdict, and thread its id
  -- onto the run. Matches direct_llm/openclaw/hermes — every dispatch is journaled.
  v_decision_id := public.fn_record_execution_decision(
    jsonb_build_object(
      'clow_purpose',      'claude_cli_task',
      'runtime',           'cli',
      'cli_slug',          p_cli_slug,
      'backend_kind',      'cli',
      'admission_verdict', v_verdict,
      'risk_level',        v_admit->'axis_results'->'risk'->>'level',
      'approval_required', v_approval_req,
      'resolution_source', 'policy',  -- the verdict is policy-driven (spend + risk thresholds); precise source in reason + decision_json
      'reason',            format('fn_spawn_claude_cli_run admission %s', v_verdict),
      'cost',              v_admit->'axis_results'->'spend'->'detail'->>'estimate_used'
    ),
    v_run_id,
    v_story_id
  );
  UPDATE public.agent_runs SET decision_id = v_decision_id WHERE id = v_run_id;

  -- Audit breadcrumb (without the prompt body — may be large / sensitive); now
  -- carries the admission verdict + the decision id for traceability.
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'agent_run.spawned',
          jsonb_build_object(
            'run_id', v_run_id,
            'kind', 'claude_cli_task',
            'story_id', v_story_id,
            'source', p_source,
            'profile', p_profile,
            'admission_verdict', v_verdict,
            'approval_required', v_approval_req,
            'decision_id', v_decision_id));

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_spawn_claude_cli_run(text, text, jsonb, text, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_spawn_claude_cli_run(text, text, jsonb, text, text, int, text) TO authenticated;
-- service_role: a SYSTEM-spawned CLI run (the reflection cli RuntimeAdapter, or the
-- svc-agent-runner POST /runs executor) calls this with no human user — requested_by
-- lands NULL. Same admission (fn_admit_clow accepts service_role) + journal apply.
GRANT EXECUTE ON FUNCTION public.fn_spawn_claude_cli_run(text, text, jsonb, text, text, int, text) TO service_role;

COMMENT ON FUNCTION public.fn_spawn_claude_cli_run(text, text, jsonb, text, text, int, text) IS
  'Enqueue an AISHA-spawned Claude CLI run (agent_runs kind=claude_cli_task) gated by E0 admission (fn_admit_clow: spend + runtime-availability + capability + risk). deny refuses; ask creates the run held pending approval (approve_claude_run); allow proceeds. Every dispatch mints an ai_decisions row (fn_record_execution_decision, I1) threaded onto the run. Anti-pile-up: one active run per story + a global queued+running ceiling (p_max_inflight). The svc-agent-runner consumes a claimable (allow or approved) row, builds a per-run worktree, and launches claude.';

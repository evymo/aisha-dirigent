-- ============================================================================
-- Source of Truth: fn_upsert_agent_live_session
-- Purpose: Upsert one agent_live_sessions row + manage the per-session
--          ai_runs aggregate (kind='ide_session'):
--            - first sight of a session_id → INSERT ai_runs (status running)
--            - phase 'stopped' → finish_ai_run() (cost rollup from trace events)
--          Phase is validated against agent_phase_catalog (axis='activity');
--          'session_start' is accepted as an alias that initialises the row
--          without downgrading an existing phase.
-- Callers: dirigent-supervisor route (Claude Code hook relay, service_role),
--          VS Code Dirigent extension (authenticated user push).
-- Security: SECURITY DEFINER + REVOKE/GRANT. Returns the session's ai_run_id.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_upsert_agent_live_session(
  p_session_id   text,
  p_source       text DEFAULT 'claude-code',
  p_story_id     uuid DEFAULT NULL,
  p_user_id      uuid DEFAULT NULL,
  p_branch       text DEFAULT NULL,
  p_phase        text DEFAULT 'idle',
  p_phase_detail text DEFAULT NULL,
  p_current_task text DEFAULT NULL,
  p_last_tool    text DEFAULT NULL,
  p_last_file    text DEFAULT NULL,
  p_agent_run_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_source     text := COALESCE(NULLIF(btrim(p_source), ''), 'claude-code');
  v_phase      text := COALESCE(NULLIF(btrim(p_phase), ''), 'idle');
  v_run_id     uuid;
  v_existing   public.agent_live_sessions%ROWTYPE;
  v_is_service boolean :=
    (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
  v_caller     uuid := auth.uid();
  v_user_id    uuid;
BEGIN
  -- Auth: service_role (dirigent relay backend) or any authenticated user
  -- (VS Code extension push). Anonymous callers are rejected.
  IF NOT v_is_service AND v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  -- Identity hardening (AITG-APP-04): non-service callers report only
  -- themselves — p_user_id from the body is overridden by the JWT subject.
  v_user_id := CASE WHEN v_is_service THEN p_user_id ELSE v_caller END;

  -- JIT-provision a non-service caller so agent_live_sessions.user_id (FK
  -- aisha_auth.users) can't 23503 for a Keycloak user created post-bootstrap.
  IF NOT v_is_service THEN
    PERFORM public.ensure_current_user();
  END IF;

  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'fn_upsert_agent_live_session: p_session_id required'
      USING ERRCODE = '22023';
  END IF;

  -- Phase taxonomy is data, not schema: validate against the catalog so AISHA
  -- can extend phases by seeding rows. 'session_start' is a lifecycle alias.
  IF v_phase <> 'session_start' AND NOT EXISTS (
    SELECT 1 FROM public.agent_phase_catalog c
    WHERE c.axis = 'activity' AND c.slug = v_phase AND c.is_active
  ) THEN
    RAISE EXCEPTION 'fn_upsert_agent_live_session: unknown activity phase %', v_phase
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.agent_live_sessions
  WHERE session_id = p_session_id;

  -- Telemetry aggregate: one ai_run per session. Lazily created so every
  -- consumer (anomaly scan, performance snapshot, router coach, cost rollup)
  -- sees IDE sessions through the same ai_runs/ai_trace_events lens.
  v_run_id := v_existing.ai_run_id;
  IF v_run_id IS NULL THEN
    INSERT INTO public.ai_runs (kind, story_id, actor_user_id, status, metadata)
    VALUES (
      'ide_session',
      COALESCE(p_story_id, v_existing.story_id),
      COALESCE(v_user_id, v_existing.user_id),
      'running',
      jsonb_strip_nulls(jsonb_build_object(
        'session_id', p_session_id,
        'source', v_source,
        'branch', COALESCE(p_branch, v_existing.branch)
      ))
    )
    RETURNING id INTO v_run_id;
  END IF;

  INSERT INTO public.agent_live_sessions
    (session_id, source, story_id, user_id, agent_run_id, ai_run_id, branch,
     current_phase, phase_detail, current_task, last_tool, last_file,
     started_at, updated_at)
  VALUES (
    p_session_id,
    v_source,
    p_story_id,
    v_user_id,
    p_agent_run_id,
    v_run_id,
    p_branch,
    CASE WHEN v_phase = 'session_start' THEN 'idle' ELSE v_phase END,
    p_phase_detail,
    p_current_task,
    p_last_tool,
    p_last_file,
    now(),
    now()
  )
  ON CONFLICT (session_id) DO UPDATE SET
    source        = EXCLUDED.source,
    story_id      = COALESCE(EXCLUDED.story_id, agent_live_sessions.story_id),
    user_id       = COALESCE(EXCLUDED.user_id, agent_live_sessions.user_id),
    agent_run_id  = COALESCE(EXCLUDED.agent_run_id, agent_live_sessions.agent_run_id),
    ai_run_id     = COALESCE(agent_live_sessions.ai_run_id, EXCLUDED.ai_run_id),
    branch        = COALESCE(EXCLUDED.branch, agent_live_sessions.branch),
    current_phase = CASE
                      WHEN v_phase = 'session_start'
                      THEN agent_live_sessions.current_phase
                      ELSE EXCLUDED.current_phase
                    END,
    phase_detail  = COALESCE(EXCLUDED.phase_detail, agent_live_sessions.phase_detail),
    current_task  = COALESCE(EXCLUDED.current_task, agent_live_sessions.current_task),
    last_tool     = COALESCE(EXCLUDED.last_tool, agent_live_sessions.last_tool),
    last_file     = COALESCE(EXCLUDED.last_file, agent_live_sessions.last_file),
    updated_at    = now();

  -- Session end: finalize the aggregate run. finish_ai_run prefers the
  -- event-sourced cost rollup (tokens/usd from ai_trace_events.cost_json).
  IF v_phase = 'stopped' AND v_run_id IS NOT NULL THEN
    PERFORM public.finish_ai_run(v_run_id, 'succeeded');
  END IF;

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_upsert_agent_live_session(text, text, uuid, uuid, text, text, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_upsert_agent_live_session(text, text, uuid, uuid, text, text, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_upsert_agent_live_session(text, text, uuid, uuid, text, text, text, text, text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.fn_upsert_agent_live_session(text, text, uuid, uuid, text, text, text, text, text, text, uuid) IS
  'Upsert agent_live_sessions row + manage the per-session ide_session ai_run (create on first sight, finish_ai_run on stopped). Phase validated against agent_phase_catalog axis=activity. Returns ai_run_id.';

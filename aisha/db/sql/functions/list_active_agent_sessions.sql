-- ============================================================================
-- Source of Truth: list_active_agent_sessions
-- Description: Active agent work sessions (any source) for the Mission
--   Control AgentSessionsStrip and the Dirigent VS Code live panel.
--   Live token/cost figures are aggregated from ai_trace_events through the
--   session's ide_session ai_run — the same rollup finish_ai_run persists.
-- Security: SECURITY DEFINER. Mirrors list_active_agent_runs visibility:
--   admin/staff see everything, others see their own sessions.
-- See also: agent_live_sessions (table), list_active_agent_runs (the
--   AISHA-orchestrated-runs twin pane), useAgentLiveSessions (UI consumer).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_active_agent_sessions(
  p_limit  int  DEFAULT 20,
  p_source text DEFAULT NULL
)
RETURNS TABLE (
  session_id      text,
  source          text,
  story_id        uuid,
  story_title     text,
  user_id         uuid,
  agent_run_id    uuid,
  ai_run_id       uuid,
  branch          text,
  current_phase   text,
  phase_detail    text,
  current_task    text,
  last_tool       text,
  last_file       text,
  subagents       jsonb,
  tokens_estimate int,
  tokens_input    bigint,
  tokens_output   bigint,
  cost        numeric,
  started_at      timestamptz,
  updated_at      timestamptz,
  elapsed_ms      bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id  uuid    := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);

  RETURN QUERY
  SELECT
    s.session_id,
    s.source,
    s.story_id,
    ps.title                                                   AS story_title,
    s.user_id,
    s.agent_run_id,
    s.ai_run_id,
    s.branch,
    s.current_phase,
    s.phase_detail,
    s.current_task,
    s.last_tool,
    s.last_file,
    s.subagents,
    s.tokens_estimate,
    -- SUM() over bigint widens to numeric; cast back to match the bigint
    -- column types declared in RETURNS TABLE (else 42804 at call time).
    COALESCE(tc.tokens_in, 0)::bigint                          AS tokens_input,
    COALESCE(tc.tokens_out, 0)::bigint                         AS tokens_output,
    COALESCE(tc.usd, 0)::numeric                               AS cost,
    s.started_at,
    s.updated_at,
    EXTRACT(EPOCH FROM (now() - s.started_at))::bigint * 1000  AS elapsed_ms
  FROM public.agent_live_sessions s
  LEFT JOIN public.partner_stories ps ON ps.id = s.story_id
  LEFT JOIN LATERAL (
    SELECT
      SUM(COALESCE((ate.cost_json->>'tokens_in')::bigint, 0))  AS tokens_in,
      SUM(COALESCE((ate.cost_json->>'tokens_out')::bigint, 0)) AS tokens_out,
      SUM(COALESCE((ate.cost_json->>'usd')::numeric, 0))       AS usd
    FROM public.ai_trace_events ate
    WHERE ate.run_id = s.ai_run_id
  ) tc ON s.ai_run_id IS NOT NULL
  WHERE
    s.current_phase <> 'stopped'
    AND s.updated_at > now() - interval '1 hour'
    AND (p_source IS NULL OR s.source = p_source)
    AND (
      v_is_admin
      OR s.user_id = v_user_id
    )
  ORDER BY s.updated_at DESC
  LIMIT LEAST(p_limit, 100);
END;
$$;

REVOKE ALL ON FUNCTION public.list_active_agent_sessions(int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_agent_sessions(int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_agent_sessions(int, text) TO service_role;

COMMENT ON FUNCTION public.list_active_agent_sessions(int, text) IS
  'Active agent work sessions (source-dimensioned) with live token/cost rollup from ai_trace_events. Admin sees all; others own sessions only.';

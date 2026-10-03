-- Function: public.list_active_agent_runs
-- Description: Returns currently-running ai_runs for the mission-control
--   LiveAgentsStrip pane. Joined with most-recent ai_trace_event for
--   "what is the agent doing right now" summary.
-- Security: SECURITY DEFINER. Admin/staff visibility on every row;
--   non-admins see only runs whose story they participate in (matches
--   kanban_stories_view semantics so the same user sees consistent slice
--   of "AISHA activity" across panels).
-- See also: ai_runs (table), ai_trace_events (table), kanban_stories_view
--   (parallel viewer), useLiveTable hook (UI consumer).

CREATE OR REPLACE FUNCTION public.list_active_agent_runs(
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  run_id                uuid,
  kind                  text,
  story_id              uuid,
  story_title           text,
  is_stack_default      boolean,
  status                text,
  started_at            timestamptz,
  elapsed_ms            bigint,
  current_agent_slug    text,
  current_step          text,
  step_count            int,
  cost_total        numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);

  RETURN QUERY
  WITH active AS (
    SELECT ar.id, ar.kind, ar.story_id, ar.status, ar.started_at,
           ar.route_plan, ar.metadata, ar.cost_total_json
    FROM public.ai_runs ar
    WHERE ar.status = 'running'
      -- ide_session aggregates (agent_live_sessions telemetry runs) surface in
      -- the AgentSessionsStrip pane via list_active_agent_sessions — exclude
      -- them here so the two mission-control panes stay disjoint.
      AND ar.kind <> 'ide_session'
  ),
  visible AS (
    SELECT a.*
    FROM active a
    LEFT JOIN public.partner_stories ps ON ps.id = a.story_id
    WHERE
      v_is_admin
      OR a.story_id IS NULL                 -- system run, admin-only via fallback below
      OR ps.is_stack_default = true
      OR EXISTS (
        SELECT 1 FROM public.story_participants sp
        WHERE sp.story_id = a.story_id AND sp.user_id = v_user_id
      )
  ),
  latest_event AS (
    SELECT DISTINCT ON (ate.run_id)
      ate.run_id, ate.agent_slug, ate.operation, ate.created_at
    FROM public.ai_trace_events ate
    WHERE ate.run_id IN (SELECT id FROM visible)
    ORDER BY ate.run_id, ate.created_at DESC
  ),
  event_count AS (
    SELECT ate.run_id, COUNT(*)::int AS n
    FROM public.ai_trace_events ate
    WHERE ate.run_id IN (SELECT id FROM visible)
    GROUP BY ate.run_id
  )
  SELECT
    v.id                                                     AS run_id,
    v.kind,
    v.story_id,
    ps.title                                                 AS story_title,
    COALESCE(ps.is_stack_default, false)                     AS is_stack_default,
    v.status,
    v.started_at,
    -- elapsed_ms: now - started, capped at int8 range; clients render hh:mm:ss.
    EXTRACT(EPOCH FROM (now() - v.started_at))::bigint * 1000 AS elapsed_ms,
    COALESCE(
      le.agent_slug,
      v.route_plan -> 'agents' -> 0 ->> 'slug',
      v.metadata ->> 'agent_slug',
      v.kind
    )                                                        AS current_agent_slug,
    le.operation                                             AS current_step,
    COALESCE(ec.n, 0)                                        AS step_count,
    -- cost_total_json shape: { total, breakdown[] }. Fallback to 0.
    NULLIF(v.cost_total_json ->> 'total', '')::numeric   AS cost_total
  FROM visible v
  LEFT JOIN public.partner_stories ps ON ps.id = v.story_id
  LEFT JOIN latest_event           le ON le.run_id = v.id
  LEFT JOIN event_count            ec ON ec.run_id = v.id
  ORDER BY v.started_at DESC
  LIMIT LEAST(p_limit, 100);
END;
$$;

REVOKE ALL ON FUNCTION public.list_active_agent_runs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_agent_runs(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_agent_runs(int) TO service_role;

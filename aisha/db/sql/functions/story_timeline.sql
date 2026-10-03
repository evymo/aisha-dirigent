-- Function: public.story_timeline
-- Description: Unified chronological feed for one story — what AISHA + the
--   deploy pipeline have been doing. UNIONs three sources:
--     1. ai_trace_events for the story's ai_runs (LLM calls, tool calls,
--        patches, route decisions, critic reviews, escalations, etc.)
--     2. rollback_history rows whose app_name matches one of the story's
--        coolify_app_slots
--     3. Synthetic 'bg_switch' rows from coolify_app_slots.last_switch_at
--        for the story's apps
-- Security: SECURITY DEFINER. Admin/staff see all; otherwise the caller
--   must be a story_participants member (matches kanban_stories_view +
--   get_story_rulesets pattern).
-- See also: ai_trace_events (table), rollback_history (table),
--   coolify_app_slots (table), useStoryTimeline (UI hook).

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.story_timeline(uuid, integer);

CREATE OR REPLACE FUNCTION public.story_timeline(
  p_story_id uuid,
  p_limit    int DEFAULT 50
)
RETURNS TABLE (
  event_id        uuid,
  event_kind      text,       -- 'trace' | 'rollback' | 'bg_switch'
  trace_event_type text,      -- ai_event_type::text (NULL for non-trace)
  ts              timestamptz,
  agent_slug      text,
  operation       text,
  status          text,
  duration_ms     int,
  cost        numeric,
  story_id        uuid,
  run_id          uuid,
  app_name        text,
  files_changed   text[],
  payload         jsonb
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

  -- Authorization: admin/staff OR participant OR stack-default story.
  IF NOT v_is_admin
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_stories ps
       WHERE ps.id = p_story_id
         AND (
           ps.is_stack_default = true
           OR EXISTS (
             SELECT 1 FROM public.story_participants sp
             WHERE sp.story_id = ps.id AND sp.user_id = v_user_id
           )
         )
     )
  THEN
    RAISE EXCEPTION 'Access denied: story participant or admin/staff required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH story_runs AS (
    SELECT ar.id AS run_id
    FROM public.ai_runs ar
    WHERE ar.story_id = p_story_id
  ),
  story_apps AS (
    SELECT cs.app_name, cs.last_switch_at, cs.active_slot,
           cs.blue_image_tag, cs.green_image_tag
    FROM public.coolify_app_slots cs
    WHERE cs.story_id = p_story_id
  ),
  trace_rows AS (
    SELECT
      ate.id                       AS event_id,
      'trace'::text                AS event_kind,
      ate.event_type::text         AS trace_event_type,
      ate.created_at               AS ts,
      ate.agent_slug,
      ate.operation,
      ate.status,
      ate.duration_ms,
      NULLIF(ate.cost_json ->> 'total', '')::numeric AS cost,
      p_story_id                   AS story_id,
      ate.run_id,
      NULL::text                   AS app_name,
      CASE
        WHEN ate.event_type = 'patch_applied'
             AND jsonb_typeof(ate.response_summary -> 'files') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(ate.response_summary -> 'files'))
        ELSE NULL
      END                          AS files_changed,
      jsonb_strip_nulls(jsonb_build_object(
        'provider',         ate.provider,
        'request_summary',  ate.request_summary,
        'response_summary', ate.response_summary,
        'error',            ate.error_json
      ))                           AS payload
    FROM public.ai_trace_events ate
    WHERE ate.run_id IN (SELECT run_id FROM story_runs)
  ),
  rollback_rows AS (
    SELECT
      rh.id                        AS event_id,
      'rollback'::text             AS event_kind,
      NULL::text                   AS trace_event_type,
      rh.triggered_at              AS ts,
      NULL::text                   AS agent_slug,
      format('rollback %s→%s', rh.from_slot, rh.to_slot) AS operation,
      COALESCE(rh.execution_status, rh.approval_status)   AS status,
      NULL::int                    AS duration_ms,
      NULL::numeric                AS cost,
      p_story_id                   AS story_id,
      NULL::uuid                   AS run_id,
      rh.app_name,
      NULL::text[]                 AS files_changed,
      jsonb_strip_nulls(jsonb_build_object(
        'from_slot',         rh.from_slot,
        'to_slot',           rh.to_slot,
        'from_image_tag',    rh.from_image_tag,
        'to_image_tag',      rh.to_image_tag,
        'triggered_by',      rh.triggered_by,
        'approval_status',   rh.approval_status,
        'execution_status',  rh.execution_status,
        'sentry_correlation', rh.sentry_correlation
      ))                           AS payload
    FROM public.rollback_history rh
    WHERE rh.app_name IN (SELECT app_name FROM story_apps)
  ),
  bg_switch_rows AS (
    SELECT
      gen_random_uuid()            AS event_id,
      'bg_switch'::text            AS event_kind,
      NULL::text                   AS trace_event_type,
      sa.last_switch_at            AS ts,
      NULL::text                   AS agent_slug,
      format('B/G switch → %s', sa.active_slot) AS operation,
      'succeeded'::text            AS status,
      NULL::int                    AS duration_ms,
      NULL::numeric                AS cost,
      p_story_id                   AS story_id,
      NULL::uuid                   AS run_id,
      sa.app_name,
      NULL::text[]                 AS files_changed,
      jsonb_build_object(
        'active_slot',      sa.active_slot,
        'blue_image_tag',   sa.blue_image_tag,
        'green_image_tag',  sa.green_image_tag
      )                            AS payload
    FROM story_apps sa
    WHERE sa.last_switch_at IS NOT NULL
  )
  SELECT * FROM (
    SELECT * FROM trace_rows
    UNION ALL
    SELECT * FROM rollback_rows
    UNION ALL
    SELECT * FROM bg_switch_rows
  ) merged
  ORDER BY ts DESC NULLS LAST
  LIMIT LEAST(p_limit, 500);
END;
$$;

REVOKE ALL ON FUNCTION public.story_timeline(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.story_timeline(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.story_timeline(uuid, int) TO service_role;

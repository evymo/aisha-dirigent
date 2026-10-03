-- Function: public.get_integration_events_for_story
-- Returns recent integration events for a specific story (webhooks, deployments).
-- @security: admin/staff only

CREATE OR REPLACE FUNCTION public.get_integration_events_for_story(
  p_story_id  uuid,
  p_limit     integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(ev ORDER BY created_at DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', id,
        'event_source', event_source,
        'event_type', event_type,
        'status', status,
        'duration_ms', duration_ms,
        'attempt', attempt,
        'error_message', error_json->>'message',
        'routed_to', routed_to,
        'created_at', created_at
      ) AS ev, created_at
      FROM integration_events
      WHERE story_id = p_story_id
      ORDER BY created_at DESC
      LIMIT p_limit
    ) sub
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_integration_events_for_story(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_integration_events_for_story(uuid, integer) TO authenticated;

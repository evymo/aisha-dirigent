-- Function: public.get_exhausted_integration_events
-- Returns integration events that exhausted all retry attempts.
-- For monitoring dashboards and alerting.
-- @security: admin/staff only

CREATE OR REPLACE FUNCTION public.get_exhausted_integration_events(
  p_hours_back integer DEFAULT 24
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
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', ie.id,
        'event_source', ie.event_source,
        'event_type', ie.event_type,
        'external_id', ie.external_id,
        'attempt', ie.attempt,
        'max_attempts', ie.max_attempts,
        'error_message', ie.error_json->>'message',
        'story_id', ie.story_id,
        'created_at', ie.created_at
      )
      ORDER BY ie.created_at DESC
    ), '[]'::jsonb)
    FROM integration_events ie
    WHERE ie.status = 'exhausted'
      AND ie.created_at > now() - (p_hours_back || ' hours')::interval
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_exhausted_integration_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_exhausted_integration_events(integer) TO authenticated;

-- Function: public.get_integration_event_stats
-- Returns aggregated statistics for integration events within a time window.
-- Includes: total, by-status, error rate, retry rate, p95 duration, top errors.
-- Supports pagination via p_limit/p_offset for top_errors and by_event_type.
-- @security: admin/staff only

CREATE OR REPLACE FUNCTION public.get_integration_event_stats(
  p_hours_back    integer DEFAULT 24,
  p_event_source  text DEFAULT NULL,
  p_limit         integer DEFAULT 20,
  p_offset        integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Guard: max 720 hours (30 days)
  IF p_hours_back > 720 THEN
    p_hours_back := 720;
  END IF;

  SELECT jsonb_build_object(
    'period_hours', p_hours_back,
    'event_source_filter', p_event_source,
    'total', COUNT(*),
    'completed', COUNT(*) FILTER (WHERE status = 'completed'),
    'failed', COUNT(*) FILTER (WHERE status = 'failed'),
    'exhausted', COUNT(*) FILTER (WHERE status = 'exhausted'),
    'skipped_duplicate', COUNT(*) FILTER (WHERE status = 'skipped_duplicate'),
    'processing', COUNT(*) FILTER (WHERE status = 'processing'),
    'avg_duration_ms', ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL)),
    'p95_duration_ms', ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)
                        FILTER (WHERE duration_ms IS NOT NULL)),
    'error_rate', ROUND(
      COUNT(*) FILTER (WHERE status IN ('failed', 'exhausted'))::numeric
      / NULLIF(COUNT(*), 0), 4
    ),
    'retry_rate', ROUND(
      COUNT(*) FILTER (WHERE attempt > 1)::numeric
      / NULLIF(COUNT(*), 0), 4
    ),
    'top_errors', (
      SELECT COALESCE(jsonb_agg(err), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'event_type', event_type,
          'error_message', error_json->>'message',
          'count', COUNT(*)
        ) AS err
        FROM integration_events
        WHERE created_at > now() - (p_hours_back || ' hours')::interval
          AND status IN ('failed', 'exhausted')
          AND (p_event_source IS NULL OR event_source = p_event_source)
        GROUP BY event_type, error_json->>'message'
        ORDER BY COUNT(*) DESC
        LIMIT p_limit OFFSET p_offset
      ) sub
    ),
    'by_event_type', (
      SELECT COALESCE(jsonb_agg(et), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'event_type', event_type,
          'count', COUNT(*),
          'avg_duration_ms', ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL)),
          'error_rate', ROUND(
            COUNT(*) FILTER (WHERE status IN ('failed', 'exhausted'))::numeric
            / NULLIF(COUNT(*), 0), 4
          )
        ) AS et
        FROM integration_events
        WHERE created_at > now() - (p_hours_back || ' hours')::interval
          AND (p_event_source IS NULL OR event_source = p_event_source)
        GROUP BY event_type
        ORDER BY COUNT(*) DESC
        LIMIT p_limit OFFSET p_offset
      ) sub
    )
  ) INTO v_result
  FROM integration_events
  WHERE created_at > now() - (p_hours_back || ' hours')::interval
    AND (p_event_source IS NULL OR event_source = p_event_source);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_integration_event_stats(integer, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_integration_event_stats(integer, text, integer, integer) TO authenticated;

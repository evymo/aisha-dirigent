-- Function: public.analyze_integration_performance
-- Analyzes integration event performance over a rolling window.
-- Per-event_type metrics: count, avg_duration, p95, error_rate, retry_rate.
-- Per-installation metrics: total events, health score, trend.
-- Per-story metrics: webhook count, failure rate, delivery correlation.
-- Hourly time-series for trend visualization.
-- @security: admin/staff via is_admin_or_staff()

CREATE OR REPLACE FUNCTION public.analyze_integration_performance(
  p_hours_back integer DEFAULT 24,
  p_installation_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cutoff timestamptz := now() - (p_hours_back || ' hours')::interval;
  v_by_event_type jsonb;
  v_by_installation jsonb;
  v_by_story jsonb;
  v_hourly_trend jsonb;
  v_summary jsonb;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Per event_type metrics
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_by_event_type
  FROM (
    SELECT
      event_type,
      event_source,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status IN ('failed', 'exhausted')) AS failed,
      ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL)) AS avg_duration_ms,
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)
        FILTER (WHERE duration_ms IS NOT NULL)) AS p95_duration_ms,
      ROUND(
        COUNT(*) FILTER (WHERE status IN ('failed', 'exhausted'))::numeric /
        NULLIF(COUNT(*), 0) * 100, 1
      ) AS error_rate_pct,
      ROUND(
        COUNT(*) FILTER (WHERE attempt > 1)::numeric /
        NULLIF(COUNT(*), 0) * 100, 1
      ) AS retry_rate_pct
    FROM integration_events
    WHERE created_at > v_cutoff
      AND (p_installation_id IS NULL OR installation_id = p_installation_id)
    GROUP BY event_type, event_source
    ORDER BY total DESC
    LIMIT 20
  ) t;

  -- Per installation metrics
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_by_installation
  FROM (
    SELECT
      ie.installation_id,
      gai.account_login,
      COUNT(*) AS total_events,
      COUNT(*) FILTER (WHERE ie.status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE ie.status IN ('failed', 'exhausted')) AS failed,
      ROUND(AVG(ie.duration_ms) FILTER (WHERE ie.duration_ms IS NOT NULL)) AS avg_duration_ms,
      ROUND(
        COUNT(*) FILTER (WHERE ie.status = 'completed')::numeric /
        NULLIF(COUNT(*), 0) * 100, 1
      ) AS health_score
    FROM integration_events ie
    LEFT JOIN github_app_installations gai ON gai.installation_id = ie.installation_id
    WHERE ie.created_at > v_cutoff
      AND ie.installation_id IS NOT NULL
      AND (p_installation_id IS NULL OR ie.installation_id = p_installation_id)
    GROUP BY ie.installation_id, gai.account_login
    ORDER BY total_events DESC
    LIMIT 10
  ) t;

  -- Per story metrics
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_by_story
  FROM (
    SELECT
      story_id,
      COUNT(*) AS total_events,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status IN ('failed', 'exhausted')) AS failed,
      COUNT(*) FILTER (WHERE event_source = 'deployment') AS deploy_events,
      ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL)) AS avg_duration_ms
    FROM integration_events
    WHERE created_at > v_cutoff
      AND story_id IS NOT NULL
      AND (p_installation_id IS NULL OR installation_id = p_installation_id)
    GROUP BY story_id
    ORDER BY total_events DESC
    LIMIT 10
  ) t;

  -- Hourly time-series
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.hour), '[]'::jsonb)
  INTO v_hourly_trend
  FROM (
    SELECT
      date_trunc('hour', created_at) AS hour,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status IN ('failed', 'exhausted')) AS failed,
      ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL)) AS avg_duration_ms
    FROM integration_events
    WHERE created_at > v_cutoff
      AND (p_installation_id IS NULL OR installation_id = p_installation_id)
    GROUP BY date_trunc('hour', created_at)
    ORDER BY hour
  ) t;

  -- Summary
  SELECT jsonb_build_object(
    'period_hours', p_hours_back,
    'total_events', COUNT(*),
    'completed', COUNT(*) FILTER (WHERE status = 'completed'),
    'failed', COUNT(*) FILTER (WHERE status IN ('failed', 'exhausted')),
    'exhausted', COUNT(*) FILTER (WHERE status = 'exhausted'),
    'avg_duration_ms', ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL)),
    'error_rate_pct', ROUND(
      COUNT(*) FILTER (WHERE status IN ('failed', 'exhausted'))::numeric /
      NULLIF(COUNT(*), 0) * 100, 1
    )
  )
  INTO v_summary
  FROM integration_events
  WHERE created_at > v_cutoff
    AND (p_installation_id IS NULL OR installation_id = p_installation_id);

  RETURN jsonb_build_object(
    'summary', v_summary,
    'by_event_type', v_by_event_type,
    'by_installation', v_by_installation,
    'by_story', v_by_story,
    'hourly_trend', v_hourly_trend
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analyze_integration_performance(integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analyze_integration_performance(integer, bigint) TO authenticated;

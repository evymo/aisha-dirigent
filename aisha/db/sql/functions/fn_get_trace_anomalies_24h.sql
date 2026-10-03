-- Function: fn_get_trace_anomalies_24h

CREATE OR REPLACE FUNCTION public.fn_get_trace_anomalies_24h(p_min_occurrences integer DEFAULT 3, p_max_results integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- Only service_role or admin can call this
  IF NOT (
    public.is_service_role()
    OR is_admin_or_staff()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role or admin';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      a.event_type,
      a.agent_slug,
      a.operation,
      a.status,
      a.occurrences,
      a.first_seen,
      a.last_seen,
      a.request_summary,
      a.anomaly_key
    FROM (
      -- Source 1: ai_trace_events (existing). event_type is cast to text so the
      -- UNION ALL with integration_events (whose event_type column is text — a
      -- different domain: 'pull_request.opened', 'push', …) is type-compatible.
      -- Without the cast the function raised "UNION types ai_event_type and text
      -- cannot be matched" at plan time and never ran. A unified text label is the
      -- correct representation for an anomaly report spanning both event domains
      -- (the anomaly_key concat below already treats event_type as text). Separate
      -- defect from the 'system' enum literal fixed below; found by direct-call verify.
      SELECT
        event_type::text AS event_type,
        agent_slug,
        operation,
        status,
        count(*) AS occurrences,
        min(created_at) AS first_seen,
        max(created_at) AS last_seen,
        (array_agg(request_summary ORDER BY created_at DESC))[1] AS request_summary,
        agent_slug || '::' || event_type || '::' || operation || '::' || status AS anomaly_key
      FROM ai_trace_events
      WHERE created_at >= now() - interval '24 hours'
        AND status IN ('error', 'failed', 'timeout', 'rejected')
      GROUP BY event_type, agent_slug, operation, status
      HAVING count(*) >= p_min_occurrences

      UNION ALL

      -- Source 2: integration_events (GitHub App, webhooks, deployments)
      SELECT
        event_type,
        'integration' AS agent_slug,
        event_source AS operation,
        status,
        count(*) AS occurrences,
        min(created_at) AS first_seen,
        max(created_at) AS last_seen,
        (array_agg(error_json ORDER BY created_at DESC))[1] AS request_summary,
        'integration::' || event_source || '::' || event_type || '::' || status AS anomaly_key
      FROM integration_events
      WHERE created_at >= now() - interval '24 hours'
        AND status IN ('failed', 'exhausted')
      GROUP BY event_type, event_source, status
      HAVING count(*) >= p_min_occurrences
    ) a
    WHERE NOT EXISTS (
      SELECT 1 FROM improvement_proposals ip
      WHERE ip.anomaly_key = a.anomaly_key
        AND ip.status IN ('draft','pending','pending_review','approved','auto_approved','in_progress')
        AND ip.created_at >= now() - interval '7 days'
    )
    ORDER BY a.occurrences DESC
    LIMIT LEAST(p_max_results, 20)
  ) t;

  -- Log that we ran the analysis
  INSERT INTO ai_trace_events (
    run_id,
    event_type,
    agent_slug,
    operation,
    status,
    request_summary,
    created_at
  ) VALUES (
    gen_random_uuid(),
    -- 'dirigent_action' is a valid ai_event_type member (Dirigent self-scan,
    -- agent_slug='dirigent'). The prior 'system' was not a member, so this
    -- audit INSERT (event_type is ai_event_type NOT NULL) raised `invalid input
    -- value for enum ai_event_type` and aborted the nightly anomaly scan.
    'dirigent_action',
    'dirigent',
    'trace_anomaly_scan',
    'ok',
    jsonb_build_object(
      'anomalies_found', jsonb_array_length(v_result),
      'min_occurrences', p_min_occurrences,
      'window', '24h',
      'dedup_window', '7d'
    ),
    now()
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION fn_get_trace_anomalies_24h(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_get_trace_anomalies_24h(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_get_trace_anomalies_24h(integer,integer) TO service_role;

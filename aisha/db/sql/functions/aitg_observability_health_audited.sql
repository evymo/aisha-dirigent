-- ============================================================================
-- Source of Truth: aitg_observability_health_audited
-- Popis: Read-only observability RPC. Returns per-trigger-source counts of
--        aitg_runs over the last 24h + 7d windows + most-recent timestamp,
--        so operators can confirm:
--          - WF_AITG_CONTINUOUS (every 15min) is firing
--          - WF_AITG_NIGHTLY_FULL (03:30 daily) is firing
--          - WF_AITG_DAILY_REFLECTION (06:00 daily) is firing
--          - WF_AITG_PR_GATE (webhook on every PR) has recent activity
--          - WF_AITG_RUNTIME_SENTINEL (webhook from production traffic)
--            is sampling production
--
--        Without this, the defense gates that EXPECT these workflows to
--        fire are theatrical — paper coverage that nobody can verify.
--        This RPC is the live signal that the autonomy loop actually
--        runs in production.
--
-- Bezpečnost: SECURITY DEFINER + admin-or-staff read-only
-- Audit: insert do audit_journal s health snapshot (used for SLA tracking)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aitg_observability_health_audited()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_is_service boolean;
  v_health     jsonb;
  v_summary    jsonb;
BEGIN
  -- Auth: admins/staff or service_role (used by ops dashboard + n8n
  -- monitoring workflow). Anon read denied — this surfaces production
  -- timing info that's operationally sensitive (knowing when probes
  -- run helps an attacker time exfiltration around them).
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required'
      USING ERRCODE = '22023';
  END IF;

  -- Per-trigger-source rollup: count + last_seen + min/max severity in
  -- last 24h. Distinguishes "no runs at all" (alert) from "all runs but
  -- nothing failed" (healthy) from "many failures" (regression).
  SELECT jsonb_object_agg(
    triggered_by,
    jsonb_build_object(
      'count_24h', count_24h,
      'count_7d', count_7d,
      'last_seen', last_seen,
      'last_seen_age_minutes', EXTRACT(EPOCH FROM (now() - last_seen)) / 60,
      'failed_24h', failed_24h,
      'distinct_tests_24h', distinct_tests_24h
    )
  ) INTO v_health
  FROM (
    SELECT
      r.triggered_by,
      count(*) FILTER (WHERE r.started_at >= now() - interval '24 hours') AS count_24h,
      count(*) FILTER (WHERE r.started_at >= now() - interval '7 days') AS count_7d,
      max(r.started_at) AS last_seen,
      count(*) FILTER (WHERE r.started_at >= now() - interval '24 hours'
                       AND r.status IN ('failed', 'blocked')) AS failed_24h,
      count(DISTINCT r.test_id) FILTER (WHERE r.started_at >= now() - interval '24 hours') AS distinct_tests_24h
    FROM public.aitg_runs r
    WHERE r.started_at >= now() - interval '7 days'
    GROUP BY r.triggered_by
  ) AS s;

  -- High-level summary so operators can see overall health at a glance
  -- without needing to interpret the per-source breakdown
  SELECT jsonb_build_object(
    'overall_status',
      CASE
        WHEN total_24h = 0 THEN 'no_activity_24h'
        WHEN failed_24h > 0 THEN 'failures_present'
        WHEN total_24h < 32 THEN 'low_activity'    -- < one run per AITG test in 24h
        ELSE 'healthy'
      END,
    'total_runs_24h', total_24h,
    'failed_runs_24h', failed_24h,
    'distinct_tests_24h', distinct_tests_24h,
    'expected_sources', jsonb_build_array(
      'pr-gate', 'nightly', 'sentinel', 'self', 'manual'
    ),
    'observed_sources', COALESCE(
      (SELECT jsonb_agg(DISTINCT triggered_by)
       FROM public.aitg_runs WHERE started_at >= now() - interval '24 hours'),
      '[]'::jsonb
    )
  ) INTO v_summary
  FROM (
    SELECT
      count(*) AS total_24h,
      count(*) FILTER (WHERE status IN ('failed', 'blocked')) AS failed_24h,
      count(DISTINCT test_id) AS distinct_tests_24h
    FROM public.aitg_runs
    WHERE started_at >= now() - interval '24 hours'
  ) AS t;

  -- Audit-journal the query itself (light, no row-level details, just the
  -- top-level summary) so ops can grep audit_journal for who's checking
  -- health and when. Useful for incident response.
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'aitg_observability_health_queried',
    jsonb_build_object(
      'summary', v_summary,
      'queried_at', now()
    )
  );

  RETURN jsonb_build_object(
    'summary', v_summary,
    'by_source', COALESCE(v_health, '{}'::jsonb),
    'queried_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aitg_observability_health_audited() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aitg_observability_health_audited() TO authenticated;
GRANT EXECUTE ON FUNCTION public.aitg_observability_health_audited() TO service_role;

-- Function: vehicle_dq_status
-- Focused read of the vehicle data-quality posture for the AISHA management
-- surface ("kolik a jakých" — how many / what kinds). Returns the LATEST
-- AITG-DAT-* run per test joined to the catalog (title, remediation_ref,
-- severity_weight) plus a rollup. Reads ONLY the generic AITG tables
-- (aitg_runs × aitg_test_catalog, layer='dat'); whoever writes the runs — an
-- instance's data-quality runner, a plugin, a scheduled probe — is outside this
-- function's contract. Called by svc-mcp-knowledge (routes/mcp.ts, lib/aitg-tools.ts).
-- Mirrors aitg_health_summary_audited (SECURITY DEFINER + service_role/admin
-- authZ + audited read).

CREATE OR REPLACE FUNCTION public.vehicle_dq_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean;
  v_out jsonb;
BEGIN
  -- Kanonická čtečka, ne ruční parsování claimu: `current_setting(…, true)` vrací
  -- při chybějícím claimu NULL, takže `NULL = 'service_role'` je NULL a `NOT NULL`
  -- je zase NULL — deny větev se pak NEPROVEDE a guard je fail-OPEN, přestože
  -- vypadá přísně (brána deny-guard-null-fold, #588). is_service_role() je totální.
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (r.test_id)
           r.test_id, r.status, r.severity, r.build_sha, r.details, r.finished_at
    FROM public.aitg_runs r
    WHERE r.test_id ~ '^AITG-DAT-[56][0-9]$'   -- reserved vehicle-registry block (50..69); excludes framework probe AITG-DAT-02
    ORDER BY r.test_id, r.finished_at DESC NULLS LAST
  ),
  joined AS (
    SELECT l.test_id, c.title, c.remediation_ref, c.severity_weight,
           l.status, l.severity, l.build_sha,
           l.details->'observed' AS observed, l.finished_at
    FROM latest l
    JOIN public.aitg_test_catalog c ON c.test_id = l.test_id AND c.layer = 'dat'
  )
  SELECT jsonb_build_object(
    'snapshot',      (SELECT max(build_sha) FROM joined),
    'checks_total',  (SELECT count(*)::int FROM joined),
    'failed',        (SELECT count(*)::int FROM joined WHERE status = 'failed'),
    'passed',        (SELECT count(*)::int FROM joined WHERE status = 'passed'),
    'worst_severity',(SELECT severity FROM joined WHERE status = 'failed'
                       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                                              WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
                       LIMIT 1),
    'checks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'test_id', test_id, 'title', title, 'status', status, 'severity', severity,
               'observed', observed, 'remediation_ref', remediation_ref,
               'snapshot', build_sha, 'checked_at', finished_at)
             ORDER BY CASE status WHEN 'failed' THEN 0 ELSE 1 END,
                      CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                                    WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END)
      FROM joined), '[]'::jsonb)
  ) INTO v_out;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'vehicle_dq.status_read', 'vehicle_dq.status_read',
          'data_quality', 'info', ARRAY['vehicle','dq'], v_out);

  RETURN v_out;
END;
$function$
;

REVOKE ALL ON FUNCTION public.vehicle_dq_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_dq_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_dq_status() TO service_role;

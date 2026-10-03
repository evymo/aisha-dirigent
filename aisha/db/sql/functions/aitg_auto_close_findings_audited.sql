-- Function: aitg_auto_close_findings_audited

CREATE OR REPLACE FUNCTION public.aitg_auto_close_findings_audited(p_required_consecutive_passes integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean;
  v_closed     int := 0;
  v_finding    record;
  v_recent_passes int;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  FOR v_finding IN
    SELECT f.finding_id, f.run_id, r.test_id, r.finished_at AS failed_at
    FROM public.aitg_findings f
    JOIN public.aitg_runs r ON r.run_id = f.run_id
    WHERE f.fixed_at IS NULL
  LOOP
    SELECT COUNT(*)
    INTO v_recent_passes
    FROM (
      SELECT status FROM public.aitg_runs
      WHERE test_id = v_finding.test_id
        AND finished_at > v_finding.failed_at
      ORDER BY finished_at ASC
      LIMIT p_required_consecutive_passes
    ) recent
    WHERE status = 'passed';

    IF v_recent_passes >= p_required_consecutive_passes THEN
      UPDATE public.aitg_findings
      SET fixed_at = now(),
          remediation = COALESCE(remediation, 'auto-closed: ' || p_required_consecutive_passes || ' consecutive passes')
      WHERE finding_id = v_finding.finding_id;
      v_closed := v_closed + 1;

      INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
      VALUES (auth.uid(), 'aitg.finding_auto_closed', 'aitg.finding_auto_closed', 'security', 'info',
              ARRAY['aitg', 'auto_close', v_finding.test_id],
              jsonb_build_object('finding_id', v_finding.finding_id, 'test_id', v_finding.test_id,
                                  'consecutive_passes', v_recent_passes));
    END IF;
  END LOOP;

  RETURN v_closed;
END;
$function$

;

REVOKE ALL ON FUNCTION aitg_auto_close_findings_audited(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aitg_auto_close_findings_audited(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION aitg_auto_close_findings_audited(integer) TO service_role;

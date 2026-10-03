-- ============================================================================
-- Function: aitg_record_run_audited
-- Purpose: Append-only record of a single AITG test execution.
-- AuthZ: admin, staff, OR service_role (service_role used by svc-aitg-probes
--        + Aisha's MCP tool surface).
-- Side effects: writes to aitg_runs AND audit_journal (action='aitg.run_recorded').
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aitg_record_run_audited(
  p_test_id      text,
  p_build_sha    text,
  p_triggered_by text,
  p_status       aitg_status,
  p_severity     aitg_severity,
  p_evidence_uri text,
  p_ai_run_id    uuid,
  p_details      jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id           uuid;
  v_is_service_role  boolean;
BEGIN
  v_is_service_role := public.is_service_role();
  IF NOT v_is_service_role AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.aitg_runs (test_id, build_sha, triggered_by, status, severity,
                                evidence_uri, ai_run_id, details, finished_at)
  VALUES (p_test_id, p_build_sha, p_triggered_by, p_status, p_severity,
          p_evidence_uri, p_ai_run_id, p_details, now())
  RETURNING run_id INTO v_run_id;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details, metadata)
  VALUES (
    auth.uid(),
    'aitg.run_recorded',
    'aitg.run_recorded',
    'security',
    CASE p_status WHEN 'failed' THEN 'warn' WHEN 'blocked' THEN 'warn' ELSE 'info' END,
    ARRAY['aitg', p_test_id, p_status::text],
    jsonb_build_object('test_id', p_test_id, 'build_sha', p_build_sha,
                       'status', p_status, 'severity', p_severity, 'run_id', v_run_id),
    p_details
  );

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aitg_record_run_audited(text, text, text, aitg_status, aitg_severity, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aitg_record_run_audited(text, text, text, aitg_status, aitg_severity, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aitg_record_run_audited(text, text, text, aitg_status, aitg_severity, text, uuid, jsonb) TO service_role;

-- Function: public.record_residency_audit
-- §11 DoD #5: persist a data-sensitivity verdict to audit_journal so residency
-- enforcement is auditable. Called fire-and-forget by svc-ai-chat AFTER
-- detectDataSensitivity (the verdict is the SAME one the dispatcher/evaluator
-- consult — no fork). SECURITY DEFINER so the service role can write regardless
-- of the journal's RLS. plpgsql (defers body validation; writes a row).
CREATE OR REPLACE FUNCTION public.record_residency_audit(
  p_user_id uuid,
  p_ai_run_id uuid,
  p_sensitivity text,
  p_tables text[],
  p_surface text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_confidential boolean := (p_sensitivity = 'confidential');
BEGIN
  INSERT INTO public.audit_journal
    (user_id, ai_run_id, action_type, action, entity_type, area, severity, summary, details, tags)
  VALUES (
    p_user_id,
    p_ai_run_id,
    'residency_classification',
    'data_sensitivity',
    'data_sensitivity_verdict',
    COALESCE(NULLIF(p_surface, ''), 'omni'),
    CASE WHEN v_confidential THEN 'warning' ELSE 'info' END,
    format(
      'residency=%s — on-prem %s',
      p_sensitivity,
      CASE WHEN v_confidential THEN 'ENFORCED (cloud APIs excluded)' ELSE 'not required' END
    ),
    jsonb_build_object(
      'sensitivity', p_sensitivity,
      'tables', to_jsonb(COALESCE(p_tables, ARRAY[]::text[])),
      'cloud_forbidden', v_confidential,
      'surface', p_surface
    ),
    ARRAY['residency', 'governance', 'sec-11']
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_residency_audit(uuid, uuid, text, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_residency_audit(uuid, uuid, text, text[], text) TO service_role;

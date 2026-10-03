-- ============================================================================
-- Function: aitg_list_active_payloads_audited
-- Purpose: Return active adversarial payloads for a given test (or all).
--          Sensitive — restricted to admin/staff/service_role to prevent the
--          corpus from being leaked to anon traffic.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aitg_list_active_payloads_audited(
  p_test_id text DEFAULT NULL
) RETURNS TABLE (
  payload_id     uuid,
  test_id        text,
  payload        jsonb,
  expected_block text,
  tags           text[],
  source         text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service_role boolean;
BEGIN
  v_is_service_role := public.is_service_role();
  IF NOT v_is_service_role AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'AITG_INSUFFICIENT_PRIVILEGE' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, action_type, area, severity, tags, details)
  VALUES (auth.uid(), 'aitg.payloads_listed', 'aitg.payloads_listed', 'security', 'info',
          ARRAY['aitg', 'corpus'], jsonb_build_object('test_id', p_test_id));

  RETURN QUERY
  SELECT p.payload_id, p.test_id, p.payload, p.expected_block, p.tags, p.source
  FROM public.aitg_payloads p
  WHERE p.active = true
    AND (p_test_id IS NULL OR p.test_id = p_test_id);
END;
$$;

REVOKE ALL ON FUNCTION public.aitg_list_active_payloads_audited(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aitg_list_active_payloads_audited(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aitg_list_active_payloads_audited(text) TO service_role;

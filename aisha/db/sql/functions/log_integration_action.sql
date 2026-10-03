-- ============================================================================
-- Source of Truth: log_integration_action
-- Popis: Zapíše akci provedenou na integrační službě (audit trail).
--        Používá Aisha při každé operaci na NocoDB/Langfuse.
--        Povoleno pro: admin/staff (authenticated) a service_role (n8n).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_integration_action(
  p_service_name  text,
  p_action        text,
  p_action_detail jsonb DEFAULT '{}'::jsonb,
  p_status        text DEFAULT 'success',
  p_error_message text DEFAULT NULL,
  p_duration_ms   integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_service_id     uuid;
  v_log_id         uuid;
  v_is_service_role boolean;
BEGIN
  -- Detect service_role caller (n8n, edge functions)
  v_is_service_role := public.is_service_role();

  -- Authorization: admin/staff OR service_role
  IF NOT v_is_service_role AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Lookup service
  SELECT id INTO v_service_id
  FROM public.integration_services
  WHERE service_name = p_service_name;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Integration service not found: %', p_service_name;
  END IF;

  -- Insert log (performed_by is NULL for service_role calls without JWT user)
  INSERT INTO public.integration_service_logs (
    service_id, action, action_detail, performed_by, status, error_message, duration_ms
  )
  VALUES (
    v_service_id, p_action, p_action_detail, auth.uid(), p_status, p_error_message, p_duration_ms
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_integration_action(text, text, jsonb, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_integration_action(text, text, jsonb, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_integration_action(text, text, jsonb, text, text, integer) TO service_role;

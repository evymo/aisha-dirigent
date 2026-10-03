-- ============================================================================
-- Source of Truth: update_integration_health
-- Popis: Aktualizuje health status integrační služby a zapíše log.
--        Voláno Aishou periodicky (health check workflow).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_integration_health(
  p_service_name    text,
  p_health_status   text,
  p_duration_ms     integer DEFAULT NULL,
  p_error_message   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_service_id uuid;
BEGIN
  -- Authorization: admin/staff only
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  -- Update health status
  UPDATE public.integration_services
  SET
    health_status     = p_health_status,
    last_health_check = now(),
    updated_at        = now()
  WHERE service_name = p_service_name
  RETURNING id INTO v_service_id;

  IF v_service_id IS NULL THEN
    RAISE EXCEPTION 'Integration service not found: %', p_service_name;
  END IF;

  -- Log health check
  INSERT INTO public.integration_service_logs (
    service_id, action, action_detail, status, error_message, duration_ms
  )
  VALUES (
    v_service_id,
    'health_check',
    jsonb_build_object('health_status', p_health_status),
    CASE WHEN p_health_status = 'healthy' THEN 'success' ELSE 'failure' END,
    p_error_message,
    p_duration_ms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_integration_health(text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_integration_health(text, text, integer, text) TO authenticated;

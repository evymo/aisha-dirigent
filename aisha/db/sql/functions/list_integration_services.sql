-- ============================================================================
-- Source of Truth: list_integration_services
-- Popis: Vrátí seznam aktivních integračních služeb.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_integration_services(
  p_service_type text DEFAULT NULL,
  p_active_only  boolean DEFAULT true
)
RETURNS TABLE (
  id              uuid,
  service_name    text,
  display_name    text,
  service_type    text,
  base_url        text,
  config          jsonb,
  health_status   text,
  last_health_check timestamptz,
  is_active       boolean,
  managed_by      text,
  created_at      timestamptz,
  updated_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Authorization: admin/staff only
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.service_name, s.display_name, s.service_type,
    s.base_url, s.config, s.health_status, s.last_health_check,
    s.is_active, s.managed_by, s.created_at, s.updated_at
  FROM public.integration_services s
  WHERE
    (p_active_only = false OR s.is_active = true)
    AND (p_service_type IS NULL OR s.service_type = p_service_type)
  ORDER BY s.display_name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_integration_services(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_integration_services(text, boolean) TO authenticated;

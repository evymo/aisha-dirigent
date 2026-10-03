-- resolve_deployed_url
-- Helper: maps coolify_app_slots.app_name → the live slot's URL + identity.
-- Used by start_playwright_run when caller passes p_app_name + p_target_base_url='auto'
-- so the runner always hits the slot that is actively serving traffic right now.
--
-- Returns NULL target_base_url when the app has no domain configured — caller decides
-- whether that's fatal (production_manual) or an explicit URL override path.
--
-- SECURITY: function is SECURITY DEFINER so it can bypass coolify_app_slots RLS
-- (which gates reads to admin-or-staff). The auth check below replicates that
-- gate inside the function so non-admin authenticated users cannot leak
-- B/G slot topology via this helper. service_role calls (n8n WF_PLAYWRIGHT_RUN)
-- bypass the check because they're trusted infrastructure callers.

CREATE OR REPLACE FUNCTION public.resolve_deployed_url(p_app_name text)
RETURNS TABLE (target_base_url text, active_slot text, blue_app_uuid text, green_app_uuid text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required to resolve deployed URL'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN s.domain IS NULL OR s.domain = '' THEN NULL
      WHEN s.domain LIKE 'http%://%'         THEN s.domain
      ELSE 'https://' || s.domain
    END AS target_base_url,
    s.active_slot,
    s.blue_app_uuid,
    s.green_app_uuid
  FROM public.coolify_app_slots s
  WHERE s.app_name = p_app_name
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_deployed_url(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_deployed_url(text) TO authenticated, service_role;

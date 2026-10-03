-- Function: public.get_branding_sites_admin
-- Description: Lists each platform-level brand (partner_id IS NULL) with the
--   hostnames routed to it, for the admin page-builder "which site?" selector.
--   Brands with no hostname mapping are still listed.
-- Security: SECURITY DEFINER, authenticated only
-- Created: 2026-06-03

CREATE OR REPLACE FUNCTION public.get_branding_sites_admin()
RETURNS TABLE (
  branding_profile_id uuid,
  operator_name text,
  status text,
  hostnames text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    bp.id,
    bp.operator_name,
    bp.status,
    COALESCE(
      array_agg(m.hostname ORDER BY m.hostname) FILTER (WHERE m.hostname IS NOT NULL),
      ARRAY[]::text[]
    ) AS hostnames
  FROM public.branding_profiles bp
  LEFT JOIN public.branding_hostname_mapping m ON m.branding_profile_id = bp.id
  WHERE bp.partner_id IS NULL
  GROUP BY bp.id, bp.operator_name, bp.status
  ORDER BY bp.operator_name ASC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_branding_sites_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branding_sites_admin() TO authenticated;

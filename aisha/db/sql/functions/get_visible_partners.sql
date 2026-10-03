-- Function: public.get_visible_partners
-- Arguments: p_city TEXT
-- Description: Returns visible certified partners, optionally filtered by city.
-- Restored 2026-01-08: Full parameterized version from migration 20251220030000.
-- Security: SECURITY DEFINER, public access (seznam partnerů je veřejný - bez sensitive data/PII dat)
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_visible_partners(p_city TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(p)::jsonb)
  INTO v_result
  FROM (
    SELECT 
      pp.id,
      pp.user_id,
      pp.certification_level,
      pp.is_production_provider,
      pp.business_name,
      pp.display_name,
      pp.description,
      pp.city,
      pp.country,
      pp.website,
      pp.services,
      pp.is_visible,
      pp.accepts_online_appointments,
      pp.accepts_in_person_appointments,
      pp.certification_passed_at,
      pp.certification_score,
      pp.avatar_url,
      pp.created_at,
      pp.updated_at
    FROM partner_profiles pp
    WHERE pp.is_visible = TRUE
      AND pp.certification_passed_at IS NOT NULL
      AND (p_city IS NULL OR pp.city = p_city)
    ORDER BY pp.certification_level DESC, pp.display_name
  ) p;

  RETURN jsonb_build_object(
    'partners', COALESCE(v_result, '[]'::JSONB),
    'isAuthenticated', auth.uid() IS NOT NULL
  );
END;
$function$;

COMMENT ON FUNCTION public.get_visible_partners(text) IS 
  'Get visible partner profiles for directory with optional city filter. RPC-only.';

-- Permissions (PUBLIC: seznam partnerů je veřejný - bez sensitive data/PII dat)
REVOKE ALL ON FUNCTION public.get_visible_partners(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_visible_partners(TEXT) TO public;

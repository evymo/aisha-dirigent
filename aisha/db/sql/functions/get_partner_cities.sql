-- Function: public.get_partner_cities
-- Arguments: (none)
-- Description: Returns list of cities with visible partners. Public directory data.
-- Security: SECURITY DEFINER - public read-only directory data.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_partner_cities()
 RETURNS SETOF text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT DISTINCT pp.city
  FROM partner_profiles pp
  WHERE pp.is_visible = true
    AND pp.certification_passed_at IS NOT NULL
    AND pp.city IS NOT NULL
    AND pp.city != ''
  ORDER BY pp.city;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_cities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_cities() TO public;

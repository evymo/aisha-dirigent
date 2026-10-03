-- Function: public.get_partner_profile
-- Arguments: p_partner_id uuid
-- Description: Returns public partner profile (where is_visible=true). Public directory data.
-- Security: SECURITY DEFINER - only returns visible profiles.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_partner_profile(p_partner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT row_to_json(pp.*)::jsonb
    FROM partner_profiles pp
    WHERE pp.id = p_partner_id
      AND pp.is_visible = true
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_profile(p_partner_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_profile(p_partner_id uuid) TO public;

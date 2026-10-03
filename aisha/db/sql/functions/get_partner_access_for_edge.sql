-- Function: public.get_partner_access_for_edge
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:09+01:00

CREATE OR REPLACE FUNCTION public.get_partner_access_for_edge(p_user_id uuid)
 RETURNS TABLE(partner_id uuid, user_id uuid, access_level text, specialization text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    pp.id AS partner_id,
    pp.user_id,
    pp.access_level::TEXT,
    pp.specialization
  FROM partner_profiles pp
  WHERE pp.user_id = p_user_id
  LIMIT 1;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_access_for_edge(p_user_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_partner_access_for_edge(p_user_id uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_access_for_edge(p_user_id uuid) TO service_role;

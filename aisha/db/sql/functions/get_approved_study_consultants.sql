-- Function: public.get_approved_study_consultants
-- Arguments: p_study_id uuid
-- Description: Returns approved study consultants. Public directory data.
-- Security: SECURITY DEFINER - public study consultant listing.
-- @security: public
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_approved_study_consultants(p_study_id uuid)
 RETURNS TABLE(id uuid, study_id uuid, partner_id uuid, role text, status text, max_participants integer, notes text, approved_at timestamptz, created_at timestamptz, partner_display_name text, partner_business_name text, partner_city text, partner_is_production_provider boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    sc.id,
    sc.study_id,
    sc.partner_id,
    sc.role::text,
    sc.status::text,
    sc.max_participants,
    sc.notes,
    sc.approved_at,
    sc.created_at,
    pp.display_name,
    pp.business_name,
    pp.city,
    pp.is_production_provider
  FROM study_consultants sc
  JOIN partner_profiles pp ON pp.id = sc.partner_id
  WHERE sc.study_id = p_study_id
    AND sc.status = 'approved'
  ORDER BY sc.approved_at DESC NULLS LAST;
END;
$function$
;

-- Permissions (PUBLIC: konzultanti studie jsou veřejní)
REVOKE ALL ON FUNCTION public.get_approved_study_consultants(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_approved_study_consultants(p_study_id uuid) TO public;

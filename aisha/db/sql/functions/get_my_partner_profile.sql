-- Function: public.get_my_partner_profile
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:01+01:00

CREATE OR REPLACE FUNCTION public.get_my_partner_profile()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'on'
AS $function$
  SELECT to_jsonb(pp_sub)
  FROM (
    SELECT
      pp.id,
      pp.display_name,
      pp.business_name,
      pp.description,
      pp.notes_for_visitors,
      pp.city,
      pp.country,
      pp.address,
      pp.email,
      pp.phone,
      pp.website,
      pp.services,
      pp.languages,
      pp.is_visible,
      pp.accepts_online_appointments,
      pp.accepts_in_person_appointments,
      pp.is_production_provider,
      pp.certification_score,
      pp.certification_passed_at,
      pp.created_at,
      pp.updated_at
    FROM public.partner_profiles pp
    WHERE pp.user_id = auth.uid()
    ORDER BY pp.created_at DESC
    LIMIT 1
  ) pp_sub;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_partner_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_partner_profile() TO authenticated;

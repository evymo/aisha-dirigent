-- Function: public.get_public_homepage_stats
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:25+01:00

CREATE OR REPLACE FUNCTION public.get_public_homepage_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_member_count integer;
  v_study_count integer;
  v_partner_count integer;
  v_completed_registrations integer;
BEGIN
  -- Count active members
  SELECT COUNT(DISTINCT user_id) INTO v_member_count
  FROM memberships
  WHERE status IN ('active', 'trial', 'pending');

  -- Count active studies
  SELECT COUNT(*) INTO v_study_count
  FROM studies
  WHERE is_active = true;

  -- Count visible certified partners using correct enum values
  SELECT COUNT(*) INTO v_partner_count
  FROM partner_profiles
  WHERE is_visible = true
    AND certification_level IN ('certified_partner', 'certified_provider');

  -- Count completed registrations
  SELECT COUNT(*) INTO v_completed_registrations
  FROM study_registrations
  WHERE status = 'completed';

  v_result := jsonb_build_object(
    'member_count', COALESCE(v_member_count, 0),
    'study_count', COALESCE(v_study_count, 0),
    'partner_count', COALESCE(v_partner_count, 0),
    'completed_registrations', COALESCE(v_completed_registrations, 0)
  );

  RETURN v_result;
END;
$function$
;

-- Permissions (PUBLIC: homepage stats pro všechny návštěvníky)
REVOKE ALL ON FUNCTION public.get_public_homepage_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_homepage_stats() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_homepage_stats() TO authenticated;

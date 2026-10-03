-- Function: public.get_unclaimed_users_for_partners
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:45+01:00

CREATE OR REPLACE FUNCTION public.get_unclaimed_users_for_partners()
 RETURNS TABLE(id uuid, user_id uuid, display_name text, overall_feeling integer, energy_perception integer, primary_concern text, main_goal text, age_range text, mentor_preference text, communication_style text, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- Check if caller is a certified partner
  IF NOT EXISTS (
    SELECT 1 FROM partner_profiles pp
    WHERE pp.user_id = v_user_id
    AND pp.certification_passed_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  -- Audit log for sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'partner',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'onboarding_responses',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Partner viewing unclaimed users',
      p_tags := ARRAY['phi','partner','onboarding'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    o.id,
    o.user_id,
    p.display_name,
    o.overall_feeling,
    o.energy_perception,
    o.primary_concern,
    o.main_goal,
    o.age_range,
    o.mentor_preference,
    o.communication_style,
    o.created_at
  FROM onboarding_responses o
  JOIN profiles p ON p.user_id = o.user_id
  WHERE o.assigned_partner_id IS NULL
    AND o.onboarding_completed = false
  ORDER BY o.created_at DESC
  LIMIT 50;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_unclaimed_users_for_partners() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unclaimed_users_for_partners() TO authenticated;

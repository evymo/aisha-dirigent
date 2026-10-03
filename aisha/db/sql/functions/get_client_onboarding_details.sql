-- Function: public.get_client_onboarding_details
-- Arguments: p_user_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:42+01:00

CREATE OR REPLACE FUNCTION public.get_client_onboarding_details(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_is_assigned_partner boolean;
  v_has_consent boolean;
  v_result jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if caller is assigned partner
  v_is_assigned_partner := EXISTS (
    SELECT 1 FROM onboarding_responses
    WHERE user_id = p_user_id AND assigned_partner_id = v_caller_id
  );

  IF NOT v_is_assigned_partner THEN
    RAISE EXCEPTION 'Access denied: You are not assigned to this user';
  END IF;

  -- Check data sharing consent
  v_has_consent := public.has_data_sharing_consent(p_user_id, v_caller_id);

  -- Audit the access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'partner_dashboard',
      p_details := jsonb_build_object(
      'partner_id', v_caller_id,
      'user_id', p_user_id,
      'has_consent', v_has_consent
    ),
      p_entity_id := NULL,
      p_entity_type := 'onboarding_details',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Partner viewed client onboarding details',
      p_tags := ARRAY['partner', 'phi', 'onboarding_details'],
      p_user_id := v_caller_id
  );

  -- Return full details if consent granted, limited if not
  IF v_has_consent THEN
    SELECT jsonb_build_object(
      'user_id', o.user_id,
      'overall_feeling', o.overall_feeling,
      'energy_perception', o.energy_perception,
      'physical_confidence', o.physical_confidence,
      'mental_wellbeing', o.mental_wellbeing,
      'sleep_satisfaction', o.sleep_satisfaction,
      'primary_concern', o.primary_concern,
      'secondary_concerns', o.secondary_concerns,
      'main_goal', o.main_goal,
      'timeframe_expectation', o.timeframe_expectation,
      'age_range', o.age_range,
      'has_chronic_condition', o.has_chronic_condition,
      'condition_brief', o.condition_brief,
      'mentor_preference', o.mentor_preference,
      'communication_style', o.communication_style,
      'has_consent', true
    ) INTO v_result
    FROM onboarding_responses o
    WHERE o.user_id = p_user_id;
  ELSE
    SELECT jsonb_build_object(
      'user_id', o.user_id,
      'primary_concern', 'Consent required to view details',
      'main_goal', 'Consent required to view details',
      'has_consent', false
    ) INTO v_result
    FROM onboarding_responses o
    WHERE o.user_id = p_user_id;
  END IF;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_client_onboarding_details(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_client_onboarding_details(p_user_id uuid) TO authenticated;

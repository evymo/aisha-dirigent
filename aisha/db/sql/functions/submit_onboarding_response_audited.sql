-- Function: public.submit_onboarding_response_audited
-- Arguments: p_overall_feeling integer, p_energy_perception integer, p_physical_confidence integer, p_mental_wellbeing integer, p_sleep_satisfaction integer, p_primary_concern text, p_main_goal text, p_timeframe_expectation text, p_mentor_preference text, p_communication_style text, p_age_range text, p_has_chronic_condition boolean, p_condition_brief text, p_secondary_concerns text[]
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:07+01:00

CREATE OR REPLACE FUNCTION public.submit_onboarding_response_audited(p_overall_feeling integer, p_energy_perception integer, p_physical_confidence integer, p_mental_wellbeing integer, p_sleep_satisfaction integer, p_primary_concern text, p_main_goal text, p_timeframe_expectation text, p_mentor_preference text, p_communication_style text, p_age_range text, p_has_chronic_condition boolean, p_condition_brief text, p_secondary_concerns text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_response_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  INSERT INTO onboarding_responses (
    user_id, overall_feeling, energy_perception, physical_confidence,
    mental_wellbeing, sleep_satisfaction, primary_concern, main_goal,
    timeframe_expectation, mentor_preference, communication_style,
    age_range, has_chronic_condition, condition_brief, secondary_concerns
  ) VALUES (
    v_user_id, p_overall_feeling, p_energy_perception, p_physical_confidence,
    p_mental_wellbeing, p_sleep_satisfaction, p_primary_concern, p_main_goal,
    p_timeframe_expectation, p_mentor_preference, p_communication_style,
    p_age_range, p_has_chronic_condition, p_condition_brief, p_secondary_concerns
  )
  RETURNING id INTO v_response_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'member'::journal_area,
      p_details := jsonb_build_object('secondary_concerns_count', COALESCE(array_length(p_secondary_concerns, 1), 0)),
      p_entity_id := v_response_id::text,
      p_entity_type := 'onboarding_response',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User submitted onboarding response',
      p_tags := ARRAY['onboarding', 'self'],
      p_user_id := v_user_id
  );

  RETURN v_response_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_onboarding_response_audited(p_overall_feeling integer, p_energy_perception integer, p_physical_confidence integer, p_mental_wellbeing integer, p_sleep_satisfaction integer, p_primary_concern text, p_main_goal text, p_timeframe_expectation text, p_mentor_preference text, p_communication_style text, p_age_range text, p_has_chronic_condition boolean, p_condition_brief text, p_secondary_concerns text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_onboarding_response_audited(p_overall_feeling integer, p_energy_perception integer, p_physical_confidence integer, p_mental_wellbeing integer, p_sleep_satisfaction integer, p_primary_concern text, p_main_goal text, p_timeframe_expectation text, p_mentor_preference text, p_communication_style text, p_age_range text, p_has_chronic_condition boolean, p_condition_brief text, p_secondary_concerns text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_onboarding_response_audited(p_overall_feeling integer, p_energy_perception integer, p_physical_confidence integer, p_mental_wellbeing integer, p_sleep_satisfaction integer, p_primary_concern text, p_main_goal text, p_timeframe_expectation text, p_mentor_preference text, p_communication_style text, p_age_range text, p_has_chronic_condition boolean, p_condition_brief text, p_secondary_concerns text[]) TO authenticated;

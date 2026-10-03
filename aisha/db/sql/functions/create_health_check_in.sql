-- Function: public.create_health_check_in
-- Arguments: p_check_in_type text, p_check_in_date date, p_study_registration_id uuid, p_pain_level integer, p_pain_location text, p_pain_notes text, p_sleep_quality integer, p_sleep_hours numeric, p_energy_level integer, p_mood_level integer, p_steps_count integer, p_activity_minutes integer, p_exercise_type text, p_womac_pain integer, p_womac_stiffness integer, p_womac_function integer, p_took_medication boolean, p_medication_notes text, p_side_effects text, p_general_notes text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:04+01:00

CREATE OR REPLACE FUNCTION public.create_health_check_in(p_check_in_type text DEFAULT 'morning'::text, p_check_in_date date DEFAULT CURRENT_DATE, p_study_registration_id uuid DEFAULT NULL::uuid, p_pain_level integer DEFAULT NULL::integer, p_pain_location text DEFAULT NULL::text, p_pain_notes text DEFAULT NULL::text, p_sleep_quality integer DEFAULT NULL::integer, p_sleep_hours numeric DEFAULT NULL::numeric, p_energy_level integer DEFAULT NULL::integer, p_mood_level integer DEFAULT NULL::integer, p_steps_count integer DEFAULT NULL::integer, p_activity_minutes integer DEFAULT NULL::integer, p_exercise_type text DEFAULT NULL::text, p_womac_pain integer DEFAULT NULL::integer, p_womac_stiffness integer DEFAULT NULL::integer, p_womac_function integer DEFAULT NULL::integer, p_took_medication boolean DEFAULT NULL::boolean, p_medication_notes text DEFAULT NULL::text, p_side_effects text DEFAULT NULL::text, p_general_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_new_id uuid;
  v_result jsonb;
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Insert new health check-in
  INSERT INTO health_check_ins (
    user_id,
    study_registration_id,
    check_in_type,
    check_in_date,
    pain_level,
    pain_location,
    pain_notes,
    sleep_quality,
    sleep_hours,
    energy_level,
    mood_level,
    steps_count,
    activity_minutes,
    exercise_type,
    womac_pain,
    womac_stiffness,
    womac_function,
    took_medication,
    medication_notes,
    side_effects,
    general_notes
  ) VALUES (
    v_user_id,
    p_study_registration_id,
    p_check_in_type::check_in_type,
    p_check_in_date,
    p_pain_level,
    p_pain_location,
    p_pain_notes,
    p_sleep_quality,
    p_sleep_hours,
    p_energy_level,
    p_mood_level,
    p_steps_count,
    p_activity_minutes,
    p_exercise_type,
    p_womac_pain,
    p_womac_stiffness,
    p_womac_function,
    p_took_medication,
    p_medication_notes,
    p_side_effects,
    p_general_notes
  )
  RETURNING id INTO v_new_id;

  -- Log the creation
  INSERT INTO audit_journal (
    entity_type,
    entity_id,
    action,
    user_id,
    new_data
  ) VALUES (
    'health_check_ins',
    v_new_id,
    'INSERT',
    v_user_id,
    jsonb_build_object(
      'check_in_type', p_check_in_type,
      'check_in_date', p_check_in_date
    )
  );

  -- Return the created record
  SELECT jsonb_build_object(
    'id', h.id,
    'user_id', h.user_id,
    'study_registration_id', h.study_registration_id,
    'check_in_type', h.check_in_type,
    'check_in_date', h.check_in_date,
    'pain_level', h.pain_level,
    'pain_location', h.pain_location,
    'pain_notes', h.pain_notes,
    'sleep_quality', h.sleep_quality,
    'sleep_hours', h.sleep_hours,
    'energy_level', h.energy_level,
    'mood_level', h.mood_level,
    'steps_count', h.steps_count,
    'activity_minutes', h.activity_minutes,
    'exercise_type', h.exercise_type,
    'womac_pain', h.womac_pain,
    'womac_stiffness', h.womac_stiffness,
    'womac_function', h.womac_function,
    'took_medication', h.took_medication,
    'medication_notes', h.medication_notes,
    'side_effects', h.side_effects,
    'general_notes', h.general_notes,
    'created_at', h.created_at
  ) INTO v_result
  FROM health_check_ins h
  WHERE h.id = v_new_id;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_health_check_in(p_check_in_type text, p_check_in_date date, p_study_registration_id uuid, p_pain_level integer, p_pain_location text, p_pain_notes text, p_sleep_quality integer, p_sleep_hours numeric, p_energy_level integer, p_mood_level integer, p_steps_count integer, p_activity_minutes integer, p_exercise_type text, p_womac_pain integer, p_womac_stiffness integer, p_womac_function integer, p_took_medication boolean, p_medication_notes text, p_side_effects text, p_general_notes text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_health_check_in(p_check_in_type text, p_check_in_date date, p_study_registration_id uuid, p_pain_level integer, p_pain_location text, p_pain_notes text, p_sleep_quality integer, p_sleep_hours numeric, p_energy_level integer, p_mood_level integer, p_steps_count integer, p_activity_minutes integer, p_exercise_type text, p_womac_pain integer, p_womac_stiffness integer, p_womac_function integer, p_took_medication boolean, p_medication_notes text, p_side_effects text, p_general_notes text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_health_check_in(p_check_in_type text, p_check_in_date date, p_study_registration_id uuid, p_pain_level integer, p_pain_location text, p_pain_notes text, p_sleep_quality integer, p_sleep_hours numeric, p_energy_level integer, p_mood_level integer, p_steps_count integer, p_activity_minutes integer, p_exercise_type text, p_womac_pain integer, p_womac_stiffness integer, p_womac_function integer, p_took_medication boolean, p_medication_notes text, p_side_effects text, p_general_notes text) TO authenticated;

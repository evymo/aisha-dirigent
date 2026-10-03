-- Function: public.get_my_health_check_ins_audited
-- Arguments: p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:56+01:00

CREATE OR REPLACE FUNCTION public.get_my_health_check_ins_audited(p_limit integer DEFAULT 30)
 RETURNS TABLE(id uuid, user_id uuid, study_registration_id uuid, check_in_type check_in_type, check_in_date date, pain_level integer, pain_location text, pain_notes text, sleep_quality integer, sleep_hours numeric, energy_level integer, mood_level integer, steps_count integer, activity_minutes integer, exercise_type text, womac_pain integer, womac_stiffness integer, womac_function integer, took_medication boolean, medication_notes text, side_effects text, general_notes text, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'studies',
      p_details := jsonb_build_object('result', 'granted', 'limit', GREATEST(0, COALESCE(p_limit, 0))),
      p_entity_id := NULL,
      p_entity_type := 'health_check_in',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewed health check-ins',
      p_tags := ARRAY['phi','member','check_ins'],
      p_user_id := v_uid
  );

  RETURN QUERY
    SELECT
      h.id,
      h.user_id,
      h.study_registration_id,
      h.check_in_type,
      h.check_in_date,
      h.pain_level,
      h.pain_location,
      h.pain_notes,
      h.sleep_quality,
      h.sleep_hours,
      h.energy_level,
      h.mood_level,
      h.steps_count,
      h.activity_minutes,
      h.exercise_type,
      h.womac_pain,
      h.womac_stiffness,
      h.womac_function,
      h.took_medication,
      h.medication_notes,
      h.side_effects,
      h.general_notes,
      h.created_at
    FROM public.health_check_ins h
    WHERE h.user_id = v_uid
    ORDER BY h.check_in_date DESC
    LIMIT GREATEST(0, COALESCE(p_limit, 0));
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_health_check_ins_audited(p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_health_check_ins_audited(p_limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_health_check_ins_audited(p_limit integer) TO authenticated;

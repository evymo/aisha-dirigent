-- Function: audience_cohort_register_actor

CREATE OR REPLACE FUNCTION public.audience_cohort_register_actor(p_cohort_id uuid, p_user_id uuid, p_notes text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_registration_id UUID;
BEGIN
  IF public.get_jwt_role() = 'service_role' THEN
    NULL; -- trusted service_role/system enroll (no auth.uid() JWT)
  ELSIF NOT public.can_invite_to_study(p_cohort_id) THEN
    RAISE EXCEPTION 'Access denied: caller may not register actors to cohort %', p_cohort_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.study_registrations (
    study_id, user_id, status, enrolled_at,
    baseline_data, notes, created_at
  ) VALUES (
    p_cohort_id, p_user_id, 'active', now(),
    p_metadata, p_notes, now()
  )
  RETURNING id INTO v_registration_id;

  -- Increment current_registration on cohort
  UPDATE public.studies
  SET current_registration = COALESCE(current_registration, 0) + 1
  WHERE id = p_cohort_id;

  -- Audit
  PERFORM public.audience_log_event(
    'register',
    'cohort_register_actor',
    'cohort',
    p_cohort_id,
    'Actor registered to cohort',
    jsonb_build_object('user_id', p_user_id, 'registration_id', v_registration_id)
  );

  RETURN v_registration_id;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_cohort_register_actor(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_cohort_register_actor(uuid,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_cohort_register_actor(uuid,uuid,text,jsonb) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_cohort_register_actor(uuid,uuid,text,jsonb) TO service_role;

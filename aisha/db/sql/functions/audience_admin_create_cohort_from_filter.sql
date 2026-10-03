-- Function: audience_admin_create_cohort_from_filter

CREATE OR REPLACE FUNCTION public.audience_admin_create_cohort_from_filter(p_name text, p_description text, p_filter jsonb, p_cohort_type text DEFAULT 'marketing_segment'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cohort_id UUID;
  v_registered INT := 0;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Insert cohort (studies row)
  INSERT INTO public.studies (
    code, name, description, study_type, status,
    is_active, starts_at, created_at
  ) VALUES (
    'cohort_' || extract(epoch from now())::text,
    p_name,
    p_description,
    p_cohort_type::study_type,
    'screening',
    true,
    now(),
    now()
  )
  RETURNING id INTO v_cohort_id;

  -- Auto-register matching actors based on filter
  -- (Simple implementation: filter by member_tier; expand as needed)
  IF p_filter ? 'tier' THEN
    INSERT INTO public.study_registrations (study_id, user_id, status, enrolled_at, created_at)
    SELECT v_cohort_id, t.user_id, 'active', now(), now()
    FROM public.audience_actor_tier_v t
    WHERE t.member_tier = p_filter->>'tier'
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_registered = ROW_COUNT;

    UPDATE public.studies
    SET current_registration = v_registered
    WHERE id = v_cohort_id;
  END IF;

  PERFORM public.audience_log_event(
    'create_cohort',
    'audience_admin_create_cohort_from_filter',
    'cohort',
    v_cohort_id,
    format('Created cohort "%s" with %s registrations', p_name, v_registered),
    jsonb_build_object('filter', p_filter, 'cohort_id', v_cohort_id, 'registered', v_registered)
  );

  RETURN v_cohort_id;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_admin_create_cohort_from_filter(text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_admin_create_cohort_from_filter(text,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_admin_create_cohort_from_filter(text,text,jsonb,text) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_admin_create_cohort_from_filter(text,text,jsonb,text) TO service_role;

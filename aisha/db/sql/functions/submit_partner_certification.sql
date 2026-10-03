-- Function: public.submit_partner_certification
-- Arguments: p_answers jsonb, p_profile_data jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:07+01:00

CREATE OR REPLACE FUNCTION public.submit_partner_certification(p_answers jsonb, p_profile_data jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_result jsonb;
  v_passed boolean;
  v_score integer;
  v_total integer;
  v_correct integer := 0;
  v_question record;
  v_user_answer text;
  v_is_production_provider boolean := false;
  v_cert_level partner_certification_level;
  v_role_to_grant app_role;
  v_existing_profile_id uuid;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Check if profile data indicates production provider
  IF p_profile_data IS NOT NULL THEN
    v_is_production_provider := COALESCE((p_profile_data->>'is_production_provider')::boolean, false);
  END IF;

  -- Check existing profile if no profile data provided
  IF p_profile_data IS NULL THEN
    SELECT id, is_production_provider 
    INTO v_existing_profile_id, v_is_production_provider
    FROM partner_profiles
    WHERE user_id = v_user_id;
  END IF;

  -- Determine certification level and role based on partner type
  IF v_is_production_provider THEN
    v_cert_level := 'certified_provider';
    v_role_to_grant := 'practitioner';
  ELSE
    v_cert_level := 'certified_partner';
    v_role_to_grant := 'partner';
  END IF;

  -- Count total questions
  SELECT COUNT(*) INTO v_total
  FROM test_questions
  WHERE test_type = 'certification' AND is_active = true;

  -- Check each answer
  FOR v_question IN 
    SELECT id, correct_answer 
    FROM test_questions 
    WHERE test_type = 'certification' AND is_active = true
  LOOP
    v_user_answer := p_answers->>v_question.id::text;
    IF v_user_answer IS NOT NULL AND LOWER(v_user_answer) = LOWER(v_question.correct_answer) THEN
      v_correct := v_correct + 1;
    END IF;
  END LOOP;

  -- Calculate score
  v_score := CASE WHEN v_total > 0 
    THEN ROUND((v_correct::numeric / v_total::numeric) * 100)
    ELSE 0 
  END;
  
  v_passed := v_score >= 75;

  -- Record certification attempt
  INSERT INTO partner_certifications (user_id, answers, score, passed)
  VALUES (v_user_id, p_answers, v_score, v_passed);

  -- If passed, update partner profile and grant role
  IF v_passed THEN
    -- Sanction the privilege-column write (is_production_provider) for the
    -- partner_profiles_privilege_guard trigger. Transaction-local; a direct client
    -- cannot set this GUC (set_config is not reachable as a PostgREST RPC).
    PERFORM set_config('aisha.partner_priv_write', 'on', true);

    -- Create or update partner profile
    IF p_profile_data IS NOT NULL THEN
      INSERT INTO partner_profiles (
        user_id,
        display_name,
        business_name,
        city,
        country,
        is_production_provider,
        certification_level,
        certification_score,
        certification_passed_at,
        is_visible
      ) VALUES (
        v_user_id,
        COALESCE(p_profile_data->>'display_name', 'Partner'),
        p_profile_data->>'business_name',
        COALESCE(p_profile_data->>'city', 'Unknown'),
        COALESCE(p_profile_data->>'country', 'CZ'),
        v_is_production_provider,
        v_cert_level,
        v_score,
        now(),
        true
      )
      ON CONFLICT (user_id) DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, partner_profiles.display_name),
        business_name = COALESCE(EXCLUDED.business_name, partner_profiles.business_name),
        city = COALESCE(EXCLUDED.city, partner_profiles.city),
        is_production_provider = v_is_production_provider,
        certification_level = v_cert_level,
        certification_score = v_score,
        certification_passed_at = now(),
        updated_at = now();
    ELSE
      -- Update existing profile
      UPDATE partner_profiles
      SET 
        certification_level = v_cert_level,
        certification_score = v_score,
        certification_passed_at = now(),
        updated_at = now()
      WHERE user_id = v_user_id;
    END IF;

    -- Grant appropriate role (partner or practitioner)
    INSERT INTO user_roles (user_id, role, granted_by)
    VALUES (v_user_id, v_role_to_grant, v_user_id)
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Log to audit journal
    INSERT INTO audit_journal (action, 
      user_id,
      action_type,
      area,
      entity_type,
      entity_id,
      severity,
      summary,
      details
    ) VALUES ('SUBMIT_CERTIFICATION', 
      v_user_id,
      'create',
      'user_management',
      'partner_certification',
      v_user_id::text,
      'info',
      'Partner certification passed',
      jsonb_build_object(
        'score', v_score,
        'certification_level', v_cert_level::text,
        'role_granted', v_role_to_grant::text,
        'is_production_provider', v_is_production_provider
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'passed', v_passed,
    'score', v_score,
    'total_questions', v_total,
    'correct_count', v_correct,
    'certification_level', v_cert_level::text,
    'role_granted', CASE WHEN v_passed THEN v_role_to_grant::text ELSE NULL END
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_partner_certification(p_answers jsonb, p_profile_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_partner_certification(p_answers jsonb, p_profile_data jsonb) TO authenticated;

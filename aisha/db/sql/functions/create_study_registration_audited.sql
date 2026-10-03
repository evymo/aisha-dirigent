-- Function: public.create_study_registration_audited
-- Arguments: p_study_id uuid, p_initial_status text DEFAULT 'screening'::text, p_baseline_data jsonb DEFAULT NULL::jsonb
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.create_study_registration_audited(p_study_id uuid, p_initial_status text DEFAULT 'screening'::text, p_baseline_data jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(registration_id uuid, member_token uuid, umbrella_registration_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_registration_id uuid;
  v_member_token text;
  v_umbrella_study_id uuid;
  v_umbrella_registration_id uuid;
  v_study_record RECORD;
  v_existing_registration_id uuid;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify study exists and is active
  SELECT id, name, is_umbrella, parent_study_id 
  INTO v_study_record
  FROM studies
  WHERE id = p_study_id AND is_active = true;
  
  IF v_study_record IS NULL THEN
    RAISE EXCEPTION 'Study not found or inactive';
  END IF;

  -- Check for existing registration
  SELECT id INTO v_existing_registration_id
  FROM study_registrations
  WHERE user_id = v_user_id AND study_id = p_study_id;
  
  IF v_existing_registration_id IS NOT NULL THEN
    -- Return existing registration
    v_registration_id := v_existing_registration_id;
    
    SELECT se.member_token INTO v_member_token
    FROM study_registrations se
    WHERE se.id = v_registration_id;
  ELSE
    -- Generate unique member token
    v_member_token := 'MBR-' || generate_random_code(8);
    
    -- Create primary registration
    INSERT INTO study_registrations (
      user_id, 
      study_id, 
      member_token, 
      status, 
      enrolled_at,
      baseline_data
    )
    VALUES (
      v_user_id, 
      p_study_id, 
      v_member_token, 
      p_initial_status, 
      now(),
      p_baseline_data
    )
    RETURNING id INTO v_registration_id;

    -- Audit log for primary registration
    PERFORM public.write_audit_journal(
        p_action_type := 'create'::journal_action_type,
        p_area := 'study'::journal_area,
        p_details := jsonb_build_object(
        'study_id', p_study_id, 
        'study_name', v_study_record.name,
        'member_token', v_member_token,
        'initial_status', p_initial_status
      ),
        p_entity_id := v_registration_id::text,
        p_entity_type := 'study_registration',
        p_severity := NULL,
        p_summary := 'User enrolled in study via audited RPC',
    p_user_id := v_user_id
  );
  END IF;

  -- Handle umbrella registration for child studies
  IF v_study_record.is_umbrella = false THEN
    -- Find umbrella study (either parent or global umbrella)
    IF v_study_record.parent_study_id IS NOT NULL THEN
      v_umbrella_study_id := v_study_record.parent_study_id;
    ELSE
      SELECT id INTO v_umbrella_study_id
      FROM studies
      WHERE is_umbrella = true
      LIMIT 1;
    END IF;

    IF v_umbrella_study_id IS NOT NULL AND v_umbrella_study_id != p_study_id THEN
      -- Check if already enrolled in umbrella
      SELECT id INTO v_umbrella_registration_id
      FROM study_registrations
      WHERE user_id = v_user_id AND study_id = v_umbrella_study_id;
      
      IF v_umbrella_registration_id IS NULL THEN
        -- Create umbrella registration with same status
        INSERT INTO study_registrations (
          user_id, 
          study_id, 
          member_token, 
          status, 
          enrolled_at
        )
        VALUES (
          v_user_id, 
          v_umbrella_study_id, 
          'MBR-' || generate_random_code(8), 
          p_initial_status, 
          now()
        )
        RETURNING id INTO v_umbrella_registration_id;

        -- Audit log for umbrella registration
        PERFORM public.write_audit_journal(
            p_action_type := 'create'::journal_action_type,
            p_area := 'study'::journal_area,
            p_details := jsonb_build_object(
            'umbrella_study_id', v_umbrella_study_id,
            'triggered_by_study_id', p_study_id
          ),
            p_entity_id := v_umbrella_registration_id::text,
            p_entity_type := 'study_registration',
            p_severity := NULL,
            p_summary := 'User auto-enrolled in umbrella study via dual registration',
    p_user_id := v_user_id
  );
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT v_registration_id, v_member_token, v_umbrella_registration_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_study_registration_audited(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_study_registration_audited(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_study_registration_audited(uuid, text, jsonb) TO service_role;

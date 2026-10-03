-- Function: public.upsert_my_profile_phi
-- Arguments: p_patch jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:33+01:00

CREATE OR REPLACE FUNCTION public.upsert_my_profile_phi(p_patch jsonb)
 RETURNS TABLE(display_name text, phone text, gender text, date_of_birth date, preferred_language text, primary_diagnosis text, current_medications text, allergies text, medical_history text, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_changed_fields text[] := ARRAY[]::text[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Invalid patch' USING ERRCODE = '22023';
  END IF;

  -- Basic validation: enforce UI max lengths at DB boundary.
  IF p_patch ? 'display_name' AND length(p_patch->>'display_name') > 100 THEN
    RAISE EXCEPTION 'display_name too long' USING ERRCODE = '22001';
  END IF;

  IF p_patch ? 'phone' AND length(p_patch->>'phone') > 20 THEN
    RAISE EXCEPTION 'phone too long' USING ERRCODE = '22001';
  END IF;

  IF p_patch ? 'gender' AND length(p_patch->>'gender') > 50 THEN
    RAISE EXCEPTION 'gender too long' USING ERRCODE = '22001';
  END IF;

  IF p_patch ? 'preferred_language' AND length(p_patch->>'preferred_language') > 10 THEN
    RAISE EXCEPTION 'preferred_language too long' USING ERRCODE = '22001';
  END IF;

  IF p_patch ? 'primary_diagnosis' AND length(p_patch->>'primary_diagnosis') > 500 THEN
    RAISE EXCEPTION 'primary_diagnosis too long' USING ERRCODE = '22001';
  END IF;

  IF p_patch ? 'current_medications' AND length(p_patch->>'current_medications') > 1000 THEN
    RAISE EXCEPTION 'current_medications too long' USING ERRCODE = '22001';
  END IF;

  IF p_patch ? 'allergies' AND length(p_patch->>'allergies') > 500 THEN
    RAISE EXCEPTION 'allergies too long' USING ERRCODE = '22001';
  END IF;

  IF p_patch ? 'medical_history' AND length(p_patch->>'medical_history') > 2000 THEN
    RAISE EXCEPTION 'medical_history too long' USING ERRCODE = '22001';
  END IF;

  IF p_patch ? 'preferred_language' THEN
    IF nullif(p_patch->>'preferred_language', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.supported_languages sl
        WHERE sl.code = (p_patch->>'preferred_language') AND sl.is_active
      ) THEN
      RAISE EXCEPTION 'Unsupported preferred_language' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Track changed keys (no values) for audit detail.
  IF p_patch ? 'display_name' THEN v_changed_fields := array_append(v_changed_fields, 'display_name'); END IF;
  IF p_patch ? 'phone' THEN v_changed_fields := array_append(v_changed_fields, 'phone'); END IF;
  IF p_patch ? 'gender' THEN v_changed_fields := array_append(v_changed_fields, 'gender'); END IF;
  IF p_patch ? 'date_of_birth' THEN v_changed_fields := array_append(v_changed_fields, 'date_of_birth'); END IF;
  IF p_patch ? 'preferred_language' THEN v_changed_fields := array_append(v_changed_fields, 'preferred_language'); END IF;
  IF p_patch ? 'primary_diagnosis' THEN v_changed_fields := array_append(v_changed_fields, 'primary_diagnosis'); END IF;
  IF p_patch ? 'current_medications' THEN v_changed_fields := array_append(v_changed_fields, 'current_medications'); END IF;
  IF p_patch ? 'allergies' THEN v_changed_fields := array_append(v_changed_fields, 'allergies'); END IF;
  IF p_patch ? 'medical_history' THEN v_changed_fields := array_append(v_changed_fields, 'medical_history'); END IF;

  -- Ensure row exists (defense-in-depth in case signup trigger failed).
  INSERT INTO public.profiles (user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.profiles p
  SET
    display_name = CASE
      WHEN p_patch ? 'display_name' THEN nullif(p_patch->>'display_name', '')
      ELSE p.display_name
    END,
    phone = CASE
      WHEN p_patch ? 'phone' THEN nullif(p_patch->>'phone', '')
      ELSE p.phone
    END,
    gender = CASE
      WHEN p_patch ? 'gender' THEN nullif(p_patch->>'gender', '')
      ELSE p.gender
    END,
    date_of_birth = CASE
      WHEN p_patch ? 'date_of_birth' THEN NULLIF(p_patch->>'date_of_birth', '')::date
      ELSE p.date_of_birth
    END,
    preferred_language = CASE
      WHEN p_patch ? 'preferred_language' THEN nullif(p_patch->>'preferred_language', '')
      ELSE p.preferred_language
    END,
    primary_diagnosis = CASE
      WHEN p_patch ? 'primary_diagnosis' THEN nullif(p_patch->>'primary_diagnosis', '')
      ELSE p.primary_diagnosis
    END,
    current_medications = CASE
      WHEN p_patch ? 'current_medications' THEN nullif(p_patch->>'current_medications', '')
      ELSE p.current_medications
    END,
    allergies = CASE
      WHEN p_patch ? 'allergies' THEN nullif(p_patch->>'allergies', '')
      ELSE p.allergies
    END,
    medical_history = CASE
      WHEN p_patch ? 'medical_history' THEN nullif(p_patch->>'medical_history', '')
      ELSE p.medical_history
    END,
    updated_at = now()
  WHERE p.user_id = v_user_id;

  -- Audit: record update without sensitive data values.
  PERFORM public.write_audit_journal(
      p_action_type := 'update',
      p_area := 'profile',
      p_details := jsonb_build_object(
      'scope', 'self',
      'changed_fields', v_changed_fields
    ),
      p_entity_id := v_user_id::text,
      p_entity_type := 'profiles',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'User updated own sensitive data profile fields',
      p_tags := ARRAY['phi', 'self', 'profile', 'update'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT
    p.display_name,
    p.phone,
    p.gender,
    p.date_of_birth,
    p.preferred_language,
    p.primary_diagnosis,
    p.current_medications,
    p.allergies,
    p.medical_history,
    p.updated_at
  FROM public.profiles p
  WHERE p.user_id = v_user_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.upsert_my_profile_phi(p_patch jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_my_profile_phi(p_patch jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_my_profile_phi(p_patch jsonb) TO authenticated;

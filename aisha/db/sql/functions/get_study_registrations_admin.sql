-- Function: public.get_study_registrations_admin
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_study_registrations_admin()
 RETURNS TABLE(id uuid, user_id uuid, study_id uuid, status text, group_assignment text, enrolled_at timestamptz, created_at timestamptz, notes text, baseline_data jsonb, study_name text, study_code text, study_type text, profile_display_name text, profile_email text, profile_phone text, profile_date_of_birth date, profile_primary_diagnosis text, profile_current_medications text, profile_medical_history text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- Check if user is admin or staff
  IF NOT is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Audit log for admin sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'admin',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'study_registrations',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Admin viewing all study registrations with sensitive data',
      p_tags := ARRAY['phi','admin','registrations'],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    se.id,
    se.user_id,
    se.study_id,
    se.status::text,
    se.group_assignment,
    se.enrolled_at,
    se.created_at,
    se.notes,
    se.baseline_data::jsonb,
    s.name as study_name,
    s.code as study_code,
    s.study_type::text,
    p.display_name as profile_display_name,
    p.email as profile_email,
    p.phone as profile_phone,
    p.date_of_birth as profile_date_of_birth,
    p.primary_diagnosis as profile_primary_diagnosis,
    p.current_medications as profile_current_medications,
    p.medical_history as profile_medical_history
  FROM study_registrations se
  LEFT JOIN studies s ON s.id = se.study_id
  LEFT JOIN profiles p ON p.user_id = se.user_id
  ORDER BY se.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_study_registrations_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_registrations_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_study_registrations_admin() TO service_role;

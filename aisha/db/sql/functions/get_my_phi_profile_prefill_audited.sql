-- Function: public.get_my_phi_profile_prefill_audited
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:01+01:00

CREATE OR REPLACE FUNCTION public.get_my_phi_profile_prefill_audited()
 RETURNS TABLE(primary_diagnosis text, current_medications text, allergies text, medical_history text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.write_audit_journal(
      p_action_type := 'view'::journal_action_type,
      p_area := 'profile'::journal_area,
      p_details := jsonb_build_object(
      'fields',
      ARRAY['primary_diagnosis', 'current_medications', 'allergies', 'medical_history']
    ),
      p_entity_id := auth.uid()::text,
      p_entity_type := 'profile',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::journal_severity,
      p_summary := 'User viewed sensitive data profile prefill',
      p_tags := ARRAY['phi', 'profile', 'prefill'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    p.primary_diagnosis,
    p.current_medications,
    p.allergies,
    p.medical_history
  FROM profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_phi_profile_prefill_audited() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_phi_profile_prefill_audited() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_phi_profile_prefill_audited() TO authenticated;

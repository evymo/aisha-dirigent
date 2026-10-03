-- Function: public.update_study_registration_baseline
-- Arguments: p_registration_id uuid, p_baseline_data jsonb
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:28+01:00

CREATE OR REPLACE FUNCTION public.update_study_registration_baseline(p_registration_id uuid, p_baseline_data jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Only allow updating own registration
  UPDATE study_registrations SET
    baseline_data = p_baseline_data,
    updated_at = now()
  WHERE id = p_registration_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found or access denied';
  END IF;

  -- Log audit
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'research'::journal_area,
      p_entity_id := p_registration_id::text,
      p_entity_type := 'study_registration',
      p_severity := 'info'::journal_severity,
      p_summary := 'Study registration baseline data updated',
    p_user_id := auth.uid()
  );

  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_study_registration_baseline(p_registration_id uuid, p_baseline_data jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_study_registration_baseline(p_registration_id uuid, p_baseline_data jsonb) TO authenticated;

-- Function: public.delete_study_consent_requirement_admin
-- Arguments: p_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:26+01:00

CREATE OR REPLACE FUNCTION public.delete_study_consent_requirement_admin(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  DELETE FROM public.study_consent_requirements WHERE id = p_id;

  IF FOUND THEN
    PERFORM public.write_audit_journal(
        p_action_type := 'delete'::journal_action_type,
        p_area := 'consents'::journal_area,
        p_entity_id := p_id::text,
        p_entity_type := 'study_consent_requirement',
        p_summary := 'Deleted study consent requirement',
    p_user_id := auth.uid()
  );
  END IF;

  RETURN FOUND;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_study_consent_requirement_admin(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_study_consent_requirement_admin(p_id uuid) TO authenticated;

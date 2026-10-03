-- Function: public.get_study_consent_requirements_admin
-- Security: See function definition below.
-- Extracted: 2026-02-08T04:14:53.856Z

CREATE OR REPLACE FUNCTION public.get_study_consent_requirements_admin(p_study_id uuid)
 RETURNS TABLE(id uuid, study_id uuid, consent_template_id uuid, is_required boolean, sort_order integer, created_at timestamptz, template_key text, template_title_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'research'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_study_id::text,
      p_entity_type := 'study_consent_requirement',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read study consent requirement',
      p_tags := ARRAY['admin', 'study_consent_requirement'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    scr.id,
    scr.study_id,
    scr.consent_template_id,
    scr.is_required,
    scr.sort_order,
    scr.created_at,
    COALESCE(ct.template_key, ct.code, '') AS template_key,
    COALESCE(ct.title_key, '') AS template_title_key
  FROM public.study_consent_requirements scr
  JOIN public.consent_templates ct ON ct.id = scr.consent_template_id
  WHERE scr.study_id = p_study_id
  ORDER BY scr.sort_order, COALESCE(ct.template_key, ct.code, '');
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_consent_requirements_admin(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_consent_requirements_admin(p_study_id uuid) TO authenticated;


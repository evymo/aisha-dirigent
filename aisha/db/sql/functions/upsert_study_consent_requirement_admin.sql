-- Function: public.upsert_study_consent_requirement_admin
-- Arguments: p_study_id uuid, p_consent_template_id uuid, p_is_required boolean, p_sort_order integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:33+01:00

CREATE OR REPLACE FUNCTION public.upsert_study_consent_requirement_admin(p_study_id uuid, p_consent_template_id uuid, p_is_required boolean DEFAULT true, p_sort_order integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO public.study_consent_requirements (
    study_id,
    consent_template_id,
    is_required,
    sort_order
  ) VALUES (
    p_study_id,
    p_consent_template_id,
    COALESCE(p_is_required, true),
    COALESCE(p_sort_order, 0)
  )
  ON CONFLICT (study_id, consent_template_id)
  DO UPDATE SET
    is_required = EXCLUDED.is_required,
    sort_order = EXCLUDED.sort_order,
    updated_at = now()
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'consents'::journal_area,
      p_entity_id := v_id::text,
      p_entity_type := 'study_consent_requirement',
      p_summary := format('Upserted study consent requirement for study %s', p_study_id),
    p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.upsert_study_consent_requirement_admin(p_study_id uuid, p_consent_template_id uuid, p_is_required boolean, p_sort_order integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_study_consent_requirement_admin(p_study_id uuid, p_consent_template_id uuid, p_is_required boolean, p_sort_order integer) TO authenticated;

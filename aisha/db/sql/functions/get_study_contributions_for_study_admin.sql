-- Function: public.get_study_contributions_for_study_admin
-- Arguments: p_study_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:35+01:00

CREATE OR REPLACE FUNCTION public.get_study_contributions_for_study_admin(p_study_id uuid)
 RETURNS TABLE(id uuid, study_id uuid, user_id uuid, contribution_type text, amount numeric, currency text, token_type text, message text, is_anonymous boolean, status text, created_at timestamptz, study jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'manage_studies') THEN
    RAISE EXCEPTION 'Access denied: manage_studies permission required';
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'view'::public.journal_action_type,
      p_area := 'studies'::public.journal_area,
      p_details := NULL,
      p_entity_id := p_study_id::text,
      p_entity_type := 'study_contributions',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info'::public.journal_severity,
      p_summary := 'Admin viewed study contributions (single study)',
      p_tags := ARRAY['admin','studies','contributions'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    sc.id,
    sc.study_id,
    sc.user_id,
    sc.contribution_type,
    sc.amount,
    sc.currency,
    sc.token_type,
    sc.message,
    sc.is_anonymous,
    sc.status,
    sc.created_at,
    jsonb_build_object(
      'name', s.name,
      'code', s.code
    ) AS study
  FROM public.study_contributions sc
  JOIN public.studies s ON s.id = sc.study_id
  WHERE sc.study_id = p_study_id
  ORDER BY sc.created_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_contributions_for_study_admin(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_contributions_for_study_admin(p_study_id uuid) TO authenticated;

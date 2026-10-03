-- Function: public.get_study_questionnaires_admin
-- Arguments: p_study_id uuid
-- Description: Returns study questionnaire config with translation keys (no hardcoded locale columns).
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.get_study_questionnaires_admin(p_study_id uuid)
 RETURNS TABLE(id uuid, created_at timestamptz, description_key text, display_order integer, ends_after_days integer, frequency_days integer, frequency_type text, is_active boolean, is_required boolean, questionnaire_code text, questionnaire_id uuid, questionnaire_name text, questionnaire_type text, starts_after_days integer, study_id uuid, title_key text, token_reward integer, updated_at timestamptz)
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
      p_entity_type := 'study_questionnaire',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read study questionnaire',
      p_tags := ARRAY['admin', 'study_questionnaire'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    sq.id,
    sq.created_at,
    sq.description_key,
    sq.display_order,
    sq.ends_after_days,
    sq.frequency_days,
    sq.frequency_type,
    sq.is_active,
    sq.is_required,
    q.code AS questionnaire_code,
    sq.questionnaire_id,
    q.name AS questionnaire_name,
    sq.questionnaire_type,
    sq.starts_after_days,
    sq.study_id,
    sq.title_key,
    sq.token_reward,
    sq.updated_at
  FROM public.study_questionnaires sq
  LEFT JOIN public.questionnaires q ON q.id = sq.questionnaire_id
  WHERE sq.study_id = p_study_id
  ORDER BY sq.display_order, sq.created_at;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_study_questionnaires_admin(p_study_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_questionnaires_admin(p_study_id uuid) TO authenticated;

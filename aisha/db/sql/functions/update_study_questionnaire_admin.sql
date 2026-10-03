-- Function: public.update_study_questionnaire_admin
-- Description: Updates a study questionnaire link with unified translation keys.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.update_study_questionnaire_admin(
  p_id uuid,
  p_description_key text DEFAULT NULL::text,
  p_display_order integer DEFAULT NULL::integer,
  p_ends_after_days integer DEFAULT NULL::integer,
  p_frequency_days integer DEFAULT NULL::integer,
  p_frequency_type text DEFAULT NULL::text,
  p_is_active boolean DEFAULT NULL::boolean,
  p_is_required boolean DEFAULT NULL::boolean,
  p_questionnaire_id uuid DEFAULT NULL::uuid,
  p_questionnaire_type text DEFAULT NULL::text,
  p_starts_after_days integer DEFAULT NULL::integer,
  p_title_key text DEFAULT NULL::text,
  p_token_reward integer DEFAULT NULL::integer
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  UPDATE public.study_questionnaires SET
    description_key = COALESCE(p_description_key, description_key),
    display_order = COALESCE(p_display_order, display_order),
    ends_after_days = COALESCE(p_ends_after_days, ends_after_days),
    frequency_days = COALESCE(p_frequency_days, frequency_days),
    frequency_type = COALESCE(p_frequency_type, frequency_type),
    is_active = COALESCE(p_is_active, is_active),
    is_required = COALESCE(p_is_required, is_required),
    questionnaire_id = COALESCE(p_questionnaire_id, questionnaire_id),
    questionnaire_type = COALESCE(p_questionnaire_type, questionnaire_type),
    starts_after_days = COALESCE(p_starts_after_days, starts_after_days),
    title_key = COALESCE(p_title_key, title_key),
    token_reward = COALESCE(p_token_reward, token_reward),
    updated_at = NOW()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Study questionnaire not found: %', p_id;
  END IF;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'research'::journal_area,
      p_entity_id := p_id::text,
      p_entity_type := 'study_questionnaire',
      p_summary := 'Updated study questionnaire',
    p_user_id := auth.uid()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_study_questionnaire_admin(uuid, text, integer, integer, integer, text, boolean, boolean, uuid, text, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_study_questionnaire_admin(uuid, text, integer, integer, integer, text, boolean, boolean, uuid, text, integer, text, integer) TO authenticated;

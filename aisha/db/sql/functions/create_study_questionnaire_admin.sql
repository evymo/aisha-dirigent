-- Function: public.create_study_questionnaire_admin
-- Description: Creates a study questionnaire link with unified translation keys.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.create_study_questionnaire_admin(
  p_questionnaire_type text,
  p_study_id uuid,
  p_description_key text DEFAULT NULL::text,
  p_display_order integer DEFAULT 0,
  p_ends_after_days integer DEFAULT NULL::integer,
  p_frequency_days integer DEFAULT NULL::integer,
  p_frequency_type text DEFAULT 'one_time'::text,
  p_is_active boolean DEFAULT true,
  p_is_required boolean DEFAULT true,
  p_questionnaire_id uuid DEFAULT NULL::uuid,
  p_starts_after_days integer DEFAULT 0,
  p_title_key text DEFAULT NULL::text,
  p_token_reward integer DEFAULT 0
)
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

  INSERT INTO public.study_questionnaires (
    description_key,
    display_order,
    ends_after_days,
    frequency_days,
    frequency_type,
    is_active,
    is_required,
    questionnaire_id,
    questionnaire_type,
    starts_after_days,
    study_id,
    title_key,
    token_reward
  ) VALUES (
    p_description_key,
    COALESCE(p_display_order, 0),
    p_ends_after_days,
    p_frequency_days,
    COALESCE(p_frequency_type, 'one_time'),
    COALESCE(p_is_active, true),
    COALESCE(p_is_required, true),
    p_questionnaire_id,
    p_questionnaire_type,
    COALESCE(p_starts_after_days, 0),
    p_study_id,
    p_title_key,
    COALESCE(p_token_reward, 0)
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'research'::journal_area,
      p_entity_id := v_id::text,
      p_entity_type := 'study_questionnaire',
      p_summary := format('Created study questionnaire: %s for study %s', p_questionnaire_type, p_study_id),
    p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_study_questionnaire_admin(text, uuid, text, integer, integer, integer, text, boolean, boolean, uuid, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_study_questionnaire_admin(text, uuid, text, integer, integer, integer, text, boolean, boolean, uuid, integer, text, integer) TO authenticated;

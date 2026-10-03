-- Function: public.update_questionnaire_admin
-- Description: Updates questionnaire with auto-versioning on content changes. Unified translation keys.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.update_questionnaire_admin(
  p_id uuid,
  p_base_locale text DEFAULT NULL::text,
  p_code text DEFAULT NULL::text,
  p_description_key text DEFAULT NULL::text,
  p_is_active boolean DEFAULT NULL::boolean,
  p_name text DEFAULT NULL::text,
  p_name_key text DEFAULT NULL::text,
  p_points_reward integer DEFAULT NULL::integer,
  p_questionnaire_type text DEFAULT NULL::text,
  p_questions jsonb DEFAULT NULL::jsonb,
  p_token_reward integer DEFAULT NULL::integer
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current public.questionnaires%ROWTYPE;
  v_new_version integer;
  v_has_content_update boolean := false;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  SELECT * INTO v_current
  FROM public.questionnaires
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_has_content_update := p_name IS NOT NULL
    OR p_questions IS NOT NULL
    OR p_name_key IS NOT NULL
    OR p_description_key IS NOT NULL
    OR p_base_locale IS NOT NULL;

  IF v_has_content_update THEN
    INSERT INTO public.questionnaire_versions (
      questionnaire_id, version, name, name_key, description_key,
      questions, is_active, base_locale
    ) VALUES (
      v_current.id, v_current.version, v_current.name, v_current.name_key,
      v_current.description_key, v_current.questions,
      v_current.is_active, v_current.base_locale
    );

    v_new_version := v_current.version + 1;
  ELSE
    v_new_version := v_current.version;
  END IF;

  UPDATE public.questionnaires SET
    base_locale = COALESCE(p_base_locale, base_locale),
    code = COALESCE(p_code, code),
    description_key = COALESCE(p_description_key, description_key),
    is_active = COALESCE(p_is_active, is_active),
    name = COALESCE(p_name, name),
    name_key = COALESCE(p_name_key, name_key),
    points_reward = COALESCE(p_points_reward, points_reward),
    questionnaire_type = COALESCE(p_questionnaire_type, questionnaire_type),
    questions = COALESCE(p_questions, questions),
    token_reward = COALESCE(p_token_reward, token_reward),
    updated_at = now(),
    version = v_new_version
  WHERE id = p_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := 'research'::public.journal_area,
      p_entity_id := p_id::text,
      p_entity_type := 'questionnaire',
      p_new_values := jsonb_build_object('version', v_new_version),
      p_summary := 'Updated questionnaire version ' || v_new_version,
    p_user_id := auth.uid()
  );

  RETURN FOUND;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_questionnaire_admin(uuid, text, text, text, boolean, text, text, integer, text, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_questionnaire_admin(uuid, text, text, text, boolean, text, text, integer, text, jsonb, integer) TO authenticated;

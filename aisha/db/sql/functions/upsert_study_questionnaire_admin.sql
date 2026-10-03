-- Function: public.upsert_study_questionnaire_admin
-- Arguments: p_description_key, p_display_order, p_ends_after_days, p_frequency_days,
--   p_frequency_type, p_id, p_is_active, p_is_required, p_questionnaire_id,
--   p_questionnaire_type, p_questionnaire_version, p_starts_after_days, p_study_id,
--   p_title_key, p_token_reward
-- Description: Upsert study questionnaire configuration. Admin/staff only.
--   Translations are stored in "translations" table via keys, NOT as _cs/_en columns.
-- Security: SECURITY DEFINER, admin/staff only

CREATE OR REPLACE FUNCTION public.upsert_study_questionnaire_admin(
  p_study_id UUID,
  p_description_key TEXT DEFAULT NULL,
  p_display_order INTEGER DEFAULT 0,
  p_ends_after_days INTEGER DEFAULT NULL,
  p_frequency_days INTEGER DEFAULT NULL,
  p_frequency_type TEXT DEFAULT 'one_time',
  p_id UUID DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT TRUE,
  p_is_required BOOLEAN DEFAULT TRUE,
  p_questionnaire_id UUID DEFAULT NULL,
  p_questionnaire_type TEXT DEFAULT 'custom',
  p_questionnaire_version INTEGER DEFAULT 1,
  p_starts_after_days INTEGER DEFAULT 0,
  p_title_key TEXT DEFAULT NULL,
  p_token_reward INTEGER DEFAULT 25
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_version INTEGER;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- Get questionnaire version if linked
  IF p_questionnaire_id IS NOT NULL AND p_questionnaire_version IS NULL THEN
    SELECT version INTO v_version FROM public.questionnaires WHERE id = p_questionnaire_id;
  ELSE
    v_version := p_questionnaire_version;
  END IF;

  INSERT INTO public.study_questionnaires (
    id,
    study_id,
    questionnaire_id,
    questionnaire_type,
    is_required,
    is_active,
    frequency_type,
    frequency_days,
    token_reward,
    display_order,
    starts_after_days,
    ends_after_days,
    title_key,
    description_key,
    questionnaire_version
  ) VALUES (
    COALESCE(p_id, gen_random_uuid()),
    p_study_id,
    p_questionnaire_id,
    p_questionnaire_type,
    COALESCE(p_is_required, TRUE),
    COALESCE(p_is_active, TRUE),
    COALESCE(p_frequency_type, 'one_time'),
    p_frequency_days,
    COALESCE(p_token_reward, 25),
    COALESCE(p_display_order, 0),
    COALESCE(p_starts_after_days, 0),
    p_ends_after_days,
    p_title_key,
    p_description_key,
    COALESCE(v_version, 1)
  )
  ON CONFLICT (study_id, questionnaire_type)
  DO UPDATE SET
    questionnaire_id = EXCLUDED.questionnaire_id,
    is_required = EXCLUDED.is_required,
    is_active = EXCLUDED.is_active,
    frequency_type = EXCLUDED.frequency_type,
    frequency_days = EXCLUDED.frequency_days,
    token_reward = EXCLUDED.token_reward,
    display_order = EXCLUDED.display_order,
    starts_after_days = EXCLUDED.starts_after_days,
    ends_after_days = EXCLUDED.ends_after_days,
    title_key = EXCLUDED.title_key,
    description_key = EXCLUDED.description_key,
    questionnaire_version = EXCLUDED.questionnaire_version,
    updated_at = now()
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'research'::journal_area,
      p_entity_id := v_id::text,
      p_entity_type := 'study_questionnaire',
      p_summary := 'Upserted study questionnaire',
    p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.upsert_study_questionnaire_admin(uuid, text, integer, integer, integer, text, uuid, boolean, boolean, uuid, text, integer, integer, text, integer) IS 
  'Upsert study questionnaire configuration. Admin/staff only. Translations via keys.';

-- Permissions
REVOKE ALL ON FUNCTION public.upsert_study_questionnaire_admin(uuid, text, integer, integer, integer, text, uuid, boolean, boolean, uuid, text, integer, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_study_questionnaire_admin(uuid, text, integer, integer, integer, text, uuid, boolean, boolean, uuid, text, integer, integer, text, integer) TO authenticated;

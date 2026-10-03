-- Function: public.create_questionnaire_admin
-- Description: Creates a new questionnaire with unified translation keys.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.create_questionnaire_admin(
  p_code text,
  p_name text,
  p_base_locale text DEFAULT 'en'::text,
  p_description_key text DEFAULT NULL::text,
  p_is_active boolean DEFAULT true,
  p_name_key text DEFAULT NULL::text,
  p_points_reward integer DEFAULT NULL::integer,
  p_questionnaire_type text DEFAULT NULL::text,
  p_questions jsonb DEFAULT '[]'::jsonb,
  p_token_reward integer DEFAULT NULL::integer
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

  INSERT INTO public.questionnaires (
    base_locale,
    code,
    description_key,
    is_active,
    name,
    name_key,
    points_reward,
    questionnaire_type,
    questions,
    token_reward,
    version
  ) VALUES (
    COALESCE(p_base_locale, 'en'),
    p_code,
    p_description_key,
    COALESCE(p_is_active, true),
    p_name,
    p_name_key,
    p_points_reward,
    p_questionnaire_type,
    COALESCE(p_questions, '[]'::jsonb),
    p_token_reward,
    1
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'research'::journal_area,
      p_entity_id := v_id::text,
      p_entity_type := 'questionnaire',
      p_summary := format('Created questionnaire: %s', p_code),
    p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_questionnaire_admin(text, text, text, text, boolean, text, integer, text, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_questionnaire_admin(text, text, text, text, boolean, text, integer, text, jsonb, integer) TO authenticated;

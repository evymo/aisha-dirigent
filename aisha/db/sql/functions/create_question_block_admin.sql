-- Function: public.create_question_block_admin
-- Description: Creates a question block with unified translation keys.
-- Security: SECURITY DEFINER, admin/staff only.

CREATE OR REPLACE FUNCTION public.create_question_block_admin(
  p_block_key text,
  p_description_key text DEFAULT NULL::text,
  p_is_active boolean DEFAULT true,
  p_question_type text DEFAULT 'textarea'::text,
  p_questions jsonb DEFAULT '[]'::jsonb,
  p_sort_order integer DEFAULT 0,
  p_text_key text DEFAULT NULL::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_text_key text;
  v_description_key text;
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  v_text_key := COALESCE(p_text_key, format('questionnaires.blocks.%s.text', p_block_key));
  v_description_key := COALESCE(p_description_key, format('questionnaires.blocks.%s.description', p_block_key));

  INSERT INTO public.question_blocks (
    base_locale,
    code,
    config,
    created_by,
    description_key,
    is_active,
    is_required_default,
    question_type,
    questions,
    sort_order,
    text_key
  ) VALUES (
    'en',
    p_block_key,
    jsonb_build_object('questions', COALESCE(p_questions, '[]'::jsonb)),
    auth.uid(),
    v_description_key,
    COALESCE(p_is_active, true),
    false,
    COALESCE(p_question_type, 'textarea'),
    COALESCE(p_questions, '[]'::jsonb),
    COALESCE(p_sort_order, 0),
    v_text_key
  )
  RETURNING id INTO v_id;

  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'research'::journal_area,
      p_entity_id := v_id::text,
      p_entity_type := 'question_block',
      p_summary := format('Created question block: %s', p_block_key),
    p_user_id := auth.uid()
  );

  RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_question_block_admin(text, text, boolean, text, jsonb, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_question_block_admin(text, text, boolean, text, jsonb, integer, text) TO authenticated;


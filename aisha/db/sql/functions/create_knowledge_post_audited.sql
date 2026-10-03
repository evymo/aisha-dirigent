-- Function: public.create_knowledge_post_audited
-- Description: Creates a new discussion post in a knowledge topic with audit logging.
-- Security: SECURITY DEFINER - authenticated access with audit.
-- @security: authenticated
-- @audit: write_audit_journal

CREATE OR REPLACE FUNCTION public.create_knowledge_post_audited(
  p_topic_id uuid,
  p_body text,
  p_original_locale text DEFAULT 'en'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_post_id uuid;
  v_topic_exists boolean;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate topic exists and is not locked
  SELECT EXISTS(
    SELECT 1 FROM knowledge_topics kt
    WHERE kt.id = p_topic_id
      AND kt.is_locked IS NOT TRUE
      AND kt.visibility IN ('public', 'members')
  ) INTO v_topic_exists;

  IF NOT v_topic_exists THEN
    RAISE EXCEPTION 'Topic not found or locked';
  END IF;

  -- Validate body is not empty
  IF TRIM(p_body) = '' THEN
    RAISE EXCEPTION 'Post body cannot be empty' USING ERRCODE = '22023';
  END IF;

  -- Insert new post
  INSERT INTO knowledge_posts (
    topic_id,
    author_user_id,
    body_original,
    original_locale,
    status
  ) VALUES (
    p_topic_id,
    v_user_id,
    TRIM(p_body),
    p_original_locale,
    'visible'
  )
  RETURNING id INTO v_post_id;

  -- Write audit journal entry
  PERFORM public.write_audit_journal(
    p_action_type := 'create'::journal_action_type,
    p_area := 'content'::journal_area,
    p_details := jsonb_build_object(
      'post_id', v_post_id,
      'topic_id', p_topic_id,
      'locale', p_original_locale
    ),
    p_severity := 'info',
    p_user_id := v_user_id
  );

  RETURN v_post_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_knowledge_post_audited(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_knowledge_post_audited(uuid, text, text) TO authenticated;

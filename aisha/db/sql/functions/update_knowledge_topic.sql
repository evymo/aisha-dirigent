-- Function: public.update_knowledge_topic
-- Description: Updates knowledge topic metadata and creates a new version.
-- Security: SECURITY DEFINER - admin only.
-- @category: ADMIN
-- @audit: true

CREATE OR REPLACE FUNCTION public.update_knowledge_topic(
  p_topic_id uuid,
  p_slug text DEFAULT NULL,
  p_title_key text DEFAULT NULL,
  p_summary_key text DEFAULT NULL,
  p_visibility text DEFAULT NULL,
  p_locale text DEFAULT 'en',
  p_title text DEFAULT NULL,
  p_summary text DEFAULT NULL,
  p_body text DEFAULT NULL,
  p_commit_message text DEFAULT 'Updated by admin'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_version_num integer;
  v_new_version_id uuid;
  v_old_data jsonb;
BEGIN
  -- 1. Check permissions
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'staff') THEN
    RAISE EXCEPTION 'Access denied. Admin or Staff role required.';
  END IF;

  -- 2. Get current state for audit
  SELECT to_jsonb(t) INTO v_old_data FROM knowledge_topics t WHERE id = p_topic_id;
  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'Topic not found.';
  END IF;

  -- 3. Update Topic Metadata (if changed)
  UPDATE knowledge_topics
  SET
    slug = COALESCE(p_slug, slug),
    title_key = COALESCE(p_title_key, title_key),
    summary_key = COALESCE(p_summary_key, summary_key),
    visibility = COALESCE(p_visibility, visibility),
    updated_at = now()
  WHERE id = p_topic_id;

  -- 4. Create New Version (if content changed)
  -- Determine next version number
  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_current_version_num
  FROM knowledge_topic_versions
  WHERE topic_id = p_topic_id;

  INSERT INTO knowledge_topic_versions (
    topic_id,
    version_no,
    body_markdown,
    change_note,
    created_at
  ) VALUES (
    p_topic_id,
    v_current_version_num,
    COALESCE(p_body, ''),
    p_commit_message,
    now()
  )
  RETURNING id INTO v_new_version_id;

  -- 5. Audit Log
  PERFORM public.write_audit_journal(
    p_action_type := 'update'::journal_action_type,
    p_area := 'content'::journal_area,
    p_details := jsonb_build_object(
      'topic_id', p_topic_id,
      'old_data', v_old_data,
      'new_version_id', v_new_version_id
    ),
    p_severity := 'info',
    p_user_id := auth.uid()
  );

  RETURN v_new_version_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.update_knowledge_topic(uuid, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_knowledge_topic(uuid, text, text, text, text, text, text, text, text, text) TO authenticated;

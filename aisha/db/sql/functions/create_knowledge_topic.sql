-- Function: public.create_knowledge_topic
-- Description: Creates a new knowledge topic and its initial version.
-- Security: SECURITY DEFINER - admin only.
-- @category: ADMIN
-- @audit: true

CREATE OR REPLACE FUNCTION public.create_knowledge_topic(
  p_slug text,
  p_title_key text,
  p_summary_key text DEFAULT NULL,
  p_visibility text DEFAULT 'members',
  p_initial_locale text DEFAULT 'en',
  p_initial_title text DEFAULT '',
  p_initial_summary text DEFAULT '',
  p_initial_body text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_topic_id uuid;
  v_version_id uuid;
BEGIN
  -- 1. Check permissions (Admin/Staff)
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'staff') THEN
    RAISE EXCEPTION 'Access denied. Admin or Staff role required.';
  END IF;

  -- 2. Validate input
  IF p_slug IS NULL OR length(p_slug) < 3 THEN
    RAISE EXCEPTION 'Slug is required and must be at least 3 characters.';
  END IF;

  -- 3. Insert Topic
  INSERT INTO knowledge_topics (
    slug,
    title_key,
    summary_key,
    visibility,
    source_locale,
    verification_status,
    created_at,
    updated_at
  ) VALUES (
    p_slug,
    p_title_key,
    p_summary_key,
    p_visibility,
    p_initial_locale,
    'verified', -- Admins create verified topics by default
    now(),
    now()
  )
  RETURNING id INTO v_topic_id;

  -- 4. Insert Initial Version
  INSERT INTO knowledge_topic_versions (
    topic_id,
    version_no,
    body_markdown,
    change_note,
    created_at
  ) VALUES (
    v_topic_id,
    1,
    p_initial_body,
    'Initial version created by admin',
    now()
  )
  RETURNING id INTO v_version_id;

  -- 5. Audit Log
  PERFORM public.write_audit_journal(
    p_action_type := 'create'::journal_action_type,
    p_area := 'content'::journal_area,
    p_details := jsonb_build_object(
      'topic_id', v_topic_id,
      'slug', p_slug,
      'version_id', v_version_id
    ),
    p_severity := 'info',
    p_user_id := auth.uid()
  );

  RETURN v_topic_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_knowledge_topic(text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_knowledge_topic(text, text, text, text, text, text, text, text) TO authenticated;

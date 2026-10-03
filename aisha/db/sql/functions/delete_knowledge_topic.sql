-- Function: public.delete_knowledge_topic
-- Description: Soft deletes a knowledge topic (sets visibility to 'archived').
-- Security: SECURITY DEFINER - admin only.
-- @category: ADMIN
-- @audit: true

CREATE OR REPLACE FUNCTION public.delete_knowledge_topic(
  p_topic_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_slug text;
BEGIN
  -- 1. Check permissions
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied. Admin role required.';
  END IF;

  SELECT slug INTO v_slug FROM knowledge_topics WHERE id = p_topic_id;

  -- 2. Soft Delete (Update visibility)
  -- We don't actually delete rows to preserve referential integrity of posts
  UPDATE knowledge_topics
  SET 
    visibility = 'archived',
    updated_at = now()
  WHERE id = p_topic_id;

  -- 3. Audit
  PERFORM public.write_audit_journal(
    p_action_type := 'delete'::journal_action_type,
    p_area := 'content'::journal_area,
    p_details := jsonb_build_object(
      'topic_id', p_topic_id,
      'slug', v_slug
    ),
    p_severity := 'warning',
    p_user_id := auth.uid()
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_knowledge_topic(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_knowledge_topic(uuid) TO authenticated;

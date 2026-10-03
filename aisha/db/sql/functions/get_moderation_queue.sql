-- Function: public.get_moderation_queue
-- Description: Fetches items from the moderation queue.
-- Security: SECURITY DEFINER - admin only.
-- @category: ADMIN
-- @audit: false

CREATE OR REPLACE FUNCTION public.get_moderation_queue(
  p_status text DEFAULT 'pending',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  resource_type text,
  resource_id uuid,
  risk_score numeric,
  risk_tags text[],
  status text,
  created_at timestamptz,
  -- Post details
  post_body text,
  post_author_name text,
  topic_title text,
  topic_slug text,
  -- Reviewer details
  reviewer_notes text,
  -- AISHA compliance gate
  aisha_evaluation jsonb,
  auto_decision boolean,
  -- Expert rule details
  rule_title text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- 1. Check permissions
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'staff') THEN
    RAISE EXCEPTION 'Access denied. Admin or Staff role required.';
  END IF;

  RETURN QUERY
  SELECT
    mq.id,
    mq.resource_type,
    mq.resource_id,
    mq.risk_score,
    mq.risk_tags,
    mq.status,
    mq.created_at,
    -- Join with posts
    kp.body_original AS post_body,
    public.format_display_name_for_public(p.display_name, p.nickname, p.is_public_profile) AS post_author_name,
    COALESCE(kt.title_key, 'Unknown Topic') AS topic_title,
    COALESCE(kt.slug, '') AS topic_slug,
    mq.reviewer_notes,
    -- AISHA compliance gate fields
    mq.aisha_evaluation,
    mq.auto_decision,
    -- Expert rule title
    er.title AS rule_title
  FROM knowledge_moderation_queue mq
  LEFT JOIN knowledge_posts kp ON mq.resource_type = 'post' AND mq.resource_id = kp.id
  LEFT JOIN profiles p ON kp.author_user_id = p.id
  LEFT JOIN knowledge_topics kt ON kp.topic_id = kt.id
  LEFT JOIN expert_rules er ON mq.resource_type = 'expert_rule' AND mq.resource_id = er.id
  WHERE
    mq.status = p_status
  ORDER BY mq.risk_score DESC NULLS LAST, mq.created_at ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_moderation_queue(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_moderation_queue(text, integer, integer) TO authenticated;

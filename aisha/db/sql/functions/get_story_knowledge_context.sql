-- Function: public.get_story_knowledge_context
-- Arguments: p_story_id uuid, p_context_tags text[] DEFAULT '{}'::text[]
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.get_story_knowledge_context(p_story_id uuid, p_context_tags text[] DEFAULT '{}'::text[])
 RETURNS TABLE(id uuid, slug text, title text, summary text, category text, has_ai_instructions boolean, ai_instructions text, author_display_name text, relevance_score integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  WITH combined AS (
    -- Subscribed rules (highest relevance)
    SELECT
      er.id,
      er.slug,
      er.title,
      er.summary,
      er.category::text,
      (er.ai_instructions IS NOT NULL AND er.ai_instructions <> '') AS has_ai_instructions,
      er.ai_instructions,
      pp.display_name AS author_display_name,
      3 AS relevance_score
    FROM expert_rule_subscriptions ers
    JOIN expert_rules er ON er.id = ers.rule_id AND er.status = 'published'
      AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, v_caller_id)
    JOIN partner_profiles pp ON pp.id = er.author_partner_id
    WHERE ers.user_id = v_caller_id AND ers.is_active = true

    UNION ALL

    -- Tag-matched rules (medium relevance)
    SELECT
      er.id,
      er.slug,
      er.title,
      er.summary,
      er.category::text,
      (er.ai_instructions IS NOT NULL AND er.ai_instructions <> '') AS has_ai_instructions,
      er.ai_instructions,
      pp.display_name AS author_display_name,
      2 AS relevance_score
    FROM expert_rules er
    JOIN partner_profiles pp ON pp.id = er.author_partner_id
    WHERE er.status = 'published'
      AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, v_caller_id)
      AND er.ai_context_tags && p_context_tags
      AND NOT EXISTS (
        SELECT 1 FROM expert_rule_subscriptions ers2
        WHERE ers2.rule_id = er.id AND ers2.user_id = v_caller_id AND ers2.is_active = true
      )
  )
  SELECT DISTINCT ON (combined.id)
    combined.id,
    combined.slug,
    combined.title,
    combined.summary,
    combined.category,
    combined.has_ai_instructions,
    combined.ai_instructions,
    combined.author_display_name,
    combined.relevance_score
  FROM combined
  ORDER BY combined.id, combined.relevance_score DESC
  LIMIT 20;

  -- Track usage
  UPDATE expert_rule_subscriptions SET
    usage_count = usage_count + 1,
    last_used_at = now()
  WHERE user_id = v_caller_id AND is_active = true;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_story_knowledge_context(uuid, text[][]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_story_knowledge_context(uuid, text[][]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_story_knowledge_context(uuid, text[][]) TO service_role;

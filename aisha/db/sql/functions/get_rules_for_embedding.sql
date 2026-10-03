-- Function: get_rules_for_embedding
--
-- Returns published expert_rules that still need a content_embedding (or ALL of
-- them when p_force), for the svc-mcp-knowledge POST /embeddings/rules worker.
-- Idempotent: skips rules that already carry a content_embedding unless p_force,
-- so a cold-start embed-kickstart that re-runs produces processed:0 on the second
-- pass. Mirrors get_knowledge_items_for_embedding (the knowledge_items twin).
-- Service-role only — matches the route's verifyServiceRole gate.
CREATE OR REPLACE FUNCTION public.get_rules_for_embedding(p_force boolean DEFAULT false, p_batch_size integer DEFAULT 10, p_slug text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, slug text, title text, summary text, body_markdown text, ai_instructions text, ai_context_tags text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  IF p_batch_size > 100 THEN
    p_batch_size := 100;
  END IF;

  RETURN QUERY
  SELECT er.id,
         er.slug,
         er.title,
         er.summary,
         er.body_markdown,
         er.ai_instructions,
         er.ai_context_tags
  FROM expert_rules er
  WHERE er.status = 'published'
    AND (p_slug IS NULL OR er.slug = p_slug)
    AND (p_force OR er.content_embedding IS NULL)
  ORDER BY er.updated_at DESC NULLS LAST, er.created_at DESC
  LIMIT p_batch_size;
END;
$function$
;

REVOKE ALL ON FUNCTION get_rules_for_embedding(boolean, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rules_for_embedding(boolean, integer, text) TO service_role;

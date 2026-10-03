-- Function: fn_get_psyche_traits

CREATE OR REPLACE FUNCTION public.fn_get_psyche_traits()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL AND public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied: authentication required to read psyche traits'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'slug', ki.source_slug,
        'title', ki.title,
        'summary', ki.summary,
        'ai_instructions', ki.ai_instructions,
        'tags', ki.ai_context_tags,
        'cluster', CASE
          WHEN 'core_identity' = ANY(ki.ai_context_tags) THEN 'core_identity'
          WHEN 'response_style' = ANY(ki.ai_context_tags) THEN 'response_style'
          WHEN 'guardrail' = ANY(ki.ai_context_tags) THEN 'guardrail'
          WHEN 'emotional_intelligence' = ANY(ki.ai_context_tags) THEN 'emotional_intelligence'
          ELSE 'unknown'
        END
      )
      ORDER BY ki.source_slug
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM knowledge_items ki
  WHERE ki.item_type = 'personality_trait'
    AND ki.status = 'active';

  RETURN v_result;
END;
$function$

;

REVOKE ALL ON FUNCTION fn_get_psyche_traits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_get_psyche_traits() TO authenticated;
GRANT EXECUTE ON FUNCTION fn_get_psyche_traits() TO service_role;

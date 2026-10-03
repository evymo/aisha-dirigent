-- Function: fn_get_tao_principles

CREATE OR REPLACE FUNCTION public.fn_get_tao_principles()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL AND public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied: authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'slug', ki.source_slug,
        'title', ki.title,
        'summary', ki.summary,
        'ai_instructions', ki.ai_instructions,
        'tags', ki.ai_context_tags
      )
      ORDER BY ki.source_slug
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM knowledge_items ki
  WHERE ki.item_type = 'core_value'
    AND ki.status = 'active';

  RETURN v_result;
END;
$function$

;

REVOKE ALL ON FUNCTION fn_get_tao_principles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_get_tao_principles() TO authenticated;
GRANT EXECUTE ON FUNCTION fn_get_tao_principles() TO service_role;

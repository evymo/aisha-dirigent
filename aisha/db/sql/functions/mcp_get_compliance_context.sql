-- Function: mcp_get_compliance_context

CREATE OR REPLACE FUNCTION public.mcp_get_compliance_context(p_story_id uuid, p_severity_threshold integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  -- Stráž (can_access_story.sql) — ruleset story vidí jen ten, kdo smí na story.
  IF NOT public.can_access_story(p_story_id) THEN
    RAISE EXCEPTION 'Access denied to story %', p_story_id USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'story_id', p_story_id,
    'ruleset', jsonb_build_object(
      'fingerprint', sr.ruleset_fingerprint,
      'rules', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', er.id, 'slug', er.slug, 'title', er.title,
          'category', er.category, 'ai_instructions', er.ai_instructions,
          'body_markdown', er.body_markdown
        ))
        FROM expert_rules er
        WHERE er.id = ANY(sr.rule_ids)
          AND er.status = 'published'
      )
    )
  ) INTO v_result
  FROM story_contexts sc
  JOIN story_rulesets sr ON sr.id = sc.ruleset_id
  WHERE sc.story_id = p_story_id;

  RETURN COALESCE(v_result, jsonb_build_object('story_id', p_story_id, 'ruleset', null));
END;
$function$;

REVOKE ALL ON FUNCTION mcp_get_compliance_context(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_get_compliance_context(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_get_compliance_context(uuid,integer) TO service_role;

-- Function: public.mcp_get_story_context
-- Arguments: p_story_id uuid
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.mcp_get_story_context(p_story_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'story', jsonb_build_object(
      'id', ps.id,
      'title', ps.title,
      'status', ps.status,
      'delivery_status', ps.delivery_status,
      'repo_url', ps.repo_url,
      'repo_provider', ps.repo_provider,
      'default_branch', ps.default_branch,
      'tech_stack', ps.tech_stack,
      'domain', ps.domain,
      'project_preview', ps.project_preview,
      'risk_profile', ps.risk_profile,
      'origin', ps.origin
    ),
    'project_preview', ps.project_preview,
    'ruleset', CASE WHEN sr.id IS NOT NULL THEN jsonb_build_object(
      'id', sr.id,
      'fingerprint', sr.ruleset_fingerprint,
      'rule_count', array_length(sr.rule_ids, 1),
      'context_profile', sr.context_profile,
      'rule_versions', sr.rule_versions,
      'created_at', sr.created_at
    ) ELSE NULL END,
    'build_config', COALESCE(sc.build_config, '{}'::jsonb),
    'env_hints', COALESCE(sc.env_hints, '{}'::jsonb),
    'mcp_endpoint', sc.mcp_endpoint,
    'participants', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'user_id', sp.user_id,
        'role', sp.role,
        'joined_at', sp.joined_at
       ))
       FROM story_participants sp WHERE sp.story_id = ps.id),
      '[]'::jsonb
    ),
    'rules_preview', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', er.id,
        'slug', er.slug,
        'title', er.title,
        'category', er.category,
        'version', er.version
       ))
       FROM unnest(sr.rule_ids) AS rid
       JOIN expert_rules er ON er.id = rid
       WHERE er.status = 'published'),
      '[]'::jsonb
    )
  ) INTO v_result
  FROM partner_stories ps
  LEFT JOIN story_contexts sc ON sc.story_id = ps.id
  LEFT JOIN story_rulesets sr ON sr.id = sc.ruleset_id
  WHERE ps.id = p_story_id;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'Story not found', 'story_id', p_story_id);
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_get_story_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_get_story_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_story_context(uuid) TO service_role;

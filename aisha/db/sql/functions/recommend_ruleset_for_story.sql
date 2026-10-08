-- Function: recommend_ruleset_for_story
-- Purpose: Match story tech_stack/domain against expert_rules.ai_context_tags
-- Security: SECURITY DEFINER (admin/staff or story owner)
-- MCP tool: recommend_ruleset_for_story

CREATE OR REPLACE FUNCTION public.recommend_ruleset_for_story(
  p_story_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tech_stack text[];
  v_domain text[];
  v_risk_profile text;
  v_result jsonb;
BEGIN
  -- Authorization: admin/staff or story owner
  IF NOT is_admin_or_staff() THEN
    IF NOT EXISTS (
      SELECT 1 FROM partner_stories
      WHERE id = p_story_id AND partner_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Unauthorized: not story owner or admin/staff';
    END IF;
  END IF;

  -- Load story metadata
  SELECT tech_stack, domain, risk_profile
  INTO v_tech_stack, v_domain, v_risk_profile
  FROM partner_stories
  WHERE id = p_story_id;

  IF v_tech_stack IS NULL AND v_domain IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Story has no tech_stack or domain set. Run detect_project_context first.',
      'story_id', p_story_id
    );
  END IF;

  -- Combine tech_stack + domain for tag matching
  WITH story_tags AS (
    SELECT unnest(COALESCE(v_tech_stack, '{}') || COALESCE(v_domain, '{}')) AS tag
  ),
  rule_scores AS (
    SELECT
      er.id AS rule_id,
      er.slug,
      er.title,
      er.category::text AS category,
      er.ai_context_tags,
      (
        SELECT count(*)
        FROM unnest(er.ai_context_tags) rt
        JOIN story_tags st ON lower(rt) = lower(st.tag)
      ) AS tag_overlap,
      array_length(er.ai_context_tags, 1) AS total_tags,
      CASE WHEN 'aisha' = ANY(er.ai_context_tags) THEN 1 ELSE 0 END AS aisha_boost,
      CASE
        WHEN v_risk_profile = 'high' AND er.category = 'security_practice' THEN 2
        WHEN v_risk_profile = 'medium' AND er.category = 'security_practice' THEN 1
        ELSE 0
      END AS risk_boost
    FROM expert_rules er
    WHERE er.status = 'published'
      AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, auth.uid())
      AND er.ai_context_tags IS NOT NULL
      AND array_length(er.ai_context_tags, 1) > 0
  ),
  ranked AS (
    SELECT
      rule_id, slug, title, category, ai_context_tags,
      tag_overlap, total_tags, aisha_boost, risk_boost,
      (tag_overlap + aisha_boost + risk_boost) AS total_score
    FROM rule_scores
    WHERE tag_overlap > 0 OR aisha_boost > 0
    ORDER BY total_score DESC, tag_overlap DESC, slug
  )
  SELECT jsonb_build_object(
    'success', true,
    'story_id', p_story_id,
    'tech_stack', v_tech_stack,
    'domain', v_domain,
    'risk_profile', v_risk_profile,
    'recommended_rule_ids', COALESCE((SELECT jsonb_agg(rule_id) FROM ranked), '[]'::jsonb),
    'match_details', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'rule_id', rule_id,
          'slug', slug,
          'title', title,
          'category', category,
          'tag_overlap', tag_overlap,
          'aisha_boost', aisha_boost,
          'risk_boost', risk_boost,
          'total_score', total_score
        ) ORDER BY total_score DESC
      ) FROM ranked),
      '[]'::jsonb
    ),
    'total_recommended', (SELECT count(*) FROM ranked)
  ) INTO v_result;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'RULESET_RECOMMENDATION',
    jsonb_build_object(
      'area', 'ai',
      'severity', 'info',
      'story_id', p_story_id,
      'rules_recommended', (v_result->>'total_recommended')::int
    )
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.recommend_ruleset_for_story(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recommend_ruleset_for_story(uuid) TO authenticated;

COMMENT ON FUNCTION public.recommend_ruleset_for_story(uuid) IS
  'Recommends expert rules for a story based on tech_stack/domain tag overlap. '
  'Returns match details with scoring. Used by AISHA onboarding pipeline.';

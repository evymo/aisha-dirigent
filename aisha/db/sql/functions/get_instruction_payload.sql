-- Function: get_instruction_payload
-- Returns structured JSON payload for IDE instruction generation.
-- Loads expert rules grouped by category — either story-specific or default set.
-- Used by scripts/generate-ide-instructions.mjs to produce per-IDE instruction files.

CREATE OR REPLACE FUNCTION public.get_instruction_payload(p_story_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_story jsonb := 'null'::jsonb;
  v_ruleset jsonb := 'null'::jsonb;
  v_rule_ids uuid[];
  v_rules jsonb;
  v_categories jsonb;
  v_use_defaults boolean;
BEGIN
  -- Auth guard: require authenticated user or service_role
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- 1. Load story metadata (optional)
  IF p_story_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', ps.id,
      'title', ps.title,
      'tech_stack', to_jsonb(COALESCE(ps.tech_stack, '{}'::text[])),
      'domain', to_jsonb(COALESCE(ps.domain, '{}'::text[])),
      'risk_profile', COALESCE(ps.risk_profile, 'low')
    )
    INTO v_story
    FROM partner_stories ps
    WHERE ps.id = p_story_id;

    -- Load active ruleset for story
    SELECT jsonb_build_object(
      'fingerprint', sr.ruleset_fingerprint,
      'context_profile', COALESCE(sr.context_profile, 'repo_plus_rules'),
      'rule_count', COALESCE(array_length(sr.rule_ids, 1), 0)
    ), sr.rule_ids
    INTO v_ruleset, v_rule_ids
    FROM story_contexts sc
    JOIN story_rulesets sr ON sr.id = sc.ruleset_id
    WHERE sc.story_id = p_story_id;
  END IF;

  v_use_defaults := (v_rule_ids IS NULL);

  -- 2. Load expert rules as structured JSON array
  IF NOT v_use_defaults THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'slug', er.slug,
        'title', er.title,
        'category', er.category::text,
        'ai_instructions', COALESCE(er.ai_instructions, ''),
        'summary', COALESCE(er.summary, '')
      ) ORDER BY er.category::text, er.slug
    ), '[]'::jsonb)
    INTO v_rules
    FROM expert_rules er
    WHERE er.id = ANY(v_rule_ids)
      AND er.status = 'published'
      AND er.visibility IN ('public', 'members');
  ELSE
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'slug', er.slug,
        'title', er.title,
        'category', er.category::text,
        'ai_instructions', COALESCE(er.ai_instructions, ''),
        'summary', COALESCE(er.summary, '')
      ) ORDER BY er.category::text, er.slug
    ), '[]'::jsonb)
    INTO v_rules
    FROM expert_rules er
    WHERE er.is_default = true
      AND er.status = 'published'
      AND er.visibility = 'public';
  END IF;

  -- 3. Extract distinct categories
  SELECT COALESCE(jsonb_agg(c ORDER BY c), '[]'::jsonb)
  INTO v_categories
  FROM (
    SELECT DISTINCT r->>'category' AS c
    FROM jsonb_array_elements(v_rules) AS r
  ) sub;

  -- 4. Build payload
  RETURN jsonb_build_object(
    'generated_at', now()::text,
    'payload_version', 1,
    'scope', CASE WHEN v_use_defaults THEN 'default' ELSE 'story' END,
    'story', v_story,
    'ruleset', v_ruleset,
    'categories', v_categories,
    'rules', v_rules
  );
END;
$$;

REVOKE ALL ON FUNCTION get_instruction_payload(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_instruction_payload(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_instruction_payload(uuid) TO service_role;

COMMENT ON FUNCTION get_instruction_payload(uuid) IS
  'Returns structured JSON payload for IDE instruction file generation. Story-specific or default rules.';

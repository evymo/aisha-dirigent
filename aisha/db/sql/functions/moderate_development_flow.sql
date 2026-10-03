-- Function: moderate_development_flow

CREATE OR REPLACE FUNCTION public.moderate_development_flow(p_session_type text, p_story_id uuid DEFAULT NULL::uuid, p_tech_stack jsonb DEFAULT '[]'::jsonb, p_file_paths text[] DEFAULT '{}'::text[], p_diff_summary text DEFAULT NULL::text, p_expertise_level text DEFAULT 'intermediate'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_session_id uuid;
  v_rules jsonb := '[]'::jsonb;
  v_context_bundle jsonb := '{}'::jsonb;
  v_expertise_hints jsonb := '{}'::jsonb;
  v_story_ctx jsonb;
  v_tech_tags text[];
  v_pinned uuid[];
  v_categories expert_rule_category[];
  v_compliance boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Validate session_type
  IF p_session_type NOT IN ('chat_flow', 'pre_commit', 'pr_review', 'test_strategy', 'architecture', 'estimation') THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid session_type: %s', p_session_type), ERRCODE = 'P0001';
  END IF;

  -- Stráž (can_access_story.sql) — story je volitelná; když je zadaná, relace se k ní
  -- neváže a její kontext se nevrací, pokud na ni volající nesmí.
  IF p_story_id IS NOT NULL AND NOT public.can_access_story(p_story_id) THEN
    RAISE EXCEPTION 'Access denied to story %', p_story_id USING ERRCODE = '42501';
  END IF;

  -- Create moderation session
  INSERT INTO moderation_sessions (user_id, story_id, session_type, expertise_level, tech_stack)
  VALUES (v_user_id, p_story_id, p_session_type, p_expertise_level, p_tech_stack)
  RETURNING id INTO v_session_id;

  -- Extract tech stack tags for rule matching
  SELECT array_agg(t.value::text)
  INTO v_tech_tags
  FROM jsonb_array_elements_text(p_tech_stack) AS t(value);

  -- ⛔ NAMĚŘENO 2026-09-14: filtr porovnával enum expert_rule_category s literály
  -- 'testing'/'quality'/'compliance'/'security'/'architecture'/'patterns', které
  -- v enumu nejsou → 22P02 KAŽDÉMU volajícímu, jakmile existovalo pravidlo. Pod tím
  -- se schovávala druhá vada: ORDER BY/LIMIT stály na agregačním dotazu, ne na
  -- pravidlech. Mapování (rozhodnuto 2026-09-14):
  --   compliance = pravidla PŘIPNUTÁ ke story (story_rulesets.rule_ids — týž zdroj
  --                jako mcp_get_compliance_context); u pr_review/pre_commit severity
  --                error a patří do výběru bez ohledu na kategorii. Bez story žádná.
  --   quality    = coding_standard + performance_optimization
  --   security   = security_practice (error vždy)
  --   testing    = testing_strategy
  --   architecture/patterns = architecture_pattern + integration_pattern + data_modeling
  -- Kategorie jsou TYPOVANÉ pole: neplatná hodnota padne při prvním volání
  -- a runtime test volá každý session_type.
  IF p_story_id IS NOT NULL THEN
    SELECT sr.rule_ids INTO v_pinned
    FROM story_contexts sc
    JOIN story_rulesets sr ON sr.id = sc.ruleset_id
    WHERE sc.story_id = p_story_id;
  END IF;
  v_pinned := COALESCE(v_pinned, '{}'::uuid[]);

  v_categories := CASE p_session_type
    WHEN 'test_strategy' THEN ARRAY['testing_strategy', 'coding_standard', 'performance_optimization']::expert_rule_category[]
    WHEN 'pr_review'     THEN ARRAY['coding_standard', 'performance_optimization', 'security_practice', 'testing_strategy']::expert_rule_category[]
    WHEN 'pre_commit'    THEN ARRAY['coding_standard', 'performance_optimization', 'security_practice']::expert_rule_category[]
    WHEN 'architecture'  THEN ARRAY['architecture_pattern', 'integration_pattern', 'data_modeling']::expert_rule_category[]
    ELSE NULL  -- chat_flow, estimation: všechna publikovaná pravidla
  END;
  v_compliance := p_session_type IN ('pr_review', 'pre_commit');

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'slug', r.slug,
      'title', r.title,
      'category', r.category,
      'ai_instructions', r.ai_instructions,
      'pinned', r.pinned,
      'severity', CASE
        WHEN v_compliance AND r.pinned THEN 'error'
        WHEN r.category = 'security_practice'::expert_rule_category THEN 'error'
        ELSE 'warning'
      END
    ) ORDER BY r.pinned DESC, r.slug
  ), '[]'::jsonb)
  INTO v_rules
  FROM (
    SELECT er.slug, er.title, er.category, er.ai_instructions,
           er.id = ANY(v_pinned) AS pinned
    FROM expert_rules er
    WHERE er.status = 'published'
      AND (
        v_categories IS NULL
        OR er.category = ANY(v_categories)
        OR (v_compliance AND er.id = ANY(v_pinned))
      )
    ORDER BY (er.id = ANY(v_pinned)) DESC, er.slug
    LIMIT 30
  ) r;

  -- Load story context if available
  IF p_story_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'story_id', ps.id,
      'title', ps.title,
      'delivery_status', ps.delivery_status,
      'tech_stack', ps.tech_stack,
      'risk_profile', ps.risk_profile,
      'domain', ps.domain
    ) INTO v_story_ctx
    FROM partner_stories ps
    WHERE ps.id = p_story_id;

    IF v_story_ctx IS NOT NULL THEN
      v_context_bundle := v_context_bundle || jsonb_build_object('story', v_story_ctx);
    END IF;
  END IF;

  -- Build guidance contract from expertise level (replaces simple verbosity hints)
  v_expertise_hints := build_guidance_contract(p_expertise_level);

  -- Add file context
  IF array_length(p_file_paths, 1) > 0 THEN
    v_context_bundle := v_context_bundle || jsonb_build_object('file_paths', to_jsonb(p_file_paths));
  END IF;

  -- Add diff summary
  IF p_diff_summary IS NOT NULL THEN
    v_context_bundle := v_context_bundle || jsonb_build_object('diff_summary', p_diff_summary);
  END IF;

  -- Add tech stack to context
  v_context_bundle := v_context_bundle || jsonb_build_object('tech_stack', p_tech_stack);

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'rules', v_rules,
    'context_bundle', v_context_bundle,
    'expertise_hints', v_expertise_hints
  );
END;
$function$;

REVOKE ALL ON FUNCTION moderate_development_flow(text, uuid, jsonb, text[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION moderate_development_flow(text,uuid,jsonb,text[],text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION moderate_development_flow(text,uuid,jsonb,text[],text,text) TO service_role;

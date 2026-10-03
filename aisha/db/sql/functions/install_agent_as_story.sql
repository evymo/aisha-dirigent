-- ============================================================================
-- Source of Truth: install_agent_as_story
-- Purpose: Install a published marketplace agent (kind='agent') as a NEW
--          consumer-owned story ("run-as-story"). Mints partner_stories +
--          story_rulesets + story_contexts from the agent's declarative
--          agent_spec, and hydrates the agent's knowledge items under the new
--          story_id (per-story KB isolation in mcp_search_knowledge_v3 /
--          compose_context then scopes them to this story).
--
-- Reuses the create_story_from_preset minting shape but: (a) sources config from
-- plugin_catalog.agent_spec instead of project_presets, (b) hydrates KB, and
-- (c) fixes the create_story_from_preset ACL gap by verifying the caller owns
-- p_partner_id.
--
-- This is NOT import_story_bundle — that is same-story replica sync and cannot
-- mint a consumer-owned copy of another author's content.
-- Security: SECURITY DEFINER + REVOKE/GRANT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.install_agent_as_story(
  p_plugin_id  uuid,
  p_partner_id uuid DEFAULT NULL,
  p_title      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_plugin       record;
  v_spec         jsonb;
  v_rule_slugs   text[];
  v_rule_ids     uuid[];
  v_rule_versions jsonb;
  v_fingerprint  text;
  v_story_id     uuid;
  v_ruleset_id   uuid;
  v_title        text;
  v_kb_item      jsonb;
  v_kb_count     integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- ACL: if a partner identity is supplied, the caller must own it.
  IF p_partner_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.partner_profiles
       WHERE id = p_partner_id AND user_id = v_user_id
    ) THEN
      RAISE EXCEPTION 'partner_id % is not owned by the caller', p_partner_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Resolve the agent; only marketplace-visible agents are installable.
  SELECT pc.id, pc.slug, pc.name, pc.kind, pc.status, pc.agent_spec
    INTO v_plugin
    FROM public.plugin_catalog pc
   WHERE pc.id = p_plugin_id;

  IF v_plugin.id IS NULL THEN
    RAISE EXCEPTION 'Agent not found: %', p_plugin_id USING ERRCODE = 'P0002';
  END IF;

  IF v_plugin.kind <> 'agent' THEN
    RAISE EXCEPTION 'Plugin % is not an agent', p_plugin_id USING ERRCODE = 'P0002';
  END IF;

  IF v_plugin.status NOT IN ('canary'::public.plugin_status, 'ga'::public.plugin_status) THEN
    RAISE EXCEPTION 'Agent % is not available for install (status=%)', p_plugin_id, v_plugin.status
      USING ERRCODE = 'P0002';
  END IF;

  v_spec := v_plugin.agent_spec;
  IF v_spec IS NULL THEN
    RAISE EXCEPTION 'Agent % has no run-as-story template (call-mode only)', p_plugin_id
      USING ERRCODE = 'P0002';
  END IF;

  v_title := COALESCE(p_title, v_plugin.name, 'Agent: ' || v_plugin.slug);

  -- Resolve published rules referenced by the agent template (optional).
  v_rule_slugs := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(v_spec->'rule_slugs', '[]'::jsonb))
  );

  IF array_length(v_rule_slugs, 1) > 0 THEN
    SELECT array_agg(er.id ORDER BY er.slug),
           jsonb_object_agg(er.slug, er.version)
      INTO v_rule_ids, v_rule_versions
      FROM public.expert_rules er
     WHERE er.slug = ANY(v_rule_slugs)
       AND er.status = 'published';
  END IF;

  -- Mint the consumer-owned story.
  v_story_id := gen_random_uuid();
  INSERT INTO public.partner_stories (
    id, partner_id, user_id, title, status, priority,
    tech_stack, domain, risk_profile, origin
  ) VALUES (
    v_story_id, p_partner_id, v_user_id, v_title, 'active', 'normal',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_spec->'tech_stack', '[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_spec->'domain', '[]'::jsonb))),
    COALESCE(v_spec->>'risk_profile', 'medium'),
    'agent_install'
  );

  -- Create ruleset + context only when the agent references published rules.
  IF v_rule_ids IS NOT NULL AND array_length(v_rule_ids, 1) > 0 THEN
    SELECT 'rset:agent:' || v_plugin.slug || '-' || array_length(v_rule_ids, 1) || '-rules:'
        || md5(string_agg(er.slug || ':' || er.version::text, ',' ORDER BY er.slug))
      INTO v_fingerprint
      FROM public.expert_rules er
     WHERE er.id = ANY(v_rule_ids);

    v_ruleset_id := gen_random_uuid();
    INSERT INTO public.story_rulesets (
      id, story_id, rule_ids, rule_versions,
      context_profile, ruleset_fingerprint, created_by
    ) VALUES (
      v_ruleset_id, v_story_id, v_rule_ids, v_rule_versions,
      COALESCE(v_spec->>'context_profile', 'repo_plus_rules'),
      v_fingerprint, 'agent:' || v_plugin.slug
    );
  END IF;

  INSERT INTO public.story_contexts (story_id, ruleset_id, build_config, env_hints)
  VALUES (
    v_story_id, v_ruleset_id,
    COALESCE(v_spec->'build_config', '{}'::jsonb),
    '{}'::jsonb
  );

  -- Hydrate the agent's knowledge items under the new story_id (story-scoped,
  -- private). Per-story KB isolation then protects them from non-participants.
  FOR v_kb_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_spec->'knowledge_items', '[]'::jsonb)) AS value
  LOOP
    INSERT INTO public.knowledge_items (
      item_type, source_type, source_slug,
      title, summary, body_markdown, ai_context_tags,
      status, visibility, author_id, story_id
    ) VALUES (
      COALESCE(v_kb_item->>'item_type', 'domain_doc')::knowledge_item_type,
      'agent_install',
      v_plugin.slug,
      v_kb_item->>'title',
      v_kb_item->>'summary',
      v_kb_item->>'body_markdown',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_kb_item->'ai_context_tags', '[]'::jsonb))),
      'active',
      'private',
      v_user_id,
      v_story_id
    );
    v_kb_count := v_kb_count + 1;
  END LOOP;

  -- Audit
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'AGENT_INSTALLED', jsonb_build_object(
    'area', 'marketplace',
    'severity', 'info',
    'plugin_id', p_plugin_id,
    'slug', v_plugin.slug,
    'story_id', v_story_id,
    'partner_id', p_partner_id,
    'rule_count', COALESCE(array_length(v_rule_ids, 1), 0),
    'kb_count', v_kb_count
  ));

  RETURN jsonb_build_object(
    'story_id', v_story_id,
    'ruleset_id', v_ruleset_id,
    'plugin_id', p_plugin_id,
    'slug', v_plugin.slug,
    'rule_count', COALESCE(array_length(v_rule_ids, 1), 0),
    'kb_count', v_kb_count
  );
END;
$$;

COMMENT ON FUNCTION public.install_agent_as_story(uuid, uuid, text) IS
  'Install a published marketplace agent as a new consumer-owned story (run-as-story). Mints story + ruleset + context + story-scoped KB from agent_spec.';

REVOKE ALL ON FUNCTION public.install_agent_as_story(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.install_agent_as_story(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.install_agent_as_story(uuid, uuid, text) TO service_role;

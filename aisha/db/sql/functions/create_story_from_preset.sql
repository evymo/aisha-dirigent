-- Source of Truth: create_story_from_preset
-- Purpose: Create a new story with ruleset and context from a project preset template.
-- Used by: MCP create_story_ruleset tool, admin panel
-- Migration: 20260329100000_knowledge_project_scoping_and_presets.sql

CREATE OR REPLACE FUNCTION public.create_story_from_preset(
  p_preset_slug text,
  p_partner_id uuid,
  p_title text,
  p_repo_url text DEFAULT NULL,
  p_repo_provider text DEFAULT NULL,
  p_default_branch text DEFAULT 'main',
  p_env_hints jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_preset RECORD;
  v_user_id uuid;
  v_story_id uuid;
  v_ruleset_id uuid;
  v_rule_ids uuid[];
  v_rule_versions jsonb;
  v_fingerprint text;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  -- Load preset
  SELECT * INTO v_preset
  FROM project_presets
  WHERE slug = p_preset_slug AND is_active = true;

  IF v_preset IS NULL THEN
    RAISE EXCEPTION 'Preset not found: %', p_preset_slug USING ERRCODE = 'P0002';
  END IF;

  -- Resolve rule IDs from slugs
  SELECT
    array_agg(er.id ORDER BY er.slug),
    jsonb_object_agg(er.slug, er.version)
  INTO v_rule_ids, v_rule_versions
  FROM expert_rules er
  WHERE er.slug = ANY(v_preset.rule_slugs)
    AND er.status = 'published';

  IF v_rule_ids IS NULL OR array_length(v_rule_ids, 1) = 0 THEN
    RAISE EXCEPTION 'No published rules found for preset: %', p_preset_slug
      USING ERRCODE = 'P0002';
  END IF;

  -- Generate fingerprint
  SELECT 'rset:v3:' || p_preset_slug || '-' || array_length(v_rule_ids, 1) || '-rules:'
    || md5(string_agg(er.slug || ':' || er.version::text, ',' ORDER BY er.slug))
  INTO v_fingerprint
  FROM expert_rules er
  WHERE er.id = ANY(v_rule_ids);

  -- Create story
  v_story_id := gen_random_uuid();
  INSERT INTO partner_stories (
    id, partner_id, user_id, title, status, priority,
    repo_url, repo_provider, default_branch,
    tech_stack, domain, risk_profile, origin
  ) VALUES (
    v_story_id, p_partner_id, v_user_id, p_title, 'active', 'normal',
    p_repo_url, p_repo_provider, p_default_branch,
    v_preset.tech_stack, v_preset.domain, v_preset.risk_profile, 'preset'
  );

  -- Create ruleset
  v_ruleset_id := gen_random_uuid();
  INSERT INTO story_rulesets (
    id, story_id, rule_ids, rule_versions,
    context_profile, ruleset_fingerprint, created_by
  ) VALUES (
    v_ruleset_id, v_story_id, v_rule_ids, v_rule_versions,
    v_preset.context_profile_slug, v_fingerprint, 'preset:' || p_preset_slug
  );

  -- Create story context
  INSERT INTO story_contexts (story_id, ruleset_id, build_config, env_hints)
  VALUES (v_story_id, v_ruleset_id, v_preset.default_build_config, p_env_hints);

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'STORY_CREATED_FROM_PRESET', jsonb_build_object(
    'story_id', v_story_id,
    'preset_slug', p_preset_slug,
    'rule_count', array_length(v_rule_ids, 1),
    'severity', 'info'
  ));

  RETURN jsonb_build_object(
    'story_id', v_story_id,
    'ruleset_id', v_ruleset_id,
    'preset_slug', p_preset_slug,
    'rule_count', array_length(v_rule_ids, 1),
    'fingerprint', v_fingerprint
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_story_from_preset(text, uuid, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_story_from_preset(text, uuid, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_story_from_preset(text, uuid, text, text, text, text, jsonb) TO service_role;

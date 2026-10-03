-- Function: public.update_expert_rule_audited
-- Arguments: p_rule_id uuid, p_title text DEFAULT NULL::text, p_summary text DEFAULT NULL::text, p_body_markdown text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_expertise_area_slug text DEFAULT NULL::text, p_visibility text DEFAULT NULL::text, p_ai_instructions text DEFAULT NULL::text, p_ai_context_tags text[] DEFAULT NULL::text[], p_change_note text DEFAULT NULL::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.update_expert_rule_audited(p_rule_id uuid, p_title text DEFAULT NULL::text, p_summary text DEFAULT NULL::text, p_body_markdown text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_expertise_area_slug text DEFAULT NULL::text, p_visibility text DEFAULT NULL::text, p_ai_instructions text DEFAULT NULL::text, p_ai_context_tags text[] DEFAULT NULL::text[], p_change_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_rule record;
  v_expertise_area_id uuid;
  v_new_version int;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Must be owner
  SELECT er.* INTO v_rule
  FROM expert_rules er
  JOIN partner_profiles pp ON pp.id = er.author_partner_id
  WHERE er.id = p_rule_id AND pp.user_id = v_caller_id;

  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'Rule not found or not owned by caller';
  END IF;

  -- Resolve expertise area
  IF p_expertise_area_slug IS NOT NULL THEN
    SELECT id INTO v_expertise_area_id
    FROM guild_expertise_areas WHERE slug = p_expertise_area_slug AND is_active = true;
  ELSE
    v_expertise_area_id := v_rule.expertise_area_id;
  END IF;

  -- Create version snapshot if body changed
  IF p_body_markdown IS NOT NULL AND p_body_markdown IS DISTINCT FROM v_rule.body_markdown THEN
    v_new_version := v_rule.version + 1;

    INSERT INTO expert_rule_versions (rule_id, version_no, body_markdown, ai_instructions, change_note, created_by)
    VALUES (p_rule_id, v_new_version,
      COALESCE(p_body_markdown, v_rule.body_markdown),
      COALESCE(p_ai_instructions, v_rule.ai_instructions),
      COALESCE(p_change_note, 'Updated'),
      v_caller_id
    );
  ELSE
    v_new_version := v_rule.version;
  END IF;

  UPDATE expert_rules SET
    title = COALESCE(p_title, title),
    summary = COALESCE(p_summary, summary),
    body_markdown = COALESCE(p_body_markdown, body_markdown),
    category = COALESCE(p_category::expert_rule_category, category),
    expertise_area_id = v_expertise_area_id,
    visibility = COALESCE(p_visibility, visibility),
    ai_instructions = COALESCE(p_ai_instructions, ai_instructions),
    ai_context_tags = COALESCE(p_ai_context_tags, ai_context_tags),
    version = v_new_version
  WHERE id = p_rule_id;

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_caller_id, 'EXPERT_RULE_UPDATE', jsonb_build_object(
    'area', 'knowledge',
    'severity', 'info',
    'rule_id', p_rule_id,
    'new_version', v_new_version
  ));

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_expert_rule_audited(uuid, text, text, text, text, text, text, text, text[][], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_expert_rule_audited(uuid, text, text, text, text, text, text, text, text[][], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_expert_rule_audited(uuid, text, text, text, text, text, text, text, text[][], text) TO service_role;

-- Function: public.create_expert_rule_audited
-- Arguments: p_title text, p_slug text, p_summary text DEFAULT NULL::text, p_body_markdown text DEFAULT ''::text, p_category text DEFAULT 'other'::text, p_expertise_area_slug text DEFAULT NULL::text, p_visibility text DEFAULT 'public'::text, p_ai_instructions text DEFAULT NULL::text, p_ai_context_tags text[] DEFAULT '{}'::text[]
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.create_expert_rule_audited(p_title text, p_slug text, p_summary text DEFAULT NULL::text, p_body_markdown text DEFAULT ''::text, p_category text DEFAULT 'other'::text, p_expertise_area_slug text DEFAULT NULL::text, p_visibility text DEFAULT 'public'::text, p_ai_instructions text DEFAULT NULL::text, p_ai_context_tags text[] DEFAULT '{}'::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_partner_id uuid;
  v_expertise_area_id uuid;
  v_rule_id uuid;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Must be a partner
  SELECT id INTO v_partner_id
  FROM partner_profiles WHERE user_id = v_caller_id;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Only guild members (partners) can create rules';
  END IF;

  -- Resolve expertise area
  IF p_expertise_area_slug IS NOT NULL THEN
    SELECT id INTO v_expertise_area_id
    FROM guild_expertise_areas WHERE slug = p_expertise_area_slug AND is_active = true;
  END IF;

  INSERT INTO expert_rules (
    slug, title, summary, body_markdown, category, expertise_area_id,
    author_partner_id, visibility, ai_instructions, ai_context_tags, status
  ) VALUES (
    p_slug, p_title, p_summary, p_body_markdown, p_category::expert_rule_category,
    v_expertise_area_id, v_partner_id, p_visibility, p_ai_instructions,
    p_ai_context_tags, 'draft'
  )
  RETURNING id INTO v_rule_id;

  -- Create initial version
  INSERT INTO expert_rule_versions (rule_id, version_no, body_markdown, ai_instructions, change_note, created_by)
  VALUES (v_rule_id, 1, p_body_markdown, p_ai_instructions, 'Initial version', v_caller_id);

  -- Audit
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (v_caller_id, 'EXPERT_RULE_CREATE', jsonb_build_object(
    'area', 'knowledge',
    'severity', 'info',
    'rule_id', v_rule_id,
    'slug', p_slug
  ));

  RETURN v_rule_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_expert_rule_audited(text, text, text, text, text, text, text, text, text[][]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_expert_rule_audited(text, text, text, text, text, text, text, text, text[][]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_expert_rule_audited(text, text, text, text, text, text, text, text, text[][]) TO service_role;

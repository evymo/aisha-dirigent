-- Function: generate_default_copilot_instructions
-- Returns copilot-instructions.md content from default (public, is_default=true) rules only.
-- Accessible to anon — no authentication required.

CREATE OR REPLACE FUNCTION public.generate_default_copilot_instructions()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_md text := '';
  v_rule RECORD;
  v_cat text;
  v_cat_rules text;
  v_cat_label text;
  v_categories text[];
BEGIN
  v_md := '# Copilot Instructions — Default Standards' || E'\n\n';
  v_md := v_md || '> Auto-generated from AISHA Knowledge Base (default rule set).' || E'\n';
  v_md := v_md || '> These are generic best-practice rules available to all users.' || E'\n';
  v_md := v_md || '> For project-specific rules, connect to AISHA Cloud and use `generate_copilot_instructions(story_id)`.' || E'\n\n';
  v_md := v_md || '---' || E'\n\n';

  SELECT array_agg(DISTINCT er.category::text ORDER BY er.category::text)
  INTO v_categories
  FROM expert_rules er
  WHERE er.is_default = true
    AND er.status = 'published'
    AND er.visibility = 'public';

  IF v_categories IS NULL THEN
    v_md := v_md || '_No default rules found. Seed the database with default expert rules._' || E'\n';
    RETURN v_md;
  END IF;

  v_md := v_md || '## Expert Rules' || E'\n\n';

  FOREACH v_cat IN ARRAY v_categories
  LOOP
    v_cat_rules := '';
    v_cat_label := replace(initcap(replace(v_cat, '_', ' ')), '_', ' ');

    FOR v_rule IN
      SELECT er.slug, er.title, er.ai_instructions, er.summary
      FROM expert_rules er
      WHERE er.is_default = true
        AND er.status = 'published'
        AND er.visibility = 'public'
        AND er.category::text = v_cat
      ORDER BY er.slug
    LOOP
      -- Rule title as H4 (under H3 category)
      v_cat_rules := v_cat_rules || '#### ' || v_rule.title || E'\n\n';
      IF v_rule.ai_instructions IS NOT NULL AND v_rule.ai_instructions != '' THEN
        v_cat_rules := v_cat_rules || v_rule.ai_instructions || E'\n\n';
      ELSIF v_rule.summary IS NOT NULL THEN
        v_cat_rules := v_cat_rules || v_rule.summary || E'\n\n';
      END IF;
    END LOOP;

    IF v_cat_rules != '' THEN
      v_md := v_md || '### ' || v_cat_label || E'\n\n';
      v_md := v_md || v_cat_rules;
    END IF;
  END LOOP;

  v_md := v_md || E'\n---\n\n';
  v_md := v_md || '> **Tip:** Connect to AISHA Cloud for project-specific expert rules, automated onboarding, and full knowledge base access.' || E'\n';

  RETURN v_md;
END;
$function$;

REVOKE ALL ON FUNCTION generate_default_copilot_instructions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_default_copilot_instructions() TO anon;
GRANT EXECUTE ON FUNCTION generate_default_copilot_instructions() TO authenticated;
GRANT EXECUTE ON FUNCTION generate_default_copilot_instructions() TO service_role;

COMMENT ON FUNCTION generate_default_copilot_instructions() IS
  'Returns copilot-instructions.md from default (public) rules. No auth required.';

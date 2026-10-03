-- Function: generate_copilot_instructions
-- Fixed: uses actual expert_rule_category enum values instead of hardcoded section names

CREATE OR REPLACE FUNCTION public.generate_copilot_instructions(p_story_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_story RECORD;
  v_ruleset RECORD;
  v_rule RECORD;
  v_md text := '';
  v_cat text;
  v_cat_rules text;
  v_cat_label text;
  v_categories text[];
BEGIN
  -- Stráž (can_access_story.sql) — PŘED dohledáním, ať cizí a neexistující story vypadají stejně.
  IF NOT public.can_access_story(p_story_id) THEN
    RAISE EXCEPTION 'Access denied to story %', p_story_id USING ERRCODE = '42501';
  END IF;

  -- Load story
  SELECT ps.title, ps.tech_stack, ps.domain, ps.risk_profile
  INTO v_story
  FROM partner_stories ps
  WHERE ps.id = p_story_id;

  IF v_story IS NULL THEN
    RAISE EXCEPTION 'Story not found: %', p_story_id USING ERRCODE = 'P0002';
  END IF;

  -- Load active ruleset
  SELECT sr.ruleset_fingerprint, sr.rule_ids, sr.context_profile
  INTO v_ruleset
  FROM story_contexts sc
  JOIN story_rulesets sr ON sr.id = sc.ruleset_id
  WHERE sc.story_id = p_story_id;

  -- Header
  v_md := '# Copilot Instructions — ' || v_story.title || E'\n\n';
  v_md := v_md || '> Auto-generated from Evymo Expert Overlay ruleset.' || E'\n';
  v_md := v_md || '> **Do not edit manually** — regenerate via `generate_copilot_instructions(story_id)`.' || E'\n\n';

  -- Project metadata
  v_md := v_md || '## 🎯 Project' || E'\n\n';
  v_md := v_md || '**Tech Stack:** ' || COALESCE(array_to_string(v_story.tech_stack, ', '), 'Not specified') || E'\n';
  v_md := v_md || '**Domain:** ' || COALESCE(array_to_string(v_story.domain, ', '), 'General') || E'\n';
  v_md := v_md || '**Risk Profile:** ' || COALESCE(v_story.risk_profile, 'low') || E'\n\n';

  IF v_ruleset.ruleset_fingerprint IS NOT NULL THEN
    v_md := v_md || '**Ruleset Fingerprint:** `' || v_ruleset.ruleset_fingerprint || '`' || E'\n';
    v_md := v_md || '**Context Profile:** ' || COALESCE(v_ruleset.context_profile, 'repo_plus_rules') || E'\n\n';
  END IF;

  v_md := v_md || '---' || E'\n\n';

  -- If no ruleset, return minimal
  IF v_ruleset.rule_ids IS NULL THEN
    v_md := v_md || '_No ruleset pinned to this story. Pin rules via `create_story_ruleset(story_id, rule_ids[])`._' || E'\n';
    RETURN v_md;
  END IF;

  -- Group rules by actual categories present in the ruleset
  v_md := v_md || '## ⚠️ Expert Rules' || E'\n\n';

  -- Dynamically get distinct categories from the pinned rules
  SELECT array_agg(DISTINCT er.category::text ORDER BY er.category::text)
  INTO v_categories
  FROM expert_rules er
  WHERE er.id = ANY(v_ruleset.rule_ids)
    AND er.status = 'published'
    AND er.visibility IN ('public', 'members');

  IF v_categories IS NOT NULL THEN
    FOREACH v_cat IN ARRAY v_categories
    LOOP
      v_cat_rules := '';

      -- Human-readable category label
      v_cat_label := replace(initcap(replace(v_cat, '_', ' ')), '_', ' ');

      FOR v_rule IN
        SELECT er.slug, er.title, er.category::text, er.ai_instructions, er.summary
        FROM expert_rules er
        WHERE er.id = ANY(v_ruleset.rule_ids)
          AND er.status = 'published'
          AND er.visibility IN ('public', 'members')
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
  END IF;

  v_md := v_md || E'\n---\n\n';

  -- Footer
  v_md := v_md || E'## 📋 PR Checklist\n\n';
  v_md := v_md || '- [ ] All expert rules followed' || E'\n';
  v_md := v_md || '- [ ] `npm run test` — passing' || E'\n';
  v_md := v_md || '- [ ] `npm run build` — successful' || E'\n';
  v_md := v_md || '- [ ] `npm run lint` — no errors' || E'\n';
  v_md := v_md || '- [ ] No hardcoded text in JSX (use i18n)' || E'\n';
  v_md := v_md || '- [ ] No `any` types' || E'\n';
  v_md := v_md || '- [ ] No `console.log` in production code' || E'\n';

  RETURN v_md;
END;
$function$;

REVOKE ALL ON FUNCTION generate_copilot_instructions(p_story_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_copilot_instructions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_copilot_instructions(uuid) TO service_role;

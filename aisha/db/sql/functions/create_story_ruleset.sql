-- Function: public.create_story_ruleset
-- Arguments: p_story_id uuid, p_rule_ids uuid[], p_context_profile text DEFAULT 'repo_plus_rules'::text
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.create_story_ruleset(p_story_id uuid, p_rule_ids uuid[], p_context_profile text DEFAULT 'repo_plus_rules'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sorted_ids uuid[];
  v_versions jsonb := '{}'::jsonb;
  v_fingerprint_input text := '';
  v_fingerprint text;
  v_ruleset_id uuid;
  v_rule RECORD;
  v_rule_count int := 0;
BEGIN
  -- Authorization: must be admin/staff or story owner
  IF NOT public.is_admin_or_staff() AND NOT public.can_manage_project_story(p_story_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.partner_stories
      WHERE id = p_story_id AND partner_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Unauthorized: not story owner or admin/staff';
    END IF;
  END IF;

  -- Sort rule IDs for deterministic fingerprint
  -- Do rulesetu jen pravidlo, které volající SMÍ vidět (2026-10-05, revize B1). Do té doby šlo přidat
  -- jakékoli publikované pravidlo podle id — i soukromé nebo jen pro gildu — a přečíst ho pak čtenáři
  -- rulesetu. Pravidlo, které volající nevidí, se nepřeskakuje potichu: celé volání skončí 42501.
  IF EXISTS (
    SELECT 1 FROM public.expert_rules er
     WHERE er.id = ANY(p_rule_ids)
       AND NOT public.expert_rule_visible_to(er.visibility, er.author_partner_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'Rule not visible to the caller — cannot be pinned to the story ruleset'
      USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_sorted_ids
  FROM unnest(p_rule_ids) AS id;

  -- Collect current versions and their content_hash from published rules
  FOR v_rule IN
    SELECT 
      er.id, 
      er.version,
      COALESCE(erv.content_hash, encode(digest(er.body_markdown || COALESCE(er.ai_instructions, ''), 'sha256'), 'hex')) as hash
    FROM public.expert_rules er
    LEFT JOIN public.expert_rule_versions erv ON erv.rule_id = er.id AND erv.version_no = er.version
    WHERE er.id = ANY(v_sorted_ids) AND er.status = 'published'
      AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, auth.uid())
    ORDER BY er.id
  LOOP
    v_versions := v_versions || jsonb_build_object(v_rule.id::text, v_rule.version);
    -- Payload (v2) for content_fingerprint: (rule_id, version, content_hash)
    v_fingerprint_input := v_fingerprint_input || v_rule.id::text || ':' || v_rule.version::text || ':' || v_rule.hash || '|';
    v_rule_count := v_rule_count + 1;
  END LOOP;

  -- Require at least one valid published rule
  IF v_rule_count = 0 THEN
    RAISE EXCEPTION 'No published rules found for the given IDs';
  END IF;

  -- sha256 fingerprint (pgcrypto) incorporating v2 logic
  v_fingerprint := 'rset:v2:' || encode(digest(v_fingerprint_input, 'sha256'), 'hex');

  -- Insert ruleset record
  INSERT INTO public.story_rulesets (story_id, ruleset_fingerprint, rule_ids, rule_versions, context_profile)
  VALUES (p_story_id, v_fingerprint, v_sorted_ids, v_versions, p_context_profile)
  RETURNING id INTO v_ruleset_id;

  -- Upsert story_contexts to link the new ruleset
  INSERT INTO public.story_contexts (story_id, ruleset_id)
  VALUES (p_story_id, v_ruleset_id)
  ON CONFLICT (story_id) DO UPDATE
    SET ruleset_id = v_ruleset_id, updated_at = now();

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'STORY_RULESET_CREATED',
    jsonb_build_object(
      'area', 'ai',
      'severity', 'info',
      'story_id', p_story_id,
      'ruleset_id', v_ruleset_id,
      'fingerprint', v_fingerprint,
      'rule_count', v_rule_count
    )
  );

  RETURN jsonb_build_object(
    'ruleset_id', v_ruleset_id,
    'fingerprint', v_fingerprint,
    'rule_count', v_rule_count,
    'versions', v_versions
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_story_ruleset(uuid, uuid[][], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_story_ruleset(uuid, uuid[][], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_story_ruleset(uuid, uuid[][], text) TO service_role;

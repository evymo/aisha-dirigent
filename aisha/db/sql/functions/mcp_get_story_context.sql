-- Function: public.mcp_get_story_context
-- Arguments: p_story_id uuid
-- Security: SECURITY DEFINER — stráž příběhu public.can_access_story PŘED dohledáním
-- Source: Extracted from local DB (source-of-truth sync)
--
-- ⛔ NAMĚŘENO 2026-10-05 (nezávislá revize nad mainem 8b7637acc): funkce příběh nekontrolovala
-- vůbec — KAŽDÝ přihlášený dostal podle id metadata CIZÍHO příběhu: repo (repo_url, provider,
-- větev), účastníky (user_id, role), env_hints, build_config a mcp_endpoint. Teď jen ten, koho
-- pustí jediný predikát příběhu can_access_story: vlastník, účastník, správa a služba (strojová
-- lane). Stráž běží PŘED dohledáním, takže cizí i neexistující příběh vrací totéž (42501) — funkce
-- není orákulem existence příběhu. Služba na neexistující příběh dál dostane {"error": "Story not
-- found"} (pro ni stráž projde). Měří src/tests/db/pribeh-a-beh-cteni-podle-id.runtime.test.ts.

CREATE OR REPLACE FUNCTION public.mcp_get_story_context(p_story_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- Stráž (can_access_story.sql) — PŘED dohledáním, ať cizí a neexistující příběh vypadají stejně.
  IF NOT public.can_access_story(p_story_id) THEN
    RAISE EXCEPTION 'Access denied to story %', p_story_id USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'story', jsonb_build_object(
      'id', ps.id,
      'title', ps.title,
      'status', ps.status,
      'delivery_status', ps.delivery_status,
      'repo_url', ps.repo_url,
      'repo_provider', ps.repo_provider,
      'default_branch', ps.default_branch,
      'tech_stack', ps.tech_stack,
      'domain', ps.domain,
      'project_preview', ps.project_preview,
      'risk_profile', ps.risk_profile,
      'origin', ps.origin
    ),
    'project_preview', ps.project_preview,
    'ruleset', CASE WHEN sr.id IS NOT NULL THEN jsonb_build_object(
      'id', sr.id,
      'fingerprint', sr.ruleset_fingerprint,
      'rule_count', array_length(sr.rule_ids, 1),
      'context_profile', sr.context_profile,
      'rule_versions', sr.rule_versions,
      'created_at', sr.created_at
    ) ELSE NULL END,
    'build_config', COALESCE(sc.build_config, '{}'::jsonb),
    'env_hints', COALESCE(sc.env_hints, '{}'::jsonb),
    'mcp_endpoint', sc.mcp_endpoint,
    'participants', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'user_id', sp.user_id,
        'role', sp.role,
        'joined_at', sp.joined_at
       ))
       FROM public.story_participants sp WHERE sp.story_id = ps.id),
      '[]'::jsonb
    ),
    'rules_preview', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', er.id,
        'slug', er.slug,
        'title', er.title,
        'category', er.category,
        'version', er.version
       ))
       FROM unnest(sr.rule_ids) AS rid
       JOIN public.expert_rules er ON er.id = rid
       WHERE er.status = 'published'
         AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, auth.uid())),
      '[]'::jsonb
    )
  ) INTO v_result
  FROM public.partner_stories ps
  LEFT JOIN public.story_contexts sc ON sc.story_id = ps.id
  LEFT JOIN public.story_rulesets sr ON sr.id = sc.ruleset_id
  WHERE ps.id = p_story_id;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'Story not found', 'story_id', p_story_id);
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_get_story_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_story_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_get_story_context(uuid) TO service_role;

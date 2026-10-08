-- Function: mcp_get_knowledge_item

-- PRO KOHO se čte (stejný vzor jako hledání v2/v3): jen služba smí říct, za koho čte
-- (p_audience_user_id); přihlášený je připnutý na sebe a cizí publikum od něj se ignoruje;
-- anonym a služba bez publika jsou bez identity. Do 2026-10-04 funkce parametr publika neměla
-- a četla auth.uid() — nástroj MCP ji ale volá servisní rolí, takže KAŽDÝ uživatel MCP četl
-- podle id jako anonym: úroveň členství se neuznala a položku vlastního příběhu nedostal.
--
-- Viditelnost (2026-10-05): jeden domov public.knowledge_visibility_searchable pro toho, PRO KOHO
-- se čte — bez identity jen `public`, přihlášenému `members`, gildě `guild`. Správa (podle publika)
-- čte i `private`: do 2026-10-05 tu stál vlastní výčet ('public', 'members') pro všechny, takže
-- `members` šlo anonymovi a správa soukromou položku podle id nedostala (změřeno: 0).
-- Položka příběhu podle pravidel příběhu (vlastník, účastník, správa) — viditelnost u ní nerozhoduje,
-- stejně jako v hledání v2 a v politice tabulky pro účastníky.
--
-- Signatura se mění výměnou: dvě přetížení lišící se jen parametrem s výchozí hodnotou by
-- znamenala, že volání dvěma jmennými parametry skončí „is not unique“ (poučení z hledání v2).
DROP FUNCTION IF EXISTS public.mcp_get_knowledge_item(uuid, text);

CREATE OR REPLACE FUNCTION public.mcp_get_knowledge_item(p_item_id uuid DEFAULT NULL::uuid, p_source_slug text DEFAULT NULL::text, p_audience_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_caller_role text;
  v_audience_user uuid;  -- pro koho se čte (služba smí říct; jinak volající sám; bez identity NULL)
  v_in_guild boolean;    -- má ten, pro koho se čte, profil partnera (viditelnost `guild`)
  v_is_admin boolean;    -- je ten, pro koho se čte, správa (čte vše, i soukromé)
BEGIN
  v_caller_role := public.get_jwt_role();
  v_audience_user := CASE
    WHEN v_caller_role = 'service_role' THEN COALESCE(p_audience_user_id, auth.uid())
    ELSE auth.uid()
  END;
  -- Počítá se JEDNOU a z toho, PRO KOHO se čte; bez identity obojí false.
  v_in_guild := public.knowledge_audience_in_guild(v_audience_user);
  v_is_admin := COALESCE(public.is_admin_or_staff(v_audience_user), false);

  SELECT jsonb_build_object(
    'id', ki.id,
    'item_type', ki.item_type::text,
    'source_type', ki.source_type,
    'source_slug', ki.source_slug,
    'title', ki.title,
    'summary', ki.summary,
    'body_markdown', ki.body_markdown,
    'ai_instructions', ki.ai_instructions,
    'ai_context_tags', ki.ai_context_tags,
    'category', ki.category,
    'expertise_area_slug', gea.slug,
    'expertise_area_icon', gea.icon,
    'author_display_name', ki.author_display_name,
    'is_verified', ki.is_verified,
    'version', ki.version,
    'usage_count', ki.usage_count,
    'rating_avg', ki.rating_avg,
    'published_at', ki.published_at,
    'updated_at', ki.updated_at,
    'chunks', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'chunk_index', kc.chunk_index,
        'chunk_text', kc.chunk_text,
        'section_title', kc.section_title,
        'token_count', kc.token_count,
        'has_embedding', EXISTS(
          SELECT 1 FROM knowledge_embeddings ke WHERE ke.chunk_id = kc.id
        )
      ) ORDER BY kc.chunk_index)
      FROM knowledge_chunks kc
      WHERE kc.knowledge_item_id = ki.id),
      '[]'::jsonb
    ),
    'bindings', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'target_type', rb.target_type::text,
        'binding_type', rb.binding_type,
        'priority', rb.priority
      ))
      FROM rule_bindings rb
      WHERE rb.rule_id = ki.source_id AND rb.is_active = true),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM knowledge_items ki
  LEFT JOIN guild_expertise_areas gea ON gea.id = ki.expertise_area_id
  WHERE ki.status = 'active'
    -- Jen čitelný stav: položku v karanténě ani nezměřenou nevydá ani dotaz na id/slug.
    AND public.knowledge_state_readable(ki.quarantine_status)
    -- Brick6 tier-ACL: úroveň členství se měří u toho, PRO KOHO se čte — tvrdý filtr jako
    -- v hledání v2/v3. Bez identity (anonym, služba bez publika) projde jen položka bez úrovně.
    AND (
      ki.minimum_tier IS NULL
      OR public.audience_user_meets_tier_requirement(ki.minimum_tier, v_audience_user)
    )
    -- Kdo položku dostane — podle toho, PRO KOHO se čte:
    --  · správa: vše (i `private`);
    --  · globální položka: podle viditelnosti z JEDNOHO domova (žádný vlastní výčet);
    --  · položka příběhu: vlastník a účastník. Položka příběhu má výchozí viditelnost 'public'
    --    (upsert_story_knowledge_item_audited), takže viditelnost u ní rozhodovat NESMÍ — vydala by
    --    komukoli celé tělo, pokyny i úryvky cizího příběhu.
    -- Servisní role tu ŽÁDNOU výjimku nemá: bez publika zbývají jen globální položky `public`.
    AND (
      v_is_admin
      OR (ki.story_id IS NULL AND public.knowledge_visibility_searchable(ki.visibility, v_audience_user IS NOT NULL, v_in_guild))
      OR EXISTS (
        SELECT 1 FROM partner_stories ps
        WHERE ps.id = ki.story_id AND ps.user_id = v_audience_user
      )
      OR EXISTS (
        SELECT 1 FROM story_participants sp
        WHERE sp.story_id = ki.story_id AND sp.user_id = v_audience_user
      )
    )
    AND (
      (p_item_id IS NOT NULL AND ki.id = p_item_id)
      OR (p_source_slug IS NOT NULL AND ki.source_slug = p_source_slug)
    );

  -- Track usage
  IF v_result IS NOT NULL THEN
    UPDATE knowledge_items SET usage_count = usage_count + 1
    WHERE id = (v_result->>'id')::uuid;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION mcp_get_knowledge_item(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_get_knowledge_item(uuid, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION mcp_get_knowledge_item(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_get_knowledge_item(uuid, text, uuid) TO service_role;

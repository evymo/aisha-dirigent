CREATE OR REPLACE FUNCTION public.fn_search_personality_context(
  p_user_id uuid DEFAULT NULL,
  p_query_embedding vector(1024) DEFAULT NULL,
  p_limit integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_base_traits jsonb;
  v_experiential jsonb;
  v_merged jsonb;
  v_effective_user_id uuid;
  -- PRO KOHO se čte základní vrstva rysů (viditelnost): služba / správa jmenuje p_user_id, jinak volající sám.
  v_audience_user uuid;
  v_in_guild boolean;
  v_is_admin boolean;
BEGIN
  -- Auth: ensure caller is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- IDOR guard: resolve effective user id before any user-scoped read
  IF public.is_service_role() OR public.is_admin_or_staff() THEN
    v_effective_user_id := p_user_id;
  ELSE
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    v_effective_user_id := auth.uid();
  END IF;

  -- Viditelnost základních rysů (2026-10-05): jeden domov public.knowledge_visibility_searchable pro toho,
  -- PRO KOHO se čte. Do 2026-10-05 funkce viditelnost nečetla — přihlášený dostal i soukromý globální rys.
  -- Služba za uživatele měří jeho (p_user_id; bez něj je bez identity), správa bez p_user_id sebe.
  v_audience_user := CASE WHEN public.is_service_role() THEN p_user_id ELSE COALESCE(v_effective_user_id, auth.uid()) END;
  v_in_guild := public.knowledge_audience_in_guild(v_audience_user);
  v_is_admin := COALESCE(public.is_admin_or_staff(v_audience_user), false);

  -- -----------------------------------------------------------------------
  -- A) Base traits (DNA) — always included, from knowledge_items
  --    If embedding provided: score by cosine similarity + bonus 0.2
  --    If no embedding: return all base traits with score 1.0 (DNA is core)
  -- -----------------------------------------------------------------------
  IF p_query_embedding IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(sub.obj ORDER BY sub.score DESC), '[]'::jsonb)
    INTO v_base_traits
    FROM (
      SELECT
        jsonb_build_object(
          'trait_id', ki.id,
          'source', 'base',
          'slug', ki.source_slug,
          'title', ki.title,
          'content', ki.body_markdown,
          'ai_instructions', ki.ai_instructions,
          'tags', ki.ai_context_tags,
          'score', round((
            LEAST(1.0, (1 - (ke.embedding <=> p_query_embedding)) + 0.2)
          )::numeric, 4)
        ) AS obj,
        LEAST(1.0, (1 - (ke.embedding <=> p_query_embedding)) + 0.2) AS score
      FROM knowledge_items ki
      JOIN knowledge_chunks kc ON kc.knowledge_item_id = ki.id
      JOIN knowledge_embeddings ke ON ke.chunk_id = kc.id
      WHERE ki.item_type = 'personality_trait'
        AND ki.status = 'active'
        -- Jen GLOBÁLNÍ rysy: rys založený v příběhu není osobnost všech.
        AND ki.story_id IS NULL
        -- Jen čitelný stav (allowlist): rys v karanténě, nezměřený ani v neznámém
        -- stavu se do osobnosti agenta nedostane. Do 2026-10-04 tu filtr nebyl vůbec.
        AND public.knowledge_state_readable(ki.quarantine_status)
        -- Viditelnost z jednoho domova pro toho, pro koho se čte; správa vidí vše.
        AND (v_is_admin OR public.knowledge_visibility_searchable(ki.visibility, v_audience_user IS NOT NULL, v_in_guild))
        AND ke.embedding IS NOT NULL
      ORDER BY score DESC
      LIMIT p_limit
    ) sub;
  ELSE
    -- No embedding: return all base traits with max score
    SELECT COALESCE(jsonb_agg(sub.obj ORDER BY ki_title), '[]'::jsonb)
    INTO v_base_traits
    FROM (
      SELECT
        jsonb_build_object(
          'trait_id', ki.id,
          'source', 'base',
          'slug', ki.source_slug,
          'title', ki.title,
          'content', ki.body_markdown,
          'ai_instructions', ki.ai_instructions,
          'tags', ki.ai_context_tags,
          'score', 1.0
        ) AS obj,
        ki.title AS ki_title
      FROM knowledge_items ki
      WHERE ki.item_type = 'personality_trait'
        AND ki.status = 'active'
        -- Jen GLOBÁLNÍ rysy: rys založený v příběhu není osobnost všech.
        AND ki.story_id IS NULL
        -- Tatáž podmínka jako ve větvi s embeddingem — obě větve, ne jedna.
        AND public.knowledge_state_readable(ki.quarantine_status)
        AND (v_is_admin OR public.knowledge_visibility_searchable(ki.visibility, v_audience_user IS NOT NULL, v_in_guild))
    ) sub;
  END IF;

  -- -----------------------------------------------------------------------
  -- B) Experiential traits — user-scoped from agent_memories
  --    Only if user_id provided and embedding available
  -- -----------------------------------------------------------------------
  IF p_user_id IS NOT NULL AND p_query_embedding IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(sub.obj ORDER BY sub.score DESC), '[]'::jsonb)
    INTO v_experiential
    FROM (
      SELECT
        jsonb_build_object(
          'trait_id', am.id,
          'source', 'experiential',
          'slug', NULL,
          'title', 'Experiential: ' || am.agent_slug,
          'content', am.content,
          'ai_instructions', NULL,
          'tags', ARRAY['personality', 'experiential'],
          'score', round((
            (1 - (am.embedding <=> p_query_embedding)) * 0.6
            + (am.importance / 10.0) * 0.4
          )::numeric, 4)
        ) AS obj,
        (1 - (am.embedding <=> p_query_embedding)) * 0.6
          + (am.importance / 10.0) * 0.4
        AS score
      FROM agent_memories am
      WHERE am.memory_type = 'personality'
        AND am.user_id = v_effective_user_id
        AND am.embedding IS NOT NULL
        AND am.importance >= 3
        AND (am.expires_at IS NULL OR am.expires_at > now())
      ORDER BY score DESC
      LIMIT GREATEST(1, p_limit / 3)  -- experiential gets ~1/3 of budget
    ) sub;
  ELSE
    v_experiential := '[]'::jsonb;
  END IF;

  -- -----------------------------------------------------------------------
  -- C) Merge: base traits first (DNA dominates), then experiential
  -- -----------------------------------------------------------------------
  SELECT jsonb_agg(elem ORDER BY (elem->>'score')::numeric DESC)
  INTO v_merged
  FROM (
    SELECT jsonb_array_elements(v_base_traits) AS elem
    UNION ALL
    SELECT jsonb_array_elements(v_experiential) AS elem
  ) combined;

  RETURN COALESCE(v_merged, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_search_personality_context(uuid, vector, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_search_personality_context(uuid, vector, integer) TO authenticated;

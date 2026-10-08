-- Function: mcp_search_knowledge_v2
-- Brick6: the story overload gained p_audience_user_id (10→11 args). DROP the old 10-arg story
-- overload so it cannot linger WITHOUT the tier-ACL (CREATE OR REPLACE only replaces an exact
-- signature match; the 11-arg is a NEW function).
--
-- ⛔ PODMÍNKA VOLAJÍCÍHO (K-35, 2026-10-01): kontrola přístupu k p_story_id platí jen pro
-- authenticated — pod service_role se PŘESKAKUJE. Kdo volá pod službou s p_story_id, MUSÍ mít
-- příběh ověřený PŘED voláním (can_access_story pod koncovým uživatelem), jinak funkce vydá KB
-- cizího příběhu. Uživatelské cesty proto volají identitou uživatele (B8); pod definerem jen
-- compose_context, který žadatele ověří předem. Výčet volajících drží brána
-- kb-pribeh-jen-pod-uzivatelem. (Textová záloha vektorového hledání v svc-mcp-knowledge byla
-- 2026-10-06 zrušena — hledání bez embeddingu selže nahlas, P2.)
DROP FUNCTION IF EXISTS public.mcp_search_knowledge_v2(vector,text,text[],text,text,text[],boolean,integer,double precision,uuid);
-- JEDNO přetížení (2026-10-04). Vedle tohohle žilo 9argumentové „globální“ přetížení. Lišilo se
-- jen dvěma parametry s výchozí hodnotou, takže KAŽDÉ volání bez p_story_id / p_audience_user_id
-- — poziční i jmenné — skončilo „function … is not unique“ (změřeno na PG 18): nešlo zavolat ono
-- a tahle funkce šla zavolat jen se jmenovaným p_story_id nebo p_audience_user_id. Volání bez
-- příběhu teď obsluhuje tahle funkce: p_story_id NULL ⇒ jen globální položky.
-- DROP přesnou signaturou — CREATE OR REPLACE níž jinou signaturu nenahradí.
DROP FUNCTION IF EXISTS public.mcp_search_knowledge_v2(vector,text,text[],text,text,text[],boolean,integer,double precision);

CREATE OR REPLACE FUNCTION public.mcp_search_knowledge_v2(p_query_embedding vector DEFAULT NULL::vector, p_query_text text DEFAULT NULL::text, p_item_types text[] DEFAULT '{}'::text[], p_category text DEFAULT NULL::text, p_expertise_slug text DEFAULT NULL::text, p_context_tags text[] DEFAULT '{}'::text[], p_include_ai_instructions boolean DEFAULT true, p_limit integer DEFAULT 20, p_similarity_threshold double precision DEFAULT 0.3, p_story_id uuid DEFAULT NULL::uuid, p_audience_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_results jsonb;
  v_words text[];
  v_caller_role text;
  v_caller_id uuid;
  v_audience_user uuid;  -- Brick6: end-user whose tier gates retrieval (service may override; else self)
  v_in_guild boolean;    -- má ten, pro koho se hledá, profil partnera (viditelnost `guild`)
BEGIN
  v_caller_role := public.get_jwt_role();
  v_caller_id := auth.uid();

  -- ── RBAC: Per-story access check ───────────────────────────────────────
  -- service_role bypasses (used by compose_context, n8n internal workflows).
  -- Any other caller asking for a specific story must be admin/owner/participant.
  IF p_story_id IS NOT NULL AND v_caller_role IS DISTINCT FROM 'service_role' THEN
    IF NOT (
      public.is_admin_or_staff()
      OR EXISTS (
        SELECT 1 FROM public.partner_stories ps
        WHERE ps.id = p_story_id AND ps.user_id = v_caller_id
      )
      OR EXISTS (
        SELECT 1 FROM public.story_participants sp
        WHERE sp.story_id = p_story_id AND sp.user_id = v_caller_id
      )
    ) THEN
      RAISE EXCEPTION 'Access denied to story %', p_story_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Brick6 tier-ACL audience identity: only service_role (trusted orchestration) may name a
  -- different end-user via p_audience_user_id; authenticated callers are pinned to themselves.
  v_audience_user := CASE
    WHEN v_caller_role = 'service_role' THEN COALESCE(p_audience_user_id, auth.uid())
    ELSE auth.uid()
  END;
  -- Gilda = kdo má profil partnera (totéž pravidlo jako get_expert_rules). Počítá se JEDNOU
  -- a z toho, PRO KOHO se hledá; bez identity false — ani služba bez publika `guild` nedostane.
  v_in_guild := public.knowledge_audience_in_guild(v_audience_user);

  -- Split query text into individual words (min 2 chars)
  IF p_query_text IS NOT NULL AND trim(p_query_text) != '' THEN
    v_words := ARRAY(
      SELECT w FROM unnest(regexp_split_to_array(lower(trim(p_query_text)), '\s+')) AS w
      WHERE length(w) >= 2
    );
    IF array_length(v_words, 1) IS NULL THEN
      v_words := NULL;
    END IF;
  ELSE
    v_words := NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(result_row ORDER BY (result_row->>'score')::float DESC), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT jsonb_build_object(
      'knowledge_item_id', ki.id,
      'item_type', ki.item_type::text,
      'source_slug', ki.source_slug,
      'story_id', ki.story_id,
      'title', ki.title,
      'summary', ki.summary,
      'category', ki.category,
      'expertise_area_slug', gea.slug,
      'expertise_area_icon', gea.icon,
      'author_display_name', ki.author_display_name,
      'is_verified', ki.is_verified,
      'ai_context_tags', ki.ai_context_tags,
      'ai_instructions', CASE WHEN p_include_ai_instructions THEN ki.ai_instructions ELSE NULL END,
      'chunk_text', kc.chunk_text,
      'chunk_index', kc.chunk_index,
      -- Brick3 locale axis: surfaced for downstream consumers only. NO locale
      -- WHERE filter and NO locale score term — retrieval is byte-identical today.
      'locale', kc.locale,
      'similarity', CASE WHEN p_query_embedding IS NOT NULL AND ke.embedding IS NOT NULL
        THEN 1 - (ke.embedding <=> p_query_embedding)
        ELSE NULL END,
      'version', ki.version,
      'published_at', ki.published_at,
      'score', (
        CASE WHEN p_query_embedding IS NOT NULL AND ke.embedding IS NOT NULL
          THEN (1 - (ke.embedding <=> p_query_embedding)) * 40
          ELSE 0 END
        +
        CASE WHEN p_context_tags != '{}' AND ki.ai_context_tags && p_context_tags
          THEN COALESCE(array_length(
            ARRAY(SELECT unnest(ki.ai_context_tags) INTERSECT SELECT unnest(p_context_tags)),
            1
          ), 0) * 10
          ELSE 0 END
        +
        CASE WHEN v_words IS NOT NULL THEN
          (SELECT count(*)::int FROM unnest(v_words) AS word
           WHERE ki.title ILIKE '%' || word || '%'
              OR ki.summary ILIKE '%' || word || '%'
          ) * 15
          ELSE 0
        END
        +
        -- ZNĚNÍ dokumentu, ne jen jeho popisky. Do 2026-07-30 lexikální větev
        -- prohledávala pouze title + summary; chunky se připojovaly jen kvůli
        -- výstupu, takže dotaz na formulaci ZE SMLOUVY nenašel nic, dokud ji
        -- někdo neopsal do shrnutí. S prázdnou vektorovou vrstvou (naměřeno:
        -- 4 292 chunků / 0 embeddingů) tím retrieval prakticky nefungoval.
        --
        -- norm_text() na obou stranách = tentýž výraz jako v indexu
        -- idx_knowledge_chunks_text_trgm, jinak by se index nepoužil. Skládá
        -- diakritiku i velikost písmen; LIKE nad trigramovým GIN indexem snese
        -- i české skloňování (shodný kmen), což `simple` tsvector neumí a
        -- český slovník na serveru není.
        --
        -- Váha 8 < 15 záměrně: shoda v nadpisu je silnější signál než výskyt
        -- slova kdesi v těle dokumentu.
        CASE WHEN v_words IS NOT NULL AND kc.chunk_text IS NOT NULL THEN
          (SELECT count(*)::int FROM unnest(v_words) AS word
           WHERE public.norm_text(kc.chunk_text) LIKE '%' || public.norm_text(word) || '%'
          ) * 8
          ELSE 0
        END
        +
        CASE WHEN ki.is_verified THEN 5 ELSE 0 END
        +
        -- Per-story bonus: items scoped to current story rank above global
        CASE WHEN p_story_id IS NOT NULL AND ki.story_id = p_story_id THEN 25 ELSE 0 END
      )
    ) AS result_row
    FROM public.knowledge_items ki
    LEFT JOIN public.knowledge_chunks kc ON kc.knowledge_item_id = ki.id
    LEFT JOIN public.knowledge_embeddings ke ON ke.chunk_id = kc.id
    LEFT JOIN public.guild_expertise_areas gea ON gea.id = ki.expertise_area_id
    WHERE ki.status = 'active'
      -- ── Viditelnost: TÁŽ pravidla, jaká deklaruje sama tabulka ──────────────
      -- Do 2026-07-30 tu stál paušál `visibility IN (public, members, guild)`.
      -- Byl PŘÍSNĚJŠÍ než RLS politika knowledge_items a odřízl přesně to, co
      -- máme: interní smlouvy jsou `private` a story-scoped, takže z nich
      -- retrieval nevrátil NIKDY nic (naměřeno: všech 4 292 chunků leží pod
      -- private+story; 791 „public" položek nemá ani jeden chunk).
      --
      -- Tohle NENÍ rozvolnění přístupu. Politika čtení pro účastníky příběhu
      -- (knowledge_items_story_participants_read) o `visibility` vůbec nemluví — pouští vlastníka story,
      -- jejího účastníka a admin/staff. `private` tedy vylučuje z VEŘEJNÉ
      -- politiky, ne z oprávněných čtenářů. Definer funkce si vedle toho psala
      -- druhé, vlastní pravidlo — a dvě pravidla o jedné věci se rozešla.
      --
      -- Vyhodnocuje se proti v_audience_user (Brick6): service_role smí říct,
      -- ZA KOHO se ptá, jinak je to volající sám. Bez identity zbývá jen
      -- veřejná/globální vrstva — fail-closed, žádný service_role bypass.
      AND (
        -- Které viditelnosti se vydají bez přístupu přes příběh či správu, má jeden domov — pro TOHO,
        -- PRO KOHO se hledá: bez identity (anonym, služba bez publika) jen `public`, přihlášenému
        -- navíc `members`, gildě `guild` (rozhodnutí majitele 2026-10-04: nepřihlášený vidí jen public).
        -- Zásady a rysy osobnosti NEMAJÍ výjimku podle typu: do 2026-10-05 tu stála větev podle
        -- typu položky, která globální zásadu či rys vydala s jakoukoli viditelností (i soukromou)
        -- komukoli, i anonymovi. Štítek viditelnosti znamená všude totéž.
        (ki.story_id IS NULL AND public.knowledge_visibility_searchable(ki.visibility, v_audience_user IS NOT NULL, v_in_guild))
        OR public.is_admin_or_staff(v_audience_user)
        OR EXISTS (
          SELECT 1 FROM public.partner_stories ps
          WHERE ps.id = ki.story_id AND ps.user_id = v_audience_user
        )
        OR EXISTS (
          SELECT 1 FROM public.story_participants sp
          WHERE sp.story_id = ki.story_id AND sp.user_id = v_audience_user
        )
      )
      -- Systemic safety: items that are not in a readable state (prompt-injected, unscanned)
      -- never reach retrieval.
      -- Allowlist (2026-10-04): čitelný stav má jeden domov. Výčet zakázaných stavů
      -- pouštěl položku nezměřenou i každý budoucí stav.
      AND public.knowledge_state_readable(ki.quarantine_status)
      AND (p_item_types = '{}' OR ki.item_type::text = ANY(p_item_types))
      AND (p_category IS NULL OR ki.category = p_category)
      AND (p_expertise_slug IS NULL OR gea.slug = p_expertise_slug)
      AND (
        p_query_embedding IS NULL
        OR ke.embedding IS NULL
        OR (1 - (ke.embedding <=> p_query_embedding)) >= p_similarity_threshold
      )
      AND (
        p_query_embedding IS NOT NULL
        OR (v_words IS NOT NULL AND EXISTS (
          SELECT 1 FROM unnest(v_words) AS word
          WHERE ki.title ILIKE '%' || word || '%'
             OR ki.summary ILIKE '%' || word || '%'
        ))
        -- Bez tohohle by dokument, jehož ZNĚNÍ dotazu odpovídá, nebyl vůbec
        -- kandidátem — skóre výš by se na něj nikdy nedostalo.
        OR (v_words IS NOT NULL AND kc.chunk_text IS NOT NULL AND EXISTS (
          SELECT 1 FROM unnest(v_words) AS word
          WHERE public.norm_text(kc.chunk_text) LIKE '%' || public.norm_text(word) || '%'
        ))
        OR p_context_tags != '{}'
        OR (p_item_types != '{}')
      )
      -- ── Per-story isolation filter ───────────────────────────────────
      -- p_story_id NULL → only global items (story_id IS NULL).
      -- p_story_id NOT NULL → matching story + global items.
      -- Vrstva mozku (zásady, rysy osobnosti) tu výjimku nemá: globální položka projde podle
      -- viditelnosti výš, položka příběhu podle přístupu k příběhu. Do 2026-10-04 tu stála výjimka
      -- podle typu bez podmínky na příběh: zásada nebo rys z cizího příběhu šly komukoli.
      AND (
        (p_story_id IS NULL AND ki.story_id IS NULL)
        OR (p_story_id IS NOT NULL AND (ki.story_id = p_story_id OR ki.story_id IS NULL))
      )
      -- Brick6 tier-ACL: HARD filter — an under-tier audience user never retrieves a gated row.
      AND (ki.minimum_tier IS NULL OR public.audience_user_meets_tier_requirement(ki.minimum_tier, v_audience_user))
    ORDER BY (
      CASE WHEN p_query_embedding IS NOT NULL AND ke.embedding IS NOT NULL
        THEN (1 - (ke.embedding <=> p_query_embedding)) * 40
        ELSE 0 END
      +
      CASE WHEN p_context_tags != '{}' AND ki.ai_context_tags && p_context_tags
        THEN COALESCE(array_length(
          ARRAY(SELECT unnest(ki.ai_context_tags) INTERSECT SELECT unnest(p_context_tags)),
          1
        ), 0) * 10
        ELSE 0 END
      +
      CASE WHEN v_words IS NOT NULL THEN
        (SELECT count(*)::int FROM unnest(v_words) AS word
         WHERE ki.title ILIKE '%' || word || '%'
            OR ki.summary ILIKE '%' || word || '%'
        ) * 15
        ELSE 0
      END
      +
      CASE WHEN ki.is_verified THEN 5 ELSE 0 END
      +
      CASE WHEN p_story_id IS NOT NULL AND ki.story_id = p_story_id THEN 25 ELSE 0 END
    ) DESC
    LIMIT p_limit
  ) sub;

  RETURN v_results;
END;
$function$
;

REVOKE ALL ON FUNCTION mcp_search_knowledge_v2(vector,text,text[],text,text,text[],boolean,integer,double precision,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_search_knowledge_v2(vector,text,text[],text,text,text[],boolean,integer,double precision,uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION mcp_search_knowledge_v2(vector,text,text[],text,text,text[],boolean,integer,double precision,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_search_knowledge_v2(vector,text,text[],text,text,text[],boolean,integer,double precision,uuid,uuid) TO service_role;

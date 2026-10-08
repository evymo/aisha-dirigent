-- Function: mcp_search_knowledge
-- Word-level search: splits query into individual words, matches ANY word (OR logic)
--
-- Viditelnost (2026-10-05, revize B1): public.expert_rule_visible_to pro toho, PRO KOHO se hledá.
-- Do 2026-10-05 vlastní výčet ('public' / 'members' přihlášenému) a nástroj MCP volal servisní rolí bez
-- publika. Teď publikum předává z ověřeného tokenu; služba bez publika = jen `public`.
-- Signatura se mění výměnou (přibyl parametr s výchozí hodnotou).
DROP FUNCTION IF EXISTS public.mcp_search_knowledge(text, text, text, text[], boolean, integer);

CREATE OR REPLACE FUNCTION public.mcp_search_knowledge(
  p_query text DEFAULT NULL::text,
  p_category text DEFAULT NULL::text,
  p_expertise_slug text DEFAULT NULL::text,
  p_context_tags text[] DEFAULT '{}'::text[],
  p_include_ai_instructions boolean DEFAULT true,
  p_limit integer DEFAULT 20,
  p_audience_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_results jsonb;
  v_words text[];
  v_audience_user uuid;  -- pro koho se hledá (služba smí říct; jinak volající sám; bez identity NULL)
BEGIN
  v_audience_user := CASE
    WHEN public.get_jwt_role() = 'service_role' THEN COALESCE(p_audience_user_id, auth.uid())
    ELSE auth.uid()
  END;

  -- Split query into individual words (min 2 chars), for word-level matching
  IF p_query IS NOT NULL AND trim(p_query) != '' THEN
    v_words := ARRAY(
      SELECT w FROM unnest(regexp_split_to_array(lower(trim(p_query)), '\s+')) AS w
      WHERE length(w) >= 2
    );
    IF array_length(v_words, 1) IS NULL THEN
      v_words := NULL;
    END IF;
  ELSE
    v_words := NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(rule_row ORDER BY rule_row->>'relevance_score' DESC), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT jsonb_build_object(
      'id', er.id,
      'slug', er.slug,
      'title', er.title,
      'summary', er.summary,
      'category', er.category::text,
      'expertise_area_slug', gea.slug,
      'expertise_area_name_key', gea.name_key,
      'expertise_area_icon', gea.icon,
      'author_display_name', pp.display_name,
      'author_guild_tier', pp.guild_tier,
      'is_verified', er.is_verified,
      'ai_context_tags', er.ai_context_tags,
      'ai_instructions', CASE WHEN p_include_ai_instructions THEN er.ai_instructions ELSE NULL END,
      'rating_avg', er.rating_avg,
      'usage_count', er.usage_count,
      'version', er.version,
      'published_at', er.published_at,
      'relevance_score', (
        -- Scoring: tag overlap > text match (per word) > verified
        CASE WHEN p_context_tags != '{}' AND er.ai_context_tags && p_context_tags
          THEN array_length(
            ARRAY(SELECT unnest(er.ai_context_tags) INTERSECT SELECT unnest(p_context_tags)),
            1
          ) * 10
          ELSE 0
        END
        +
        -- Word-level text matching: score per matching word
        CASE WHEN v_words IS NOT NULL THEN
          (SELECT count(*)::int FROM unnest(v_words) AS word
           WHERE er.title ILIKE '%' || word || '%'
              OR er.summary ILIKE '%' || word || '%'
              OR er.body_markdown ILIKE '%' || word || '%'
              OR er.ai_instructions ILIKE '%' || word || '%'
          ) * 5
          ELSE 0
        END
        +
        CASE WHEN er.is_verified THEN 3 ELSE 0 END
      )
    ) AS rule_row
    FROM expert_rules er
    JOIN partner_profiles pp ON pp.id = er.author_partner_id
    LEFT JOIN guild_expertise_areas gea ON gea.id = er.expertise_area_id
    WHERE er.status = 'published'
      -- Viditelnost pro toho, pro koho se hledá (autor své, správa vše, ostatní podle domova).
      AND public.expert_rule_visible_to(er.visibility, er.author_partner_id, v_audience_user)
      AND (p_category IS NULL OR er.category::text = p_category)
      AND (p_expertise_slug IS NULL OR gea.slug = p_expertise_slug)
      AND (
        -- No query: return all (filtered by category/expertise/tags)
        v_words IS NULL
        -- Word match: at least one word matches in any text field
        OR EXISTS (
          SELECT 1 FROM unnest(v_words) AS word
          WHERE er.title ILIKE '%' || word || '%'
             OR er.summary ILIKE '%' || word || '%'
             OR er.body_markdown ILIKE '%' || word || '%'
             OR er.ai_instructions ILIKE '%' || word || '%'
        )
        -- Tag match
        OR (p_context_tags != '{}' AND er.ai_context_tags && p_context_tags)
      )
    ORDER BY (
      CASE WHEN p_context_tags != '{}' AND er.ai_context_tags && p_context_tags
        THEN array_length(
          ARRAY(SELECT unnest(er.ai_context_tags) INTERSECT SELECT unnest(p_context_tags)),
          1
        ) * 10
        ELSE 0
      END
      +
      CASE WHEN v_words IS NOT NULL THEN
        (SELECT count(*)::int FROM unnest(v_words) AS word
         WHERE er.title ILIKE '%' || word || '%'
            OR er.summary ILIKE '%' || word || '%'
        ) * 5
        ELSE 0
      END
      +
      CASE WHEN er.is_verified THEN 3 ELSE 0 END
    ) DESC
    LIMIT p_limit
  ) sub;

  RETURN v_results;
END;
$function$;

REVOKE ALL ON FUNCTION public.mcp_search_knowledge(text, text, text, text[], boolean, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mcp_search_knowledge(text,text,text,text[],boolean,integer,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.mcp_search_knowledge(text,text,text,text[],boolean,integer,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_search_knowledge(text,text,text,text[],boolean,integer,uuid) TO service_role;

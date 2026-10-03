-- Function: mcp_search_knowledge_v3

-- Brick3 locale axis: chunk_locale added to RETURNS TABLE (surfaced).
-- Brick2-guard model identity: p_query_model is a HARD WHERE filter on ke.model /
-- ke.model_v2 — model identity is a CORRECTNESS invariant (a query embedded by model X
-- must only be cosine-compared against chunks embedded by model X), NOT a score term.
-- Brick5 cross-lingual (14-arg): p_locale text DEFAULT NULL appended AFTER p_query_model.
--   * preference-BOOST, never a hard filter (HARD invariant): a chunk whose locale = p_locale
--     gets a small subtraction from its vector distance so it reranks slightly earlier; a
--     non-matching locale still ranks (cross-lingual fallback rides the shared vector space).
--   * variant DEDUP via source_concept_id: locale variants of one source node collapse to one
--     WINNING variant (the item owning the best-scoring chunk), and only that item's chunks are
--     returned. Single-variant concepts are unaffected (winner = the one item → no regression).
-- Brick6 tier-ACL (15-arg): p_audience_user_id uuid DEFAULT NULL appended AFTER p_locale. The
-- WHERE gains a HARD filter audience_user_meets_tier_requirement(ki.minimum_tier, audience_user)
-- so under-tier users never retrieve a gated row. Only service_role may name a different
-- end-user; authenticated callers are pinned to auth.uid() (no tier spoof). The signature
-- changed (14→15), so the prior overloads are DROPped and REVOKE/GRANT re-issued at 15 args.
DROP FUNCTION IF EXISTS public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text);
DROP FUNCTION IF EXISTS public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text);
DROP FUNCTION IF EXISTS public.mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text);

CREATE OR REPLACE FUNCTION public.mcp_search_knowledge_v3(p_query_embedding_v1 vector DEFAULT NULL::vector, p_query_embedding_v2 halfvec DEFAULT NULL::halfvec, p_query_text text DEFAULT NULL::text, p_item_types text[] DEFAULT NULL::text[], p_category text DEFAULT NULL::text, p_expertise_slug text DEFAULT NULL::text, p_context_tags text[] DEFAULT NULL::text[], p_include_ai_instructions boolean DEFAULT true, p_limit integer DEFAULT 10, p_similarity_threshold numeric DEFAULT 0.3, p_story_id uuid DEFAULT NULL::uuid, p_model_pref text DEFAULT 'v1'::text, p_query_model text DEFAULT NULL::text, p_locale text DEFAULT NULL::text, p_audience_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(knowledge_item_id uuid, chunk_id uuid, chunk_text text, chunk_slug text, similarity numeric, embedding_version text, chunk_locale text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role text;
  v_caller_id uuid;
  -- Brick6: the end-user whose tier gates retrieval (service may override via the arg; else self).
  v_audience_user uuid;
  -- locale preference nudge (rerank only): a locale match subtracts this from the cosine
  -- distance. Small relative to the [0,2] distance range — a same-language tie-breaker /
  -- gentle preference, never enough to override a materially better cross-lingual hit.
  c_locale_boost constant numeric := 0.05;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  -- ── RBAC: Per-story access check (ported verbatim from mcp_search_knowledge_v2) ─
  v_caller_role := public.get_jwt_role();
  v_caller_id := auth.uid();

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
  -- different end-user via p_audience_user_id; authenticated callers are pinned to themselves
  -- (no tier spoofing). The tier check itself fails closed (unknown user ⇒ anonymous).
  v_audience_user := CASE
    WHEN v_caller_role = 'service_role' THEN COALESCE(p_audience_user_id, auth.uid())
    ELSE auth.uid()
  END;

  IF p_model_pref = 'v2' THEN
    IF p_query_embedding_v2 IS NULL THEN
      RAISE EXCEPTION 'p_query_embedding_v2 is required when p_model_pref = v2';
    END IF;
    RETURN QUERY
    WITH scored AS (
      SELECT
        ke.knowledge_item_id AS s_item_id,
        ke.chunk_id AS s_chunk_id,
        kc.chunk_text AS s_chunk_text,
        (COALESCE(ki.source_slug, ki.id::text) || ':' || kc.chunk_index)::text AS s_chunk_slug,
        (1 - (ke.embedding_v2 <=> p_query_embedding_v2))::numeric AS s_similarity,
        kc.locale AS s_chunk_locale,
        -- COALESCE so a NULL source_concept_id (trigger-bypassed insert, bulk load, or a
        -- not-yet-backfilled row) degrades to "own item = its own concept" (a singleton, no
        -- dedup) instead of NULL — a NULL concept would drop the row at the winner JOIN.
        COALESCE(ki.source_concept_id, ki.id) AS s_concept,
        (ke.embedding_v2 <=> p_query_embedding_v2)
          - CASE WHEN p_locale IS NOT NULL AND kc.locale = p_locale THEN c_locale_boost ELSE 0 END AS s_eff_dist
      FROM public.knowledge_embeddings ke
      JOIN public.knowledge_chunks kc ON kc.id = ke.chunk_id
      JOIN public.knowledge_items ki ON ki.id = ke.knowledge_item_id
     WHERE ke.embedding_v2 IS NOT NULL
       AND ki.status = 'active'
       AND ki.quarantine_status NOT IN ('flagged', 'quarantined')
       AND (p_item_types IS NULL OR ki.item_type::text = ANY(p_item_types))
       AND (p_category IS NULL OR ki.category = p_category)
       AND (
         ki.item_type::text IN ('core_value', 'personality_trait')
         OR (p_story_id IS NULL AND ki.story_id IS NULL)
         OR (p_story_id IS NOT NULL AND (ki.story_id = p_story_id OR ki.story_id IS NULL))
       )
       -- Brick2-guard: HARD model-identity filter (correctness, not a score term).
       AND (p_query_model IS NULL OR ke.model_v2 = p_query_model)
       -- Brick6 tier-ACL: HARD filter — an under-tier audience user never retrieves a gated row.
       AND (ki.minimum_tier IS NULL OR public.audience_user_meets_tier_requirement(ki.minimum_tier, v_audience_user))
       AND (1 - (ke.embedding_v2 <=> p_query_embedding_v2)) >= p_similarity_threshold
    ),
    winner AS (
      -- one winning variant (knowledge_item) per source-concept: the item owning the
      -- best (locale-boosted) chunk. Collapses cross-lingual near-duplicates.
      SELECT DISTINCT ON (s_concept) s_concept, s_item_id
      FROM scored ORDER BY s_concept, s_eff_dist ASC, s_item_id
    )
    SELECT s.s_item_id, s.s_chunk_id, s.s_chunk_text, s.s_chunk_slug, s.s_similarity,
           'v2'::text, s.s_chunk_locale
    FROM scored s
    JOIN winner w ON w.s_concept = s.s_concept AND w.s_item_id = s.s_item_id
    ORDER BY s.s_eff_dist ASC
    LIMIT p_limit;
  ELSE
    IF p_query_embedding_v1 IS NULL THEN
      RAISE EXCEPTION 'p_query_embedding_v1 is required when p_model_pref = v1';
    END IF;
    RETURN QUERY
    WITH scored AS (
      SELECT
        ke.knowledge_item_id AS s_item_id,
        ke.chunk_id AS s_chunk_id,
        kc.chunk_text AS s_chunk_text,
        (COALESCE(ki.source_slug, ki.id::text) || ':' || kc.chunk_index)::text AS s_chunk_slug,
        (1 - (ke.embedding <=> p_query_embedding_v1))::numeric AS s_similarity,
        kc.locale AS s_chunk_locale,
        -- COALESCE so a NULL source_concept_id (trigger-bypassed insert, bulk load, or a
        -- not-yet-backfilled row) degrades to "own item = its own concept" (a singleton, no
        -- dedup) instead of NULL — a NULL concept would drop the row at the winner JOIN.
        COALESCE(ki.source_concept_id, ki.id) AS s_concept,
        (ke.embedding <=> p_query_embedding_v1)
          - CASE WHEN p_locale IS NOT NULL AND kc.locale = p_locale THEN c_locale_boost ELSE 0 END AS s_eff_dist
      FROM public.knowledge_embeddings ke
      JOIN public.knowledge_chunks kc ON kc.id = ke.chunk_id
      JOIN public.knowledge_items ki ON ki.id = ke.knowledge_item_id
     WHERE ke.embedding IS NOT NULL
       AND ki.status = 'active'
       AND ki.quarantine_status NOT IN ('flagged', 'quarantined')
       AND (p_item_types IS NULL OR ki.item_type::text = ANY(p_item_types))
       AND (p_category IS NULL OR ki.category = p_category)
       AND (
         ki.item_type::text IN ('core_value', 'personality_trait')
         OR (p_story_id IS NULL AND ki.story_id IS NULL)
         OR (p_story_id IS NOT NULL AND (ki.story_id = p_story_id OR ki.story_id IS NULL))
       )
       -- Brick2-guard: HARD model-identity filter (correctness, not a score term).
       AND (p_query_model IS NULL OR ke.model = p_query_model)
       -- Brick6 tier-ACL: HARD filter — an under-tier audience user never retrieves a gated row.
       AND (ki.minimum_tier IS NULL OR public.audience_user_meets_tier_requirement(ki.minimum_tier, v_audience_user))
       AND (1 - (ke.embedding <=> p_query_embedding_v1)) >= p_similarity_threshold
    ),
    winner AS (
      SELECT DISTINCT ON (s_concept) s_concept, s_item_id
      FROM scored ORDER BY s_concept, s_eff_dist ASC, s_item_id
    )
    SELECT s.s_item_id, s.s_chunk_id, s.s_chunk_text, s.s_chunk_slug, s.s_similarity,
           'v1'::text, s.s_chunk_locale
    FROM scored s
    JOIN winner w ON w.s_concept = s.s_concept AND w.s_item_id = s.s_item_id
    ORDER BY s.s_eff_dist ASC
    LIMIT p_limit;
  END IF;
END;
$function$
;

REVOKE ALL ON FUNCTION mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_search_knowledge_v3(vector,halfvec,text,text[],text,text,text[],boolean,integer,numeric,uuid,text,text,text,uuid) TO service_role;

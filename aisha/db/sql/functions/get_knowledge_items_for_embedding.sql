-- Function: get_knowledge_items_for_embedding

-- PR-1 (ingest provenance & dedup): the batch gate additionally re-emits items whose
-- chunks were built from a different content key (see WHERE below).
-- Brick4: surface ki.locale (+ source_hash) so the embedding worker can thread the
-- item's locale into chunk/embedding writes and the language-aware contextual prefix.
-- Bez DROP: návratový tvar s locale a source_hash (poslední změna 2026-07-10) má i nejstarší
-- podporovaná databáze (dno 2026-07-29), takže CREATE OR REPLACE stačí. Soubor je v heals —
-- DROP téže signatury by běžel při každém migrate a nic nepřidal.

CREATE OR REPLACE FUNCTION public.get_knowledge_items_for_embedding(p_batch_size integer DEFAULT 10, p_force boolean DEFAULT false, p_item_id uuid DEFAULT NULL::uuid, p_item_type text DEFAULT NULL::text, p_source_slug text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, title text, summary text, body_markdown text, ai_instructions text, source_slug text, item_type text, locale text, source_hash text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  IF p_batch_size > 100 THEN
    p_batch_size := 100;
  END IF;

  RETURN QUERY
  SELECT ki.id,
         ki.title,
         ki.summary,
         ki.body_markdown,
         ki.ai_instructions,
         ki.source_slug,
         ki.item_type::text,
         ki.locale,
         ki.source_hash
  FROM knowledge_items ki
  WHERE ki.status = 'active'
    AND (p_item_id IS NULL OR ki.id = p_item_id)
    AND (p_item_type IS NULL OR ki.item_type::text = p_item_type)
    AND (p_source_slug IS NULL OR ki.source_slug = p_source_slug)
    AND (
      p_force
      -- fresh item: nothing chunked yet
      OR NOT EXISTS (
        SELECT 1 FROM knowledge_chunks kc WHERE kc.knowledge_item_id = ki.id
      )
      -- stale item (PR-1 dedup): chunks exist but carry a different NON-NULL content
      -- key than the item's current source_hash (workers write chunks with
      -- p_source_hash = ki.source_hash, so equality = up-to-date). Both sides must be
      -- non-NULL: legacy hash-less chunks are NOT treated as stale, so enabling this
      -- cannot trigger a fleet-wide re-embedding storm.
      OR EXISTS (
        SELECT 1 FROM knowledge_chunks kc
        WHERE kc.knowledge_item_id = ki.id
          AND kc.source_hash IS NOT NULL
          AND ki.source_hash IS NOT NULL
          AND kc.source_hash <> ki.source_hash
      )
    )
  ORDER BY ki.updated_at DESC NULLS LAST, ki.created_at DESC
  LIMIT p_batch_size;
END;
$function$

;

REVOKE ALL ON FUNCTION get_knowledge_items_for_embedding(integer,boolean,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_knowledge_items_for_embedding(integer,boolean,uuid,text,text) TO service_role;

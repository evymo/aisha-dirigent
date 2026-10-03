-- Function: clear_knowledge_item_chunks

-- Brick4: adding p_locale (DEFAULT NULL) changes the arity (1 → 2). Drop the 1-arg
-- overload first so the per-locale and clear-all forms don't become an ambiguous pair.
DROP FUNCTION IF EXISTS public.clear_knowledge_item_chunks(uuid);

CREATE OR REPLACE FUNCTION public.clear_knowledge_item_chunks(p_item_id uuid, p_locale text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_chunks_deleted integer;
  v_embeds_deleted integer;
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  IF p_item_id IS NULL THEN
    RETURN jsonb_build_object('error', 'p_item_id is required');
  END IF;

  -- Brick4 per-locale clear: p_locale NULL clears ALL locales (back-compat); a passed
  -- locale clears only that locale's rows, leaving sibling locales intact. The earlier
  -- behaviour (always all-locales) silently wiped other languages on a single-locale
  -- re-ingest.
  WITH deleted AS (
    DELETE FROM knowledge_embeddings
     WHERE knowledge_item_id = p_item_id
       AND (p_locale IS NULL OR locale = p_locale) RETURNING 1
  )
  SELECT count(*) INTO v_embeds_deleted FROM deleted;

  WITH deleted AS (
    DELETE FROM knowledge_chunks
     WHERE knowledge_item_id = p_item_id
       AND (p_locale IS NULL OR locale = p_locale) RETURNING 1
  )
  SELECT count(*) INTO v_chunks_deleted FROM deleted;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    NULL, 'KB_CHUNKS_CLEARED',
    jsonb_build_object('entity_type','knowledge_item','entity_id',p_item_id,
                       'locale', p_locale,
                       'chunks_deleted', v_chunks_deleted,
                       'embeddings_deleted', v_embeds_deleted)
  );

  RETURN jsonb_build_object(
    'status','cleared',
    'chunks_deleted', v_chunks_deleted,
    'embeddings_deleted', v_embeds_deleted
  );
END;
$function$

;

REVOKE ALL ON FUNCTION clear_knowledge_item_chunks(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clear_knowledge_item_chunks(uuid, text) TO service_role;

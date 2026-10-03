-- Function: insert_knowledge_chunk

-- Brick3 locale axis: p_locale appended (7-arg). DROP the old 6-arg overload first
-- so the added trailing arg does not create a second overload (PGRST203 ambiguity).
DROP FUNCTION IF EXISTS public.insert_knowledge_chunk(integer,text,uuid,text,text,integer);
-- PR-1 ingest provenance & dedup: p_source_hash + p_char_start/p_char_end appended
-- (10-arg). DROP the 7-arg overload for the same PGRST203 reason. source_hash column
-- existed but was never written; char-span columns land in the same change. The
-- upsert becomes skip-if-unchanged on the content key so re-syncs are no-ops.
DROP FUNCTION IF EXISTS public.insert_knowledge_chunk(integer,text,uuid,text,text,integer,text);

CREATE OR REPLACE FUNCTION public.insert_knowledge_chunk(p_chunk_index integer, p_chunk_text text, p_knowledge_item_id uuid, p_section_title text DEFAULT NULL::text, p_source_field text DEFAULT 'body'::text, p_token_count integer DEFAULT NULL::integer, p_locale text DEFAULT 'global'::text, p_source_hash text DEFAULT NULL::text, p_char_start integer DEFAULT NULL::integer, p_char_end integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  INSERT INTO knowledge_chunks (
    knowledge_item_id, chunk_index, chunk_text, token_count, section_title, source_field, locale,
    source_hash, char_start, char_end
  )
  VALUES (
    p_knowledge_item_id, p_chunk_index, p_chunk_text, p_token_count, p_section_title, COALESCE(p_source_field, 'body'), COALESCE(p_locale, 'global'),
    p_source_hash, p_char_start, p_char_end
  )
  ON CONFLICT (knowledge_item_id, chunk_index, locale) DO UPDATE
    SET chunk_text    = EXCLUDED.chunk_text,
        token_count   = EXCLUDED.token_count,
        section_title = EXCLUDED.section_title,
        source_field  = EXCLUDED.source_field,
        source_hash   = EXCLUDED.source_hash,
        char_start    = EXCLUDED.char_start,
        char_end      = EXCLUDED.char_end
    -- skip-if-unchanged: identical NON-NULL content key is a no-op, so replays do not
    -- churn rows. A NULL stored hash always updates (legacy rows converge on first
    -- re-ingest); NULL-safety via IS DISTINCT FROM.
    WHERE knowledge_chunks.source_hash IS NULL
       OR knowledge_chunks.source_hash IS DISTINCT FROM EXCLUDED.source_hash
  RETURNING knowledge_chunks.id INTO v_id;

  IF v_id IS NULL THEN
    -- conflict row already carries this content key → skipped (idempotent re-ingest)
    SELECT kc.id INTO v_id
    FROM knowledge_chunks kc
    WHERE kc.knowledge_item_id = p_knowledge_item_id
      AND kc.chunk_index = p_chunk_index
      AND kc.locale = COALESCE(p_locale, 'global');
    RETURN jsonb_build_object('id', v_id, 'skipped', true);
  END IF;

  RETURN jsonb_build_object('id', v_id, 'skipped', false);
END;
$function$

;

REVOKE ALL ON FUNCTION insert_knowledge_chunk(integer,text,uuid,text,text,integer,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_knowledge_chunk(integer,text,uuid,text,text,integer,text,text,integer,integer) TO service_role;

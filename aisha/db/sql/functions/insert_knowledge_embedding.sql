-- Function: insert_knowledge_embedding

-- Brick3 locale axis: p_locale appended (6-arg). DROP the old 5-arg overload first
-- so the added trailing arg does not create a second overload (PGRST203 ambiguity).
DROP FUNCTION IF EXISTS public.insert_knowledge_embedding(uuid,text,uuid,text,text);

CREATE OR REPLACE FUNCTION public.insert_knowledge_embedding(p_chunk_id uuid, p_embedding text, p_knowledge_item_id uuid, p_model text DEFAULT 'text-embedding-3-small'::text, p_model_version text DEFAULT NULL::text, p_locale text DEFAULT 'global'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_model_registry_id uuid;
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  IF p_chunk_id IS NULL OR p_embedding IS NULL OR p_embedding = '' THEN
    RETURN jsonb_build_object('error', 'p_chunk_id and p_embedding are required');
  END IF;

  -- Brick2-guard: resolve the canonical ai_model_registry row for the named embedding
  -- model and PIN its id onto the row (precedence: FK-linked provider row first, mirrors
  -- fn_resolve_embedding_model). Fail loud if the model is unregistered — silently writing
  -- a NULL model_registry_id would let an unknown model's vectors join the corpus with no
  -- identity, breaking the model-as-index-constant invariant the cross-model guard enforces.
  SELECT id INTO v_model_registry_id
  FROM public.ai_model_registry
  WHERE model_id = p_model AND is_embedding
  ORDER BY (provider_registry_id IS NOT NULL) DESC
  LIMIT 1;

  IF v_model_registry_id IS NULL THEN
    RAISE EXCEPTION 'Embedding model % is not a registered is_embedding model in ai_model_registry', p_model
      USING ERRCODE = '23503';
  END IF;

  INSERT INTO knowledge_embeddings (chunk_id, knowledge_item_id, embedding, model, model_version, model_registry_id, locale)
  VALUES (p_chunk_id, p_knowledge_item_id, p_embedding::vector(1024), p_model, p_model_version, v_model_registry_id, COALESCE(p_locale, 'global'))
  ON CONFLICT (chunk_id, locale) DO UPDATE
    SET embedding         = EXCLUDED.embedding,
        model             = EXCLUDED.model,
        model_version     = EXCLUDED.model_version,
        model_registry_id = EXCLUDED.model_registry_id,
        created_at        = now();

  RETURN jsonb_build_object('status', 'inserted', 'chunk_id', p_chunk_id);
END;
$function$

;

REVOKE ALL ON FUNCTION insert_knowledge_embedding(uuid,text,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_knowledge_embedding(uuid,text,uuid,text,text,text) TO service_role;

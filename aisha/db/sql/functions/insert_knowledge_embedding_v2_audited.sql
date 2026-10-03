-- Function: insert_knowledge_embedding_v2_audited
-- Single text-input audited writer for the v2 (Qwen3, halfvec(2560)) embedding space —
-- mirrors the v1 path insert_knowledge_embedding(p_embedding text). Takes the embedding
-- as a JSON text array (what PostgREST/rpcService send), casts it to halfvec(2560),
-- updates the v2 columns and writes its audit_journal row (the _audited contract).
--
-- ONE overload by design: the prior vector/halfvec typed overloads were a back-port
-- artifact with identical parameter names (PGRST203 ambiguity) and zero callers, so they
-- are consolidated into this canonical text form (rewrite, not capability removal — the
-- v2 SPACE itself, the halfvec(2560) column + mcp_search_v3 v1/v2 routing, is untouched).
-- The SPACE choice (v1 1536 vs v2 2560) is the per-context decision the resolver makes
-- upstream; this writer only persists the resolved v2 vector.

-- Brick3 locale axis: p_locale appended (5-arg). The v2 writer UPDATEs an existing
-- knowledge_embeddings row; with the widened (chunk_id, locale) unique it must
-- scope by locale to target the right per-locale row. DROP the old 4-arg overload
-- first so the added trailing arg does not create a second overload (PGRST203).
DROP FUNCTION IF EXISTS public.insert_knowledge_embedding_v2_audited(uuid,text,text,text);

CREATE OR REPLACE FUNCTION public.insert_knowledge_embedding_v2_audited(p_chunk_id uuid, p_embedding_v2 text, p_model text, p_model_version text, p_locale text DEFAULT 'global'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_model_v2_registry_id uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_chunk_id IS NULL THEN
    RAISE EXCEPTION 'p_chunk_id is required';
  END IF;
  IF p_embedding_v2 IS NULL OR p_embedding_v2 = '' THEN
    RAISE EXCEPTION 'p_embedding_v2 is required';
  END IF;
  IF p_model IS NULL OR p_model = '' THEN
    RAISE EXCEPTION 'p_model is required';
  END IF;

  -- Brick2-guard: resolve + PIN the canonical ai_model_registry id for the v2 model
  -- (same precedence as fn_resolve_embedding_model). Fail loud on an unregistered model
  -- rather than silently leaving model_v2_registry_id NULL — an unknown v2 model's halfvec
  -- vectors must never join the corpus without a verifiable identity.
  SELECT id INTO v_model_v2_registry_id
  FROM public.ai_model_registry
  WHERE model_id = p_model AND is_embedding
  ORDER BY (provider_registry_id IS NOT NULL) DESC
  LIMIT 1;

  IF v_model_v2_registry_id IS NULL THEN
    RAISE EXCEPTION 'Embedding model % is not a registered is_embedding model in ai_model_registry', p_model
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.knowledge_embeddings
     SET embedding_v2        = p_embedding_v2::halfvec(2560),
         model_v2            = p_model,
         model_v2_version    = p_model_version,
         model_v2_registry_id = v_model_v2_registry_id,
         v2_generated_at     = now(),
         v2_status           = 'generated'
   WHERE chunk_id = p_chunk_id
     AND locale = COALESCE(p_locale, 'global');

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'knowledge.embedding_v2_generated',
    jsonb_build_object('chunk_id', p_chunk_id, 'model', p_model, 'version', p_model_version, 'locale', COALESCE(p_locale, 'global'))
  );

  RETURN jsonb_build_object('ok', true, 'chunk_id', p_chunk_id);
END;
$function$
;

REVOKE ALL ON FUNCTION insert_knowledge_embedding_v2_audited(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_knowledge_embedding_v2_audited(uuid,text,text,text,text) TO service_role;

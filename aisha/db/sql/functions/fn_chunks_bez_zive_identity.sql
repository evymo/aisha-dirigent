-- ============================================================================
-- Source of Truth: fn_chunks_bez_zive_identity
-- Popis: ČISTÝ výběr chunků bez vektoru dané živé identity — jádro
--        fn_get_chunks_needing_v1 (ta identitu zjistí z resolveru v1 a registru).
--        Oddělené, aby šel výběr ověřit bez resolveru a providerů (runtime test).
--
-- Živý vektor = model = p_model A model_version začíná p_identita (`gguf:<sha>`,
-- recept za `;` libovolný). Chunk s vynecháním pro TUTÉŽ identitu se nevrací
-- (nad_limitem — jinak by ucpal frontu). Nejstarší položky první.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_chunks_bez_zive_identity(
  p_model      text,
  p_identita   text,
  p_max_tokens integer,
  p_batch_size integer DEFAULT 20
)
RETURNS TABLE (
  chunk_id           uuid,
  knowledge_item_id  uuid,
  chunk_text         text,
  contextual_prefix  text,
  locale             text,
  model_id           text,
  identita           text,
  max_tokens         integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_model IS NULL OR p_identita IS NULL OR p_identita !~ '^gguf:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'živá identita neplatná: model %, identita %', p_model, p_identita USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT kc.id, kc.knowledge_item_id, kc.chunk_text, kc.contextual_prefix, kc.locale,
         p_model, p_identita, p_max_tokens
    FROM public.knowledge_chunks kc
    JOIN public.knowledge_items ki ON ki.id = kc.knowledge_item_id
   WHERE NOT EXISTS (
           SELECT 1 FROM public.knowledge_embeddings e
            WHERE e.chunk_id = kc.id AND e.locale = kc.locale
              AND e.model = p_model
              AND split_part(coalesce(e.model_version, ''), ';', 1) = p_identita)
     AND NOT EXISTS (
           SELECT 1 FROM public.knowledge_embedding_vynechani v
            WHERE v.chunk_id = kc.id AND v.locale = kc.locale AND v.identita = p_identita)
   ORDER BY ki.created_at, kc.knowledge_item_id, kc.chunk_index
   LIMIT greatest(1, least(coalesce(p_batch_size, 20), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_chunks_bez_zive_identity(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_chunks_bez_zive_identity(text, text, integer, integer) TO service_role;

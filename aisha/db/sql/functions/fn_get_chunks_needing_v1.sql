-- ============================================================================
-- Source of Truth: fn_get_chunks_needing_v1
-- Popis: Dávka chunků BEZ vektoru ŽIVÉ identity v prostoru v1 — pro platformní
--        dopočet (POST /embeddings/v1-backfill).
--
-- ŽIVÁ IDENTITA = model, kterým se kódují dotazy (fn_resolve_embedding_model_for_space
-- ('v1')) + DEKLAROVANÝ pin vah (ai_model_registry.provider_metadata.declared
-- .weights_sha256, data instance). Vektor je živý, když nese to jméno A model_version
-- začíná `gguf:<pin>` (recept za středníkem může být jakýkoli: engine local-ingest
-- `embed_text_v1`, tento dopočet `chunk_text_v1`). Vše ostatní — chybějící vektor,
-- jiné jméno (MLX), totéž jméno z jiného runtime (sentence-transformers) — se dopočítá
-- a přepíše NA MÍSTĚ (insert_knowledge_embedding: ON CONFLICT (chunk_id, locale)).
--
-- Bez deklarovaného pinu NEVRACÍ NIC a hlásí chybu: identitu runtime platforma nezná
-- a „živé" by nešlo odlišit od cizího (fail-closed).
-- Pořadí: nejstarší položky první — dokumenty, které dnes spravuje ingest (engine
-- je kóduje sám, s receptem embed_text_v1), přijdou na řadu až nakonec.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_chunks_needing_v1(p_batch_size integer DEFAULT 20)
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
DECLARE
  v_model text;
  v_pin   text;
  v_max   integer;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  SELECT r.model_id INTO v_model FROM public.fn_resolve_embedding_model_for_space('v1') r LIMIT 1;
  IF v_model IS NULL THEN
    RETURN;
  END IF;
  SELECT m.provider_metadata->'declared'->>'weights_sha256',
         nullif(m.provider_metadata->'declared'->>'max_tokens', '')::integer
    INTO v_pin, v_max
    FROM public.ai_model_registry m
   WHERE m.model_id = v_model AND m.is_embedding
   ORDER BY m.is_available DESC NULLS LAST
   LIMIT 1;
  IF v_pin IS NULL OR v_pin !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'živá identita embeddingu % neznámá: ai_model_registry.provider_metadata.declared.weights_sha256 chybí', v_model
      USING ERRCODE = '22023';
  END IF;
  IF v_max IS NULL OR v_max < 1 THEN
    RAISE EXCEPTION 'embedding % nemá declared.max_tokens — bez stropu nelze vyloučit tichý ořez', v_model
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT c.chunk_id, c.knowledge_item_id, c.chunk_text, c.contextual_prefix, c.locale,
         c.model_id, c.identita, c.max_tokens
    FROM public.fn_chunks_bez_zive_identity(v_model, 'gguf:' || v_pin, v_max, p_batch_size) c;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_chunks_needing_v1(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_chunks_needing_v1(integer) TO service_role;

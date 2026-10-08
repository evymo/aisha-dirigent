-- ============================================================================
-- Source of Truth: fn_get_chunks_needing_v1
-- Popis: Dávka chunků BEZ vektoru ŽIVÉ identity v prostoru v1 — pro platformní
--        dopočet (POST /embeddings/v1-backfill).
--
-- ŽIVÁ IDENTITA = fn_ziva_identita_v1() — JEDINÝ domov (model resolveru v1 + deklarovaná
-- identita vah `<formát>:<sha256>` z dat instance; čte ji i měření pokrytí v brokeru).
-- Vektor je živý, když nese to jméno A model_version
-- začíná tou identitou (recept za středníkem může být jakýkoli: engine local-ingest
-- `embed_text_v1`, tento dopočet `chunk_text_v1`). Vše ostatní — chybějící vektor,
-- jiné jméno (MLX), totéž jméno z jiného runtime (sentence-transformers) — se dopočítá
-- a přepíše NA MÍSTĚ (insert_knowledge_embedding: ON CONFLICT (chunk_id, locale)).
--
-- Bez deklarovaného pinu nebo formátu NEVRACÍ NIC a hlásí chybu s návodem (fn_ziva_identita_v1):
-- identitu runtime platforma nezná a „živé" by nešlo odlišit od cizího (fail-closed).
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
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
STABLE
AS $$
DECLARE
  v_model    text;
  v_identita text;
  v_max      integer;
BEGIN
  -- Jen role služby (dopočet, měření pokrytí v brokeru). „Je někdo přihlášen“ (auth.uid())
  -- NENÍ nárok: úseky znalostí (chunk_text) přihlášenému bez role služby nepatří.
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'fn_get_chunks_needing_v1: jen role služby' USING ERRCODE = '42501';
  END IF;
  -- Jediný domov živé identity; nedeklarovaný pin nebo formát tam selže nahlas (s návodem).
  SELECT z.model_id, z.identita, z.max_tokens INTO v_model, v_identita, v_max
    FROM public.fn_ziva_identita_v1() z;
  IF v_model IS NULL THEN
    RETURN;
  END IF;
  IF v_max IS NULL OR v_max < 1 THEN
    RAISE EXCEPTION 'embedding % nemá declared.max_tokens — bez stropu nelze vyloučit tichý ořez', v_model
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT c.chunk_id, c.knowledge_item_id, c.chunk_text, c.contextual_prefix, c.locale,
         c.model_id, c.identita, c.max_tokens
    FROM public.fn_chunks_bez_zive_identity(v_model, v_identita, v_max, p_batch_size) c;
END;
$$;

-- I od anon/authenticated: fork s výchozím EXECUTE pro authenticated (Supabase) by ho jinak dal
-- každé nové funkci a REVOKE FROM PUBLIC by ho neodebral.
REVOKE ALL ON FUNCTION public.fn_get_chunks_needing_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_chunks_needing_v1(integer) TO service_role;

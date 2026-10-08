-- ============================================================================
-- Source of Truth: fn_ziva_identita_v1
-- Popis: ŽIVÁ IDENTITA vektorů prostoru v1 — JEDINÝ domov definice. Čtou ji dopočet
--        (fn_get_chunks_needing_v1) i měření pokrytí po přehrání balíčku
--        (svc-source-broker, li-driver zmerPokrytiVektoru). Kdyby si ji každý skládal
--        sám, rozejdou se (dřív měření neslo `gguf:` napevno a vektory embedderu s jiným
--        formátem vah by hlásilo jako starý runtime, i když je dopočet uznal za živé).
--
-- Živá identita = model, kterým se kódují dotazy (fn_resolve_embedding_model_for_space('v1'))
-- + `<weights_format>:<weights_sha256>` vah, jak je DEKLARUJÍ DATA INSTANCE v
-- ai_model_registry.provider_metadata.declared. Kdo co zapisuje:
--   · `declared` (weights_format, weights_sha256, max_tokens) zapisují JEN data instance
--     (instanční seed) — platforma váhy nevidí; discovery (upsert_discovered_model)
--     změřená metadata přepisuje celá, `declared` zachovává;
--   · formát = formát SOUBORU, ze kterého je sha spočítán (gguf, pytorch, safetensors …).
-- Deklarace je tvrzení, ne měření: engine, který vektory počítá, hlásí identitu svých
-- vah sám (lane: hlavička x-aisha-identita) a dopočet ji s deklarací porovnává. Proto se
-- deklarace z měření NEDOPLŇUJE — kontrola dvěma cestami by se tím zrušila.
--
-- Bez modelu v1: žádný řádek. Model bez deklarovaného pinu nebo formátu: výjimka 22023
-- s návodem — nic se nedosazuje (ani gguf: dřívější napevno `gguf:` byl literál, ne
-- měření, takže ze starých vektorů formát nevyplývá).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_ziva_identita_v1()
RETURNS TABLE (
  model_id   text,
  identita   text,
  max_tokens integer
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
  -- NENÍ nárok: identita vah přihlášenému bez role služby nepatří.
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'fn_ziva_identita_v1: jen role služby' USING ERRCODE = '42501';
  END IF;
  SELECT r.model_id INTO v_model FROM public.fn_resolve_embedding_model_for_space('v1') r LIMIT 1;
  IF v_model IS NULL THEN
    RETURN;
  END IF;
  -- Deklarace vah má JEDEN domov (fn_deklarace_vah_embeddingu) — týž čte i hledání (v3), takže
  -- dopočet zapisuje pod identitou, podle které se hledá. Nedeklarovaný pin nebo formát tam
  -- selže nahlas s návodem (22023), nic se nedosazuje.
  SELECT d.identita, d.max_tokens INTO v_identita, v_max
    FROM public.fn_deklarace_vah_embeddingu(v_model) d;
  model_id   := v_model;
  identita   := v_identita;
  max_tokens := v_max;
  RETURN NEXT;
END;
$$;

-- I od anon/authenticated: fork s výchozím EXECUTE pro authenticated (Supabase) by ho jinak dal
-- každé nové funkci a REVOKE FROM PUBLIC by ho neodebral.
REVOKE ALL ON FUNCTION public.fn_ziva_identita_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ziva_identita_v1() TO service_role;

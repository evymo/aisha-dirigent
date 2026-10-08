-- ============================================================================
-- Source of Truth: fn_deklarace_vah_embeddingu
-- Popis: DEKLAROVANÁ identita vah embedding modelu `<weights_format>:<weights_sha256>`
--        (+ hranice tokenů) — JEDINÝ domov čtení deklarace. Čtou ji:
--          · fn_ziva_identita_v1 (dopočet v1 a měření pokrytí v brokeru),
--          · mcp_search_knowledge_v3 (tvrdý filtr hledání podle identity vah, P2 2026-10-06).
--        Kdyby si ji každý skládal sám, dopočet by zapisoval vektory pod jinou identitou,
--        než podle jaké je hledání porovnává.
--
-- Deklaraci zapisují JEN data instance (ai_model_registry.provider_metadata.declared; discovery
-- ji zachovává). Formát = formát SOUBORU, ze kterého je sha spočítán (gguf, pytorch,
-- safetensors …). Nic se nedosazuje: bez pinu nebo formátu výjimka 22023 s návodem. Zpráva nese
-- strojovou značku `embedding_identity_undeclared`, podle které volající (svc-mcp-knowledge)
-- pozná nedeklarovanou identitu od jiné chyby — text kolem je pro člověka.
--
-- Výběr řádku registru: týž model může vést víc providerů; dostupný řádek má přednost (stejně
-- jako dřív v fn_ziva_identita_v1).
--
-- SECURITY INVOKER bez stráže v těle: volají ji definer funkce (běží jako vlastník)
-- a služba. EXECUTE nemá anon ani authenticated (ani na forku s výchozím EXECUTE pro
-- authenticated) — identita vah přihlášenému bez role služby nepatří; v3 ji jen použije
-- jako filtr a ve zprávách ji nevydává.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_deklarace_vah_embeddingu(p_model_id text)
RETURNS TABLE (
  identita   text,
  max_tokens integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
STABLE
AS $$
DECLARE
  v_pin    text;
  v_format text;
  v_max    integer;
BEGIN
  IF p_model_id IS NULL OR p_model_id = '' THEN
    RAISE EXCEPTION 'identita embeddingu neznámá (embedding_identity_undeclared): model není zadaný — bez modelu nelze identitu vah určit'
      USING ERRCODE = '22023';
  END IF;
  SELECT m.provider_metadata->'declared'->>'weights_sha256',
         m.provider_metadata->'declared'->>'weights_format',
         nullif(m.provider_metadata->'declared'->>'max_tokens', '')::integer
    INTO v_pin, v_format, v_max
    FROM public.ai_model_registry m
   WHERE m.model_id = p_model_id AND m.is_embedding
   ORDER BY m.is_available DESC NULLS LAST
   LIMIT 1;
  IF v_pin IS NULL OR v_pin !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'živá identita embeddingu % neznámá (embedding_identity_undeclared): data instance nedeklarují ai_model_registry.provider_metadata.declared.weights_sha256 (sha256 souboru vah, kterým se kódují dotazy)', p_model_id
      USING ERRCODE = '22023';
  END IF;
  IF v_format IS NULL OR v_format !~ '^[a-z0-9][a-z0-9._-]{0,31}$' THEN
    RAISE EXCEPTION 'živá identita embeddingu % neznámá (embedding_identity_undeclared): data instance deklarují pin vah, ale ne declared.weights_format. Identita vektoru je <formát>:<sha256> a formát se NEDOSAZUJE (ani gguf). Oprava: data instance doplní vedle weights_sha256 formát souboru, ze kterého je pin spočítán (gguf, pytorch, safetensors …)', p_model_id
      USING ERRCODE = '22023';
  END IF;
  identita   := v_format || ':' || v_pin;
  max_tokens := v_max;
  RETURN NEXT;
END;
$$;

-- I od anon/authenticated: fork s výchozím EXECUTE pro authenticated (Supabase) by ho jinak dal
-- každé nové funkci a REVOKE FROM PUBLIC by ho neodebral.
REVOKE ALL ON FUNCTION public.fn_deklarace_vah_embeddingu(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_deklarace_vah_embeddingu(text) TO service_role;

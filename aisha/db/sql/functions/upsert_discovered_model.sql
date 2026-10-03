-- Function: upsert_discovered_model

-- Signature change (odysseus G1): +p_cached_input_price_per_m (prompt-cache READ rate).
-- Added at the END with a DEFAULT so the first 15 positional args stay compatible, but
-- Postgres keeps the prior 15-arg function as a separate overload — which makes a
-- 15-arg call ambiguous. Drop the old signature first so only the 16-arg version exists.
DROP FUNCTION IF EXISTS public.upsert_discovered_model(text, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, numeric, numeric, jsonb);

-- ⛔ Signature change 2026-09-13: +p_embedding_dimensions (MĚŘENÝ rozměr vektoru).
-- Discovery rozměr embedding modelu dosud nenesl — v registru stála jen deklarace
-- ze seedu, ačkoli alias (EMBED_ALIAS) volí instance a pod týmž jménem může běžet
-- model jiného rozměru. Resolver prostoru (fn_resolve_embedding_model_for_space:
-- 1024 → v1, 2560 → v2) se o rozměr opírá; nesedící vektor pak Postgres odmítne až
-- při zápisu do sloupce. Stejný důvod pro DROP jako výš: 16-arg přetížení by vedle
-- 17-arg zůstalo a PostgREST by volání bez nového parametru hlásil nejednoznačné.
DROP FUNCTION IF EXISTS public.upsert_discovered_model(text, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, numeric, numeric, jsonb, numeric);

CREATE OR REPLACE FUNCTION public.upsert_discovered_model(p_provider text, p_model_id text, p_display_name text DEFAULT NULL::text, p_model_family text DEFAULT NULL::text, p_is_chat_capable boolean DEFAULT true, p_is_reasoning boolean DEFAULT false, p_is_vision boolean DEFAULT false, p_is_code_optimized boolean DEFAULT false, p_is_function_calling boolean DEFAULT false, p_is_embedding boolean DEFAULT false, p_context_window integer DEFAULT NULL::integer, p_max_output_tokens integer DEFAULT NULL::integer, p_input_price_per_m numeric DEFAULT NULL::numeric, p_output_price_per_m numeric DEFAULT NULL::numeric, p_provider_metadata jsonb DEFAULT '{}'::jsonb, p_cached_input_price_per_m numeric DEFAULT NULL::numeric, p_embedding_dimensions integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_model_id uuid;
  v_is_new boolean := false;
  v_was_unavailable boolean := false;
  v_dimensions integer;
BEGIN
  -- Service role only (called by edge function)
  IF NOT (
    public.is_service_role()
    OR is_admin_or_staff()
  ) THEN
    RAISE EXCEPTION 'Service role or admin required';
  END IF;

  -- Rozměr je měření, ne volba: nula nebo záporné číslo není rozměr, je to vada sondy.
  IF p_embedding_dimensions IS NOT NULL AND p_embedding_dimensions <= 0 THEN
    RAISE EXCEPTION 'p_embedding_dimensions must be positive (got %)', p_embedding_dimensions;
  END IF;

  -- Check if model already exists
  SELECT id, NOT is_available INTO v_model_id, v_was_unavailable
  FROM ai_model_registry
  WHERE provider = p_provider AND model_id = p_model_id;

  IF v_model_id IS NULL THEN
    -- New model discovered
    v_is_new := true;

    INSERT INTO ai_model_registry (
      provider, model_id, display_name, model_family,
      is_chat_capable, is_reasoning, is_vision, is_code_optimized, is_function_calling, is_embedding,
      embedding_dimensions,
      context_window, max_output_tokens,
      input_price_per_m, output_price_per_m, cached_input_price_per_m,
      provider_metadata, eval_status, provider_registry_id
    ) VALUES (
      p_provider, p_model_id, p_display_name, p_model_family,
      p_is_chat_capable, p_is_reasoning, p_is_vision, p_is_code_optimized, p_is_function_calling, p_is_embedding,
      p_embedding_dimensions,
      p_context_window, p_max_output_tokens,
      p_input_price_per_m, p_output_price_per_m, p_cached_input_price_per_m,
      p_provider_metadata, 'pending',
      -- Link to the provider registry so the capability resolvers can JOIN by id.
      -- A model's `provider` is the family key; the registry `slug` is the
      -- addressable provider id (they differ for google/vllm) — normalize here so
      -- a freshly DISCOVERED Gemini/vLLM model is not silently dropped by the JOIN.
      (SELECT id FROM ai_provider_registry
        WHERE slug = CASE p_provider
                       WHEN 'google' THEN 'google-genai'
                       WHEN 'vllm'   THEN 'vllm-local'
                       ELSE p_provider
                     END)
    )
    RETURNING id, embedding_dimensions INTO v_model_id, v_dimensions;
  ELSE
    -- Update existing model
    UPDATE ai_model_registry
    SET last_seen_at = now(),
        is_available = true,
        display_name = COALESCE(p_display_name, display_name),
        model_family = COALESCE(p_model_family, model_family),
        is_chat_capable = p_is_chat_capable,
        is_reasoning = p_is_reasoning,
        is_vision = p_is_vision,
        is_code_optimized = p_is_code_optimized,
        is_function_calling = p_is_function_calling,
        is_embedding = p_is_embedding,
        -- MĚŘENÍ PŘEBÍJÍ DEKLARACI: změřený rozměr nahradí seedovaný. Nezměřeno (NULL)
        -- dosavadní hodnotu nechá — sonda, která neodpověděla, nic nevyvrací.
        embedding_dimensions = COALESCE(p_embedding_dimensions, embedding_dimensions),
        context_window = COALESCE(p_context_window, context_window),
        max_output_tokens = COALESCE(p_max_output_tokens, max_output_tokens),
        input_price_per_m = COALESCE(p_input_price_per_m, input_price_per_m),
        output_price_per_m = COALESCE(p_output_price_per_m, output_price_per_m),
        -- COALESCE: a scan that doesn't report a cache rate must not wipe an existing one.
        cached_input_price_per_m = COALESCE(p_cached_input_price_per_m, cached_input_price_per_m),
        -- Změřená metadata discovery přepisuje CELÁ (klíč, který sken přestal hlásit,
        -- nesmí zůstat se starou hodnotou). Jmenný prostor `declared` ale nepatří
        -- měření: je to DEKLARACE instance (např. pin vah embedderu, z nějž se skládá
        -- živá identita vektorů — idata 50_ai_provider_local_model.sql). Discovery ho
        -- proto ZACHOVÁ; bez toho by první sken pin smazal a platformní dopočet
        -- vektorů by přestal znát identitu runtime (fail-closed, ale tiché pro pokrytí).
        provider_metadata = p_provider_metadata
          || jsonb_strip_nulls(jsonb_build_object('declared', ai_model_registry.provider_metadata->'declared'))
    WHERE id = v_model_id
    RETURNING embedding_dimensions INTO v_dimensions;
  END IF;

  RETURN jsonb_build_object(
    'model_registry_id', v_model_id,
    'is_new', v_is_new,
    'was_unavailable', v_was_unavailable,
    'provider', p_provider,
    'model_id', p_model_id,
    -- Aktuální rozměr v registru (po zápisu) — discovery podle něj pozná, jestli
    -- je co měřit, a nemusí sondovat pomalý CPU embedding při každém průchodu.
    'embedding_dimensions', v_dimensions
  );
END;
$function$;

REVOKE ALL ON FUNCTION upsert_discovered_model(text, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, numeric, numeric, jsonb, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_discovered_model(text,text,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,numeric,numeric,jsonb,numeric,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_discovered_model(text,text,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer,integer,numeric,numeric,jsonb,numeric,integer) TO service_role;

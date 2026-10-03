-- Function: mark_models_unavailable
--
-- Dostupnost modelu je vlastnost ŽIVÉHO listingu providera: co v jeho ÚPLNÉM seznamu
-- (/v1/models) není, se neobsluhuje. Volá svc-ai-chat discovery (modelDiscovery.ts)
-- jen nad listingem, který backend výslovně označil jako úplný — stránkovaný nebo
-- nedostupný listing dostupnost NEMĚŘÍ a sem nedojde. Zpět na dostupný vrací model
-- upsert_discovered_model, jakmile se v listingu znovu objeví.
--
-- ⛔ NAMĚŘENO 2026-09-13: funkci nevolal nikdo, takže seedované vLLM řádky, které nic
-- neobsluhovalo, zůstávaly is_available=true a resolver je nabízel.
--
-- Audit: zmizení modelu z nabídky resolveru je rozhodnutí se stopou (kolik, u koho),
-- ne tichá změna — bez PII, jen provider a počet.

CREATE OR REPLACE FUNCTION public.mark_models_unavailable(p_provider text, p_available_model_ids text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT (
    public.is_service_role()
    OR is_admin_or_staff()
  ) THEN
    RAISE EXCEPTION 'Service role or admin required';
  END IF;

  -- NULL seznam není „nic se neobsluhuje", je to nezměřeno — `!= ALL(NULL)` by
  -- nic neoznačilo, ale tiché no-op by vypadalo jako úspěch. Hlasitě.
  IF p_provider IS NULL OR p_available_model_ids IS NULL THEN
    RAISE EXCEPTION 'p_provider and p_available_model_ids are required (empty array = provider serves nothing)';
  END IF;

  UPDATE ai_model_registry
  SET is_available = false
  WHERE provider = p_provider
    AND model_id != ALL(p_available_model_ids)
    AND is_available = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'models_marked_unavailable',
      jsonb_build_object(
        'provider', p_provider,
        'marked_unavailable', v_count,
        'listed_models', cardinality(p_available_model_ids),
        'source', 'live_listing'
      )
    );
  END IF;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION mark_models_unavailable(p_provider text, p_available_model_ids text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_models_unavailable(text,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_models_unavailable(text,text[]) TO service_role;

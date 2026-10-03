-- =============================================================================
-- get_plugin_sandbox_policy(p_plugin_slug)
--
-- Kam smí plugin z sandboxu volat — hostitelé (`network_allowlist`) a RPC
-- (`rpc_allowlist`) z jeho SCHVÁLENÉ sandbox politiky (`plugin_catalog.sandbox_policy`,
-- tedy `sandbox` z manifestu).
--
-- ⛔ PROČ (naměřeno 2026-09-26 v produkci instance): broker bral povolené hostitele
-- i RPC z proměnných služby `PLUGIN_NETWORK_ALLOWLIST` / `PLUGIN_RPC_WHITELIST` —
-- a ty byly prázdné. Každý plugin by tak po schválení dostal na první volání
-- dodavatele 403 „No network destinations are allowed" a na první zápis „No RPC
-- functions are allowed". Komentář brokeru přitom tvrdil, že zdrojem je manifest
-- — ten seznam hostitelů nesl, jen ho nikdo nečetl. Seznam, který musí někdo
-- ručně opsat do env každé instance, je třetí domov téže pravdy.
--
-- ⭐ `source_slug` = jméno zdroje ze `source_spec` pluginu. Broker podle něj
-- vynucuje, že plugin zapisuje do OBECNÝCH drah (např. source_catalog_rows přes
-- audience_sync_source_catalog) jen pod SVÝM jménem — argument `p_source_slug`
-- s cizím zdrojem odmítne. Bez toho by plugin se zápisem do katalogu mohl
-- přepsat (snapshot = i smazat) katalog jiného zdroje.
--
-- ⭐ JEN SCHVÁLENÝ PLUGIN. Sandbox politika je součást toho, co člověk schvaluje
-- (`submit_plugin` při její změně vrátí plugin na `submitted`). Plugin mimo
-- `canary`/`ga` dostane PRÁZDNÉ seznamy = žádné volání ven, žádný zápis
-- (default-deny, ne „co si manifest přeje").
--
-- Jen služba: volá ji broker hostu pro plugin, který nese broker token běhu.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_plugin_sandbox_policy(p_plugin_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status public.plugin_status;
  v_policy jsonb;
  v_zdroj  text;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'get_plugin_sandbox_policy: jen služba (broker svc-plugin-system)' USING ERRCODE = '42501';
  END IF;

  SELECT pc.status, COALESCE(pc.sandbox_policy, '{}'::jsonb), NULLIF(pc.source_spec->>'source_slug', '')
    INTO v_status, v_policy, v_zdroj
    FROM public.plugin_catalog pc
   WHERE pc.slug = p_plugin_slug;

  IF NOT FOUND OR v_status NOT IN ('canary'::public.plugin_status, 'ga'::public.plugin_status) THEN
    RETURN jsonb_build_object('schvaleno', false, 'source_slug', NULL,
                              'network_allowlist', '[]'::jsonb, 'rpc_allowlist', '[]'::jsonb);
  END IF;

  -- Jen řetězce: cokoli jiného v seznamu je vada manifestu, ne povolení.
  RETURN jsonb_build_object(
    'schvaleno', true,
    'source_slug', v_zdroj,
    'network_allowlist', COALESCE((SELECT jsonb_agg(h) FROM jsonb_array_elements(
                            CASE WHEN jsonb_typeof(v_policy->'network_allowlist') = 'array'
                                 THEN v_policy->'network_allowlist' ELSE '[]'::jsonb END) AS h
                          WHERE jsonb_typeof(h) = 'string'), '[]'::jsonb),
    'rpc_allowlist',     COALESCE((SELECT jsonb_agg(f) FROM jsonb_array_elements(
                            CASE WHEN jsonb_typeof(v_policy->'rpc_allowlist') = 'array'
                                 THEN v_policy->'rpc_allowlist' ELSE '[]'::jsonb END) AS f
                          WHERE jsonb_typeof(f) = 'string'), '[]'::jsonb));
END;
$$;

COMMENT ON FUNCTION public.get_plugin_sandbox_policy(text) IS
  'Service only (plugin broker): network and RPC allowlists from the APPROVED (canary/ga) plugin''s sandbox policy; anything else gets empty lists (default-deny).';

REVOKE ALL ON FUNCTION public.get_plugin_sandbox_policy(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_plugin_sandbox_policy(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plugin_sandbox_policy(text) TO service_role;

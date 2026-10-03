-- =============================================================================
-- get_plugin_runtime_config(p_plugin_slug, p_tenant_id)
--
-- Konfigurace, se kterou plugin POBĚŽÍ (ctx.config) — složená z domovů, kde ji
-- platforma drží, v pořadí od obecného ke konkrétnímu:
--   1. výchozí hodnoty z config_schema.properties.*.default (jen ne-tajné pole),
--   2. source_spec.default_config (konektory),
--   3. konfigurace datového zdroje (set_data_source_config) — zdroj napojený na
--      plugin (agent_knowledge_sources.source_plugin_id),
--   4. pověření zdroje (set_data_source_secrets) — DEŠIFROVANÁ auditovaně,
--   5. přepis tenanta (plugin_tenant_overrides.config_override), pokud ho tenant má.
--
-- ⛔ NAMĚŘENO 2026-09-16: host předával pluginu `ctx.config = {}` (config šel
-- v ENV kontejneru, kam pověření nesmí) a `set_data_source_secrets` nikdo nečetl
-- — konektor tedy neměl endpoint ani pověření a mohl jen selhat.
--
-- Jen služba: volá ji broker hostu (/sandbox/config) pro plugin a tenanta, které
-- nese broker token běhu. Výsledek nese tajemství — nikdy do ENV, nikdy do logu.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_plugin_runtime_config(
  p_plugin_slug text,
  p_tenant_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_plugin  public.plugin_catalog%ROWTYPE;
  v_config  jsonb := '{}'::jsonb;
  v_zdroj   public.agent_knowledge_sources%ROWTYPE;
  v_tajne   jsonb;
  v_prepis  jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'get_plugin_runtime_config: jen služba (broker svc-plugin-system)' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_plugin FROM public.plugin_catalog WHERE slug = p_plugin_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'get_plugin_runtime_config: plugin % neexistuje', p_plugin_slug;
  END IF;

  -- 1. výchozí hodnoty schématu (pole označená secret se z výchozích hodnot neberou)
  SELECT COALESCE(jsonb_object_agg(k, v->'default'), '{}'::jsonb)
    INTO v_config
    FROM jsonb_each(COALESCE(v_plugin.config_schema->'properties', '{}'::jsonb)) AS e(k, v)
   WHERE v ? 'default' AND COALESCE((v->>'secret')::boolean, false) = false;

  -- 2. výchozí konfigurace konektoru
  v_config := v_config || COALESCE(v_plugin.source_spec->'default_config', '{}'::jsonb);

  -- 3. + 4. datový zdroj napojený na plugin
  -- ⚠ Víc zdrojů téhož pluginu (druhá instance konektoru) = dnes první podle vzniku,
  -- deterministicky (dřív LIMIT 1 bez ORDER BY = náhodně cizí pověření). Změřeno
  -- 2026-09-29 riq: plugin:zdroj 1:1. Správně: zdroj z BĚHU (run → source_id) — krok B.
  SELECT * INTO v_zdroj FROM public.agent_knowledge_sources
   WHERE source_plugin_id = v_plugin.id ORDER BY created_at, id LIMIT 1;
  IF FOUND THEN
    v_config := v_config || COALESCE(v_zdroj.config, '{}'::jsonb);
    -- Audit každého dešifrování nese účel, klíč, plugin a zdroj (ne hodnotu) — kdo co četl.
    SELECT COALESCE(jsonb_object_agg(s.secret_key, public.aisha_decrypt_column_audited(s.value_enc, jsonb_build_object(
             'ucel', 'plugin_runtime', 'entita', 'agent_knowledge_source', 'entita_id', v_zdroj.id::text,
             'klic', s.secret_key, 'plugin', p_plugin_slug, 'tenant', p_tenant_id))), '{}'::jsonb)
      INTO v_tajne
      FROM public.agent_knowledge_source_secrets s
     WHERE s.source_id = v_zdroj.id;
    v_config := v_config || v_tajne;
  END IF;

  -- 5. přepis tenanta
  IF p_tenant_id IS NOT NULL THEN
    SELECT config_override INTO v_prepis
      FROM public.plugin_tenant_overrides
     WHERE plugin_id = v_plugin.id AND tenant_id = p_tenant_id;
    v_config := v_config || COALESCE(v_prepis, '{}'::jsonb);
  END IF;

  RETURN v_config;
END;
$$;

COMMENT ON FUNCTION public.get_plugin_runtime_config(text, uuid) IS
  'Konfigurace běhu pluginu (výchozí → zdroj → dešifrovaná pověření → přepis tenanta). Nese tajemství. Jen služba.';

REVOKE ALL ON FUNCTION public.get_plugin_runtime_config(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_plugin_runtime_config(text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plugin_runtime_config(text, uuid) TO service_role;

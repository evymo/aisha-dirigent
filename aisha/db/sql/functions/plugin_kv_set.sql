-- Function: public.plugin_kv_set
-- Per-plugin key/value WRITE for the plugin sandbox broker. Upserts into the
-- shared plugin_kv store under the fixed broker partition (nil tenant sentinel),
-- resolving the plugin slug to plugin_catalog.id. Mirrors sandbox_kv_op 'set'.
-- Security: SECURITY DEFINER (service_role-invoked via rpcService), search_path pinned.

CREATE OR REPLACE FUNCTION public.plugin_kv_set(
  p_key text,
  p_plugin text,
  p_value jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_broker_tenant constant uuid := '00000000-0000-0000-0000-000000000000';
  v_plugin_id uuid;
BEGIN
  IF p_plugin IS NULL OR p_key IS NULL THEN
    RAISE EXCEPTION 'plugin and key are required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_plugin_id FROM public.plugin_catalog WHERE slug = p_plugin;
  IF v_plugin_id IS NULL THEN
    RAISE EXCEPTION 'Unknown plugin slug: %', p_plugin USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.plugin_kv (plugin_id, tenant_id, key, value)
  VALUES (v_plugin_id, v_broker_tenant, p_key, COALESCE(p_value, '{}'::jsonb))
  ON CONFLICT (plugin_id, tenant_id, key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now();
END;
$function$;

COMMENT ON FUNCTION public.plugin_kv_set(text, text, jsonb) IS
  'Per-plugin (slug-keyed) sandbox KV upsert for the plugin broker.';

REVOKE ALL ON FUNCTION public.plugin_kv_set(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plugin_kv_set(text, text, jsonb) TO service_role;

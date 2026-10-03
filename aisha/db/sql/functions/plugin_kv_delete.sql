-- Function: public.plugin_kv_delete
-- Per-plugin key/value DELETE for the plugin sandbox broker. Removes the key from
-- the shared plugin_kv store under the fixed broker partition (nil tenant
-- sentinel), resolving the plugin slug to plugin_catalog.id. Mirrors
-- sandbox_kv_op 'delete'.
-- Security: SECURITY DEFINER (service_role-invoked via rpcService), search_path pinned.

CREATE OR REPLACE FUNCTION public.plugin_kv_delete(
  p_key text,
  p_plugin text
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

  DELETE FROM public.plugin_kv
  WHERE plugin_id = v_plugin_id
    AND tenant_id = v_broker_tenant
    AND key = p_key;
END;
$function$;

COMMENT ON FUNCTION public.plugin_kv_delete(text, text) IS
  'Per-plugin (slug-keyed) sandbox KV delete for the plugin broker.';

REVOKE ALL ON FUNCTION public.plugin_kv_delete(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plugin_kv_delete(text, text) TO service_role;

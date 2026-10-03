-- Function: public.plugin_kv_get
-- Per-plugin key/value READ for the plugin sandbox broker (svc-plugin-system
-- routes/broker.ts + sandbox.ts). The broker identifies the plugin by SLUG
-- (broker token source_ref), tenant-agnostic — distinct from sandbox_kv_op which
-- is tenant-scoped. Resolves the slug to plugin_catalog.id and reads the row from
-- the shared plugin_kv store under a fixed broker partition (nil tenant sentinel).
-- Returns 'null'::jsonb when the key is absent.
-- Security: SECURITY DEFINER (service_role-invoked via rpcService), search_path pinned.

CREATE OR REPLACE FUNCTION public.plugin_kv_get(
  p_key text,
  p_plugin text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Broker KV is per-plugin (not per-tenant); park it under a fixed sentinel
  -- tenant so the (plugin_id, tenant_id, key) unique key still holds.
  v_broker_tenant constant uuid := '00000000-0000-0000-0000-000000000000';
  v_plugin_id uuid;
  v_result jsonb;
BEGIN
  IF p_plugin IS NULL OR p_key IS NULL THEN
    RAISE EXCEPTION 'plugin and key are required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_plugin_id FROM public.plugin_catalog WHERE slug = p_plugin;
  IF v_plugin_id IS NULL THEN
    RAISE EXCEPTION 'Unknown plugin slug: %', p_plugin USING ERRCODE = 'no_data_found';
  END IF;

  SELECT value INTO v_result
  FROM public.plugin_kv
  WHERE plugin_id = v_plugin_id
    AND tenant_id = v_broker_tenant
    AND key = p_key;

  RETURN COALESCE(v_result, 'null'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.plugin_kv_get(text, text) IS
  'Per-plugin (slug-keyed) sandbox KV read for the plugin broker. Returns null jsonb when absent.';

REVOKE ALL ON FUNCTION public.plugin_kv_get(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plugin_kv_get(text, text) TO service_role;

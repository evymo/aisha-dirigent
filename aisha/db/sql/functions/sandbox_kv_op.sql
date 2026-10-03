-- ============================================================================
-- sandbox_kv_op — Sandboxed key-value CRUD for plugins
-- Called by plugin-host on behalf of plugin code via SandboxContext.kv
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sandbox_kv_op(
  p_key text DEFAULT NULL,
  p_op text DEFAULT 'get',
  p_plugin_id uuid DEFAULT NULL,
  p_prefix text DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL,
  p_value jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_plugin_id IS NULL OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'plugin_id and tenant_id are required';
  END IF;

  CASE p_op
    WHEN 'get' THEN
      SELECT value INTO v_result
      FROM public.plugin_kv
      WHERE plugin_id = p_plugin_id
        AND tenant_id = p_tenant_id
        AND key = p_key;
      RETURN COALESCE(v_result, 'null'::jsonb);

    WHEN 'set' THEN
      INSERT INTO public.plugin_kv (plugin_id, tenant_id, key, value)
      VALUES (p_plugin_id, p_tenant_id, p_key, COALESCE(p_value, '{}'::jsonb))
      ON CONFLICT (plugin_id, tenant_id, key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now();
      RETURN jsonb_build_object('ok', true);

    WHEN 'delete' THEN
      DELETE FROM public.plugin_kv
      WHERE plugin_id = p_plugin_id
        AND tenant_id = p_tenant_id
        AND key = p_key;
      RETURN jsonb_build_object('ok', true);

    WHEN 'list' THEN
      SELECT jsonb_agg(key) INTO v_result
      FROM public.plugin_kv
      WHERE plugin_id = p_plugin_id
        AND tenant_id = p_tenant_id
        AND (p_prefix IS NULL OR key LIKE p_prefix || '%');
      RETURN COALESCE(v_result, '[]'::jsonb);

    ELSE
      RAISE EXCEPTION 'Unknown KV operation: %', p_op;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.sandbox_kv_op(text, text, uuid, text, uuid, jsonb) IS 'Sandboxed key-value CRUD for plugins. Called by plugin-host on behalf of plugin code.';

REVOKE ALL ON FUNCTION public.sandbox_kv_op(text, text, uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sandbox_kv_op(text, text, uuid, text, uuid, jsonb) TO authenticated;

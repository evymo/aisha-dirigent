-- =============================================================================
-- register_plugin_event(p_plugin_id, p_event_kind, p_latency_ms, p_error, p_tenant_id, p_metadata)
-- =============================================================================
-- Records a health event after each plugin invocation.
-- Called by svc-plugin-system after every plugin run (invoke/error/timeout).
-- SECURITY DEFINER, service role only (was anon-callable until 2026-09-24).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_plugin_event(
  p_error       text DEFAULT NULL,
  p_event_kind  text DEFAULT NULL,
  p_latency_ms  integer DEFAULT NULL,
  p_metadata    jsonb DEFAULT '{}'::jsonb,
  p_plugin_id   uuid DEFAULT NULL,
  p_tenant_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  -- ⛔ 2026-09-24: funkce byla povolená anon i authenticated („callable from edge
  -- functions running as anon") — kdokoli mohl podvrhnout telemetrii, ze které
  -- teď čte hlídač stavu zdrojů. Zapisuje JEN host pluginů (svc-plugin-system).
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'register_plugin_event: jen služba (svc-plugin-system)' USING ERRCODE = '42501';
  END IF;
  IF p_plugin_id IS NULL OR p_event_kind IS NULL THEN
    RAISE EXCEPTION 'p_plugin_id and p_event_kind are required';
  END IF;

  INSERT INTO public.plugin_health_events (
    plugin_id, tenant_id, event_kind, latency_ms, error_text, metadata
  ) VALUES (
    p_plugin_id,
    p_tenant_id,
    p_event_kind::public.plugin_health_event_kind,
    p_latency_ms,
    p_error,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'plugin_id', p_plugin_id,
    'event_kind', p_event_kind
  );
END;
$$;

COMMENT ON FUNCTION public.register_plugin_event(text, text, integer, jsonb, uuid, uuid) IS
  'Records a plugin health event (load/invoke/error/timeout). Called by plugin-host.';

REVOKE ALL ON FUNCTION public.register_plugin_event(text, text, integer, jsonb, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_plugin_event(text, text, integer, jsonb, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_plugin_event(text, text, integer, jsonb, uuid, uuid) TO service_role;

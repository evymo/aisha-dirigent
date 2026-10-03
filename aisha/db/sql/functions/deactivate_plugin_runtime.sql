-- ============================================================================
-- Source of Truth: deactivate_plugin_runtime — the kill-switch dispatcher.
--
-- Counterpart of materialize_plugin: when a plugin is disabled/archived, its
-- materialized runtime rows are switched off — ONLY rows this plugin owns
-- (source_plugin_id), so a shared slug never lets one plugin's kill-switch
-- darken a built-in or another plugin's row. Rows are disabled, never deleted:
-- provenance and operator forensics survive, and re-approval re-materializes
-- without resurrecting operator-disabled trust boundaries (each materializer's
-- ON CONFLICT leaves is_enabled untouched for auth/tracking).
-- Security: SECURITY DEFINER, service_role only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.deactivate_plugin_runtime(p_plugin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pc       record;
  v_counts   jsonb := '{}'::jsonb;
  v_n        int;
BEGIN
  SELECT id, slug, kind::text AS kind INTO v_pc
    FROM public.plugin_catalog WHERE id = p_plugin_id;

  IF v_pc.id IS NULL THEN
    RAISE EXCEPTION 'Plugin not found: %', p_plugin_id USING ERRCODE = 'P0002';
  END IF;

  -- Agents have a dedicated disabler (bindings + catalog row semantics).
  IF v_pc.kind IN ('agent', 'full_stack') THEN
    PERFORM public.disable_agent_runtime(p_plugin_id);
    v_counts := v_counts || jsonb_build_object('agent', 'disable_agent_runtime called');
  END IF;

  UPDATE public.ai_provider_registry SET is_enabled = false, updated_at = now()
   WHERE source_plugin_id = p_plugin_id AND is_enabled;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_counts := v_counts || jsonb_build_object('providers_disabled', v_n); END IF;

  UPDATE public.custom_node_registry SET is_active = false, updated_at = now()
   WHERE source_plugin_id = p_plugin_id AND is_active;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_counts := v_counts || jsonb_build_object('nodes_disabled', v_n); END IF;

  UPDATE public.auth_provider_registry SET is_enabled = false, updated_at = now()
   WHERE source_plugin_id = p_plugin_id AND is_enabled;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_counts := v_counts || jsonb_build_object('idps_disabled', v_n); END IF;

  UPDATE public.web_tracking_registry SET is_enabled = false, updated_at = now()
   WHERE source_plugin_id = p_plugin_id AND is_enabled;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_counts := v_counts || jsonb_build_object('trackers_disabled', v_n); END IF;

  UPDATE public.agent_knowledge_sources SET is_active = false, updated_at = now()
   WHERE source_plugin_id = p_plugin_id AND is_active;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_counts := v_counts || jsonb_build_object('sources_deactivated', v_n); END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'PLUGIN_RUNTIME_DEACTIVATED', jsonb_build_object(
    'area', 'marketplace', 'severity', 'warning',
    'plugin_id', p_plugin_id, 'plugin_slug', v_pc.slug, 'kind', v_pc.kind,
    'effects', v_counts
  ));

  RETURN jsonb_build_object('plugin_slug', v_pc.slug, 'kind', v_pc.kind, 'effects', v_counts);
END;
$$;

COMMENT ON FUNCTION public.deactivate_plugin_runtime(uuid) IS
  'Kill-switch dispatcher: disable every runtime row a plugin owns (source_plugin_id) across all registries. Disables, never deletes. service_role only.';

REVOKE ALL ON FUNCTION public.deactivate_plugin_runtime(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_plugin_runtime(uuid) TO service_role;

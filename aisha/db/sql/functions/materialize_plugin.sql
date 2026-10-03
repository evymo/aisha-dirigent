-- ============================================================================
-- Source of Truth: materialize_plugin — the kind dispatcher.
--
-- ONE verb for the approval gates: every plugin kind that reaches
-- canary/ga materializes here into its runtime registry, so "approved manifest
-- ⇒ resolver-visible registry row" holds for the WHOLE plugin surface, not
-- just agents (the pre-2026-07-26 state: 6 kinds declared, 1 wired — see
-- expert_rule declared-extension-must-reach-the-resolver).
--
-- kind → materializer → registry:
--   agent            → materialize_agent_runtime   → agent_catalog
--   backend_provider → materialize_backend_provider→ ai_provider_registry
--   automation_node  → materialize_automation_node → custom_node_registry
--   auth_provider    → materialize_auth_provider   → auth_provider_registry (disabled)
--   web_tracking     → materialize_web_tracking    → web_tracking_registry  (disabled)
--   data_source      → materialize_data_source     → agent_knowledge_sources (inactive)
--   full_stack       → composite: every present spec materializes
--
-- An unknown kind RAISES — this function is the runtime twin of the
-- plugin-kind-has-materializer gate: a kind added to the enum without a
-- dispatch branch fails LOUD at first approval, never silently.
-- Security: SECURITY DEFINER, service_role only (approval-gate context).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.materialize_plugin(p_plugin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pc     record;
  v_result jsonb := '{}'::jsonb;
BEGIN
  SELECT id, slug, kind::text AS kind,
         agent_spec, provider_spec, node_spec, auth_spec, tracking_spec, source_spec
    INTO v_pc
    FROM public.plugin_catalog
   WHERE id = p_plugin_id;

  IF v_pc.id IS NULL THEN
    RAISE EXCEPTION 'Plugin not found: %', p_plugin_id USING ERRCODE = 'P0002';
  END IF;

  CASE v_pc.kind
    WHEN 'agent' THEN
      v_result := public.materialize_agent_runtime(p_plugin_id);
    WHEN 'backend_provider' THEN
      v_result := public.materialize_backend_provider(p_plugin_id);
    WHEN 'automation_node' THEN
      v_result := public.materialize_automation_node(p_plugin_id);
    WHEN 'auth_provider' THEN
      v_result := public.materialize_auth_provider(p_plugin_id);
    WHEN 'web_tracking' THEN
      v_result := public.materialize_web_tracking(p_plugin_id);
    WHEN 'data_source' THEN
      v_result := public.materialize_data_source(p_plugin_id);
    WHEN 'full_stack' THEN
      -- Composite: a full_stack plugin materializes every part it declares.
      -- Each part-materializer skips honestly when its spec is NULL, so this
      -- walk is total; parts land under their spec's key for traceability.
      IF v_pc.agent_spec    IS NOT NULL THEN v_result := v_result || jsonb_build_object('agent',    public.materialize_agent_runtime(p_plugin_id));   END IF;
      IF v_pc.provider_spec IS NOT NULL THEN v_result := v_result || jsonb_build_object('provider', public.materialize_backend_provider(p_plugin_id)); END IF;
      IF v_pc.node_spec     IS NOT NULL THEN v_result := v_result || jsonb_build_object('node',     public.materialize_automation_node(p_plugin_id));  END IF;
      IF v_pc.auth_spec     IS NOT NULL THEN v_result := v_result || jsonb_build_object('auth',     public.materialize_auth_provider(p_plugin_id));    END IF;
      IF v_pc.tracking_spec IS NOT NULL THEN v_result := v_result || jsonb_build_object('tracking', public.materialize_web_tracking(p_plugin_id));     END IF;
      IF v_pc.source_spec   IS NOT NULL THEN v_result := v_result || jsonb_build_object('source',   public.materialize_data_source(p_plugin_id));      END IF;
      IF v_result = '{}'::jsonb THEN
        v_result := jsonb_build_object('skipped', 'full_stack with no spec blocks', 'plugin_slug', v_pc.slug);
      END IF;
    ELSE
      RAISE EXCEPTION 'No materializer for plugin kind % (plugin %) — add a dispatch branch AND a materialize_* function; the plugin-kind-has-materializer gate enforces this',
        v_pc.kind, v_pc.slug USING ERRCODE = 'P0001';
  END CASE;

  RETURN jsonb_build_object('plugin_slug', v_pc.slug, 'kind', v_pc.kind) || jsonb_build_object('materialized', v_result);
END;
$$;

COMMENT ON FUNCTION public.materialize_plugin(uuid) IS
  'Kind dispatcher: approved plugin → its runtime registry row(s). Unknown kind raises (runtime twin of the plugin-kind-has-materializer gate). service_role only.';

REVOKE ALL ON FUNCTION public.materialize_plugin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_plugin(uuid) TO service_role;

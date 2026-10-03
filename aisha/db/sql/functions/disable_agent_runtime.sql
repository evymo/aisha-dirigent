-- ============================================================================
-- Source of Truth: disable_agent_runtime
-- Purpose: De-provision a marketplace agent's runtime when its plugin_catalog
--          row is disabled/archived (the operator kill-switch). Deactivates the
--          materialized agent_catalog row + its global bindings — NOT a delete,
--          so ai_runs / audit history that reference the slug stay intact.
--          route_task already filters is_active=true, so deactivation removes
--          routability immediately.
-- Called from transition_plugin_status when a kind='agent' plugin moves to
-- 'disabled'/'archived'. Idempotent (no-op if already disabled / never materialized).
-- Security: SECURITY DEFINER, service_role only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.disable_agent_runtime(p_plugin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_catalog_id uuid;
  v_agent_slug text;
BEGIN
  UPDATE public.agent_catalog
     SET is_active = false, updated_at = now()
   WHERE source_plugin_id = p_plugin_id
   RETURNING id, slug INTO v_catalog_id, v_agent_slug;

  IF v_agent_slug IS NULL THEN
    -- never materialized (e.g. executable agent) → nothing to disable
    RETURN jsonb_build_object('disabled', false, 'plugin_id', p_plugin_id);
  END IF;

  UPDATE public.agent_knowledge_bindings
     SET is_active = false, updated_at = now()
   WHERE agent_slug = v_agent_slug AND story_id IS NULL;

  -- Audit (auth.uid() may be NULL in service context — FK-safe).
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'AGENT_RUNTIME_DISABLED', jsonb_build_object(
    'area', 'marketplace', 'severity', 'info',
    'plugin_id', p_plugin_id, 'agent_slug', v_agent_slug
  ));

  RETURN jsonb_build_object('disabled', true, 'agent_slug', v_agent_slug);
END;
$$;

COMMENT ON FUNCTION public.disable_agent_runtime(uuid) IS
  'Deactivate a marketplace agent''s materialized agent_catalog row + bindings on plugin disable/archive. Idempotent; service_role only.';

REVOKE ALL ON FUNCTION public.disable_agent_runtime(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disable_agent_runtime(uuid) TO service_role;

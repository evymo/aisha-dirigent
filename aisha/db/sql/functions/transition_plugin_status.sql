-- =============================================================================
-- transition_plugin_status(p_plugin_id, p_new_status, p_metadata)
-- =============================================================================
-- State machine for plugin lifecycle transitions.
-- Validates against plugin_transition_rules, checks role requirement,
-- updates status, logs to plugin_audit_events.
-- Pattern: identical to transition_story_delivery_status.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.transition_plugin_status(
  p_metadata    jsonb DEFAULT '{}'::jsonb,
  p_new_status  text DEFAULT NULL,
  p_plugin_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_status  public.plugin_status;
  v_target_status   public.plugin_status;
  v_requires_role   text;
  v_user_id         uuid := auth.uid();
  v_slug            text;
  v_kind            public.plugin_kind;
BEGIN
  IF p_plugin_id IS NULL OR p_new_status IS NULL THEN
    RAISE EXCEPTION 'p_plugin_id and p_new_status are required';
  END IF;

  v_target_status := p_new_status::public.plugin_status;

  -- Lock and get current status
  SELECT status, slug, kind INTO v_current_status, v_slug, v_kind
  FROM public.plugin_catalog
  WHERE id = p_plugin_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plugin % not found', p_plugin_id;
  END IF;

  -- Validate transition against rules
  SELECT ptr.requires_role INTO v_requires_role
  FROM public.plugin_transition_rules ptr
  WHERE ptr.from_status = v_current_status
    AND ptr.to_status = v_target_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Transition %s → %s not allowed', v_current_status, v_target_status)
    );
  END IF;

  -- Check role requirement
  IF v_requires_role = 'admin' AND NOT public.is_admin_or_staff() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Admin role required for this transition'
    );
  END IF;

  IF v_requires_role = 'staff' AND NOT public.is_admin_or_staff() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Staff role required for this transition'
    );
  END IF;

  -- Execute transition
  UPDATE public.plugin_catalog
  SET status = v_target_status, updated_at = now()
  WHERE id = p_plugin_id;

  -- Keep the agent runtime (agent_catalog) in sync with the plugin lifecycle:
  -- disabled/archived → de-provision (kill-switch); canary/ga → (re)materialize.
  -- Both are idempotent and a no-op for non-agents / executable agents.
  -- EVERY kind materializes/deactivates through the dispatchers — "approved
  -- manifest ⇒ resolver-visible registry row" holds for the whole surface,
  -- not just agents (plugin-kind-has-materializer doctrine, 2026-07-26).
  IF v_target_status IN ('disabled'::public.plugin_status, 'archived'::public.plugin_status) THEN
    PERFORM public.deactivate_plugin_runtime(p_plugin_id);
  ELSIF v_target_status IN ('canary'::public.plugin_status, 'ga'::public.plugin_status) THEN
    PERFORM public.materialize_plugin(p_plugin_id);
  END IF;

  -- Audit log
  INSERT INTO public.plugin_audit_events (plugin_id, actor_id, action, metadata)
  VALUES (
    p_plugin_id, v_user_id,
    'PLUGIN_STATUS_CHANGE',
    jsonb_build_object(
      'from_status', v_current_status::text,
      'to_status', v_target_status::text,
      'slug', v_slug
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN jsonb_build_object(
    'success', true,
    'plugin_id', p_plugin_id,
    'slug', v_slug,
    'from_status', v_current_status::text,
    'to_status', v_target_status::text
  );
END;
$$;

COMMENT ON FUNCTION public.transition_plugin_status(jsonb, text, uuid) IS
  'State machine transition for plugin status. Validates rules + role, logs audit.';

REVOKE ALL ON FUNCTION public.transition_plugin_status(jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_plugin_status(jsonb, text, uuid) TO authenticated;

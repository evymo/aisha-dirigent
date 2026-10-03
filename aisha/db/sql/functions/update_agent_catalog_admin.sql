-- Function: public.update_agent_catalog_admin
-- Arguments: p_id uuid, p_updates jsonb
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.update_agent_catalog_admin(p_id uuid, p_updates jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old record;
  v_old_snapshot jsonb;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = 'P0003';
  END IF;

  -- Snapshot current state BEFORE update (audit trail)
  SELECT slug, default_model, model_overrides, safety_level,
         autonomy_level, allowed_tools, denied_tools, max_loops, is_active
  INTO v_old
  FROM agent_catalog WHERE id = p_id;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Agent not found: %', p_id USING ERRCODE = 'P0002';
  END IF;

  v_old_snapshot := jsonb_build_object(
    'allowed_tools', to_jsonb(v_old.allowed_tools),
    'autonomy_level', v_old.autonomy_level,
    'default_model', v_old.default_model,
    'denied_tools', to_jsonb(v_old.denied_tools),
    'is_active', v_old.is_active,
    'max_loops', v_old.max_loops,
    'model_overrides', v_old.model_overrides,
    'safety_level', v_old.safety_level
  );

  UPDATE agent_catalog
  SET
    display_name = COALESCE(p_updates->>'display_name', display_name),
    purpose = COALESCE(p_updates->>'purpose', purpose),
    default_model = COALESCE(p_updates->>'default_model', default_model),
    default_context_profile = COALESCE(p_updates->>'default_context_profile', default_context_profile),
    safety_level = COALESCE((p_updates->>'safety_level')::text, safety_level),
    max_loops = COALESCE((p_updates->>'max_loops')::int, max_loops),
    is_active = COALESCE((p_updates->>'is_active')::boolean, is_active),
    model_overrides = COALESCE(
      CASE WHEN p_updates ? 'model_overrides' THEN p_updates->'model_overrides' ELSE NULL END,
      model_overrides
    ),
    allowed_tools = COALESCE(
      CASE WHEN p_updates ? 'allowed_tools'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_updates->'allowed_tools'))
        ELSE NULL END,
      allowed_tools
    ),
    denied_tools = COALESCE(
      CASE WHEN p_updates ? 'denied_tools'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_updates->'denied_tools'))
        ELSE NULL END,
      denied_tools
    ),
    autonomy_level = COALESCE((p_updates->>'autonomy_level')::text, autonomy_level),
    updated_at = now()
  WHERE id = p_id;

  -- Audit: log WHO changed WHAT, with before-state snapshot
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'AGENT_CATALOG_UPDATE',
    jsonb_build_object(
      'agent_id', p_id,
      'agent_slug', v_old.slug,
      'area', 'ai',
      'previous_state', v_old_snapshot,
      'requested_changes', p_updates,
      'severity', 'info'
    )
  );

  RETURN p_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_agent_catalog_admin(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_agent_catalog_admin(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_agent_catalog_admin(uuid, jsonb) TO service_role;

-- Function: fn_rollback_agent_config

CREATE OR REPLACE FUNCTION public.fn_rollback_agent_config(p_agent_configuration_id uuid, p_proposal_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT 'auto_rollback_regression'::text, p_target_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot jsonb;
  v_current_version integer;
  v_rollback_version integer;
  v_agent_name text;
  v_new_version integer;
BEGIN
  -- Auth check: admin/staff only (or service_role for automated rollbacks)
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin_or_staff() THEN
    RETURN jsonb_build_object('error', 'Permission denied: admin or staff role required');
  END IF;

  SELECT name, instructions_version
  INTO v_agent_name, v_current_version
  FROM agent_configurations
  WHERE id = p_agent_configuration_id;

  IF v_agent_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Agent configuration not found');
  END IF;

  v_rollback_version := COALESCE(p_target_version, v_current_version - 1);

  IF v_rollback_version < 1 THEN
    RETURN jsonb_build_object('error', 'No previous version to roll back to');
  END IF;

  SELECT configuration_snapshot
  INTO v_snapshot
  FROM agent_configuration_history
  WHERE agent_configuration_id = p_agent_configuration_id
    AND version = v_rollback_version;

  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Version ' || v_rollback_version || ' not found in history'
    );
  END IF;

  UPDATE agent_configurations SET
    model = COALESCE(v_snapshot->>'model', model),
    model_settings = COALESCE(v_snapshot->'model_settings', model_settings),
    temperature = COALESCE((v_snapshot->>'temperature')::numeric, temperature),
    max_tokens = COALESCE((v_snapshot->>'max_tokens')::integer, max_tokens),
    instructions = COALESCE(v_snapshot->>'instructions', instructions),
    instructions_version = v_current_version + 1,
    tools_config = COALESCE(v_snapshot->'tools_config', tools_config),
    guardrails_config = COALESCE(v_snapshot->'guardrails_config', guardrails_config),
    updated_at = now()
  WHERE id = p_agent_configuration_id
  RETURNING instructions_version INTO v_new_version;

  INSERT INTO agent_configuration_history (
    agent_configuration_id, configuration_snapshot, version, change_summary, changed_at
  ) VALUES (
    p_agent_configuration_id, v_snapshot, v_new_version,
    'ROLLBACK to v' || v_rollback_version || ': ' || p_reason, now()
  );

  IF p_proposal_id IS NOT NULL THEN
    UPDATE improvement_proposals
    SET status = 'rolled_back',
        metadata = metadata || jsonb_build_object(
          'rollback_reason', p_reason,
          'rollback_from_version', v_current_version,
          'rollback_to_version', v_rollback_version,
          'rolled_back_at', now()::text
        ),
        updated_at = now()
    WHERE id = p_proposal_id;
  END IF;

  INSERT INTO audit_journal (user_id, action, metadata) VALUES (
    auth.uid(),
    'AGENT_CONFIG_ROLLBACK',
    jsonb_build_object(
      'agent_configuration_id', p_agent_configuration_id,
      'agent_name', v_agent_name,
      'from_version', v_current_version,
      'to_version', v_rollback_version,
      'new_version', v_new_version,
      'reason', p_reason,
      'proposal_id', p_proposal_id
    )
  );

  RETURN jsonb_build_object(
    'status', 'rolled_back',
    'agent_name', v_agent_name,
    'from_version', v_current_version,
    'to_version', v_rollback_version,
    'new_version', v_new_version,
    'proposal_id', p_proposal_id
  );
END;
$function$

;

REVOKE ALL ON FUNCTION fn_rollback_agent_config(uuid,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_rollback_agent_config(uuid,uuid,text,integer) TO authenticated;

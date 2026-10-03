-- Function: update_mcp_status_admin
-- Operator status transition for mcp_server_registry. Unlike provider
-- registry (binary on/off toggle), MCP servers have a 7-state lifecycle
-- and only specific transitions are valid:
--
--   discovered    → tested_ok / tested_failed / rejected
--   tested_ok     → enabled / rejected / deprecated
--   enabled       → in_use / deprecated
--   in_use        → deprecated   (cannot go back without re-test)
--   tested_failed → tested_ok    (after retry succeeded — usually via probe)
--   deprecated    → enabled      (operator override / reactivation)
--   rejected      → discovered   (operator override / wants to re-evaluate)
--
-- The transitions enforced here are operator-driven (admin UI buttons).
-- WF_MCP_PROBE writes status transitions via aisha_record_mcp_test_result
-- (probe-driven), and those bypass this validation (probe outcomes are
-- authoritative for tested_ok/tested_failed).
--
-- Audits via audit_journal action='MCP_STATUS_UPDATED'.

CREATE OR REPLACE FUNCTION public.update_mcp_status_admin(
  p_mcp_id      uuid,
  p_new_status  text,
  p_note        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_slug          text;
  v_old_status    text;
  v_valid_transition boolean := false;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff role required' USING ERRCODE = '22023';
  END IF;

  IF p_mcp_id IS NULL THEN
    RAISE EXCEPTION 'p_mcp_id required' USING ERRCODE = '22023';
  END IF;

  IF p_new_status NOT IN ('discovered', 'tested_ok', 'tested_failed', 'enabled', 'in_use', 'deprecated', 'rejected') THEN
    RAISE EXCEPTION 'Invalid p_new_status: % (allowed: discovered|tested_ok|tested_failed|enabled|in_use|deprecated|rejected)', p_new_status
      USING ERRCODE = '22023';
  END IF;

  SELECT slug, status INTO v_slug, v_old_status
  FROM   mcp_server_registry
  WHERE  id = p_mcp_id
  FOR    UPDATE;

  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'MCP server not found: %', p_mcp_id USING ERRCODE = '22023';
  END IF;

  -- No-op idempotency: same status → success but no audit/update
  IF v_old_status = p_new_status THEN
    RETURN jsonb_build_object(
      'success',         true,
      'slug',            v_slug,
      'old_status',      v_old_status,
      'new_status',      p_new_status,
      'transition',      'no_change'
    );
  END IF;

  -- Validate operator-driven transitions. We enforce these explicitly rather
  -- than letting any → any to prevent accidental footguns. The probe path
  -- (aisha_record_mcp_test_result) bypasses this — it's authoritative for
  -- tested_ok / tested_failed.
  v_valid_transition := CASE
    WHEN v_old_status = 'discovered'    AND p_new_status IN ('tested_ok', 'tested_failed', 'rejected') THEN true
    WHEN v_old_status = 'tested_ok'     AND p_new_status IN ('enabled', 'rejected', 'deprecated')      THEN true
    WHEN v_old_status = 'enabled'       AND p_new_status IN ('in_use', 'deprecated')                   THEN true
    WHEN v_old_status = 'in_use'        AND p_new_status IN ('deprecated')                             THEN true
    WHEN v_old_status = 'tested_failed' AND p_new_status IN ('tested_ok', 'rejected')                  THEN true
    WHEN v_old_status = 'deprecated'    AND p_new_status IN ('enabled')                                THEN true
    WHEN v_old_status = 'rejected'      AND p_new_status IN ('discovered')                             THEN true
    ELSE false
  END;

  IF NOT v_valid_transition THEN
    RAISE EXCEPTION 'Invalid transition: % → % (run aisha_test_mcp_server to probe first, or check allowed transitions in update_mcp_status_admin docs)',
      v_old_status, p_new_status USING ERRCODE = '22023';
  END IF;

  UPDATE mcp_server_registry
  SET    status     = p_new_status,
         updated_at = now()
  WHERE  id = p_mcp_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'MCP_STATUS_UPDATED',
    jsonb_build_object(
      'area',         'mcp',
      'severity',     'info',
      'entity_type',  'mcp_server_registry',
      'entity_id',    p_mcp_id::text,
      'slug',         v_slug,
      'old_status',   v_old_status,
      'new_status',   p_new_status,
      'note',         LEFT(COALESCE(p_note, ''), 200)
    )
  );

  RETURN jsonb_build_object(
    'success',    true,
    'slug',       v_slug,
    'old_status', v_old_status,
    'new_status', p_new_status,
    'transition', v_old_status || ' → ' || p_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_mcp_status_admin(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_mcp_status_admin(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.update_mcp_status_admin(uuid, text, text) IS
  'AdminMcpServerRegistry UI status transition RPC — operator-driven lifecycle. Enforces valid transitions per state machine. Probe-driven transitions bypass this via aisha_record_mcp_test_result. Audits MCP_STATUS_UPDATED.';

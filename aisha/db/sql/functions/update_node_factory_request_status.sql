-- Function: public.update_node_factory_request_status
-- Arguments: p_request_id uuid, p_status text, p_error_message text, p_generated_code text, p_validation_result jsonb
-- Description: Update the status and results of a node factory request.
-- Security: SECURITY DEFINER with search_path set.
-- Created: 2026-03-05

CREATE OR REPLACE FUNCTION public.update_node_factory_request_status(
  p_request_id uuid,
  p_status text,
  p_error_message text DEFAULT NULL,
  p_generated_code text DEFAULT NULL,
  p_validation_result jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status text;
BEGIN
  -- Authorization: only admin, staff, or service_role
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: only admin or staff can update request status'
      USING ERRCODE = 'P0001';
  END IF;

  -- Validate status value
  IF p_status NOT IN ('pending', 'generating', 'validating', 'testing', 'deploying', 'deployed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid status: %s', p_status), ERRCODE = 'P0001';
  END IF;

  -- Get old status for audit
  SELECT nfr.status INTO v_old_status
  FROM node_factory_requests nfr
  WHERE nfr.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found: %', p_request_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE node_factory_requests SET
    status = p_status,
    error_message = COALESCE(p_error_message, node_factory_requests.error_message),
    generated_code = COALESCE(p_generated_code, node_factory_requests.generated_code),
    validation_result = COALESCE(p_validation_result, node_factory_requests.validation_result),
    deployed_at = CASE WHEN p_status = 'deployed' THEN now() ELSE node_factory_requests.deployed_at END
  WHERE id = p_request_id;

  -- Audit status transition
  PERFORM write_audit_journal(
    p_action_type := 'update'::journal_action_type,
    p_area := 'system'::journal_area,
    p_details := jsonb_build_object(
      'old_status', v_old_status,
      'new_status', p_status,
      'has_error', p_error_message IS NOT NULL
    ),
    p_entity_id := p_request_id::text,
    p_entity_type := 'node_factory_request',
    p_severity := CASE WHEN p_status = 'failed' THEN 'warning' ELSE 'info' END::journal_severity,
    p_summary := 'Node factory request status: ' || v_old_status || ' → ' || p_status,
    p_user_id := auth.uid()
  );

  RETURN true;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.update_node_factory_request_status(uuid, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_node_factory_request_status(uuid, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_node_factory_request_status(uuid, text, text, text, jsonb) TO service_role;

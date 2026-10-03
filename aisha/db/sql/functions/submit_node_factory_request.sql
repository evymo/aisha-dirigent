-- Function: public.submit_node_factory_request
-- Arguments: p_node_type text, p_node_name text, p_specification jsonb
-- Description: Submit a new node generation request to the NodeFactory pipeline.
-- Security: SECURITY DEFINER with search_path set.
-- Created: 2026-03-05

CREATE OR REPLACE FUNCTION public.submit_node_factory_request(
  p_node_type text,
  p_node_name text,
  p_specification jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_request_id uuid;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  -- Authorization: only admin or staff can submit node factory requests
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: only admin or staff can submit node factory requests'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO node_factory_requests (
    requested_by,
    node_type,
    node_name,
    specification,
    status
  ) VALUES (
    v_user_id,
    p_node_type,
    p_node_name,
    p_specification,
    'pending'
  )
  RETURNING id INTO v_request_id;

  -- Audit
  PERFORM write_audit_journal(
    p_action_type := 'create'::journal_action_type,
    p_area := 'system'::journal_area,
    p_details := jsonb_build_object(
      'node_type', p_node_type,
      'node_name', p_node_name
    ),
    p_entity_id := v_request_id::text,
    p_entity_type := 'node_factory_request',
    p_severity := 'info'::journal_severity,
    p_summary := 'Node factory request submitted: ' || p_node_name,
    p_user_id := v_user_id
  );

  RETURN v_request_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_node_factory_request(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_node_factory_request(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_node_factory_request(text, text, jsonb) TO service_role;

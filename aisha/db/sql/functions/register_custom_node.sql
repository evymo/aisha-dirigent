-- Function: public.register_custom_node
-- Arguments: p_node_name text, p_display_name text, p_version text, p_description text, p_category text, p_source_request_id uuid, p_package_json jsonb, p_n8n_node_type text
-- Description: Register a new custom node in the registry after successful deployment.
-- Security: SECURITY DEFINER with search_path set.
-- Created: 2026-03-05

CREATE OR REPLACE FUNCTION public.register_custom_node(
  p_node_name text,
  p_display_name text,
  p_version text DEFAULT '0.1.0',
  p_description text DEFAULT NULL,
  p_category text DEFAULT 'aisha',
  p_source_request_id uuid DEFAULT NULL,
  p_package_json jsonb DEFAULT NULL,
  p_n8n_node_type text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_node_id uuid;
BEGIN
  -- Authorization: only admin or staff
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: only admin or staff can register custom nodes'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO custom_node_registry (
    node_name,
    display_name,
    version,
    description,
    category,
    source_request_id,
    package_json,
    n8n_node_type,
    is_active,
    deployed_to_n8n
  ) VALUES (
    p_node_name,
    p_display_name,
    p_version,
    p_description,
    p_category,
    p_source_request_id,
    p_package_json,
    p_n8n_node_type,
    true,
    true
  )
  ON CONFLICT (node_name, version) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    package_json = EXCLUDED.package_json,
    n8n_node_type = EXCLUDED.n8n_node_type,
    deployed_to_n8n = true,
    is_active = true
  RETURNING id INTO v_node_id;

  -- Audit
  PERFORM write_audit_journal(
    p_action_type := 'create'::journal_action_type,
    p_area := 'system'::journal_area,
    p_details := jsonb_build_object(
      'node_name', p_node_name,
      'version', p_version,
      'category', p_category,
      'source_request_id', p_source_request_id
    ),
    p_entity_id := v_node_id::text,
    p_entity_type := 'custom_node',
    p_severity := 'info'::journal_severity,
    p_summary := 'Custom node registered: ' || p_node_name || '@' || p_version,
    p_user_id := auth.uid()
  );

  RETURN v_node_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.register_custom_node(text, text, text, text, text, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_custom_node(text, text, text, text, text, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_custom_node(text, text, text, text, text, uuid, jsonb, text) TO service_role;

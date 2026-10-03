-- Function: public.upsert_agent_tool_admin
-- Description: Create or update an agent tool entry. Admin/staff only.
-- Security: SECURITY DEFINER, admin/staff only
-- Created: Phase 2 — Tool System

CREATE OR REPLACE FUNCTION public.upsert_agent_tool_admin(
  p_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_display_name_key text DEFAULT '',
  p_description text DEFAULT '',
  p_parameters_schema jsonb DEFAULT '{}',
  p_handler_type text DEFAULT 'rpc',
  p_handler_ref text DEFAULT '',
  p_access_tier_min text DEFAULT 'basic',
  p_requires_consent boolean DEFAULT false,
  p_audit_action text DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'P0003';
  END IF;

  IF p_id IS NOT NULL THEN
    -- UPDATE existing
    UPDATE agent_tools SET
      name = COALESCE(NULLIF(p_name, ''), name),
      display_name_key = p_display_name_key,
      description = p_description,
      parameters_schema = p_parameters_schema,
      handler_type = p_handler_type::tool_handler_type,
      handler_ref = p_handler_ref,
      access_tier_min = p_access_tier_min,
      requires_consent = p_requires_consent,
      audit_action = p_audit_action,
      is_active = p_is_active,
      metadata = p_metadata,
      updated_by = v_user_id
    WHERE id = p_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Tool not found: %', p_id USING ERRCODE = 'P0002';
    END IF;
  ELSE
    -- INSERT new
    INSERT INTO agent_tools (
      name, display_name_key, description, parameters_schema,
      handler_type, handler_ref, access_tier_min,
      requires_consent, audit_action, is_active, metadata,
      created_by, updated_by
    ) VALUES (
      p_name, p_display_name_key, p_description, p_parameters_schema,
      p_handler_type::tool_handler_type, p_handler_ref, p_access_tier_min,
      p_requires_consent, p_audit_action, p_is_active, p_metadata,
      v_user_id, v_user_id
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_agent_tool_admin(uuid, text, text, text, jsonb, text, text, text, boolean, text, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_agent_tool_admin(uuid, text, text, text, jsonb, text, text, text, boolean, text, boolean, jsonb) TO authenticated;

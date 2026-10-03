-- Function: public.get_agent_tool
-- Description: Runtime lookup of a tool by name. Used by edge functions to resolve tool definitions.
-- Security: SECURITY DEFINER, grants to service_role + authenticated
-- Created: Phase 2 — Tool System

CREATE OR REPLACE FUNCTION public.get_agent_tool(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'description', t.description,
    'parameters_schema', t.parameters_schema,
    'handler_type', t.handler_type::text,
    'handler_ref', t.handler_ref,
    'access_tier_min', t.access_tier_min,
    'requires_consent', t.requires_consent,
    'audit_action', t.audit_action,
    'metadata', t.metadata
  )
  INTO v_result
  FROM agent_tools t
  WHERE t.name = p_name AND t.is_active = true;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Tool not found or inactive: %', p_name USING ERRCODE = 'P0002';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_agent_tool(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_agent_tool(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_agent_tool(text) TO authenticated;

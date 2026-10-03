-- Function: public.delete_agent_tool_admin
-- Description: Soft-delete (deactivate) an agent tool. Admin/staff only.
-- Security: SECURITY DEFINER, admin/staff only
-- Created: Phase 2 — Tool System

CREATE OR REPLACE FUNCTION public.delete_agent_tool_admin(p_tool_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'P0003';
  END IF;

  UPDATE agent_tools SET is_active = false, updated_by = auth.uid()
  WHERE id = p_tool_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_agent_tool_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_agent_tool_admin(uuid) TO authenticated;

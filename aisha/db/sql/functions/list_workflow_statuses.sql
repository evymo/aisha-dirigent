-- Function: public.list_workflow_statuses
-- Description: Returns the active kanban lifecycle statuses in sort order.
--   Drives the kanban swimlane header layout and any UI dropdown that lets
--   a user pick a status. UI must use the returned `label_i18n_key` with
--   t() — never render `status` directly.
-- Security: SECURITY DEFINER; readable by any authenticated user (matches
--   RLS policy authenticated_can_read_workflow_statuses).
-- See also: workflow_statuses (table), get_allowed_kanban_transitions (RPC).

CREATE OR REPLACE FUNCTION public.list_workflow_statuses(
  p_include_inactive boolean DEFAULT false
)
RETURNS TABLE (
  status         text,
  label_i18n_key text,
  sort_order     int,
  swimlane_color text,
  is_terminal    boolean,
  is_active      boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ws.status,
         ws.label_i18n_key,
         ws.sort_order,
         ws.swimlane_color,
         ws.is_terminal,
         ws.is_active
  FROM public.workflow_statuses ws
  WHERE (p_include_inactive OR ws.is_active = true)
  ORDER BY ws.sort_order ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_workflow_statuses(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_workflow_statuses(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_workflow_statuses(boolean) TO service_role;

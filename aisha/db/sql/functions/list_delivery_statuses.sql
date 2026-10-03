-- Function: public.list_delivery_statuses
-- Description: Returns delivery_status pipeline metadata for the UI and
--   for the governance layer (services/svc-ai-chat/src/lib/governedOrchestration).
--   Drives per-status governance flags (requires_approval, restricts_actions)
--   that previously lived as hardcoded TS Sets.
-- Security: SECURITY DEFINER; readable by any authenticated user (matches
--   RLS policy authenticated_can_read_delivery_statuses).
-- See also: delivery_statuses (table), workflow_statuses (kanban parallel).

CREATE OR REPLACE FUNCTION public.list_delivery_statuses(
  p_include_inactive boolean DEFAULT false
)
RETURNS TABLE (
  status            text,
  label_i18n_key    text,
  sort_order        int,
  swimlane_color    text,
  requires_approval boolean,
  restricts_actions boolean,
  is_terminal       boolean,
  is_active         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ds.status,
         ds.label_i18n_key,
         ds.sort_order,
         ds.swimlane_color,
         ds.requires_approval,
         ds.restricts_actions,
         ds.is_terminal,
         ds.is_active
  FROM public.delivery_statuses ds
  WHERE (p_include_inactive OR ds.is_active = true)
  ORDER BY ds.sort_order ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_delivery_statuses(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_delivery_statuses(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_delivery_statuses(boolean) TO service_role;

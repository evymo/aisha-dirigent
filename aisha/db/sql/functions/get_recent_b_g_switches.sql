-- ============================================================================
-- Source of Truth: get_recent_b_g_switches
-- Popis: Reads recent blue_green_switch_committed events from audit_journal.
--        Vrací app_name, from→to slot, image_tag, switched_by user, is_rollback flag.
-- Volá: WF_APPSMITH_DASHBOARD_BUILDER (Recent B/G Switches table widget)
-- Auth: admin/staff nebo service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_recent_b_g_switches(
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  switched_at  timestamptz,
  app_name     text,
  from_slot    text,
  to_slot      text,
  image_tag    text,
  switched_by  uuid,
  is_rollback  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF NOT public.is_admin_or_staff()
     AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    aj.created_at AS switched_at,
    aj.metadata->>'app_name' AS app_name,
    aj.metadata->>'from_slot' AS from_slot,
    aj.metadata->>'to_slot' AS to_slot,
    aj.metadata->>'image_tag' AS image_tag,
    aj.user_id AS switched_by,
    COALESCE((aj.metadata->>'is_rollback')::boolean, false) AS is_rollback
  FROM public.audit_journal aj
  WHERE aj.action = 'blue_green_switch_committed'
  ORDER BY aj.created_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_recent_b_g_switches(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_b_g_switches(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_b_g_switches(int) TO service_role;

-- ============================================================================
-- Source of Truth: get_rollback_history
-- Popis: Read-only query rollback_history pro Phase 4 dashboard.
-- Auth: admin/staff nebo service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_rollback_history(
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id              uuid,
  app_name        text,
  triggered_at    timestamptz,
  triggered_by    text,
  from_slot       text,
  to_slot         text,
  from_image_tag  text,
  to_image_tag    text,
  approval_status text,
  approved_by     uuid,
  approved_at     timestamptz,
  executed_at     timestamptz,
  execution_status text,
  age_minutes     int
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
    rh.id, rh.app_name, rh.triggered_at, rh.triggered_by,
    rh.from_slot, rh.to_slot, rh.from_image_tag, rh.to_image_tag,
    rh.approval_status, rh.approved_by, rh.approved_at,
    rh.executed_at, rh.execution_status,
    EXTRACT(EPOCH FROM (now() - rh.triggered_at))::int / 60 AS age_minutes
  FROM public.rollback_history rh
  ORDER BY rh.triggered_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_rollback_history(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rollback_history(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rollback_history(int) TO service_role;

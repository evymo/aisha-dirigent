-- ============================================================================
-- Source of Truth: get_latest_drift_state
-- Popis: Read-only query pro Phase 4 dashboard. Vrací poslední N drift záznamů
--        s age_minutes (kolik minut starý). Volitelně filtrovat jen unresolved.
-- Volá: dashboard widgets (Recent Drift table, drill-down panels)
-- Auth: admin/staff (read-only) nebo service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_latest_drift_state(
  p_limit        int     DEFAULT 50,
  p_only_unresolved boolean DEFAULT true
)
RETURNS TABLE (
  id              uuid,
  observed_at     timestamptz,
  app_uuid        text,
  app_name        text,
  drift_kind      text,
  risk_level      text,
  remediation     text,
  observation_count int,
  resolved_at     timestamptz,
  resolution_note text,
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
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  RETURN QUERY
  SELECT
    ds.id, ds.observed_at, ds.app_uuid, ds.app_name, ds.drift_kind,
    ds.risk_level, ds.remediation, ds.observation_count,
    ds.resolved_at, ds.resolution_note,
    EXTRACT(EPOCH FROM (now() - ds.observed_at))::int / 60 AS age_minutes
  FROM public.drift_state ds
  WHERE (p_only_unresolved IS FALSE OR ds.resolved_at IS NULL)
  ORDER BY ds.observed_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_latest_drift_state(int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_drift_state(int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_drift_state(int, boolean) TO service_role;

-- ============================================================================
-- Source of Truth: get_unresolved_drift_count
-- Popis: Vrací počet unresolved drift záznamů s risk_level >= p_min_risk.
--        Používáno pro StatBox widget v dashboardu (count badge).
-- Volá: dashboard StatBox widgets, alert thresholds
-- Auth: any authenticated user (no admin gate na count — read-only metric)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_unresolved_drift_count(
  p_min_risk text DEFAULT 'low'
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_count int := 0;
  v_min_idx int;
  v_caller uuid;
BEGIN
  -- Auth check: require authenticated user OR service_role
  v_caller := auth.uid();
  IF v_caller IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  v_min_idx := CASE p_min_risk
    WHEN 'low' THEN 0
    WHEN 'medium' THEN 1
    WHEN 'high' THEN 2
    WHEN 'critical' THEN 3
    ELSE 0
  END;

  SELECT count(*) INTO v_count
  FROM public.drift_state
  WHERE resolved_at IS NULL
    AND CASE risk_level
      WHEN 'low' THEN 0
      WHEN 'medium' THEN 1
      WHEN 'high' THEN 2
      WHEN 'critical' THEN 3
      ELSE 0
    END >= v_min_idx;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_unresolved_drift_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unresolved_drift_count(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unresolved_drift_count(text) TO service_role;

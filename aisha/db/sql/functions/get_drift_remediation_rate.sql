-- ============================================================================
-- Source of Truth: get_drift_remediation_rate
-- Popis: Vrací počet auto-remediated drift incidentů per app v posledních X minutách.
--        Používáno pro rate-limit check ("max 5 auto-remediations per hour"
--        z DRIFT_OBSERVER.md §5.2). Pokud rate překročí threshold, eskalace na approval.
-- Volá: WF_DRIFT_OBSERVER před auto-remediation
-- Auth: any authenticated user
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_drift_remediation_rate(
  p_app_uuid text,
  p_window_minutes int DEFAULT 60
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_count int := 0;
  v_caller uuid;
BEGIN
  -- Auth check: require authenticated user OR service_role
  v_caller := auth.uid();
  IF v_caller IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.drift_state
  WHERE app_uuid = p_app_uuid
    AND remediation = 'auto'
    AND resolved_at > now() - (p_window_minutes || ' minutes')::interval;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_drift_remediation_rate(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_drift_remediation_rate(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_drift_remediation_rate(text, int) TO service_role;

-- ============================================================================
-- Source of Truth: get_pending_approval_count
-- Popis: Phase 4 dashboard StatBoxWidget — počet pending approvals (drift + rollback).
--        Bezpečně agreguje napříč integration_service_logs (přes WF_APPROVAL_GATE).
--        Last 24h window + filter na unresolved.
-- Volá: dashboard StatBox widget
-- Auth: any authenticated (counts only, no PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_pending_approval_count()
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
  -- Auth check: require authenticated user OR service_role (counts only, no PII)
  v_caller := auth.uid();
  IF v_caller IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: authentication required';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.integration_service_logs
  WHERE action = 'approval_request_pending'
    AND status = 'success'
    AND created_at > now() - interval '24 hours'
    AND COALESCE(action_detail->>'resolved', 'false') = 'false';

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_approval_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_approval_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_approval_count() TO service_role;

-- ============================================================================
-- Source of Truth: mark_drift_pending_approval
-- Popis: Linkuje drift_state row na approval request (z WF_APPROVAL_GATE) přes
--        approval_id. Změní remediation na 'approval_pending'.
-- Volá: WF_DRIFT_OBSERVER pro high/critical risk drifty
-- Auth: service_role nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_drift_pending_approval(
  p_drift_id    uuid,
  p_approval_id uuid
)
RETURNS public.drift_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.drift_state;
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  UPDATE public.drift_state
  SET remediation = 'approval_pending',
      approval_id = p_approval_id
  WHERE id = p_drift_id
    AND resolved_at IS NULL
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Drift % not found or already resolved', p_drift_id;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_drift_pending_approval(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_drift_pending_approval(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_drift_pending_approval(uuid, uuid) TO service_role;

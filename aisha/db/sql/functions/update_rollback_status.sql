-- ============================================================================
-- Source of Truth: update_rollback_status
-- Popis: State transitions na rollback_history row. Validuje approval_status enum.
--        Při 'approved' nastavuje approved_at + approved_by. Při 'executed' nastavuje
--        executed_at. Loguje do audit_journal.
-- Volá: WF_APPROVAL_GATE callback, WF_BLUE_GREEN_ORCHESTRATOR po executed
-- Auth: service_role nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_rollback_status(
  p_rollback_id      uuid,
  p_approval_status  text,
  p_execution_status text DEFAULT NULL,
  p_execution_details jsonb DEFAULT NULL
)
RETURNS public.rollback_history
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.rollback_history;
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '22023';
  END IF;

  IF p_approval_status NOT IN ('pending', 'approved', 'rejected', 'expired', 'executed', 'failed', 'aborted') THEN
    RAISE EXCEPTION 'Invalid approval_status: %', p_approval_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.rollback_history
  SET approval_status = p_approval_status,
      approved_at     = CASE WHEN p_approval_status = 'approved' THEN now() ELSE approved_at END,
      approved_by     = CASE WHEN p_approval_status = 'approved' THEN auth.uid() ELSE approved_by END,
      executed_at     = CASE WHEN p_approval_status = 'executed' THEN now() ELSE executed_at END,
      execution_status = COALESCE(p_execution_status, execution_status),
      execution_details = COALESCE(p_execution_details, execution_details),
      updated_at       = now()
  WHERE id = p_rollback_id
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Rollback % not found', p_rollback_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'rollback_status_updated',
    jsonb_build_object(
      'rollback_id', p_rollback_id,
      'app_name', v_row.app_name,
      'approval_status', p_approval_status,
      'execution_status', p_execution_status
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_rollback_status(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_rollback_status(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_rollback_status(uuid, text, text, jsonb) TO service_role;

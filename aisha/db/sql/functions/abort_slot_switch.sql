-- ============================================================================
-- Source of Truth: abort_slot_switch
-- Popis: Releases switch lock without committing — rollback path on smoke test
--        failure or approval rejection. Allows force-release i pokud lock owner
--        mismatch (loguje warning v audit_journal).
-- Volá: WF_BLUE_GREEN_ORCHESTRATOR (Abort Smoke Fail / Abort Pending Approval)
-- Auth: service_role nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.abort_slot_switch(
  p_app_name   text,
  p_lock_owner text,
  p_reason     text DEFAULT 'manual_abort'
)
RETURNS public.coolify_app_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.coolify_app_slots;
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Allow abort even if lock owner mismatch (force-release)
  -- ale loguje warning v audit
  UPDATE public.coolify_app_slots
  SET switch_lock = false,
      switch_lock_at = NULL,
      switch_lock_by = NULL,
      updated_at = now()
  WHERE app_name = p_app_name
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'App slot not found: %', p_app_name;
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'blue_green_switch_aborted',
    jsonb_build_object(
      'app_name', p_app_name,
      'reason', p_reason,
      'lock_owner_was', v_row.switch_lock_by,
      'lock_owner_provided', p_lock_owner,
      'force_release', v_row.switch_lock_by IS DISTINCT FROM p_lock_owner
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.abort_slot_switch(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abort_slot_switch(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abort_slot_switch(text, text, text) TO service_role;

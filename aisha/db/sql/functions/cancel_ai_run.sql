-- ============================================================================
-- Source of Truth: cancel_ai_run
-- Mission Control intervention — stop an in-flight ai_runs row.
--
-- Authorization (security-critical, maximally safeguarded):
--   - The run OWNER (ai_runs.actor_user_id) may cancel their own run.
--   - An admin/staff may cancel ANY run by acting ON BEHALF OF the owner
--     ("switch to the user and stop it for them"). This is impersonation by
--     role, NOT by a trusted parameter — the owner is always derived from the
--     run row, never passed in (mirrors the 2026-05-01 hardening that made
--     auth.uid() win over p_user_id).
--   - A non-owner without admin/staff is denied.
--
-- Audit: subject (user_id) = owner; actor (acted_by) = caller; on-behalf-of
-- impersonation flagged at 'warn'. Mirrors log_security_event actor/subject
-- separation + terminate_session_admin admin-destructive template. No PII.
--
-- Status: only in-flight ('pending'|'queued'|'running') → 'canceled' (the value
-- finish_ai_run validates). Idempotent: a terminal run reports cancelled=false.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_ai_run(
  p_run_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller    uuid    := auth.uid();
  v_is_admin  boolean := public.is_admin_or_staff();
  v_owner     uuid;
  v_status    text;
  v_on_behalf boolean := false;
  v_updated   int;
BEGIN
  IF v_caller IS NULL AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id is required' USING ERRCODE = '22023';
  END IF;

  -- Owner + status are derived from the run row — never trusted from a parameter.
  SELECT actor_user_id, status INTO v_owner, v_status
  FROM public.ai_runs
  WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % not found', p_run_id USING ERRCODE = 'P0002';
  END IF;

  -- Authorize: owner-self OR admin/staff on-behalf-of. Nothing else.
  IF NOT (v_caller = v_owner OR v_is_admin) THEN
    RAISE EXCEPTION 'Unauthorized to cancel run %', p_run_id USING ERRCODE = '42501';
  END IF;
  v_on_behalf := (v_is_admin AND v_caller IS DISTINCT FROM v_owner);

  -- Only in-flight runs are cancellable.
  IF v_status NOT IN ('pending', 'queued', 'running') THEN
    RETURN jsonb_build_object(
      'cancelled', false,
      'run_id',    p_run_id,
      'reason',    'not_cancellable',
      'status',    v_status
    );
  END IF;

  UPDATE public.ai_runs SET
    status      = 'canceled',
    finished_at = now()
  WHERE id = p_run_id
    AND status IN ('pending', 'queued', 'running');
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    -- Lost a race to a concurrent terminal transition — report idempotently.
    RETURN jsonb_build_object('cancelled', false, 'run_id', p_run_id, 'reason', 'race_lost');
  END IF;

  -- Audit: subject = owner, actor = caller; 'warn' when impersonating.
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_owner,
    'ai.run.cancelled',
    jsonb_build_object(
      'run_id',       p_run_id,
      'acted_by',     v_caller,
      'on_behalf_of', v_owner,
      'impersonated', v_on_behalf,
      'prev_status',  v_status,
      'reason',       p_reason,
      'severity',     CASE WHEN v_on_behalf THEN 'warn' ELSE 'info' END,
      'via',          'mission_control'
    )
  );

  RETURN jsonb_build_object(
    'cancelled',    true,
    'run_id',       p_run_id,
    'on_behalf_of', v_owner,
    'acted_by',     v_caller,
    'impersonated', v_on_behalf,
    'prev_status',  v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_ai_run(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_ai_run(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ai_run(uuid, text) TO service_role;

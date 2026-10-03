-- ============================================================================
-- Source of Truth: reject_task_spend_audited
-- Purpose: Human rejection of a spend-blocked run ('ask' decision outcome).
--          Cancels the run, records the decision + reason in metadata and
--          audit_journal, nudges the story's agent channel.
-- Security: SECURITY DEFINER + is_admin_or_staff() guard + audit.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reject_task_spend_audited(
  p_run_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run public.ai_runs%ROWTYPE;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required' USING ERRCODE = '42501';
  END IF;

  -- JIT-provision the admin actor so the audit_journal insert below can't
  -- FK-violate (23503) for a Keycloak admin created after bootstrap import.
  PERFORM public.ensure_current_user();

  SELECT * INTO v_run FROM public.ai_runs WHERE id = p_run_id FOR UPDATE;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'reject_task_spend_audited: run % not found', p_run_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> 'blocked'
     OR COALESCE(v_run.metadata->>'awaiting', '') <> 'spend_approval' THEN
    RAISE EXCEPTION 'reject_task_spend_audited: run % is not awaiting spend approval', p_run_id
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.ai_runs
  SET status = 'canceled',
      finished_at = now(),
      metadata = (metadata - 'awaiting') || jsonb_build_object(
        'spend_approval', jsonb_strip_nulls(jsonb_build_object(
          'decision', 'rejected',
          'by', auth.uid(),
          'at', now(),
          'reason', p_reason
        ))
      )
  WHERE id = p_run_id;

  IF v_run.story_id IS NOT NULL THEN
    INSERT INTO public.dirigent_nudges
      (story_id, event_origin, severity, message, metadata, expires_at)
    VALUES (
      v_run.story_id,
      'manual',
      'warn',
      format('🛑 Spend rejected for run %s (kind %s)%s.',
             p_run_id, v_run.kind,
             CASE WHEN p_reason IS NOT NULL THEN ': ' || p_reason ELSE '' END),
      jsonb_build_object('run_id', p_run_id, 'kind', v_run.kind),
      now() + interval '4 hours'
    );
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'ai.spend.rejected',
    jsonb_strip_nulls(jsonb_build_object(
      'run_id', p_run_id,
      'kind', v_run.kind,
      'story_id', v_run.story_id,
      'reason', p_reason
    ))
  );

  RETURN jsonb_build_object('success', true, 'run_id', p_run_id, 'status', 'canceled');
END;
$$;

REVOKE ALL ON FUNCTION public.reject_task_spend_audited(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_task_spend_audited(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_task_spend_audited(uuid, text) TO service_role;

COMMENT ON FUNCTION public.reject_task_spend_audited(uuid, text) IS
  'Reject a spend-blocked run: status blocked→canceled with reason, dirigent nudge + audit. Admin/staff only.';

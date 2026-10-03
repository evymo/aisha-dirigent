-- ============================================================================
-- Source of Truth: approve_task_spend_audited
-- Purpose: Human approval of a spend-blocked run ('ask' decision outcome).
--          Unblocks the ai_runs row (status blocked → pending so the runner
--          admission re-picks it), optionally raises the story lifetime
--          budget cap in the same action, records the decision in run
--          metadata + audit_journal, and nudges the story's agent channel.
-- Security: SECURITY DEFINER + is_admin_or_staff() guard + audit.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_task_spend_audited(
  p_run_id           uuid,
  p_raise_budget numeric DEFAULT NULL,
  p_note             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run     public.ai_runs%ROWTYPE;
  v_new_cap numeric;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required' USING ERRCODE = '42501';
  END IF;

  -- JIT-provision the admin actor so the audit_journal insert below can't
  -- FK-violate (23503) for a Keycloak admin created after bootstrap import.
  PERFORM public.ensure_current_user();

  SELECT * INTO v_run FROM public.ai_runs WHERE id = p_run_id FOR UPDATE;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'approve_task_spend_audited: run % not found', p_run_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> 'blocked'
     OR COALESCE(v_run.metadata->>'awaiting', '') <> 'spend_approval' THEN
    RAISE EXCEPTION 'approve_task_spend_audited: run % is not awaiting spend approval', p_run_id
      USING ERRCODE = '22023';
  END IF;

  -- Optional budget raise: bump the story lifetime USD cap so the post-paid
  -- meter (fn_check_and_consume_ai_budget_audited) won't re-block mid-run.
  IF p_raise_budget IS NOT NULL AND v_run.story_id IS NOT NULL THEN
    IF p_raise_budget <= 0 THEN
      RAISE EXCEPTION 'p_raise_budget must be > 0' USING ERRCODE = '22023';
    END IF;
    UPDATE public.ai_budget
    SET cost_limit = COALESCE(cost_limit, 0) + p_raise_budget,
        updated_at = now()
    WHERE scope_type = 'story' AND scope_id = v_run.story_id AND period = 'lifetime'
    RETURNING cost_limit INTO v_new_cap;
    -- No lifetime budget row yet → nothing to raise; the approval itself
    -- still unblocks the run (caps stay unconfigured = uncapped).
  END IF;

  UPDATE public.ai_runs
  SET status = 'pending',
      metadata = (metadata - 'awaiting') || jsonb_build_object(
        'spend_approval', jsonb_strip_nulls(jsonb_build_object(
          'decision', 'approved',
          'by', auth.uid(),
          'at', now(),
          'raised_budget', p_raise_budget,
          'note', p_note
        ))
      )
  WHERE id = p_run_id;

  -- Agent notification on the story channel (drained on next Stop event).
  IF v_run.story_id IS NOT NULL THEN
    INSERT INTO public.dirigent_nudges
      (story_id, event_origin, severity, message, metadata, expires_at)
    VALUES (
      v_run.story_id,
      'manual',
      'info',
      format('✅ Spend approved for run %s (kind %s)%s — task may proceed.',
             p_run_id, v_run.kind,
             CASE WHEN p_raise_budget IS NOT NULL
                  THEN format(', budget raised by $%s', p_raise_budget)
                  ELSE '' END),
      jsonb_build_object('run_id', p_run_id, 'kind', v_run.kind),
      now() + interval '4 hours'
    );
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'ai.spend.approved',
    jsonb_strip_nulls(jsonb_build_object(
      'run_id', p_run_id,
      'kind', v_run.kind,
      'story_id', v_run.story_id,
      'raised_budget', p_raise_budget,
      'new_lifetime_cap', v_new_cap,
      'note', p_note
    ))
  );

  RETURN jsonb_build_object(
    'success', true,
    'run_id', p_run_id,
    'status', 'pending',
    'new_lifetime_cap', v_new_cap
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_task_spend_audited(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_task_spend_audited(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_task_spend_audited(uuid, numeric, text) TO service_role;

COMMENT ON FUNCTION public.approve_task_spend_audited(uuid, numeric, text) IS
  'Approve a spend-blocked run: status blocked→pending, optional story lifetime budget raise, dirigent nudge + audit. Admin/staff only.';

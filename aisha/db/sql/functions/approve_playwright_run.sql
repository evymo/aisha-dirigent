-- approve_playwright_run
-- Admin approval for production_manual runs. Unblocks the runner.
--
-- Production integration (migration 20260518040000):
--  • Segregation of duties — approver MUST differ from requester (auth.uid()).
--  • Story-linked runs emit qa_playwright_approved entry into the storyloop timeline.

CREATE OR REPLACE FUNCTION public.approve_playwright_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_run record;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff required';
  END IF;

  SELECT id, status, approval_required, approved_at, trigger_kind, target_env, story_id, requested_by
  INTO v_run
  FROM public.playwright_runs
  WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Playwright run not found: %', p_run_id;
  END IF;

  IF NOT v_run.approval_required THEN
    RAISE EXCEPTION 'Run does not require approval (trigger=%)', v_run.trigger_kind;
  END IF;

  IF v_run.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Run already approved at %', v_run.approved_at;
  END IF;

  IF v_run.status <> 'queued' THEN
    RAISE EXCEPTION 'Run not in queued state (got %)', v_run.status;
  END IF;

  -- Segregation of duties: requester cannot self-approve a production_manual run.
  IF v_run.requested_by IS NOT NULL AND v_run.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'Segregation of duties: approver must differ from requester';
  END IF;

  UPDATE public.playwright_runs
  SET approved_by = auth.uid(),
      approved_at = now()
  WHERE id = p_run_id;

  IF v_run.story_id IS NOT NULL THEN
    INSERT INTO public.story_entries (story_id, entry_type, content, metadata, created_by)
    VALUES (
      v_run.story_id,
      'qa_playwright_approved',
      NULL,
      jsonb_build_object(
        'type', 'qa_playwright_approved',
        'run_id', p_run_id,
        'target_env', v_run.target_env
      ),
      auth.uid()
    );
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'PLAYWRIGHT_RUN_APPROVE',
    jsonb_build_object(
      'area', 'qa',
      'severity', 'info',
      'entity_type', 'playwright_run',
      'entity_id', p_run_id::text,
      'target_env', v_run.target_env,
      'story_id', v_run.story_id,
      'tags', ARRAY['stack', 'qa', 'playwright', 'approval']
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_playwright_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_playwright_run(uuid) TO authenticated;

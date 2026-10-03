-- Function: public.approve_claude_run
-- Description: Mission Control approval for a HELD claude_cli_task — one whose
--   fn_admit_clow verdict was 'ask' (approval_required=true, approved_at IS NULL).
--   Setting approved_at clears the hold so claim_queued_claude_run drains it. The
--   approver-side twin of fn_spawn_claude_cli_run's ask branch. Mirrors
--   approve_playwright_run: admin/staff + segregation of duties + audit.
-- Security: SECURITY INVOKER (admin check + approver identity from the caller).

CREATE OR REPLACE FUNCTION public.approve_claude_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_run record;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff required to approve a claude_cli_task';
  END IF;

  SELECT id, kind, status, approval_required, approved_at, requested_by, inputs
  INTO v_run
  FROM public.agent_runs
  WHERE id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_run not found: %', p_run_id;
  END IF;
  IF v_run.kind <> 'claude_cli_task' THEN
    RAISE EXCEPTION 'agent_run % is not a claude_cli_task (kind=%)', p_run_id, v_run.kind;
  END IF;
  IF NOT v_run.approval_required THEN
    RAISE EXCEPTION 'agent_run % does not require approval', p_run_id;
  END IF;
  IF v_run.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'agent_run % already approved at %', p_run_id, v_run.approved_at;
  END IF;
  -- Only a still-held (queued) run can be approved; a run that already ran/failed
  -- cannot be retro-approved.
  IF v_run.status <> 'queued' THEN
    RAISE EXCEPTION 'agent_run % not in a holdable state (status=%)', p_run_id, v_run.status;
  END IF;

  -- Segregation of duties: the requester cannot self-approve their own held run
  -- (mirrors approve_playwright_run).
  IF v_run.requested_by IS NOT NULL AND v_run.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'Segregation of duties: approver must differ from the requester';
  END IF;

  UPDATE public.agent_runs
  SET approved_by = auth.uid(),
      approved_at = now()
  WHERE id = p_run_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'agent_run.approved',
    jsonb_build_object(
      'run_id', p_run_id,
      'kind', 'claude_cli_task',
      'story_id', NULLIF(v_run.inputs->>'story_id', '')::uuid
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_claude_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_claude_run(uuid) TO authenticated;

COMMENT ON FUNCTION public.approve_claude_run(uuid) IS
  'Mission Control approval for a HELD claude_cli_task (fn_admit_clow ask verdict). Admin/staff only + segregation of duties (approver <> requester); sets approved_at so claim_queued_claude_run drains it. Mirrors approve_playwright_run.';

-- Function: public.list_pending_claude_approvals
-- Description: Mission Control inbox — claude_cli_task runs HELD pending approval
--   (fn_admit_clow returned 'ask': approval_required + approved_at IS NULL). Joins
--   the journaled ai_decisions row so an approver sees the admission reason
--   (awaiting) + computed risk before calling approve_claude_run. Read-only.
-- Security: SECURITY DEFINER (reads across requesters; the admin/staff gate is the
--   access control), admin/staff only.

CREATE OR REPLACE FUNCTION public.list_pending_claude_approvals()
RETURNS TABLE (
  run_id       uuid,
  story_id     uuid,
  source       text,
  awaiting     text,
  decision_id  uuid,
  risk_level   text,
  requested_by uuid,
  created_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff required';
  END IF;

  RETURN QUERY
  SELECT r.id,
         NULLIF(r.inputs->>'story_id', '')::uuid,
         r.source,
         r.awaiting,
         r.decision_id,
         d.risk_level,
         r.requested_by,
         r.created_at
  FROM public.agent_runs r
  LEFT JOIN public.ai_decisions d ON d.id = r.decision_id
  WHERE r.kind = 'claude_cli_task'
    AND r.approval_required
    AND r.approved_at IS NULL
    AND r.status = 'queued'
  ORDER BY r.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.list_pending_claude_approvals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pending_claude_approvals() TO authenticated;

COMMENT ON FUNCTION public.list_pending_claude_approvals() IS
  'Mission Control inbox of claude_cli_task runs held pending approval (fn_admit_clow ask). Admin/staff only; joins ai_decisions for the admission reason + risk. Feeds approve_claude_run.';

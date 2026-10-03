-- Function: public.cancel_agent_run
-- Description: Cancel a queued or running agent run owned by the caller.
--   Returns true if the run was cancelled, false if not found / not cancellable.
-- Security: SECURITY DEFINER, grants to authenticated

CREATE OR REPLACE FUNCTION public.cancel_agent_run(p_run_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.agent_runs SET
    status      = 'cancelled',
    finished_at = now()
  WHERE id = p_run_id
    AND requested_by = auth.uid()
    AND status IN ('queued', 'running');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_agent_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_agent_run(uuid) TO authenticated;

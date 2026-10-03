-- Function: public.claim_queued_claude_run
-- Description: The producer→executor link (plan: "spawner naslouchá na agent_runs
--   INSERT WHERE kind='claude_cli_task'"). A queued claude_cli_task row (created
--   by fn_spawn_claude_cli_run from ANY producer — Dirigent UI, n8n, RPC) is
--   atomically claimed by the svc-agent-runner poller: transitioned queued→running
--   and returned with its execution context. Job-queue semantics (FOR UPDATE SKIP
--   LOCKED) so concurrent runners never double-execute. The grace window lets the
--   synchronous POST /runs path keep its own freshly-created rows (those go
--   queued→running in <1s, so the poller never claims them).
-- Security: SECURITY DEFINER. service_role only (the runner).

CREATE OR REPLACE FUNCTION public.claim_queued_claude_run(
  p_grace_seconds int DEFAULT 10
)
RETURNS TABLE (id uuid, image text, profile text, source text, source_ref text, inputs jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT r.id INTO v_id
  FROM public.agent_runs r
  WHERE r.kind = 'claude_cli_task'
    AND r.status = 'queued'
    -- Admission gate: a run whose fn_admit_clow verdict was 'ask' is HELD
    -- (approval_required + approved_at IS NULL) until approve_claude_run clears it.
    -- 'allow' runs have approval_required=false → claimed normally.
    AND NOT (r.approval_required AND r.approved_at IS NULL)
    AND r.created_at < now() - make_interval(secs => GREATEST(p_grace_seconds, 0))
  ORDER BY r.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.agent_runs
  SET status = 'running', started_at = now()
  WHERE agent_runs.id = v_id;

  RETURN QUERY
  SELECT r.id, r.image, r.profile, r.source, r.source_ref, r.inputs
  FROM public.agent_runs r
  WHERE r.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_queued_claude_run(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_queued_claude_run(int) TO service_role;

COMMENT ON FUNCTION public.claim_queued_claude_run(int) IS
  'Atomically claim (FOR UPDATE SKIP LOCKED) the oldest queued claude_cli_task run older than the grace window, mark it running, and return its execution context. The svc-agent-runner poller calls this so fn_spawn_claude_cli_run is the universal producer (UI / n8n / RPC).';

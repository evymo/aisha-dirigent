-- Function: get_completed_batches_pending_resume
-- Returns batch jobs that completed at the provider AND have a related run
-- still in 'waiting_batch' status (so WF_BATCH_RESUMER must fetch results +
-- resume). Idempotent: jobs whose state.batch_result is already populated
-- are excluded (means a prior resumer run already handled them but the run
-- hasn't progressed yet — likely runWorkflow is in flight).
--
-- Called by n8n WF_BATCH_RESUMER on its scheduleTrigger (every 5 min).
-- Pairs with persist_batch_result_and_resume which closes the loop.

CREATE OR REPLACE FUNCTION public.get_completed_batches_pending_resume(
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  batch_job_id uuid,
  external_batch_id text,
  provider text,
  result_url text,
  related_run_id uuid,
  succeeded_count int,
  errored_count int,
  metadata jsonb,
  agent_slug text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT j.id            AS batch_job_id,
         j.external_batch_id,
         j.provider,
         j.result_url,
         j.related_run_id,
         j.succeeded_count,
         j.errored_count,
         j.metadata,
         j.agent_slug
  FROM   ai_batch_jobs j
  JOIN   ai_runs r ON r.id = j.related_run_id
  WHERE  j.status = 'completed'
    AND  j.related_run_id IS NOT NULL
    AND  j.result_url IS NOT NULL
    AND  r.status = 'waiting_batch'
    -- Idempotency: skip if state.batch_result already populated. The presence
    -- of this key indicates persist_batch_result_and_resume already ran;
    -- runWorkflow is either in-flight or will be picked up on next call.
    AND  (
           (r.metadata -> 'checkpoint' -> 'state' -> 'batch_result') IS NULL
        OR (r.metadata -> 'checkpoint' -> 'state' -> 'batch_result') = 'null'::jsonb
         )
  ORDER  BY j.completed_at ASC NULLS LAST
  LIMIT  p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_completed_batches_pending_resume(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_completed_batches_pending_resume(int) TO service_role;

COMMENT ON FUNCTION public.get_completed_batches_pending_resume(int) IS
  'WF_BATCH_RESUMER discovery RPC — returns completed batch jobs whose related ai_runs are still in waiting_batch + don''t yet have a batch_result in state. Service-role only.';

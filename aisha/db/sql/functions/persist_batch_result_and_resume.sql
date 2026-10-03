-- Function: persist_batch_result_and_resume
-- WF_BATCH_RESUMER calls this after fetching + normalizing batch results
-- from the provider (Anthropic results_url or OpenAI files/{id}/content).
--
-- Mutations (atomic):
--   1. ai_runs.metadata.checkpoint.state.batch_result ← normalized result
--   2. ai_runs.metadata.checkpoint.state.last_generation ← extracted text
--      (so a downstream node can read it like any other sync generator output)
--   3. ai_runs.status: 'waiting_batch' → 'running'
--   4. ai_runs.cost_total_json: accrue tokens_input + tokens_output
--   5. audit_journal: action='batch.resumed' with batch_job_id + run_id
--
-- Idempotency: if ai_runs.status != 'waiting_batch' (e.g. someone already
-- resumed it, or run was cancelled), this is a no-op success — caller should
-- treat as already-processed and skip the runWorkflow re-invocation.
--
-- The actual orchestrator re-invocation (runWorkflow) happens TS-side via
-- the /reflect/runs/:id/resume-batch endpoint — this RPC just does the
-- DB-side state transition.

CREATE OR REPLACE FUNCTION public.persist_batch_result_and_resume(
  p_batch_job_id   uuid,
  p_result         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job             RECORD;
  v_run             RECORD;
  v_new_metadata    jsonb;
  v_tokens_input    int;
  v_tokens_output   int;
  v_text            text;
  v_already_resumed boolean := false;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  IF p_batch_job_id IS NULL THEN
    RAISE EXCEPTION 'p_batch_job_id required' USING ERRCODE = '22023';
  END IF;
  IF p_result IS NULL OR jsonb_typeof(p_result) != 'object' THEN
    RAISE EXCEPTION 'p_result must be a JSON object' USING ERRCODE = '22023';
  END IF;

  -- Lock the row to prevent concurrent resumers from racing.
  SELECT * INTO v_job
  FROM   ai_batch_jobs
  WHERE  id = p_batch_job_id
  FOR    UPDATE;

  IF v_job IS NULL THEN
    RAISE EXCEPTION 'Batch job % not found', p_batch_job_id USING ERRCODE = '22023';
  END IF;

  IF v_job.related_run_id IS NULL THEN
    RAISE EXCEPTION 'Batch job % has no related_run_id', p_batch_job_id USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM   ai_runs
  WHERE  id = v_job.related_run_id
  FOR    UPDATE;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'Run % (related to batch %) not found',
                    v_job.related_run_id, p_batch_job_id USING ERRCODE = '22023';
  END IF;

  -- Idempotency: if the run is no longer waiting_batch, treat as already-
  -- resumed (someone won the race or operator cancelled). Return success
  -- so the caller knows not to re-trigger runWorkflow.
  IF v_run.status != 'waiting_batch' THEN
    v_already_resumed := true;
  END IF;

  v_tokens_input  := COALESCE((p_result ->> 'tokens_input')::int, 0);
  v_tokens_output := COALESCE((p_result ->> 'tokens_output')::int, 0);
  v_text          := COALESCE(p_result ->> 'text', '');

  IF NOT v_already_resumed THEN
    -- Merge batch_result + last_generation into checkpoint.state. Use jsonb
    -- path UPDATE to preserve all other state keys (clow_backend, etc.).
    v_new_metadata := v_run.metadata;
    v_new_metadata := jsonb_set(
      v_new_metadata,
      '{checkpoint,state,batch_result}',
      p_result,
      true
    );
    v_new_metadata := jsonb_set(
      v_new_metadata,
      '{checkpoint,state,last_generation}',
      to_jsonb(v_text),
      true
    );

    UPDATE ai_runs
    SET    status            = 'running',
           metadata          = v_new_metadata,
           cost_total_json   = jsonb_set(
             COALESCE(cost_total_json, '{}'::jsonb),
             '{tokens_input}',
             to_jsonb(COALESCE((cost_total_json ->> 'tokens_input')::int, 0) + v_tokens_input)
           ) || jsonb_build_object(
             'tokens_output',
             COALESCE((cost_total_json ->> 'tokens_output')::int, 0) + v_tokens_output
           )
    WHERE  id = v_run.id;
  END IF;

  -- Audit always (even if already_resumed — operator can see retry attempts)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'batch.resumed',
    jsonb_build_object(
      'batch_job_id',     p_batch_job_id,
      'run_id',           v_run.id,
      'provider',         v_job.provider,
      'external_batch_id', v_job.external_batch_id,
      'tokens_input',     v_tokens_input,
      'tokens_output',    v_tokens_output,
      'already_resumed',  v_already_resumed
    )
  );

  RETURN jsonb_build_object(
    'run_id',          v_run.id,
    'batch_job_id',    p_batch_job_id,
    'already_resumed', v_already_resumed,
    'new_status',      CASE WHEN v_already_resumed THEN v_run.status ELSE 'running' END,
    'tokens_input',    v_tokens_input,
    'tokens_output',   v_tokens_output
  );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_batch_result_and_resume(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_batch_result_and_resume(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.persist_batch_result_and_resume(uuid, jsonb) IS
  'WF_BATCH_RESUMER persistence RPC — merges batch result into ai_runs.checkpoint.state and flips status waiting_batch → running. Idempotent: no-op success if run not in waiting_batch. Service-role only.';

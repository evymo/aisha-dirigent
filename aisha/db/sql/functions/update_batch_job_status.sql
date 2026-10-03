-- Function: update_batch_job_status
-- Polling helper: WF_BATCH_POLLER (n8n) calls this after fetching provider
-- batch state. Records last_polled_at on every call so we can detect stalled
-- pollers and rate-limit per-job polls. Transitions status and persists cost
-- + result URL on completion.

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.update_batch_job_status(text, text, text, text, numeric, integer, integer);

CREATE OR REPLACE FUNCTION public.update_batch_job_status(
  p_provider text,
  p_external_batch_id text,
  p_status text,
  p_result_url text DEFAULT NULL,
  p_actual_cost numeric DEFAULT NULL,
  p_succeeded_count int DEFAULT NULL,
  p_errored_count int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job       RECORD;
  v_completed_at timestamptz;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_provider NOT IN ('anthropic', 'openai') THEN
    RAISE EXCEPTION 'Invalid provider: %', p_provider USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('submitted', 'in_progress', 'completed', 'expired', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM ai_batch_jobs
  WHERE provider = p_provider AND external_batch_id = p_external_batch_id
  FOR UPDATE;

  IF v_job IS NULL THEN
    RAISE EXCEPTION 'Batch job %/% not found', p_provider, p_external_batch_id USING ERRCODE = '22023';
  END IF;

  v_completed_at := CASE
    WHEN p_status IN ('completed', 'expired', 'failed', 'cancelled')
         AND v_job.completed_at IS NULL
    THEN now()
    ELSE v_job.completed_at
  END;

  UPDATE ai_batch_jobs
  SET status = p_status,
      last_polled_at = now(),
      completed_at = v_completed_at,
      result_url = COALESCE(p_result_url, result_url),
      actual_cost = COALESCE(p_actual_cost, actual_cost),
      succeeded_count = COALESCE(p_succeeded_count, succeeded_count),
      errored_count = COALESCE(p_errored_count, errored_count),
      updated_at = now()
  WHERE id = v_job.id;

  IF p_status != v_job.status THEN
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'batch.status_changed',
      jsonb_build_object(
        'batch_job_id', v_job.id,
        'provider', p_provider,
        'external_batch_id', p_external_batch_id,
        'from_status', v_job.status,
        'to_status', p_status,
        'result_url', p_result_url
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'batch_job_id', v_job.id,
    'status', p_status,
    'completed_at', v_completed_at,
    'changed', p_status != v_job.status
  );
END;
$$;

COMMENT ON FUNCTION public.update_batch_job_status(text, text, text, text, numeric, int, int) IS
  'Transition a batch job status (used by WF_BATCH_POLLER). Records last_polled_at; '
  'audits status changes.';

REVOKE ALL ON FUNCTION public.update_batch_job_status(text, text, text, text, numeric, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_batch_job_status(text, text, text, text, numeric, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_batch_job_status(text, text, text, text, numeric, int, int) TO service_role;

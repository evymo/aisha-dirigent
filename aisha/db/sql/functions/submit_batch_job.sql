-- Function: submit_batch_job
-- Registers a batch job in ai_batch_jobs after the provider's batch endpoint
-- has accepted the JSONL request. Returns the local UUID of the batch row.
-- The actual provider POST is performed by the TS batchSubmitter helper —
-- this RPC is the authoritative state-write.

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.submit_batch_job(text, text, integer, jsonb, uuid, text, uuid, numeric);

CREATE OR REPLACE FUNCTION public.submit_batch_job(
  p_provider text,
  p_external_batch_id text,
  p_request_count int,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_related_run_id uuid DEFAULT NULL,
  p_agent_slug text DEFAULT 'aisha',
  p_story_id uuid DEFAULT NULL,
  p_estimated_cost numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id      uuid;
  v_user_id uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_provider NOT IN ('anthropic', 'openai') THEN
    RAISE EXCEPTION 'Invalid provider: %', p_provider USING ERRCODE = '22023';
  END IF;
  IF p_external_batch_id IS NULL OR p_external_batch_id = '' THEN
    RAISE EXCEPTION 'p_external_batch_id is required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_request_count, 0) <= 0 THEN
    RAISE EXCEPTION 'p_request_count must be > 0' USING ERRCODE = '22023';
  END IF;

  v_user_id := auth.uid();

  INSERT INTO ai_batch_jobs (
    provider,
    external_batch_id,
    status,
    request_count,
    estimated_cost,
    related_run_id,
    agent_slug,
    story_id,
    metadata,
    created_by
  )
  VALUES (
    p_provider,
    p_external_batch_id,
    'submitted',
    p_request_count,
    p_estimated_cost,
    p_related_run_id,
    p_agent_slug,
    p_story_id,
    COALESCE(p_metadata, '{}'::jsonb),
    v_user_id
  )
  RETURNING id INTO v_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'batch.job_submitted',
    jsonb_build_object(
      'batch_job_id', v_id,
      'provider', p_provider,
      'external_batch_id', p_external_batch_id,
      'request_count', p_request_count,
      'related_run_id', p_related_run_id,
      'agent_slug', p_agent_slug,
      'story_id', p_story_id
    )
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.submit_batch_job(text, text, int, jsonb, uuid, text, uuid, numeric) IS
  'Records a batch job after provider acceptance. Returns local UUID of ai_batch_jobs row.';

REVOKE ALL ON FUNCTION public.submit_batch_job(text, text, int, jsonb, uuid, text, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_batch_job(text, text, int, jsonb, uuid, text, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_batch_job(text, text, int, jsonb, uuid, text, uuid, numeric) TO service_role;

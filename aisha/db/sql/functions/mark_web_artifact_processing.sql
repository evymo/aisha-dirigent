-- mark_web_artifact_processing
-- service_role only: transition pending -> processing.

CREATE OR REPLACE FUNCTION public.mark_web_artifact_processing(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service THEN
    RAISE EXCEPTION 'Unauthorized: service_role required';
  END IF;

  UPDATE public.web_artifact_jobs
  SET status = 'processing',
      processed_at = NULL
  WHERE id = p_job_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found or not in pending state: %', p_job_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_web_artifact_processing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_web_artifact_processing(uuid) TO service_role;

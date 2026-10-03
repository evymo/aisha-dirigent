CREATE OR REPLACE FUNCTION update_scheduled_job_run_status(
  p_job_id uuid,
  p_status text,
  p_duration_ms integer DEFAULT NULL,
  p_next_run_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service_role BOOLEAN;
BEGIN
  v_is_service_role := public.is_service_role();
  IF auth.uid() IS NULL AND NOT v_is_service_role THEN
    RAISE EXCEPTION 'Access denied: authentication required';
  END IF;

  UPDATE ai_scheduled_jobs SET
    last_run_at = now(),
    last_run_status = p_status,
    last_run_duration_ms = p_duration_ms,
    next_run_at = p_next_run_at,
    total_runs = total_runs + 1,
    successful_runs = CASE WHEN p_status = 'completed' THEN successful_runs + 1 ELSE successful_runs END,
    failed_runs = CASE WHEN p_status = 'failed' THEN failed_runs + 1 ELSE failed_runs END
  WHERE id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION update_scheduled_job_run_status(uuid, text, integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_scheduled_job_run_status(uuid, text, integer, timestamptz) TO authenticated;

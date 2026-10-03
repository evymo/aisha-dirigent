CREATE OR REPLACE FUNCTION get_ai_scheduled_jobs_admin()
RETURNS TABLE (
  id uuid,
  name text,
  display_name text,
  description text,
  cron_expression text,
  job_type text,
  agent_name text,
  workflow_name text,
  job_config jsonb,
  is_active boolean,
  last_run_at timestamptz,
  last_run_status text,
  last_run_duration_ms integer,
  next_run_at timestamptz,
  total_runs integer,
  successful_runs integer,
  failed_runs integer,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  RETURN QUERY
    SELECT
      j.id, j.name, j.display_name, j.description,
      j.cron_expression, j.job_type, j.agent_name, j.workflow_name,
      j.job_config, j.is_active,
      j.last_run_at, j.last_run_status, j.last_run_duration_ms,
      j.next_run_at, j.total_runs, j.successful_runs, j.failed_runs,
      j.metadata, j.created_at
    FROM ai_scheduled_jobs j
    ORDER BY j.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION get_ai_scheduled_jobs_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_ai_scheduled_jobs_admin() TO authenticated;

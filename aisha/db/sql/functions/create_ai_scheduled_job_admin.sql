CREATE OR REPLACE FUNCTION create_ai_scheduled_job_admin(
  p_name text,
  p_display_name text,
  p_cron_expression text,
  p_job_type text DEFAULT 'ai_analysis',
  p_agent_name text DEFAULT NULL,
  p_workflow_name text DEFAULT NULL,
  p_job_config jsonb DEFAULT '{}'::jsonb,
  p_is_active boolean DEFAULT false,
  p_description text DEFAULT '',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO ai_scheduled_jobs (
    name, display_name, description, cron_expression,
    job_type, agent_name, workflow_name, job_config,
    is_active, metadata, created_by
  )
  VALUES (
    p_name, p_display_name, p_description, p_cron_expression,
    p_job_type, p_agent_name, p_workflow_name, p_job_config,
    p_is_active, p_metadata, auth.uid()
  )
  RETURNING ai_scheduled_jobs.id INTO v_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'AI_SCHEDULED_JOB_CREATE', jsonb_build_object(
    'area', 'admin', 'severity', 'info',
    'job_id', v_id, 'job_name', p_name
  ));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION create_ai_scheduled_job_admin(text, text, text, text, text, text, jsonb, boolean, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_ai_scheduled_job_admin(text, text, text, text, text, text, jsonb, boolean, text, jsonb) TO authenticated;

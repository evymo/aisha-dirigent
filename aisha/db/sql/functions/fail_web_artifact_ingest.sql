-- fail_web_artifact_ingest
-- service_role only: transition any non-terminal state -> failed.
-- Appends a story_entries row (entry_type=web_artifact_failed) so operators
-- see the failure in the storyloop timeline.

CREATE OR REPLACE FUNCTION public.fail_web_artifact_ingest(
  p_job_id uuid,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean;
  v_job record;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service THEN
    RAISE EXCEPTION 'Unauthorized: service_role required';
  END IF;

  SELECT id, status, story_id, kind INTO v_job
  FROM public.web_artifact_jobs
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found: %', p_job_id;
  END IF;

  IF v_job.status IN ('applied', 'failed', 'rejected') THEN
    RAISE EXCEPTION 'Job in terminal state (%), cannot fail', v_job.status;
  END IF;

  UPDATE public.web_artifact_jobs
  SET status = 'failed',
      error_message = COALESCE(p_error_message, 'Unknown error'),
      processed_at = COALESCE(processed_at, now())
  WHERE id = p_job_id;

  IF v_job.story_id IS NOT NULL THEN
    INSERT INTO public.story_entries (story_id, entry_type, content, metadata, created_by)
    VALUES (
      v_job.story_id,
      'web_artifact_failed',
      NULL,
      jsonb_build_object(
        'type', 'web_artifact_failed',
        'job_id', p_job_id,
        'kind', v_job.kind::text,
        'error_message', COALESCE(p_error_message, 'Unknown error')
      ),
      NULL
    );
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    NULL,
    'WEB_ARTIFACT_INGEST_FAIL',
    jsonb_build_object(
      'area', 'content',
      'severity', 'warning',
      'entity_type', 'web_artifact_job',
      'entity_id', p_job_id::text,
      'story_id', v_job.story_id,
      'kind', v_job.kind::text,
      'error_message', p_error_message,
      'tags', ARRAY['stack', 'story', 'web_artifact', 'fail']
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fail_web_artifact_ingest(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fail_web_artifact_ingest(uuid, text) TO service_role;

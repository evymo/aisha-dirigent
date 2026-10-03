-- complete_web_artifact_ingest
-- service_role only: transition processing -> ready_for_review with parser results.
-- Appends a story_entries row (entry_type=web_artifact_aisha_proposal) so the
-- storyloop timeline surfaces Aisha's proposed canvas + runtime block suggestions.

CREATE OR REPLACE FUNCTION public.complete_web_artifact_ingest(
  p_job_id uuid,
  p_canvas_data jsonb,
  p_canvas_html text,
  p_canvas_css text,
  p_extracted_tokens jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean;
  v_job record;
  v_proposal_metadata jsonb;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service THEN
    RAISE EXCEPTION 'Unauthorized: service_role required';
  END IF;

  IF p_canvas_data IS NULL THEN
    RAISE EXCEPTION 'canvas_data required';
  END IF;

  IF jsonb_typeof(p_canvas_data->'pages') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'canvas_data.pages must be array (got %)', jsonb_typeof(p_canvas_data->'pages');
  END IF;

  SELECT id, status, story_id, kind, source_type INTO v_job
  FROM public.web_artifact_jobs
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found: %', p_job_id;
  END IF;

  IF v_job.status NOT IN ('processing', 'pending') THEN
    RAISE EXCEPTION 'Job not in processing/pending state (got %)', v_job.status;
  END IF;

  UPDATE public.web_artifact_jobs
  SET status = 'ready_for_review',
      result_canvas_data = p_canvas_data,
      result_canvas_html = p_canvas_html,
      result_canvas_css = p_canvas_css,
      extracted_tokens = COALESCE(p_extracted_tokens, extracted_tokens),
      metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
      processed_at = now()
  WHERE id = p_job_id;

  IF v_job.story_id IS NOT NULL THEN
    v_proposal_metadata := jsonb_build_object(
      'type', 'web_artifact_aisha_proposal',
      'job_id', p_job_id,
      'source_type', v_job.source_type::text,
      'style_band', COALESCE(p_metadata->>'style_band', NULL),
      'mock_mode', COALESCE((p_metadata->>'mock_mode')::boolean, false),
      'runtime_block_suggestions', COALESCE(p_metadata->'runtime_block_suggestions', '[]'::jsonb)
    );
    INSERT INTO public.story_entries (story_id, entry_type, content, metadata, created_by)
    VALUES (v_job.story_id, 'web_artifact_aisha_proposal', NULL, v_proposal_metadata, NULL);
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    NULL,
    'WEB_ARTIFACT_INGEST_COMPLETE',
    jsonb_build_object(
      'area', 'content',
      'severity', 'info',
      'entity_type', 'web_artifact_job',
      'entity_id', p_job_id::text,
      'story_id', v_job.story_id,
      'kind', v_job.kind::text,
      'tags', ARRAY['stack', 'story', 'web_artifact', 'ingest', 'complete']
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_web_artifact_ingest(uuid, jsonb, text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_web_artifact_ingest(uuid, jsonb, text, text, jsonb, jsonb) TO service_role;

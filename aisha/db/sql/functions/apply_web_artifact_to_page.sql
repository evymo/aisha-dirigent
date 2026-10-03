-- apply_web_artifact_to_page
-- Apply a ready_for_review job's result canvas to a web_pages row.
-- Concurrency guard: raises stale_artifact_apply_another_version_landed if web_pages
-- has been updated since this job was created.
-- Always creates a pre-apply version snapshot for rollback.
-- Appends a story_entries row (entry_type=web_artifact_applied) so the storyloop
-- timeline records the transition.
-- Authz: admin/staff (or story participant when story_id is set).

CREATE OR REPLACE FUNCTION public.apply_web_artifact_to_page(
  p_job_id uuid,
  p_page_id uuid,
  p_publish boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_job record;
  v_page record;
  v_latest_version_id uuid;
  v_pre_apply_version_id uuid;
BEGIN
  SELECT id, status, story_id, result_canvas_data, result_canvas_html, result_canvas_css, created_at
  INTO v_job
  FROM public.web_artifact_jobs
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found: %', p_job_id;
  END IF;

  IF v_job.status NOT IN ('ready_for_review', 'approved') THEN
    RAISE EXCEPTION 'Job must be ready_for_review/approved (got %)', v_job.status;
  END IF;

  IF v_job.result_canvas_data IS NULL THEN
    RAISE EXCEPTION 'Job has no result canvas to apply';
  END IF;

  SELECT id, story_id, updated_at, status INTO v_page
  FROM public.web_pages
  WHERE id = p_page_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Page not found: %', p_page_id;
  END IF;

  -- Boot-time /seed-default publishes via service_role (sub-less system runner,
  -- not a story participant) — admit it, consistent with start/mark/complete
  -- which are already service_role-aware. Admin/staff + story-participant paths
  -- are unchanged.
  IF NOT public.is_admin_or_staff()
     AND NOT public.is_service_role()
     AND (v_job.story_id IS NULL OR NOT public.is_story_participant(auth.uid(), v_job.story_id))
  THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff, service_role, or story participant required';
  END IF;

  SELECT id INTO v_latest_version_id
  FROM public.web_page_versions
  WHERE page_id = p_page_id
  ORDER BY version_number DESC
  LIMIT 1;

  IF v_page.updated_at > v_job.created_at
     AND (v_latest_version_id IS NULL OR v_latest_version_id IS DISTINCT FROM (
       SELECT applied_version_id FROM public.web_artifact_jobs WHERE id = p_job_id
     ))
  THEN
    RAISE EXCEPTION 'stale_artifact_apply_another_version_landed: page updated_at=% > job created_at=%, regenerate artifact', v_page.updated_at, v_job.created_at;
  END IF;

  v_pre_apply_version_id := public.create_web_page_version(p_page_id, 'auto: before web_artifact apply');

  UPDATE public.web_pages
  SET canvas_data = v_job.result_canvas_data,
      canvas_html = v_job.result_canvas_html,
      canvas_css = v_job.result_canvas_css,
      story_id = v_job.story_id,
      status = CASE WHEN p_publish THEN 'published' ELSE status END,
      updated_at = now()
  WHERE id = p_page_id;

  UPDATE public.web_artifact_jobs
  SET status = 'applied',
      applied_to_page_id = p_page_id,
      applied_version_id = v_pre_apply_version_id,
      applied_at = now()
  WHERE id = p_job_id;

  IF v_job.story_id IS NOT NULL THEN
    INSERT INTO public.story_entries (story_id, entry_type, content, metadata, created_by)
    VALUES (
      v_job.story_id,
      'web_artifact_applied',
      NULL,
      jsonb_build_object(
        'type', 'web_artifact_applied',
        'job_id', p_job_id,
        'page_id', p_page_id,
        'pre_apply_version_id', v_pre_apply_version_id,
        'published', p_publish
      ),
      auth.uid()
    );
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'WEB_ARTIFACT_APPLY',
    jsonb_build_object(
      'area', 'content',
      'severity', 'info',
      'entity_type', 'web_artifact_job',
      'entity_id', p_job_id::text,
      'page_id', p_page_id::text,
      'pre_apply_version_id', v_pre_apply_version_id::text,
      'published', p_publish,
      'tags', ARRAY['stack', 'story', 'web_artifact', 'apply']
    )
  );

  RETURN v_pre_apply_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_web_artifact_to_page(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_web_artifact_to_page(uuid, uuid, boolean) TO authenticated, service_role;

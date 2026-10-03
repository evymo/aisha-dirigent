-- publish_web_artifact
-- Flip applied page status to 'published'. Job must already be in 'applied' state.
-- Appends a story_entries row (entry_type=web_artifact_published).
-- Authz: admin/staff or story participant.

CREATE OR REPLACE FUNCTION public.publish_web_artifact(p_job_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_job record;
  v_slug text;
BEGIN
  SELECT id, status, story_id, applied_to_page_id INTO v_job
  FROM public.web_artifact_jobs
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found: %', p_job_id;
  END IF;

  IF v_job.status <> 'applied' THEN
    RAISE EXCEPTION 'Job must be applied (got %)', v_job.status;
  END IF;

  IF v_job.applied_to_page_id IS NULL THEN
    RAISE EXCEPTION 'Job has no applied page reference';
  END IF;

  IF NOT public.is_admin_or_staff()
     AND (v_job.story_id IS NULL OR NOT public.is_story_participant(auth.uid(), v_job.story_id))
  THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff or story participant required';
  END IF;

  UPDATE public.web_pages
  SET status = 'published', updated_at = now()
  WHERE id = v_job.applied_to_page_id
  RETURNING slug INTO v_slug;

  IF v_job.story_id IS NOT NULL THEN
    INSERT INTO public.story_entries (story_id, entry_type, content, metadata, created_by)
    VALUES (
      v_job.story_id,
      'web_artifact_published',
      NULL,
      jsonb_build_object(
        'type', 'web_artifact_published',
        'job_id', p_job_id,
        'page_id', v_job.applied_to_page_id,
        'slug', v_slug
      ),
      auth.uid()
    );
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'WEB_ARTIFACT_PUBLISH',
    jsonb_build_object(
      'area', 'content',
      'severity', 'info',
      'entity_type', 'web_artifact_job',
      'entity_id', p_job_id::text,
      'page_id', v_job.applied_to_page_id::text,
      'slug', v_slug,
      'tags', ARRAY['stack', 'story', 'web_artifact', 'publish']
    )
  );

  RETURN v_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_web_artifact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_web_artifact(uuid) TO authenticated;

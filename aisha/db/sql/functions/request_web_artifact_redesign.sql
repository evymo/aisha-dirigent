-- request_web_artifact_redesign
-- Spawns a new redesign job seeded from an existing ready_for_review job's canvas.
-- Authz: admin/staff OR story participant.

CREATE OR REPLACE FUNCTION public.request_web_artifact_redesign(
  p_job_id uuid,
  p_brief text,
  p_slot_profile text DEFAULT 'balanced',
  p_creativity_seed numeric DEFAULT 0.5
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_source_job record;
  v_new_job_id uuid;
  v_idempotency_key text;
BEGIN
  SELECT id, story_id, result_canvas_data, status, kind
  INTO v_source_job
  FROM public.web_artifact_jobs
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source job not found: %', p_job_id;
  END IF;

  IF v_source_job.status NOT IN ('ready_for_review', 'approved', 'applied') THEN
    RAISE EXCEPTION 'Source job must be ready_for_review/approved/applied (got %)', v_source_job.status;
  END IF;

  IF v_source_job.result_canvas_data IS NULL THEN
    RAISE EXCEPTION 'Source job has no result canvas to seed redesign from';
  END IF;

  IF NOT public.is_admin_or_staff()
     AND (v_source_job.story_id IS NULL OR NOT public.is_story_participant(auth.uid(), v_source_job.story_id))
  THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff or story participant required';
  END IF;

  IF p_slot_profile NOT IN ('budget', 'balanced', 'maxQuality') THEN
    RAISE EXCEPTION 'slot_profile must be budget | balanced | maxQuality';
  END IF;

  v_idempotency_key := encode(digest(
    'llm_redesign|' || p_job_id::text || '|' || COALESCE(p_brief, '') || '|' || p_slot_profile || '|' || now()::text,
    'sha256'
  ), 'hex');

  INSERT INTO public.web_artifact_jobs (
    story_id, kind, source_type, status,
    seed_canvas_data, brief, slot_profile, creativity_seed,
    idempotency_key, created_by, metadata
  ) VALUES (
    v_source_job.story_id,
    'redesign',
    'llm_redesign',
    'pending',
    v_source_job.result_canvas_data,
    p_brief,
    p_slot_profile,
    p_creativity_seed,
    v_idempotency_key,
    auth.uid(),
    jsonb_build_object('source_job_id', p_job_id::text)
  )
  RETURNING id INTO v_new_job_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'WEB_ARTIFACT_REDESIGN_REQUEST',
    jsonb_build_object(
      'area', 'content',
      'severity', 'info',
      'entity_type', 'web_artifact_job',
      'entity_id', v_new_job_id::text,
      'story_id', v_source_job.story_id,
      'kind', 'redesign',
      'source_job_id', p_job_id::text,
      'slot_profile', p_slot_profile,
      'tags', ARRAY['stack', 'story', 'web_artifact', 'redesign']
    )
  );

  RETURN v_new_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_web_artifact_redesign(uuid, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_web_artifact_redesign(uuid, text, text, numeric) TO authenticated;

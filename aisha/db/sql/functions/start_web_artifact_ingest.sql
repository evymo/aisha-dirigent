-- start_web_artifact_ingest
-- Creates a new web artifact ingest job (or returns existing on idempotency-key match).
-- Authz: admin/staff OR story participant OR service_role.
--
-- Appends a story_entries row (entry_type=web_artifact_upload | web_artifact_scrape)
-- so the storyloop timeline reflects the new operator turn. Default seed and
-- redesign sources do not append from here.

CREATE OR REPLACE FUNCTION public.start_web_artifact_ingest(
  p_story_id uuid,
  p_kind public.web_artifact_kind,
  p_source_type public.web_artifact_source_type,
  p_source_url text DEFAULT NULL,
  p_source_storage_path text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_job_id uuid;
  v_is_service boolean;
  v_existing_id uuid;
  v_idempotency_key text;
  v_entry_type text;
  v_entry_metadata jsonb;
BEGIN
  v_is_service := public.is_service_role();

  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RAISE EXCEPTION 'idempotency_key required';
  END IF;
  v_idempotency_key := p_idempotency_key;

  IF NOT v_is_service
     AND NOT public.is_admin_or_staff()
     AND (p_story_id IS NULL OR NOT public.is_story_participant(auth.uid(), p_story_id))
  THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, story participant, or service_role required';
  END IF;

  IF p_source_type = 'default_seed' AND NOT v_is_service THEN
    RAISE EXCEPTION 'default_seed source_type is service_role only';
  END IF;

  IF p_source_type IN ('folder_upload', 'url_scrape') AND p_story_id IS NULL THEN
    RAISE EXCEPTION 'story_id required for source_type %', p_source_type;
  END IF;

  SELECT id INTO v_existing_id
  FROM public.web_artifact_jobs
  WHERE idempotency_key = v_idempotency_key;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.web_artifact_jobs (
    story_id, kind, source_type, source_url, source_storage_path,
    idempotency_key, created_by, metadata, status
  ) VALUES (
    p_story_id, p_kind, p_source_type, p_source_url, p_source_storage_path,
    v_idempotency_key, auth.uid(), COALESCE(p_metadata, '{}'::jsonb), 'pending'
  )
  RETURNING id INTO v_job_id;

  IF p_story_id IS NOT NULL AND p_source_type IN ('folder_upload', 'url_scrape') THEN
    v_entry_type := CASE p_source_type
      WHEN 'folder_upload' THEN 'web_artifact_upload'
      WHEN 'url_scrape' THEN 'web_artifact_scrape'
    END;
    v_entry_metadata := jsonb_build_object(
      'type', v_entry_type,
      'job_id', v_job_id,
      'source_url', p_source_url,
      'source_storage_path', p_source_storage_path,
      'source_filename', COALESCE(p_metadata->>'source_filename', NULL)
    );
    INSERT INTO public.story_entries (story_id, entry_type, content, metadata, created_by)
    VALUES (p_story_id, v_entry_type, NULL, v_entry_metadata, auth.uid());
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'WEB_ARTIFACT_INGEST_START',
    jsonb_build_object(
      'area', 'content',
      'severity', 'info',
      'entity_type', 'web_artifact_job',
      'entity_id', v_job_id::text,
      'story_id', p_story_id,
      'kind', p_kind::text,
      'source_type', p_source_type::text,
      'tags', ARRAY['stack', 'story', 'web_artifact', 'ingest']
    )
  );

  RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_web_artifact_ingest(uuid, public.web_artifact_kind, public.web_artifact_source_type, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_web_artifact_ingest(uuid, public.web_artifact_kind, public.web_artifact_source_type, text, text, text, jsonb) TO authenticated, service_role;

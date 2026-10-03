-- get_web_artifact_jobs_for_story
-- Returns artifact job history for a story (chronological).
-- Authz: RLS handles it (admin/staff sees all, story participants see theirs).

CREATE OR REPLACE FUNCTION public.get_web_artifact_jobs_for_story(p_story_id uuid)
RETURNS TABLE (
  id uuid,
  story_id uuid,
  kind public.web_artifact_kind,
  source_type public.web_artifact_source_type,
  status public.web_artifact_job_status,
  source_url text,
  source_storage_path text,
  brief text,
  slot_profile text,
  extracted_tokens jsonb,
  result_canvas_html text,
  applied_to_page_id uuid,
  applied_version_id uuid,
  error_message text,
  metadata jsonb,
  created_by uuid,
  created_at timestamptz,
  processed_at timestamptz,
  applied_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT j.id, j.story_id, j.kind, j.source_type, j.status, j.source_url, j.source_storage_path,
         j.brief, j.slot_profile, j.extracted_tokens, j.result_canvas_html, j.applied_to_page_id,
         j.applied_version_id, j.error_message, j.metadata, j.created_by, j.created_at,
         j.processed_at, j.applied_at
  FROM public.web_artifact_jobs j
  WHERE j.story_id = p_story_id
  ORDER BY j.created_at DESC
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.get_web_artifact_jobs_for_story(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_web_artifact_jobs_for_story(uuid) TO authenticated;

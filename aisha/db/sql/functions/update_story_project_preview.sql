-- Function: public.update_story_project_preview
-- Arguments: p_story_id uuid, p_project_preview jsonb, p_publish boolean DEFAULT false
-- Security: SECURITY DEFINER
-- Source: Source-of-truth function for story project preview updates.

CREATE OR REPLACE FUNCTION public.update_story_project_preview(
  p_story_id uuid,
  p_project_preview jsonb,
  p_publish boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_previous_preview jsonb;
  v_rows_updated int := 0;
BEGIN
  -- Authorization: must be admin/staff or story owner
  IF NOT public.is_admin_or_staff() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.partner_stories
      WHERE id = p_story_id
        AND partner_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Unauthorized: not story owner or admin/staff' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_project_preview IS NULL OR jsonb_typeof(p_project_preview) <> 'object' THEN
    RAISE EXCEPTION 'project_preview must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    p_project_preview ? 'summary'
    AND p_project_preview ? 'goals'
    AND p_project_preview ? 'constraints'
    AND p_project_preview ? 'success_criteria'
  ) THEN
    RAISE EXCEPTION 'project_preview must include summary, goals, constraints, success_criteria' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    jsonb_typeof(p_project_preview->'summary') = 'string'
    AND jsonb_typeof(p_project_preview->'goals') = 'array'
    AND jsonb_typeof(p_project_preview->'constraints') = 'array'
    AND jsonb_typeof(p_project_preview->'success_criteria') = 'array'
  ) THEN
    RAISE EXCEPTION 'project_preview fields have invalid types' USING ERRCODE = '22023';
  END IF;

  SELECT ps.project_preview
  INTO v_previous_preview
  FROM public.partner_stories ps
  WHERE ps.id = p_story_id;

  UPDATE public.partner_stories
  SET
    project_preview = p_project_preview,
    updated_at = now()
  WHERE id = p_story_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'Story not found: %', p_story_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    CASE WHEN p_publish THEN 'STORY_PROJECT_PREVIEW_PUBLISHED' ELSE 'STORY_PROJECT_PREVIEW_UPDATED' END,
    jsonb_build_object(
      'area', 'ai',
      'severity', 'info',
      'story_id', p_story_id,
      'published', p_publish,
      'has_previous_preview', v_previous_preview IS NOT NULL,
      'has_summary', COALESCE((p_project_preview ? 'summary'), false),
      'has_goals', COALESCE((p_project_preview ? 'goals'), false),
      'has_constraints', COALESCE((p_project_preview ? 'constraints'), false),
      'has_success_criteria', COALESCE((p_project_preview ? 'success_criteria'), false)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'story_id', p_story_id,
    'published', p_publish,
    'updated_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_story_project_preview(uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_story_project_preview(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_story_project_preview(uuid, jsonb, boolean) TO service_role;

-- Function: public.update_story_canvas
-- Arguments: p_story_id uuid, p_canvas_data jsonb, p_canvas_html text DEFAULT NULL, p_canvas_css text DEFAULT NULL, p_publish boolean DEFAULT false
-- Security: SECURITY DEFINER
-- Source: Source-of-truth function for story canvas (GrapesJS) updates.

CREATE OR REPLACE FUNCTION public.update_story_canvas(
  p_story_id uuid,
  p_canvas_data jsonb,
  p_canvas_html text DEFAULT NULL,
  p_canvas_css text DEFAULT NULL,
  p_publish boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
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
      RAISE EXCEPTION 'Unauthorized: not story owner or admin/staff';
    END IF;
  END IF;

  -- Validate canvas_data is a JSON object
  IF p_canvas_data IS NOT NULL AND jsonb_typeof(p_canvas_data) <> 'object' THEN
    RAISE EXCEPTION 'canvas_data must be a JSON object or null';
  END IF;

  UPDATE public.partner_stories
  SET
    canvas_data = p_canvas_data,
    canvas_html = COALESCE(p_canvas_html, canvas_html),
    canvas_css = COALESCE(p_canvas_css, canvas_css),
    updated_at = now()
  WHERE id = p_story_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'Story not found: %', p_story_id;
  END IF;

  -- Audit logging
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    CASE WHEN p_publish THEN 'STORY_CANVAS_PUBLISHED' ELSE 'STORY_CANVAS_UPDATED' END,
    jsonb_build_object(
      'area', 'ai',
      'severity', 'info',
      'story_id', p_story_id,
      'published', p_publish,
      'has_html', p_canvas_html IS NOT NULL,
      'has_css', p_canvas_css IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'story_id', p_story_id,
    'updated', true,
    'published', p_publish
  );
END;
$function$;

-- Security grants
REVOKE ALL ON FUNCTION public.update_story_canvas(uuid, jsonb, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_story_canvas(uuid, jsonb, text, text, boolean) TO authenticated;

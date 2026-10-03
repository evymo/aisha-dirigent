-- Function: public.update_web_page_canvas_admin
-- Description: Saves GrapeJS canvas data for a web page. Requires admin role.
-- Security: SECURITY DEFINER, authenticated only
-- Created: 2026-04-11

CREATE OR REPLACE FUNCTION public.update_web_page_canvas_admin(
  p_id uuid,
  p_canvas_data jsonb DEFAULT NULL,
  p_canvas_html text DEFAULT NULL,
  p_canvas_css text DEFAULT NULL,
  p_page_settings jsonb DEFAULT NULL,
  p_publish boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE web_pages SET
    canvas_data = COALESCE(p_canvas_data, web_pages.canvas_data),
    canvas_html = COALESCE(p_canvas_html, web_pages.canvas_html),
    canvas_css = COALESCE(p_canvas_css, web_pages.canvas_css),
    page_settings = COALESCE(p_page_settings, web_pages.page_settings),
    status = CASE WHEN p_publish THEN 'published' ELSE web_pages.status END,
    updated_at = now()
  WHERE web_pages.id = p_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::public.journal_action_type,
    p_area := 'content'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_id::text,
    p_entity_type := 'web_page',
    p_new_values := jsonb_build_object('publish', p_publish),
    p_old_values := NULL,
    p_severity := 'info'::public.journal_severity,
    p_summary := CASE WHEN p_publish THEN 'Published web page canvas' ELSE 'Saved web page canvas' END,
    p_tags := ARRAY['admin', 'content', 'web_page', 'canvas'],
    p_user_id := auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_web_page_canvas_admin(uuid, jsonb, text, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_web_page_canvas_admin(uuid, jsonb, text, text, jsonb, boolean) TO authenticated;

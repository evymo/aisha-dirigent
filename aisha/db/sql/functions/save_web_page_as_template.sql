-- Function: public.save_web_page_as_template
-- Description: Saves a web page's current state as a reusable template.
-- Security: SECURITY INVOKER, authenticated only, admin/staff check inside
-- Created: 2026-04-14

CREATE OR REPLACE FUNCTION public.save_web_page_as_template(
  p_page_id uuid,
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_template_id uuid;
  v_page record;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT canvas_data, canvas_html, canvas_css, page_settings
  INTO v_page
  FROM public.web_pages
  WHERE id = p_page_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Page not found';
  END IF;

  INSERT INTO public.web_page_templates (
    name, description, canvas_data, canvas_html, canvas_css,
    page_settings, created_by
  ) VALUES (
    p_name, p_description, v_page.canvas_data, v_page.canvas_html,
    v_page.canvas_css, v_page.page_settings, auth.uid()
  )
  RETURNING id INTO v_template_id;

  RETURN v_template_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_web_page_as_template(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_web_page_as_template(uuid, text, text) TO authenticated;

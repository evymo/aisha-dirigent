-- Function: public.apply_web_page_template
-- Description: Applies a template to a page (auto-snapshots current state first).
-- Security: SECURITY INVOKER, authenticated only, admin/staff check inside
-- Created: 2026-04-14

CREATE OR REPLACE FUNCTION public.apply_web_page_template(
  p_page_id uuid,
  p_template_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_tpl record;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Snapshot before overwrite
  PERFORM public.create_web_page_version(p_page_id, 'auto: before template apply');

  SELECT canvas_data, canvas_html, canvas_css, page_settings
  INTO v_tpl
  FROM public.web_page_templates
  WHERE id = p_template_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  UPDATE public.web_pages
  SET canvas_data = v_tpl.canvas_data,
      canvas_html = v_tpl.canvas_html,
      canvas_css = v_tpl.canvas_css,
      page_settings = v_tpl.page_settings,
      updated_at = now()
  WHERE id = p_page_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'PAGE_TEMPLATE_APPLY',
    jsonb_build_object(
      'area', 'web_pages',
      'severity', 'info',
      'entity_type', 'web_page_template',
      'entity_id', p_template_id::text,
      'page_id', p_page_id::text
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_web_page_template(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_web_page_template(uuid, uuid) TO authenticated;

-- Function: public.restore_web_page_version
-- Description: Restores a web page to a previous version snapshot (auto-snapshots current state first).
-- Security: SECURITY INVOKER, authenticated only, admin/staff check inside
-- Created: 2026-04-14

CREATE OR REPLACE FUNCTION public.restore_web_page_version(
  p_page_id uuid,
  p_version_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_version record;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Get version data
  SELECT canvas_data, canvas_html, canvas_css, page_settings
  INTO v_version
  FROM public.web_page_versions
  WHERE id = p_version_id AND page_id = p_page_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version not found';
  END IF;

  -- Create snapshot of current state before restore
  PERFORM public.create_web_page_version(p_page_id, 'auto: before restore');

  -- Apply version
  UPDATE public.web_pages
  SET canvas_data = v_version.canvas_data,
      canvas_html = v_version.canvas_html,
      canvas_css = v_version.canvas_css,
      page_settings = v_version.page_settings,
      updated_at = now()
  WHERE id = p_page_id;

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'PAGE_VERSION_RESTORE',
    jsonb_build_object(
      'area', 'web_pages',
      'severity', 'warning',
      'entity_type', 'web_page_version',
      'entity_id', p_version_id::text,
      'page_id', p_page_id::text
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_web_page_version(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_web_page_version(uuid, uuid) TO authenticated;

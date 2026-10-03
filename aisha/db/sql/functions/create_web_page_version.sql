-- Function: public.create_web_page_version
-- Description: Creates a snapshot version of a web page's current state.
-- Security: SECURITY INVOKER, authenticated only, admin/staff check inside
-- Created: 2026-04-14

CREATE OR REPLACE FUNCTION public.create_web_page_version(
  p_page_id uuid,
  p_label text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_version_id uuid;
  v_next_version integer;
  v_page record;
BEGIN
  -- Admin/staff (editor) OR service_role (boot-time /seed-default publishes via
  -- apply_web_artifact_to_page, which snapshots a version). Consistent with the
  -- rest of the now service_role-aware seed chain.
  IF NOT public.is_admin_or_staff()
     AND NOT public.is_service_role()
  THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Get current page data
  SELECT canvas_data, canvas_html, canvas_css, page_settings
  INTO v_page
  FROM public.web_pages
  WHERE id = p_page_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Page not found';
  END IF;

  -- Nothing to snapshot: a freshly-created page (no canvas yet) has no prior
  -- state worth versioning. web_page_versions.canvas_data is NOT NULL, so an
  -- empty snapshot is both meaningless and illegal. Return NULL — callers
  -- (apply_web_artifact_to_page) treat a NULL pre-apply version as "no prior
  -- version". This is what makes the FIRST seed of a page work.
  IF v_page.canvas_data IS NULL AND v_page.canvas_html IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get next version number
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM public.web_page_versions
  WHERE page_id = p_page_id;

  -- Insert version
  INSERT INTO public.web_page_versions (
    page_id, version_number, canvas_data, canvas_html, canvas_css,
    page_settings, created_by, label
  ) VALUES (
    p_page_id, v_next_version, v_page.canvas_data, v_page.canvas_html,
    v_page.canvas_css, v_page.page_settings, auth.uid(), p_label
  )
  RETURNING id INTO v_version_id;

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'PAGE_VERSION_CREATE',
    jsonb_build_object(
      'area', 'web_pages',
      'severity', 'info',
      'entity_type', 'web_page_version',
      'entity_id', v_version_id::text,
      'page_id', p_page_id::text,
      'version_number', v_next_version
    )
  );

  RETURN v_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_web_page_version(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_web_page_version(uuid, text) TO authenticated, service_role;

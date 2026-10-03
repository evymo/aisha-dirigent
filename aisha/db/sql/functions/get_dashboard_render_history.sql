-- ============================================================================
-- Source of Truth: get_dashboard_render_history
-- Popis: Admin view recent dashboard rendering events s diff summary + duration_ms.
-- Volá: dashboard "Render History" widget (admin-only sekce)
-- Auth: admin/staff only
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_render_history(
  p_dashboard_slug text DEFAULT 'aisha-ops',
  p_limit          int DEFAULT 30
)
RETURNS TABLE (
  id              uuid,
  rendered_at     timestamptz,
  content_hash    text,
  triggered_by    text,
  publish_status  text,
  publish_error   text,
  duration_ms     int,
  diff_summary    jsonb,
  age_minutes     int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin/staff role required';
  END IF;

  RETURN QUERY
  SELECT
    drh.id, drh.rendered_at, drh.content_hash, drh.triggered_by,
    drh.publish_status, drh.publish_error, drh.duration_ms, drh.diff_summary,
    EXTRACT(EPOCH FROM (now() - drh.rendered_at))::int / 60 AS age_minutes
  FROM public.dashboard_render_history drh
  WHERE drh.dashboard_slug = p_dashboard_slug
  ORDER BY drh.rendered_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_render_history(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_render_history(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_render_history(text, int) TO service_role;

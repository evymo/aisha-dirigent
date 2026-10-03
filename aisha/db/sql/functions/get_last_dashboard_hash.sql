-- ============================================================================
-- Source of Truth: get_last_dashboard_hash
-- Popis: Returns hash z posledního "published" rendering (skip-if-unchanged check).
--        Pokud žádný úspěšný render neexistuje, vrátí NULL (forces first import).
-- Volá: WF_APPSMITH_DASHBOARD_BUILDER před content hash compare
-- Auth: admin/staff nebo service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_last_dashboard_hash(
  p_dashboard_slug text DEFAULT 'aisha-ops'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_hash text;
BEGIN
  IF NOT public.is_admin_or_staff()
     AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT content_hash INTO v_hash
  FROM public.dashboard_render_history
  WHERE dashboard_slug = p_dashboard_slug
    AND publish_status IN ('published', 'skipped_no_change')
  ORDER BY rendered_at DESC
  LIMIT 1;

  RETURN v_hash;  -- NULL pokud first run
END;
$$;

REVOKE ALL ON FUNCTION public.get_last_dashboard_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_last_dashboard_hash(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_last_dashboard_hash(text) TO service_role;

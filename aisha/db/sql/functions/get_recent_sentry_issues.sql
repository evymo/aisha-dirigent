-- ============================================================================
-- Source of Truth: get_recent_sentry_issues
-- Popis: Dashboard query Sentry issues — vrací deduplikované issues filtered by
--        min level (fatal | error | warning | info | debug) a optional app_name.
--        DISTINCT ON (sentry_issue_id) → per issue jen latest snapshot.
-- Auth: admin/staff nebo service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_recent_sentry_issues(
  p_limit int DEFAULT 50,
  p_min_level text DEFAULT 'error',
  p_app_name text DEFAULT NULL
)
RETURNS TABLE (
  sentry_issue_id text,
  app_name        text,
  project_slug    text,
  level           text,
  title           text,
  first_seen      timestamptz,
  last_seen       timestamptz,
  count           int,
  user_count      int,
  release         text,
  permalink       text,
  age_minutes     int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_min_idx int;
BEGIN
  IF NOT public.is_admin_or_staff()
     AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_min_idx := CASE p_min_level
    WHEN 'fatal'   THEN 0
    WHEN 'error'   THEN 1
    WHEN 'warning' THEN 2
    WHEN 'info'    THEN 3
    WHEN 'debug'   THEN 4
    ELSE 1
  END;

  RETURN QUERY
  SELECT DISTINCT ON (sis.sentry_issue_id)
    sis.sentry_issue_id, sis.app_name, sis.project_slug, sis.level, sis.title,
    sis.first_seen, sis.last_seen, sis.count, sis.user_count,
    sis.release, sis.permalink,
    EXTRACT(EPOCH FROM (now() - sis.first_seen))::int / 60 AS age_minutes
  FROM public.sentry_issue_snapshot sis
  WHERE sis.status = 'unresolved'
    AND CASE sis.level
      WHEN 'fatal'   THEN 0
      WHEN 'error'   THEN 1
      WHEN 'warning' THEN 2
      WHEN 'info'    THEN 3
      WHEN 'debug'   THEN 4
    END <= v_min_idx
    AND (p_app_name IS NULL OR sis.app_name = p_app_name)
  ORDER BY sis.sentry_issue_id, sis.observed_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.get_recent_sentry_issues(int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_sentry_issues(int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_sentry_issues(int, text, text) TO service_role;

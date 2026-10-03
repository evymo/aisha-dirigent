-- ============================================================================
-- Source of Truth: correlate_sentry_with_deploys
-- Popis: Centrální RPC Phase 3 — pro každou recently-switched app spočítá Sentry
--        issues v okně (default 15 min od switche), vrátí rollback recommendation.
--        Threshold pravidla: ≥3 fatal, ≥50 error, nebo ≥100 dotčených uživatelů
--        → rollback_recommended = true.
-- Volá: WF_SENTRY_OBSERVER (Phase 3)
-- Auth: admin/staff nebo service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.correlate_sentry_with_deploys(
  p_window_minutes int DEFAULT 15
)
RETURNS TABLE (
  app_name             text,
  active_slot          text,
  switched_at          timestamptz,
  last_image_tag       text,
  fatal_count          int,
  error_count          int,
  warning_count        int,
  new_issues_in_window int,
  unique_users_affected int,
  rollback_recommended boolean,
  rollback_reason      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF NOT public.is_admin_or_staff()
     AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  WITH recent_switches AS (
    SELECT
      cas.app_name,
      cas.active_slot,
      cas.last_switch_at,
      CASE cas.active_slot
        WHEN 'blue' THEN cas.blue_image_tag
        WHEN 'green' THEN cas.green_image_tag
      END AS image_tag
    FROM public.coolify_app_slots cas
    WHERE cas.last_switch_at IS NOT NULL
      AND cas.last_switch_at > now() - interval '30 minutes'
  ),
  sentry_window AS (
    SELECT
      sis.app_name,
      sis.level,
      sis.user_count,
      sis.first_seen,
      sis.sentry_issue_id
    FROM public.sentry_issue_snapshot sis
    INNER JOIN recent_switches rs ON sis.app_name = rs.app_name
    WHERE sis.first_seen > rs.last_switch_at
      AND sis.first_seen < rs.last_switch_at + (p_window_minutes || ' minutes')::interval
      AND sis.status = 'unresolved'
  ),
  agg AS (
    SELECT
      sw.app_name,
      count(*) FILTER (WHERE sw.level = 'fatal')::int AS fatal_count,
      count(*) FILTER (WHERE sw.level = 'error')::int AS error_count,
      count(*) FILTER (WHERE sw.level = 'warning')::int AS warning_count,
      count(DISTINCT sw.sentry_issue_id)::int AS new_issues,
      sum(sw.user_count)::int AS users
    FROM sentry_window sw
    GROUP BY sw.app_name
  )
  SELECT
    rs.app_name,
    rs.active_slot,
    rs.last_switch_at AS switched_at,
    rs.image_tag AS last_image_tag,
    COALESCE(a.fatal_count, 0) AS fatal_count,
    COALESCE(a.error_count, 0) AS error_count,
    COALESCE(a.warning_count, 0) AS warning_count,
    COALESCE(a.new_issues, 0) AS new_issues_in_window,
    COALESCE(a.users, 0) AS unique_users_affected,
    (
      COALESCE(a.fatal_count, 0) >= 3
      OR COALESCE(a.error_count, 0) >= 50
      OR COALESCE(a.users, 0) >= 100
    ) AS rollback_recommended,
    CASE
      WHEN COALESCE(a.fatal_count, 0) >= 3
        THEN '≥3 fatal issues po switchi'
      WHEN COALESCE(a.error_count, 0) >= 50
        THEN '≥50 error issues po switchi'
      WHEN COALESCE(a.users, 0) >= 100
        THEN '≥100 dotčených uživatelů'
      ELSE NULL
    END AS rollback_reason
  FROM recent_switches rs
  LEFT JOIN agg a ON a.app_name = rs.app_name;
END;
$$;

REVOKE ALL ON FUNCTION public.correlate_sentry_with_deploys(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correlate_sentry_with_deploys(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correlate_sentry_with_deploys(int) TO service_role;

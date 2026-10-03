-- Function: public.get_storyloop_admin_overview
-- Arguments: (none)
-- Description: Admin/staff non-sensitive data StoryLoop aggregates for operational monitoring.
-- Security: SECURITY DEFINER; admin/staff guard + audit logging.

CREATE OR REPLACE FUNCTION public.get_storyloop_admin_overview()
 RETURNS TABLE(
  total_stories bigint,
  active_stories bigint,
  stories_active_7d bigint,
  stories_active_30d bigint,
  inbox_count bigint,
  in_progress_count bigint,
  scheduled_count bigint,
  archived_count bigint,
  trash_count bigint,
  starred_count bigint,
  unread_total bigint,
  total_entries bigint,
  entries_7d bigint,
  entries_30d bigint,
  reminders_upcoming_7d bigint,
  reminders_overdue bigint,
  partners_active bigint,
  members_covered bigint
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'view',
    p_area := 'admin',
    p_details := jsonb_build_object('dataset', 'storyloop_aggregates'),
    p_entity_id := NULL,
    p_entity_type := 'storyloop_overview',
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'notice',
    p_summary := 'Admin viewing StoryLoop aggregated overview',
    p_tags := ARRAY['admin', 'storyloop', 'aggregates'],
    p_user_id := v_user_id
  );

  RETURN QUERY
  WITH story_stats AS (
    SELECT
      COUNT(*) AS total_stories,
      COUNT(*) FILTER (WHERE ps.status IN ('active', 'inbox', 'in_progress', 'scheduled')) AS active_stories,
      COUNT(*) FILTER (WHERE ps.last_activity_at >= now() - interval '7 days') AS stories_active_7d,
      COUNT(*) FILTER (WHERE ps.last_activity_at >= now() - interval '30 days') AS stories_active_30d,
      COUNT(*) FILTER (WHERE ps.status = 'inbox') AS inbox_count,
      COUNT(*) FILTER (WHERE ps.status = 'in_progress') AS in_progress_count,
      COUNT(*) FILTER (WHERE ps.status = 'scheduled') AS scheduled_count,
      COUNT(*) FILTER (WHERE ps.status = 'archived') AS archived_count,
      COUNT(*) FILTER (WHERE ps.status = 'trash') AS trash_count,
      COUNT(*) FILTER (WHERE ps.is_starred = true AND ps.status != 'trash') AS starred_count,
      COALESCE(SUM(ps.unread_count) FILTER (WHERE ps.status != 'trash' AND ps.status != 'archived'), 0) AS unread_total,
      COUNT(DISTINCT ps.partner_id) AS partners_active,
      COUNT(DISTINCT ps.user_id) AS members_covered
    FROM public.partner_stories ps
  ),
  entry_stats AS (
    SELECT
      COUNT(*) AS total_entries,
      COUNT(*) FILTER (WHERE se.created_at >= now() - interval '7 days') AS entries_7d,
      COUNT(*) FILTER (WHERE se.created_at >= now() - interval '30 days') AS entries_30d
    FROM public.story_entries se
  ),
  reminder_stats AS (
    SELECT
      COUNT(*) FILTER (
        WHERE sr.is_completed = false
        AND sr.remind_at >= now()
        AND sr.remind_at < now() + interval '7 days'
      ) AS reminders_upcoming_7d,
      COUNT(*) FILTER (
        WHERE sr.is_completed = false
        AND sr.remind_at < now()
      ) AS reminders_overdue
    FROM public.story_reminders sr
  )
  SELECT
    ss.total_stories,
    ss.active_stories,
    ss.stories_active_7d,
    ss.stories_active_30d,
    ss.inbox_count,
    ss.in_progress_count,
    ss.scheduled_count,
    ss.archived_count,
    ss.trash_count,
    ss.starred_count,
    ss.unread_total,
    es.total_entries,
    es.entries_7d,
    es.entries_30d,
    rs.reminders_upcoming_7d,
    rs.reminders_overdue,
    ss.partners_active,
    ss.members_covered
  FROM story_stats ss
  CROSS JOIN entry_stats es
  CROSS JOIN reminder_stats rs;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_storyloop_admin_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storyloop_admin_overview() TO authenticated;

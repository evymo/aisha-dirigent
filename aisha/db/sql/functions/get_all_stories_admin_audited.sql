-- Function: public.get_all_stories_admin_audited
-- Arguments: p_limit integer, p_offset integer, p_search text, p_status text
-- Description: Admin/staff paginated list of all member stories with filters.
--              Non-sensitive data display: anonymised user names, partner names, study names.
-- Security: SECURITY DEFINER; admin/staff guard + audit logging.

CREATE OR REPLACE FUNCTION public.get_all_stories_admin_audited(
  p_limit   integer DEFAULT 50,
  p_offset  integer DEFAULT 0,
  p_search  text    DEFAULT NULL,
  p_status  text    DEFAULT NULL
)
RETURNS TABLE(
  id                   uuid,
  partner_id           uuid,
  user_id           uuid,
  study_id             uuid,
  title                text,
  status               text,
  priority             text,
  is_starred           boolean,
  is_read              boolean,
  unread_count         integer,
  last_activity_at     timestamptz,
  created_at           timestamptz,
  user_display_name text,
  partner_display_name text,
  study_name           text,
  last_entry_preview   text,
  labels               jsonb,
  entry_count          bigint,
  total_count          bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'access'::public.journal_action_type,
    p_area        := 'admin'::public.journal_area,
    p_details     := jsonb_build_object(
      'dataset',      'all_stories',
      'p_limit',      p_limit,
      'p_offset',     p_offset,
      'has_search',   p_search IS NOT NULL,
      'status_filter', p_status
    ),
    p_entity_id   := NULL,
    p_entity_type := 'partner_stories',
    p_severity    := 'info'::public.journal_severity,
    p_summary     := 'Admin accessed full story list',
    p_user_id := v_user_id
  );

  RETURN QUERY
  WITH filtered AS (
    SELECT
      ps.id,
      ps.partner_id,
      ps.user_id,
      ps.study_id,
      ps.title,
      ps.status,
      ps.priority,
      ps.is_starred,
      ps.is_read,
      ps.unread_count,
      ps.last_activity_at,
      ps.created_at
    FROM public.partner_stories ps
    WHERE
      (p_status IS NULL OR ps.status = p_status)
      AND (p_search IS NULL OR ps.title ILIKE '%' || p_search || '%')
  ),
  total AS (
    SELECT COUNT(*) AS cnt FROM filtered
  )
  SELECT
    f.id,
    f.partner_id,
    f.user_id,
    f.study_id,
    f.title,
    f.status,
    f.priority,
    f.is_starred,
    f.is_read,
    f.unread_count,
    f.last_activity_at,
    f.created_at,
    -- user display name (anonymised: first name + last initial)
    (
      SELECT p.first_name || ' ' || LEFT(p.last_name, 1) || '.'
      FROM public.profiles p
      WHERE p.id = f.user_id
    ) AS user_display_name,
    -- partner display name
    (
      SELECT COALESCE(pp.display_name, pp.business_name)
      FROM public.partner_profiles pp
      WHERE pp.id = f.partner_id
    ) AS partner_display_name,
    -- study name
    (SELECT s.name FROM public.studies s WHERE s.id = f.study_id) AS study_name,
    -- last entry preview (no sensitive data — truncated to 100 chars)
    (
      SELECT LEFT(se.content, 100)
      FROM public.story_entries se
      WHERE se.story_id = f.id
      ORDER BY se.created_at DESC
      LIMIT 1
    ) AS last_entry_preview,
    -- labels as JSONB array
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('label', sl.label, 'color', sl.color))
        FROM public.story_labels sl
        WHERE sl.story_id = f.id
      ),
      '[]'::jsonb
    ) AS labels,
    -- entry count
    (SELECT COUNT(*) FROM public.story_entries se WHERE se.story_id = f.id)::bigint AS entry_count,
    (SELECT cnt FROM total) AS total_count
  FROM filtered f
  ORDER BY f.last_activity_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Permissions
REVOKE ALL     ON FUNCTION public.get_all_stories_admin_audited(integer, integer, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_all_stories_admin_audited(integer, integer, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_all_stories_admin_audited(integer, integer, text, text) TO authenticated;

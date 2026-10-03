-- Function: public.get_my_stories_audited
-- Arguments: p_status text, p_search text, p_labels text[], p_limit integer, p_offset integer
-- Description: List stories accessible to current user. Admin/staff see all, partners see own,
--              members see own, participants see shared stories via story_participants.
-- Security: SECURITY DEFINER, authenticated only.
-- Updated: 2026-03-31

CREATE OR REPLACE FUNCTION public.get_my_stories_audited(p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_labels text[] DEFAULT NULL::text[], p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, partner_id uuid, user_id uuid, study_id uuid, title text, status text, priority text, is_starred boolean, is_read boolean, unread_count integer, last_activity_at timestamptz, created_at timestamptz, user_display_name text, study_name text, last_entry_preview text, labels jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_partner_id UUID;
  v_owner_mode TEXT;
  v_is_admin_staff BOOLEAN;
  v_audit_area public.journal_area;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  v_partner_id := public.get_current_partner_id();
  v_is_admin_staff := public.is_admin_or_staff();

  v_owner_mode := CASE
    WHEN v_is_admin_staff THEN 'admin'
    WHEN v_partner_id IS NOT NULL THEN 'partner'
    ELSE 'member'
  END;

  v_audit_area := CASE
    WHEN v_owner_mode = 'admin' THEN 'admin'::public.journal_area
    WHEN v_owner_mode = 'partner' THEN 'partner'::public.journal_area
    ELSE 'member'::public.journal_area
  END;

  -- Audit read operation (no sensitive data in details)
  PERFORM public.write_audit_journal(
      p_action_type := 'access'::public.journal_action_type,
      p_area := v_audit_area,
      p_details := jsonb_build_object(
        'owner_mode', v_owner_mode,
        'status_filter', p_status,
        'has_search', p_search IS NOT NULL,
        'has_labels', p_labels IS NOT NULL
      ),
      p_entity_id := NULL,
      p_entity_type := 'partner_stories',
      p_severity := 'info'::public.journal_severity,
      p_summary := v_owner_mode || ' accessed story list',
    p_user_id := v_user_id
  );

  RETURN QUERY
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
    ps.created_at,
    -- Display name: member mode shows partner/business, all other modes show user name
    CASE
      WHEN v_owner_mode = 'member' THEN (
        SELECT pp.business_name
        FROM public.partner_profiles pp
        WHERE pp.id = ps.partner_id
      )
      ELSE (
        SELECT p.first_name || ' ' || LEFT(p.last_name, 1) || '.'
        FROM public.profiles p
        WHERE p.id = ps.user_id
      )
    END AS user_display_name,
    -- Study name
    (SELECT s.name FROM public.studies s WHERE s.id = ps.study_id) AS study_name,
    -- Last entry preview (truncated, no sensitive data)
    (SELECT LEFT(se.content, 100)
     FROM public.story_entries se
     WHERE se.story_id = ps.id
     ORDER BY se.created_at DESC
     LIMIT 1) AS last_entry_preview,
    -- Labels as JSONB array
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('label', sl.label, 'color', sl.color))
       FROM public.story_labels sl
       WHERE sl.story_id = ps.id),
      '[]'::jsonb
    ) AS labels
  FROM public.partner_stories ps
  WHERE (
      -- Admin/staff see all stories
      v_is_admin_staff
      OR
      -- Partner sees own stories
      (v_owner_mode = 'partner' AND ps.partner_id = v_partner_id)
      OR
      -- Member sees own stories
      (v_owner_mode = 'member' AND ps.user_id = v_user_id)
      OR
      -- Participant sees shared stories
      EXISTS (
        SELECT 1 FROM public.story_participants sp
        WHERE sp.story_id = ps.id AND sp.user_id = v_user_id
      )
    )
    AND (
      p_status IS NULL
      OR (p_status = 'starred' AND ps.is_starred = true)
      OR (p_status <> 'starred' AND ps.status = p_status)
    )
    AND (p_search IS NULL OR ps.title ILIKE '%' || p_search || '%')
    AND (p_labels IS NULL OR EXISTS (
      SELECT 1 FROM public.story_labels sl
      WHERE sl.story_id = ps.id AND sl.label = ANY(p_labels)
    ))
  ORDER BY
    ps.is_starred DESC,
    ps.last_activity_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_stories_audited(p_status text, p_search text, p_labels text[], p_limit integer, p_offset integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_stories_audited(p_status text, p_search text, p_labels text[], p_limit integer, p_offset integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_stories_audited(p_status text, p_search text, p_labels text[], p_limit integer, p_offset integer) TO authenticated;

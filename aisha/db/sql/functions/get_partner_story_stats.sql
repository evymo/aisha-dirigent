-- Function: public.get_partner_story_stats
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:16+01:00

CREATE OR REPLACE FUNCTION public.get_partner_story_stats()
 RETURNS TABLE(active_count bigint, inbox_count bigint, in_progress_count bigint, scheduled_count bigint, archived_count bigint, starred_count bigint, unread_total bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_partner_id UUID;
  v_owner_mode TEXT;
  v_audit_area public.journal_area;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  v_partner_id := public.get_current_partner_id();
  v_owner_mode := CASE WHEN v_partner_id IS NOT NULL THEN 'partner' ELSE 'member' END;
  v_audit_area := CASE
    WHEN v_owner_mode = 'partner' THEN 'partner'::public.journal_area
    ELSE 'member'::public.journal_area
  END;

  -- Audit log for story stats access.
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := v_audit_area,
      p_details := jsonb_build_object(
        'owner_mode', v_owner_mode,
        'partner_id', v_partner_id
      ),
      p_entity_id := NULL,
      p_entity_type := 'partner_stories',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := CASE
        WHEN v_owner_mode = 'partner' THEN 'Partner viewing story stats'
        ELSE 'Member viewing story stats'
      END,
      p_tags := ARRAY['phi','stories',v_owner_mode],
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE ps.status = 'active') AS active_count,
    COUNT(*) FILTER (WHERE ps.status = 'inbox') AS inbox_count,
    COUNT(*) FILTER (WHERE ps.status = 'in_progress') AS in_progress_count,
    COUNT(*) FILTER (WHERE ps.status = 'scheduled') AS scheduled_count,
    COUNT(*) FILTER (WHERE ps.status = 'archived') AS archived_count,
    COUNT(*) FILTER (WHERE ps.is_starred = true AND ps.status != 'trash') AS starred_count,
    COALESCE(SUM(ps.unread_count) FILTER (WHERE ps.status != 'trash' AND ps.status != 'archived'), 0) AS unread_total
  FROM public.partner_stories ps
  WHERE (
    (v_owner_mode = 'partner' AND ps.partner_id = v_partner_id)
    OR
    (v_owner_mode = 'member' AND ps.user_id = v_user_id)
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_partner_story_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_story_stats() TO authenticated;

-- Function: public.get_my_upcoming_reminders_audited
-- Arguments: p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:07+01:00

CREATE OR REPLACE FUNCTION public.get_my_upcoming_reminders_audited(p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, story_id uuid, story_title text, user_display_name text, remind_at timestamptz, message text, is_overdue boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_partner_id UUID;
  v_owner_mode TEXT;
  v_audit_area public.journal_area;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_partner_id := public.get_current_partner_id();
  v_owner_mode := CASE WHEN v_partner_id IS NOT NULL THEN 'partner' ELSE 'member' END;
  v_audit_area := CASE
    WHEN v_owner_mode = 'partner' THEN 'partner'::public.journal_area
    ELSE 'member'::public.journal_area
  END;
  
  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := v_audit_area,
      p_details := jsonb_build_object(
        'owner_mode', v_owner_mode,
        'partner_id', v_partner_id,
        'limit', p_limit
      ),
      p_entity_id := NULL,
      p_entity_type := 'story_reminder',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := CASE
        WHEN v_owner_mode = 'partner' THEN 'Partner viewed upcoming reminders'
        ELSE 'Member viewed upcoming reminders'
      END,
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    sr.id,
    sr.story_id,
    ps.title AS story_title,
    CASE
      WHEN v_owner_mode = 'partner' THEN (
        SELECT p.first_name || ' ' || LEFT(p.last_name, 1) || '.'
        FROM public.profiles p
        WHERE p.id = ps.user_id
      )
      ELSE (
        SELECT pp.business_name
        FROM public.partner_profiles pp
        WHERE pp.id = ps.partner_id
      )
    END AS user_display_name,
    sr.remind_at,
    sr.message,
    sr.remind_at < now() AS is_overdue
  FROM public.story_reminders sr
  JOIN public.partner_stories ps ON ps.id = sr.story_id
  WHERE (
      (v_owner_mode = 'partner' AND sr.partner_id = v_partner_id)
      OR
      (v_owner_mode = 'member' AND ps.user_id = v_user_id)
    )
    AND sr.is_completed = false
  ORDER BY sr.remind_at ASC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_upcoming_reminders_audited(p_limit integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_upcoming_reminders_audited(p_limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_upcoming_reminders_audited(p_limit integer) TO authenticated;

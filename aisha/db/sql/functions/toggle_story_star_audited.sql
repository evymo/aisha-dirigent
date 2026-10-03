-- Function: public.toggle_story_star_audited
-- Arguments: p_story_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:11+01:00

CREATE OR REPLACE FUNCTION public.toggle_story_star_audited(p_story_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_partner_id UUID;
  v_owner_mode TEXT;
  v_audit_area public.journal_area;
  v_new_starred BOOLEAN;
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

  IF v_owner_mode = 'partner' THEN
    UPDATE public.partner_stories
    SET is_starred = NOT is_starred
    WHERE id = p_story_id
      AND partner_id = v_partner_id
    RETURNING is_starred INTO v_new_starred;
  ELSE
    UPDATE public.partner_stories
    SET is_starred = NOT is_starred
    WHERE id = p_story_id
      AND user_id = v_user_id
    RETURNING is_starred INTO v_new_starred;
  END IF;

  IF v_new_starred IS NULL THEN
    RAISE EXCEPTION 'Story not found or unauthorized';
  END IF;

  -- Audit
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::public.journal_action_type,
      p_area := v_audit_area,
      p_details := jsonb_build_object(
        'owner_mode', v_owner_mode,
        'is_starred', v_new_starred
      ),
      p_entity_id := p_story_id::text,
      p_entity_type := 'partner_stories',
      p_severity := 'info'::public.journal_severity,
      p_summary := CASE
        WHEN v_owner_mode = 'partner' THEN 'Partner toggled story star'
        ELSE 'Member toggled story star'
      END,
    p_user_id := v_user_id
  );

  RETURN v_new_starred;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.toggle_story_star_audited(p_story_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_story_star_audited(p_story_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_story_star_audited(p_story_id uuid) TO authenticated;

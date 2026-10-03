-- Function: public.get_my_story_labels_audited
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:05+01:00

CREATE OR REPLACE FUNCTION public.get_my_story_labels_audited()
 RETURNS TABLE(label text, color text, story_count bigint)
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
        'partner_id', v_partner_id
      ),
      p_entity_id := NULL,
      p_entity_type := 'story_label',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := CASE
        WHEN v_owner_mode = 'partner' THEN 'Partner viewed story labels summary'
        ELSE 'Member viewed story labels summary'
      END,
      p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT 
    sl.label,
    sl.color,
    COUNT(*) AS story_count
  FROM public.story_labels sl
  WHERE (
      (v_owner_mode = 'partner' AND sl.partner_id = v_partner_id)
      OR (
        v_owner_mode = 'member' AND EXISTS (
          SELECT 1
          FROM public.partner_stories ps
          WHERE ps.id = sl.story_id
            AND ps.user_id = v_user_id
        )
      )
    )
  GROUP BY sl.label, sl.color
  ORDER BY story_count DESC, sl.label ASC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_story_labels_audited() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_story_labels_audited() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_story_labels_audited() TO authenticated;

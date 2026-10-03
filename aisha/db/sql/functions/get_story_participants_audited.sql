-- Function: public.get_story_participants_audited
-- Arguments: p_story_id uuid
-- Description: List participants of a story with profile info.
-- Security: SECURITY DEFINER, authenticated only
-- Source: Migration 20260329230000_story_participants_foundation.sql

CREATE OR REPLACE FUNCTION public.get_story_participants_audited(p_story_id uuid)
 RETURNS TABLE(
   user_id uuid,
   role text,
   joined_at timestamptz,
   display_name text,
   avatar_url text,
   certification_level text,
   business_name text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authorization: caller must be participant or admin/staff
  IF NOT EXISTS (
    SELECT 1 FROM public.story_participants sp
    WHERE sp.story_id = p_story_id AND sp.user_id = v_user_id
  ) AND NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: Not a participant of this story';
  END IF;

  -- Audit
  PERFORM public.write_audit_journal(
    p_action_type := 'access'::public.journal_action_type,
    p_area := 'partner'::public.journal_area,
    p_details := NULL,
    p_entity_id := p_story_id::text,
    p_entity_type := 'story_participants',
    p_severity := 'info'::public.journal_severity,
    p_summary := 'Accessed story participants list',
    p_user_id := v_user_id
  );

  RETURN QUERY
  SELECT
    sp.user_id,
    sp.role,
    sp.joined_at,
    COALESCE(p.first_name || ' ' || LEFT(p.last_name, 1) || '.', 'Unknown') AS display_name,
    p.avatar_url,
    pp.certification_level::text,
    pp.business_name
  FROM public.story_participants sp
  LEFT JOIN public.profiles p ON p.id = sp.user_id
  LEFT JOIN public.partner_profiles pp ON pp.user_id = sp.user_id
  WHERE sp.story_id = p_story_id
  ORDER BY
    CASE sp.role
      WHEN 'partner' THEN 0
      WHEN 'member' THEN 1
      WHEN 'guild_expert' THEN 2
      WHEN 'aisha' THEN 3
      ELSE 4
    END,
    sp.joined_at ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_story_participants_audited(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_story_participants_audited(uuid) TO authenticated;

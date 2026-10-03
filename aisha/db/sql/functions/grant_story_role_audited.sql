-- Function: public.grant_story_role_audited
-- Arguments: p_story_id uuid, p_user_id uuid, p_role text, p_note text
-- Description: Grants a CONTEXTUAL role — "this person holds role R in the
--              context of that twin" (a coordinator of a centre, a supervisor of
--              a line, a mentor of a programme). A contextual role is not a new
--              entity: it is the relation between two twins, carried by
--              story_participants, while WHAT the role may do stays with the
--              global RBAC tables (roles / permissions / user_roles).
-- Security: SECURITY DEFINER. Operators, or a 'partner' participant of that
--           story. The reserved 'partner' role itself cannot be granted here —
--           add_story_participant_audited owns that path and enforces the
--           certification check that makes story ownership meaningful; letting
--           a generic role RPC mint it would be a privilege-escalation door.
--
-- NOTE ON VISIBILITY: story_participants is also an ACCESS relation
-- (story_timeline and participant_read_story_entries both consult it), so
-- granting a contextual role grants sight of that story. That is the intended
-- meaning — a coordinator sees the centre they coordinate — but it is why this
-- door is operator-gated and audited rather than self-service.

CREATE OR REPLACE FUNCTION public.grant_story_role_audited(
  p_story_id uuid,
  p_user_id uuid,
  p_role text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_role text := btrim(COALESCE(p_role, ''));
  v_entry_id uuid;
  v_inserted boolean := false;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_role = '' THEN
    RAISE EXCEPTION 'role is required' USING ERRCODE = '22023';
  END IF;
  IF v_role = 'partner' THEN
    RAISE EXCEPTION 'Use add_story_participant_audited to grant the partner role' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.partner_stories ps WHERE ps.id = p_story_id) THEN
    RAISE EXCEPTION 'Story not found' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    public.is_admin_or_staff()
    OR EXISTS (
      SELECT 1 FROM public.story_participants sp
      WHERE sp.story_id = p_story_id AND sp.user_id = v_caller_id AND sp.role = 'partner'
    )
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.story_participants (story_id, user_id, role)
  VALUES (p_story_id, p_user_id, v_role)
  ON CONFLICT (story_id, user_id, role) DO NOTHING;
  v_inserted := FOUND;

  -- The grant is a typed record on the CONTEXT twin's timeline. History lives
  -- on the timeline, not in an ended_at column: a role that was held and handed
  -- over reads as two records, which is also how every other flow in this
  -- schema records a transition.
  IF v_inserted THEN
    v_entry_id := public.append_subject_entry_service(
      p_subject_type := 'story',
      p_subject_id   := p_story_id,
      p_entry_type   := 'role_granted',
      p_content      := p_note,
      p_metadata     := jsonb_build_object('role', v_role, 'user_id', p_user_id, 'granted_by', v_caller_id),
      p_created_by   := v_caller_id,
      p_story_id     := p_story_id,
      p_is_internal  := false,
      p_occurred_at  := now()
    );

    PERFORM public.write_audit_journal(
      p_action_type := 'create'::public.journal_action_type,
      p_area        := 'partner'::public.journal_area,
      p_details     := jsonb_build_object('story_id', p_story_id, 'role', v_role, 'subject_user_id', p_user_id, 'entry_id', v_entry_id),
      p_entity_id   := p_story_id::text,
      p_entity_type := 'story_participants',
      p_severity    := 'notice'::public.journal_severity,
      p_summary     := format('Granted story role %s', v_role),
      p_user_id     := v_caller_id
    );
  END IF;

  RETURN v_entry_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.grant_story_role_audited(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_story_role_audited(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_story_role_audited(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_story_role_audited(uuid, uuid, text, text) TO service_role;

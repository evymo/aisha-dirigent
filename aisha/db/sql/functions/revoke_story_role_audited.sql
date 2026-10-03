-- Function: public.revoke_story_role_audited
-- Arguments: p_story_id uuid, p_user_id uuid, p_role text, p_reason text
-- Description: Ends a CONTEXTUAL role. The participation row goes away (it is an
--              access relation — a role that ended must stop granting sight) and
--              the ending is recorded as a typed record on the context twin's
--              timeline, which is where the history of who held what actually lives.
-- Security: SECURITY DEFINER. Operators, a 'partner' participant of that story,
--           or the holder giving up their own role. The reserved 'partner' role
--           is out of scope here, exactly as in grant_story_role_audited.

CREATE OR REPLACE FUNCTION public.revoke_story_role_audited(
  p_story_id uuid,
  p_user_id uuid,
  p_role text,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_role text := btrim(COALESCE(p_role, ''));
  v_entry_id uuid;
  v_deleted int := 0;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_role = '' THEN
    RAISE EXCEPTION 'role is required' USING ERRCODE = '22023';
  END IF;
  IF v_role = 'partner' THEN
    RAISE EXCEPTION 'The partner role is not revocable through this function' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    public.is_admin_or_staff()
    OR v_caller_id = p_user_id
    OR EXISTS (
      SELECT 1 FROM public.story_participants sp
      WHERE sp.story_id = p_story_id AND sp.user_id = v_caller_id AND sp.role = 'partner'
    )
  ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.story_participants
  WHERE story_id = p_story_id AND user_id = p_user_id AND role = v_role;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    v_entry_id := public.append_subject_entry_service(
      p_subject_type := 'story',
      p_subject_id   := p_story_id,
      p_entry_type   := 'role_revoked',
      p_content      := p_reason,
      p_metadata     := jsonb_build_object('role', v_role, 'user_id', p_user_id, 'revoked_by', v_caller_id),
      p_created_by   := v_caller_id,
      p_story_id     := p_story_id,
      p_is_internal  := false,
      p_occurred_at  := now()
    );

    PERFORM public.write_audit_journal(
      p_action_type := 'delete'::public.journal_action_type,
      p_area        := 'partner'::public.journal_area,
      p_details     := jsonb_build_object('story_id', p_story_id, 'role', v_role, 'subject_user_id', p_user_id, 'entry_id', v_entry_id),
      p_entity_id   := p_story_id::text,
      p_entity_type := 'story_participants',
      p_severity    := 'notice'::public.journal_severity,
      p_summary     := format('Revoked story role %s', v_role),
      p_user_id     := v_caller_id
    );
  END IF;

  RETURN v_deleted > 0;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.revoke_story_role_audited(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_story_role_audited(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_story_role_audited(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_story_role_audited(uuid, uuid, text, text) TO service_role;

-- Function: public.move_story_entry_audited
-- Moves a story_entry (e.g. an inbound mail) — together with its reply subtree — to a
-- DIFFERENT story. "Mail můžu přesunout do jiné story protože k ní patří": because the
-- STORY is the ACL boundary (story_entries RLS keys off story access), re-homing an
-- entry changes the scope of who/how/when it can be reached. The inverse-ish of
-- promote_entry_to_story_audited (which spins a record out into its OWN child story).
--
-- Invariants:
--   * the whole subtree rooted at the entry moves together (a thread stays intact);
--   * the root entry's parent_id is cleared (it was a reply in the source story; in the
--     target it becomes a top-level entry) — descendants keep their in-subtree parents;
--   * provenance: the root entry is stamped metadata.moved_from_story_id + moved_at.
--
-- Authorization: the caller must be able to access BOTH the source and the target story
-- (partner owner / member owner / participant / admin-staff) — or be service_role.
-- This prevents moving a record into (or out of) a story the caller cannot see.
--
-- Security: SECURITY DEFINER.
-- @audit: required

CREATE OR REPLACE FUNCTION public.move_story_entry_audited(
  p_entry_id        uuid,
  p_target_story_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean := current_setting('role', true) = 'service_role';
  v_user_id    uuid := auth.uid();
  v_partner_id uuid;
  v_entry      public.story_entries%ROWTYPE;
  v_source     public.partner_stories%ROWTYPE;
  v_target     public.partner_stories%ROWTYPE;
  v_can_source boolean;
  v_can_target boolean;
  v_count      integer;
BEGIN
  IF v_user_id IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_entry FROM public.story_entries WHERE id = p_entry_id;
  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'Story entry not found: %', p_entry_id USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_source FROM public.partner_stories WHERE id = v_entry.story_id;
  SELECT * INTO v_target FROM public.partner_stories WHERE id = p_target_story_id;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'Target story not found: %', p_target_story_id USING ERRCODE = '22023';
  END IF;
  IF v_source.id = v_target.id THEN
    RAISE EXCEPTION 'Entry is already in the target story' USING ERRCODE = '22023';
  END IF;

  -- Authorization: access to BOTH stories.
  v_partner_id := public.get_current_partner_id();
  v_can_source := v_is_service
    OR (v_partner_id IS NOT NULL AND v_partner_id = v_source.partner_id)
    OR (v_user_id IS NOT NULL AND v_user_id = v_source.user_id)
    OR (v_user_id IS NOT NULL AND public.is_story_participant(v_user_id, v_source.id))
    OR (v_user_id IS NOT NULL AND public.is_admin_or_staff(v_user_id));
  v_can_target := v_is_service
    OR (v_partner_id IS NOT NULL AND v_partner_id = v_target.partner_id)
    OR (v_user_id IS NOT NULL AND v_user_id = v_target.user_id)
    OR (v_user_id IS NOT NULL AND public.is_story_participant(v_user_id, v_target.id))
    OR (v_user_id IS NOT NULL AND public.is_admin_or_staff(v_user_id));

  IF NOT (v_can_source AND v_can_target) THEN
    RAISE EXCEPTION 'Unauthorized: need access to both the source and the target story'
      USING ERRCODE = '42501';
  END IF;

  -- Move the whole subtree rooted at the entry. Root: clear parent_id + stamp provenance.
  WITH RECURSIVE subtree AS (
    SELECT id FROM public.story_entries WHERE id = p_entry_id
    UNION ALL
    SELECT se.id FROM public.story_entries se JOIN subtree s ON se.parent_id = s.id
  )
  UPDATE public.story_entries se
     SET story_id  = p_target_story_id,
         parent_id = CASE WHEN se.id = p_entry_id THEN NULL ELSE se.parent_id END,
         metadata  = CASE WHEN se.id = p_entry_id
                          THEN COALESCE(se.metadata, '{}'::jsonb)
                               || jsonb_build_object('moved_from_story_id', v_source.id, 'moved_at', now())
                          ELSE se.metadata END
   WHERE se.id IN (SELECT id FROM subtree);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Bump activity on both ends (UPDATE does not fire the insert-time activity trigger).
  UPDATE public.partner_stories SET last_activity_at = now() WHERE id IN (v_source.id, v_target.id);

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'STORY_ENTRY_MOVED',
    jsonb_build_object(
      'area',          'collaboration',
      'severity',      'notice',
      'entry_id',      p_entry_id,
      'from_story_id', v_source.id,
      'to_story_id',   v_target.id,
      'moved_count',   v_count));

  RETURN jsonb_build_object(
    'entry_id',      p_entry_id,
    'from_story_id', v_source.id,
    'to_story_id',   v_target.id,
    'moved_count',   v_count);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.move_story_entry_audited(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_story_entry_audited(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.move_story_entry_audited(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_story_entry_audited(uuid, uuid) TO service_role;

-- Function: public.merge_stories_audited
-- Merges one story INTO another ("slučování do celku"): all of the source story's
-- content moves into the target, and the source is left as a 'merged' stub that points
-- at the target. The inverse of promote_entry_to_story_audited (which branches OUT).
--
-- Additive evolution — reuses the move pattern + existing primitives, touches nothing
-- existing (the promote story_links/graph dual-track stays as-is; merge is a separate op).
-- Nothing is deleted: the source story survives as status='merged' with a 'related_to'
-- link to the target, so dependents that still reference it can follow the pointer.
--
-- What follows the merge (handled here so the merge does not corrupt structure):
--   * story_entries          → re-homed to target (entry-tree intact; stamped merged_from)
--   * knowledge_items.story_id → re-scoped to target (RAG isolation follows the content,
--                                so retrieval stays gated by the RIGHT story)
--   * story_reminders        → re-pointed to target
--   * story_participants     → unioned into target (people keep access to merged content)
--   * partner_stories.status → source set to 'merged' + a 'related_to' merged_into link
--
-- Authorization: caller must access BOTH stories (partner owner / member owner /
-- participant / admin-staff) or be service_role.
-- Security: SECURITY DEFINER.
-- @audit: required

CREATE OR REPLACE FUNCTION public.merge_stories_audited(
  p_source_story_id uuid,
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
  v_source     public.partner_stories%ROWTYPE;
  v_target     public.partner_stories%ROWTYPE;
  v_can_source boolean;
  v_can_target boolean;
  v_entries     integer;
  v_knowledge   integer;
  v_reminders   integer;
  v_participants integer;
BEGIN
  IF v_user_id IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_source FROM public.partner_stories WHERE id = p_source_story_id;
  SELECT * INTO v_target FROM public.partner_stories WHERE id = p_target_story_id;
  IF v_source.id IS NULL THEN RAISE EXCEPTION 'Source story not found: %', p_source_story_id USING ERRCODE = '22023'; END IF;
  IF v_target.id IS NULL THEN RAISE EXCEPTION 'Target story not found: %', p_target_story_id USING ERRCODE = '22023'; END IF;
  IF v_source.id = v_target.id THEN RAISE EXCEPTION 'Cannot merge a story into itself' USING ERRCODE = '22023'; END IF;

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

  -- (1) Re-home all source entries (the entry-tree moves wholesale → parent_id stays valid).
  UPDATE public.story_entries
     SET story_id = p_target_story_id,
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('merged_from_story_id', p_source_story_id)
   WHERE story_id = p_source_story_id;
  GET DIAGNOSTICS v_entries = ROW_COUNT;

  -- (2) Re-scope vectorized content so RAG isolation follows the content to the target.
  UPDATE public.knowledge_items SET story_id = p_target_story_id WHERE story_id = p_source_story_id;
  GET DIAGNOSTICS v_knowledge = ROW_COUNT;

  -- (3) Re-point reminders.
  UPDATE public.story_reminders SET story_id = p_target_story_id WHERE story_id = p_source_story_id;
  GET DIAGNOSTICS v_reminders = ROW_COUNT;

  -- (4) Union participants (people keep access to the merged content).
  INSERT INTO public.story_participants (story_id, user_id, role)
  SELECT p_target_story_id, sp.user_id, sp.role
    FROM public.story_participants sp
   WHERE sp.story_id = p_source_story_id
  ON CONFLICT (story_id, user_id, role) DO NOTHING;
  GET DIAGNOSTICS v_participants = ROW_COUNT;

  -- (5) Leave the source as a 'merged' stub that points at the target (nothing deleted).
  UPDATE public.partner_stories SET status = 'merged', last_activity_at = now() WHERE id = p_source_story_id;
  UPDATE public.partner_stories SET last_activity_at = now() WHERE id = p_target_story_id;

  INSERT INTO public.story_links
    (source_story_id, target_story_id, link_type, link_direction, created_by, confidence_score, is_accepted, metadata)
  VALUES
    (p_source_story_id, p_target_story_id, 'related_to', 'forward', v_user_id, 1.0, true,
     jsonb_build_object('relation', 'merged_into'))
  ON CONFLICT (source_story_id, target_story_id, link_type) DO NOTHING;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'STORY_MERGED',
    jsonb_build_object(
      'area',             'collaboration',
      'severity',         'notice',
      'source_story_id',  p_source_story_id,
      'target_story_id',  p_target_story_id,
      'merged_entries',   v_entries,
      'merged_knowledge', v_knowledge,
      'merged_reminders', v_reminders,
      'merged_participants', v_participants));

  RETURN jsonb_build_object(
    'source_story_id',  p_source_story_id,
    'target_story_id',  p_target_story_id,
    'merged_entries',   v_entries,
    'merged_knowledge', v_knowledge,
    'merged_reminders', v_reminders,
    'merged_participants', v_participants);
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.merge_stories_audited(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_stories_audited(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_stories_audited(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_stories_audited(uuid, uuid) TO service_role;

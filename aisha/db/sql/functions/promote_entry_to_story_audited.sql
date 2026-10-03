-- Function: public.promote_entry_to_story_audited
-- Recursive story tree: promotes a single story_entry into the root of its OWN
-- child story. "Every record in a story can become the beginning of its own
-- story; at the top level the context is everything." The child inherits the
-- parent's partner/user/study context. The parent→child relationship is recorded
-- three ways, one per consumer:
--   1. story_links ('extends', forward)        — member-visible hot-path hierarchy
--                                                 (story-scoped RLS, NOT admin-only)
--   2. graph_edges (PART_OF + DERIVED_FROM)     — graph/context rollup; feeds the
--                                                 compose_context `graph_context` layer
--   3. source story_entries.metadata.promoted_to_story_id — timeline branch marker
--
-- The parent Story graph node is resolved by source_id (slug-convention-agnostic)
-- so we never duplicate the bootstrap-seeded node.
--
-- Security: SECURITY DEFINER. Caller must own / participate in the parent story
-- (partner owner, member owner, participant, admin/staff) or be service_role.
-- @audit: required

CREATE OR REPLACE FUNCTION public.promote_entry_to_story_audited(
  p_entry_id uuid,
  p_title    text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service  boolean := current_setting('role', true) = 'service_role';
  v_user_id     uuid := auth.uid();
  v_partner_id  uuid;
  v_parent      public.partner_stories%ROWTYPE;
  v_entry       public.story_entries%ROWTYPE;
  v_title       text;
  v_child_id    uuid;
  v_parent_node uuid;
  v_child_node  uuid;
BEGIN
  IF v_user_id IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  -- Resolve the entry and its parent story.
  SELECT * INTO v_entry FROM public.story_entries WHERE id = p_entry_id;
  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'Story entry not found: %', p_entry_id USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_parent FROM public.partner_stories WHERE id = v_entry.story_id;
  IF v_parent.id IS NULL THEN
    RAISE EXCEPTION 'Parent story not found for entry %', p_entry_id USING ERRCODE = '22023';
  END IF;

  -- Authorization: service role, partner owner, member owner, participant, or admin/staff.
  v_partner_id := public.get_current_partner_id();
  IF NOT (
        v_is_service
     OR (v_partner_id IS NOT NULL AND v_partner_id = v_parent.partner_id)
     OR (v_user_id IS NOT NULL AND v_user_id = v_parent.user_id)
     OR (v_user_id IS NOT NULL AND public.is_story_participant(v_user_id, v_parent.id))
     OR (v_user_id IS NOT NULL AND public.is_admin_or_staff(v_user_id))
  ) THEN
    RAISE EXCEPTION 'Unauthorized: cannot promote entry from this story' USING ERRCODE = '42501';
  END IF;

  v_title := COALESCE(
    NULLIF(TRIM(p_title), ''),
    NULLIF(TRIM(LEFT(v_entry.content, 80)), ''),
    'Odbočka ' || to_char(now(), 'YYYY-MM-DD')
  );

  -- (1) Child story, inheriting the parent's context. origin marks the provenance;
  -- status falls back to the table default ('inbox') so it surfaces for triage.
  INSERT INTO public.partner_stories (partner_id, user_id, study_id, title, origin)
  VALUES (v_parent.partner_id, v_parent.user_id, v_parent.study_id, v_title, 'promoted_entry')
  RETURNING id INTO v_child_id;

  -- (2) Mark the source entry so the timeline shows the branch point.
  UPDATE public.story_entries
     SET metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object('promoted_to_story_id', v_child_id,
                                       'promoted_at', now())
   WHERE id = p_entry_id;

  -- (3) Hot-path hierarchy edge (member-visible): parent --extends--> child.
  INSERT INTO public.story_links
    (source_story_id, target_story_id, link_type, link_direction,
     created_by, confidence_score, is_accepted, metadata)
  VALUES
    (v_parent.id, v_child_id, 'extends', 'forward',
     v_user_id, 1.0, true,
     COALESCE(p_metadata, '{}'::jsonb)
       || jsonb_build_object('relation', 'promoted_from_entry',
                             'source_entry_id', p_entry_id))
  ON CONFLICT (source_story_id, target_story_id, link_type) DO NOTHING;

  -- (4) Graph rollup edges (feed compose_context graph_context layer). Resolve the
  -- parent Story node by source_id (slug-agnostic); upsert one only if absent.
  SELECT id INTO v_parent_node
    FROM public.graph_nodes
   WHERE source_table = 'partner_stories' AND source_id = v_parent.id
   LIMIT 1;
  IF v_parent_node IS NULL THEN
    v_parent_node := public.fn_upsert_graph_node_audited(
      'Story', v_parent.id::text, v_parent.title,
      'partner_stories', v_parent.id, v_parent.id, '{}'::jsonb);
  END IF;

  v_child_node := public.fn_upsert_graph_node_audited(
    'Story', v_child_id::text, v_title,
    'partner_stories', v_child_id, v_child_id,
    jsonb_build_object('origin', 'promoted_entry', 'promoted_from_entry_id', p_entry_id));

  PERFORM public.fn_upsert_graph_edge_audited(
    v_child_node, v_parent_node, 'PART_OF', 1.0, NULL, NULL,
    jsonb_build_object('via', 'promote_entry_to_story'));
  PERFORM public.fn_upsert_graph_edge_audited(
    v_child_node, v_parent_node, 'DERIVED_FROM', 1.0, NULL, NULL,
    jsonb_build_object('source_entry_id', p_entry_id));

  -- (5) Decision-provenance audit.
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (v_user_id, 'STORY_PROMOTED_FROM_ENTRY',
    jsonb_build_object(
      'area', 'collaboration',
      'severity', 'notice',
      'parent_story_id', v_parent.id,
      'child_story_id', v_child_id,
      'source_entry_id', p_entry_id));

  RETURN jsonb_build_object(
    'child_story_id', v_child_id,
    'parent_story_id', v_parent.id,
    'source_entry_id', p_entry_id,
    'title', v_title
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.promote_entry_to_story_audited(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_entry_to_story_audited(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.promote_entry_to_story_audited(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_entry_to_story_audited(uuid, text, jsonb) TO service_role;

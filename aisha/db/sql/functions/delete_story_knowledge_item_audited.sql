-- Function: public.delete_story_knowledge_item_audited
-- Description: Soft-deletes a knowledge_items row by setting status =
--   'archived'. Hard delete is intentionally not exposed — KB items are
--   referenced by agent_knowledge_bindings + retrieval logs; archived
--   rows are excluded from list_story_knowledge_items by default but
--   stay queryable via p_include_archived = true.
-- Security: SECURITY DEFINER. Admin/staff only.

CREATE OR REPLACE FUNCTION public.delete_story_knowledge_item_audited(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_story_id   uuid;
  v_title      text;
  v_old_status text;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin_or_staff(v_user_id) THEN
    RAISE EXCEPTION 'Admin or staff role required to archive knowledge items'
      USING ERRCODE = '42501';
  END IF;

  SELECT ki.story_id, ki.title, ki.status
    INTO v_story_id, v_title, v_old_status
  FROM public.knowledge_items ki
  WHERE ki.id = p_id;

  IF v_story_id IS NULL THEN
    RAISE EXCEPTION 'Knowledge item not found: %', p_id USING ERRCODE = 'P0002';
  END IF;

  IF v_old_status = 'archived' THEN
    -- Idempotent: already archived, return true.
    RETURN true;
  END IF;

  UPDATE public.knowledge_items
     SET status     = 'archived',
         updated_at = now()
   WHERE id = p_id;

  PERFORM public.write_audit_journal(
    p_action_type := 'delete'::public.journal_action_type,
    p_area        := 'admin'::public.journal_area,
    p_details     := jsonb_build_object(
      'story_id', v_story_id,
      'reason', COALESCE(p_reason, '(no reason provided)')
    ),
    p_entity_id   := p_id::text,
    p_entity_type := 'knowledge_items',
    p_new_values  := jsonb_build_object('status', 'archived'),
    p_old_values  := jsonb_build_object('status', v_old_status),
    p_severity    := 'notice'::public.journal_severity,
    p_summary     := format('Archived knowledge_item "%s" (story %s)', v_title, v_story_id),
    p_tags        := ARRAY['knowledge', 'story_kb', 'archive'],
    p_user_id     := v_user_id
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_story_knowledge_item_audited(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_story_knowledge_item_audited(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_story_knowledge_item_audited(uuid, text)
  TO service_role;

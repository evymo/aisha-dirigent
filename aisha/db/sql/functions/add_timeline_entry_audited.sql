-- Function: add_timeline_entry_audited
-- Purpose: Member adds an entry to their own timeline (with optional backdating)
-- Access: Authenticated members only
-- Security: SECURITY DEFINER with audit logging

CREATE OR REPLACE FUNCTION public.add_timeline_entry_audited(
  p_story_id UUID,
  p_entry_type TEXT,
  p_content TEXT,
  p_metadata JSONB DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL,
  p_document_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_story RECORD;
  v_entry_id UUID;
  v_allowed_types TEXT[] := ARRAY[
    'note', 'health_event', 'document', 'message'
  ];
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Validate entry type (members can only add certain types)
  IF NOT (p_entry_type = ANY(v_allowed_types)) THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid entry type for member: %s. Allowed: %s', p_entry_type, v_allowed_types::text), ERRCODE = '22023';
  END IF;

  -- Verify story ownership (user_id = current user)
  SELECT ps.id, ps.title, ps.user_id, ps.partner_id
  INTO v_story
  FROM partner_stories ps
  WHERE ps.id = p_story_id
    AND ps.user_id = v_user_id;

  IF v_story.id IS NULL THEN
    RAISE EXCEPTION 'Story not found or not authorized'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Create entry
  INSERT INTO story_entries (
    story_id,
    entry_type,
    content,
    metadata,
    occurred_at,
    document_id,
    created_by,
    is_internal
  )
  VALUES (
    p_story_id,
    p_entry_type,
    p_content,
    COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_occurred_at, now()),
    p_document_id,
    v_user_id,
    false  -- Member entries are always visible to partner
  )
  RETURNING id INTO v_entry_id;

  -- Update story last_activity_at
  UPDATE partner_stories
  SET 
    last_activity_at = now(),
    unread_count = unread_count + 1
  WHERE id = p_story_id;

  -- Audit log (no sensitive data!)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'TIMELINE_ENTRY_CREATE',
    jsonb_build_object(
      'area', 'member_timeline',
      'severity', 'info',
      'entity_type', 'story_entry',
      'entity_id', v_entry_id,
      'entry_type', p_entry_type,
      'story_id', p_story_id,
      'is_backdated', p_occurred_at IS NOT NULL AND p_occurred_at < now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'story_id', p_story_id
  );
END;
$$;

-- Security: Revoke all, grant only to authenticated
REVOKE ALL ON FUNCTION public.add_timeline_entry_audited(uuid, text, text, jsonb, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_timeline_entry_audited(uuid, text, text, jsonb, timestamptz, uuid) TO authenticated;

COMMENT ON FUNCTION public.add_timeline_entry_audited(uuid, text, text, jsonb, timestamptz, uuid) IS 'Member adds an entry to their own timeline with optional backdating. Audit logged.';

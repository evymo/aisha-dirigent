-- Function: add_system_timeline_entry
-- Purpose: System trigger adds automatic entries to member timeline
-- Access: Internal only (called by triggers)
-- Security: SECURITY DEFINER with audit logging. Internal-only per the line above — and yet it
--   was GRANTed to `authenticated` until the 2026-07-15 IDOR fix
--   (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md). Any logged-in user could call it with
--   another user's p_user_id and fabricate 'system_'-prefixed entries — system_lab_result,
--   system_payment, system_document — in that user's timeline. Those entry types exist precisely
--   to mark records the PLATFORM vouches for, as opposed to what a member wrote themselves, so
--   forging them is forging provenance: a fabricated lab result or payment in someone's medical
--   timeline, indistinguishable from a real one. The v_system_types check bounded the TYPE of the
--   forgery, never the AUTHOR — it reads as a guard and is not one.
--   Its 12 callers are trigger functions: SECURITY DEFINER, executed as the owner, who keeps
--   EXECUTE by ownership. Nothing outside the database calls it, so the grant bought nothing.

CREATE OR REPLACE FUNCTION public.add_system_timeline_entry(
  p_user_id UUID,
  p_entry_type TEXT,
  p_content TEXT,
  p_metadata JSONB DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL,
  p_source_table TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_story RECORD;
  v_entry_id UUID;
  v_system_types TEXT[] := ARRAY[
    'system_registration',
    'system_order', 
    'system_lab_result',
    'system_check_in',
    'system_payment',
    'system_document',
    'system_questionnaire',
    'system_dosing',
    'system_health_sync'
  ];
BEGIN
  -- Validate entry type (only system types allowed)
  IF NOT (p_entry_type = ANY(v_system_types)) THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid system entry type: %s. Allowed: %s', p_entry_type, v_system_types::text), ERRCODE = '22023';
  END IF;

  -- Find user's primary story (or create one if not exists)
  SELECT ps.id
  INTO v_story
  FROM partner_stories ps
  WHERE ps.user_id = p_user_id
  ORDER BY ps.created_at ASC
  LIMIT 1;

  -- If user has no story, skip (they haven't opted into timeline yet)
  IF v_story.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_story'
    );
  END IF;

  -- Check for duplicate (same source within 1 minute to prevent trigger re-fires)
  IF p_source_table IS NOT NULL AND p_source_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM story_entries se
      WHERE se.story_id = v_story.id
        AND se.entry_type = p_entry_type
        AND se.metadata->>'source_table' = p_source_table
        AND (se.metadata->>'source_id')::uuid = p_source_id
        AND se.created_at > now() - interval '1 minute'
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'duplicate'
      );
    END IF;
  END IF;

  -- Create entry
  INSERT INTO story_entries (
    story_id,
    entry_type,
    content,
    metadata,
    occurred_at,
    created_by,
    is_internal
  )
  VALUES (
    v_story.id,
    p_entry_type,
    p_content,
    jsonb_build_object(
      'source_table', p_source_table,
      'source_id', p_source_id,
      'is_system', true
    ) || COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_occurred_at, now()),
    NULL,  -- System entries have no created_by
    false  -- Visible to partner
  )
  RETURNING id INTO v_entry_id;

  -- Update story last_activity_at
  UPDATE partner_stories
  SET last_activity_at = now()
  WHERE id = v_story.id;

  -- Audit log (no sensitive data!)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    p_user_id,
    'TIMELINE_SYSTEM_ENTRY',
    jsonb_build_object(
      'area', 'member_timeline',
      'severity', 'info',
      'entity_type', 'story_entry',
      'entity_id', v_entry_id,
      'entry_type', p_entry_type,
      'story_id', v_story.id,
      'source_table', p_source_table,
      'source_id', p_source_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'story_id', v_story.id
  );
END;
$$;

-- Security: This is internal function, but grant to authenticated for testing
REVOKE ALL ON FUNCTION public.add_system_timeline_entry(uuid, text, text, jsonb, timestamptz, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_system_timeline_entry(uuid, text, text, jsonb, timestamptz, text, uuid) TO service_role;

COMMENT ON FUNCTION public.add_system_timeline_entry(uuid, text, text, jsonb, timestamptz, text, uuid) IS 'System function to add automatic timeline entries from triggers. Internal use only.';

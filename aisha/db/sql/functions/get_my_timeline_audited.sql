-- Function: get_my_timeline_audited
-- Purpose: Member views their own health timeline (StoryLoop entries)
-- Access: Authenticated members only
-- Security: SECURITY DEFINER with audit logging

CREATE OR REPLACE FUNCTION public.get_my_timeline_audited(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_entry_types TEXT[] DEFAULT NULL,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_result JSONB;
  v_total_count INTEGER;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Count total matching entries
  SELECT COUNT(*)
  INTO v_total_count
  FROM story_entries se
  JOIN partner_stories ps ON ps.id = se.story_id
  WHERE ps.user_id = v_user_id
    AND se.is_internal = false
    AND (p_entry_types IS NULL OR se.entry_type = ANY(p_entry_types))
    AND (p_date_from IS NULL OR COALESCE(se.occurred_at, se.created_at) >= p_date_from)
    AND (p_date_to IS NULL OR COALESCE(se.occurred_at, se.created_at) <= p_date_to);

  -- Build timeline result
  SELECT jsonb_build_object(
    'user_id', v_user_id,
    'total_count', v_total_count,
    'entries', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'story_id', e.story_id,
          'entry_type', e.entry_type,
          'content', e.content,
          'metadata', e.metadata,
          'is_pinned', e.is_pinned,
          'document_id', e.document_id,
          'occurred_at', e.occurred_at,
          'created_at', e.created_at,
          'story_title', e.story_title,
          'partner_name', e.partner_name
        ) ORDER BY COALESCE(e.occurred_at, e.created_at) DESC
      ),
      '[]'::jsonb
    ),
    'stories', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ps.id,
            'title', ps.title,
            'status', ps.status,
            'priority', ps.priority,
            'last_activity_at', ps.last_activity_at,
            'partner_name', pp.business_name
          )
        )
        FROM partner_stories ps
        JOIN partner_profiles pp ON pp.id = ps.partner_id
        WHERE ps.user_id = v_user_id
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM (
    SELECT 
      se.id,
      se.story_id,
      se.entry_type,
      se.content,
      se.metadata,
      se.is_pinned,
      se.document_id,
      se.occurred_at,
      se.created_at,
      ps.title AS story_title,
      pp.business_name AS partner_name
    FROM story_entries se
    JOIN partner_stories ps ON ps.id = se.story_id
    JOIN partner_profiles pp ON pp.id = ps.partner_id
    WHERE ps.user_id = v_user_id
      AND se.is_internal = false
      AND (p_entry_types IS NULL OR se.entry_type = ANY(p_entry_types))
      AND (p_date_from IS NULL OR COALESCE(se.occurred_at, se.created_at) >= p_date_from)
      AND (p_date_to IS NULL OR COALESCE(se.occurred_at, se.created_at) <= p_date_to)
    ORDER BY COALESCE(se.occurred_at, se.created_at) DESC
    LIMIT p_limit
    OFFSET p_offset
  ) e;

  -- Audit log (no sensitive data!)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'TIMELINE_VIEW',
    jsonb_build_object(
      'area', 'member_timeline',
      'severity', 'info',
      'entry_count', v_total_count,
      'limit', p_limit,
      'offset', p_offset
    )
  );

  RETURN COALESCE(v_result, jsonb_build_object(
    'user_id', v_user_id,
    'total_count', 0,
    'entries', '[]'::jsonb,
    'stories', '[]'::jsonb
  ));
END;
$$;

-- Security: Revoke all, grant only to authenticated
REVOKE ALL ON FUNCTION public.get_my_timeline_audited(integer, integer, text[][], timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_timeline_audited(integer, integer, text[][], timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_my_timeline_audited(integer, integer, text[][], timestamptz, timestamptz) IS 'Member retrieves their own health timeline with audit logging. Returns entries across all their stories.';

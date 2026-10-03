-- ============================================================================
-- Function: update_archive_tag_admin
-- Purpose: Update an existing archive tag (admin only)
-- Access: Admin/Staff only
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_archive_tag_admin(
  p_id UUID,
  p_code TEXT DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL,
  p_name_key TEXT DEFAULT NULL,
  p_sort_order INTEGER DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  -- Authorization check
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: Admin or staff role required';
  END IF;

  -- Update (only non-null fields)
  UPDATE archive_tags
  SET
    code = COALESCE(lower(trim(p_code)), code),
    display_name = COALESCE(trim(p_display_name), display_name),
    name_key = COALESCE(p_name_key, name_key),
    sort_order = COALESCE(p_sort_order, sort_order),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = NOW()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tag not found: %', p_id;
  END IF;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'update',
    jsonb_build_object(
      'area', 'archive_tags',
      'tag_id', p_id
    )
  );

  RETURN TRUE;
END;
$$;

-- Security
REVOKE ALL ON FUNCTION public.update_archive_tag_admin(uuid, text, text, text, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_archive_tag_admin(uuid, text, text, text, integer, boolean) TO authenticated;

COMMENT ON FUNCTION public.update_archive_tag_admin(uuid, text, text, text, integer, boolean) IS 'Update an archive tag (admin only)';

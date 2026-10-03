-- ============================================================================
-- Function: delete_archive_tag_admin
-- Purpose: Delete an archive tag (admin only)
-- Access: Admin/Staff only
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_archive_tag_admin(
  p_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_category TEXT;
BEGIN
  -- Authorization check
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: Admin or staff role required';
  END IF;

  -- Get tag info for audit
  SELECT code, category::TEXT INTO v_code, v_category
  FROM archive_tags
  WHERE id = p_id;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Tag not found: %', p_id;
  END IF;

  -- Delete
  DELETE FROM archive_tags WHERE id = p_id;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'delete',
    jsonb_build_object(
      'area', 'archive_tags',
      'tag_id', p_id,
      'code', v_code,
      'category', v_category
    )
  );

  RETURN TRUE;
END;
$$;

-- Security
REVOKE ALL ON FUNCTION public.delete_archive_tag_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_archive_tag_admin(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_archive_tag_admin(uuid) IS 'Delete an archive tag (admin only)';

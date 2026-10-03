-- ============================================================================
-- Function: create_archive_tag_admin
-- Purpose: Create a new archive tag (admin only)
-- Access: Admin/Staff only
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_archive_tag_admin(
  p_code TEXT,
  p_category TEXT,
  p_display_name TEXT,
  p_name_key TEXT DEFAULT NULL,
  p_sort_order INTEGER DEFAULT 0,
  p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name_key TEXT;
BEGIN
  -- Authorization check
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: Admin or staff role required';
  END IF;

  -- Validate category
  IF p_category NOT IN ('person', 'keyword', 'preparation', 'facility', 'place') THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid category: %s', p_category), ERRCODE = '22023';
  END IF;

  -- Generate name_key if not provided
  v_name_key := COALESCE(
    p_name_key,
    'archive.tags.' || p_category || '.' || regexp_replace(lower(trim(p_code)), '[^a-z0-9]+', '_', 'g')
  );

  -- Insert
  INSERT INTO archive_tags (
    code,
    category,
    name_key,
    display_name,
    sort_order,
    is_active
  )
  VALUES (
    lower(trim(p_code)),
    p_category::archive_tag_category,
    v_name_key,
    trim(p_display_name),
    p_sort_order,
    p_is_active
  )
  RETURNING id INTO v_id;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'create',
    jsonb_build_object(
      'area', 'archive_tags',
      'tag_id', v_id,
      'category', p_category,
      'code', p_code
    )
  );

  RETURN v_id;
END;
$$;

-- Security
REVOKE ALL ON FUNCTION public.create_archive_tag_admin(text, text, text, text, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_archive_tag_admin(text, text, text, text, integer, boolean) TO authenticated;

COMMENT ON FUNCTION public.create_archive_tag_admin(text, text, text, text, integer, boolean) IS 'Create a new archive tag (admin only)';

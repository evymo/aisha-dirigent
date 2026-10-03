-- ============================================================================
-- Function: get_archive_tags
-- Purpose: Get all archive tags, optionally filtered by category
-- Access: Public (anon + authenticated)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_archive_tags(
  p_category TEXT DEFAULT NULL,
  p_active_only BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  id UUID,
  code TEXT,
  category TEXT,
  name_key TEXT,
  display_name TEXT,
  sort_order INTEGER,
  is_active BOOLEAN,
  usage_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.code,
    t.category::TEXT,
    t.name_key,
    t.display_name,
    t.sort_order,
    t.is_active,
    t.usage_count
  FROM archive_tags t
  WHERE
    (p_category IS NULL OR t.category::TEXT = p_category)
    AND (NOT p_active_only OR t.is_active = TRUE)
  ORDER BY
    t.category,
    t.usage_count DESC,
    t.sort_order,
    t.display_name;
END;
$$;

-- Security
REVOKE ALL ON FUNCTION public.get_archive_tags(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_archive_tags(text, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.get_archive_tags(text, boolean) TO authenticated;

COMMENT ON FUNCTION public.get_archive_tags(text, boolean) IS 'Get archive tags with optional category filter';

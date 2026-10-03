-- Function: public.get_media_assets_admin
-- Description: Galerie nahraných médií (nesmazané), nejnovější první, s hledáním
--              v původním jménu souboru a klíči objektu. Stránkuje se limit/offset.
-- Security: SECURITY DEFINER, admin/staff.
-- Created: 2026-09-24

CREATE OR REPLACE FUNCTION public.get_media_assets_admin(
  p_limit integer DEFAULT 60,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  bucket text,
  object_key text,
  content_type text,
  bytes bigint,
  original_name text,
  uploaded_by uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT m.id, m.bucket, m.object_key, m.content_type, m.bytes, m.original_name, m.uploaded_by, m.created_at
  FROM public.media_assets m
  WHERE m.deleted_at IS NULL
    AND (p_search IS NULL OR p_search = ''
         OR m.original_name ILIKE '%' || p_search || '%'
         OR m.object_key ILIKE '%' || p_search || '%')
  ORDER BY m.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_media_assets_admin(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_media_assets_admin(integer, integer, text) TO authenticated;
